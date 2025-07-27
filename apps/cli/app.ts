#!/usr/bin/env node

import { EdgeWorker, type EdgeWorkerConfig, type RepositoryConfig, SharedApplicationServer } from 'cyrus-edge-worker'
import type { Issue } from '@linear/sdk'
import dotenv from 'dotenv'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import open from 'open'
import readline from 'readline'
import http from 'http'
import { homedir } from 'os'

// Parse command line arguments
const args = process.argv.slice(2)
const envFileArg = args.find(arg => arg.startsWith('--env-file='))

// Note: __dirname removed since version is now hardcoded

// Handle --version argument
if (args.includes('--version')) {
  console.log('0.1.28')
  process.exit(0)
}

// Handle --help argument
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
cyrus - AI-powered Linear issue automation using Claude

Usage: cyrus [command] [options]

Commands:
  start              Start the edge worker (default)
  check-tokens       Check the status of all Linear tokens
  refresh-token      Refresh a specific Linear token

Options:
  --version          Show version number
  --help, -h         Show help
  --env-file=<path>  Load environment variables from file

Examples:
  cyrus                          Start the edge worker
  cyrus check-tokens             Check all Linear token statuses
  cyrus refresh-token            Interactive token refresh
`)
  process.exit(0)
}

// Load environment variables only if --env-file is specified
if (envFileArg) {
  const envFile = envFileArg.split('=')[1]
  if (envFile) {
    dotenv.config({ path: envFile })
  }

}

interface LinearCredentials {
  linearToken: string
  linearWorkspaceId: string
  linearWorkspaceName: string
}

interface EdgeConfig {
  repositories: RepositoryConfig[]
  ngrokAuthToken?: string
}


interface Workspace {
  path: string
  isGitWorktree: boolean
}


/**
 * Edge application that uses EdgeWorker from package
 */
class EdgeApp {
  private edgeWorker: EdgeWorker | null = null
  private isShuttingDown = false

  /**
   * Get the edge configuration file path
   */
  getEdgeConfigPath(): string {
    return resolve(homedir(), '.cyrus', 'config.json')
  }


  /**
   * Get the legacy edge configuration file path (for migration)
   */
  getLegacyEdgeConfigPath(): string {
    return resolve(process.cwd(), '.edge-config.json')
  }


  /**
   * Migrate configuration from legacy location if needed
   */
  private migrateConfigIfNeeded(): void {
    const newConfigPath = this.getEdgeConfigPath()
    const legacyConfigPath = this.getLegacyEdgeConfigPath()
    
    // If new config already exists, no migration needed
    if (existsSync(newConfigPath)) {
      return
    }
    
    // If legacy config doesn't exist, no migration needed
    if (!existsSync(legacyConfigPath)) {
      return
    }
    
    try {
      // Ensure the ~/.cyrus directory exists
      const configDir = dirname(newConfigPath)
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true })
      }
      
      // Copy the legacy config to the new location
      copyFileSync(legacyConfigPath, newConfigPath)
      
      console.log(`📦 Migrated configuration from ${legacyConfigPath} to ${newConfigPath}`)
      console.log(`💡 You can safely remove the old ${legacyConfigPath} file if desired`)
    } catch (error) {
      console.warn(`⚠️  Failed to migrate config from ${legacyConfigPath}:`, (error as Error).message)
      console.warn(`   Please manually copy your configuration to ${newConfigPath}`)
    }
  }


  /**
   * Load edge configuration (credentials and repositories)
   * Note: Strips promptTemplatePath from all repositories to ensure built-in template is used
   */
  loadEdgeConfig(): EdgeConfig {
    // Migrate from legacy location if needed
    this.migrateConfigIfNeeded()
    
    const edgeConfigPath = this.getEdgeConfigPath()
    let config: EdgeConfig = { repositories: [] }
    
    if (existsSync(edgeConfigPath)) {
      try {
        config = JSON.parse(readFileSync(edgeConfigPath, 'utf-8'))
      } catch (e) {
        console.error('Failed to load edge config:', (e as Error).message)
      }
    }
    
    // Strip promptTemplatePath from all repositories to ensure built-in template is used
    if (config.repositories) {
      config.repositories = config.repositories.map(repo => {
        const { promptTemplatePath, ...repoWithoutTemplate } = repo
        if (promptTemplatePath) {
          console.log(`Ignoring custom prompt template for repository: ${repo.name} (using built-in template)`)
        }
        return repoWithoutTemplate
      })
    }
    
    return config
  }

  
  /**
   * Save edge configuration
   */
  saveEdgeConfig(config: EdgeConfig): void {
    const edgeConfigPath = this.getEdgeConfigPath()
    const configDir = dirname(edgeConfigPath)
    
    // Ensure the ~/.cyrus directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    
    writeFileSync(edgeConfigPath, JSON.stringify(config, null, 2))
  }

  
  /**
   * Interactive setup wizard for repository configuration
   */
  async setupRepositoryWizard(linearCredentials: LinearCredentials): Promise<RepositoryConfig> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    const question = (prompt: string): Promise<string> => new Promise((resolve) => {
      rl.question(prompt, resolve)
    })
    
    console.log('\n📁 Repository Setup')
    console.log('─'.repeat(50))
    
    try {
      // Ask for repository details
      const repositoryPath = await question(`Repository path (default: ${process.cwd()}): `) || process.cwd()
      const repositoryName = await question(`Repository name (default: ${basename(repositoryPath)}): `) || basename(repositoryPath)
      const baseBranch = await question('Base branch (default: main): ') || 'main'
      // Create a path-safe version of the repository name for namespacing
      const repoNameSafe = repositoryName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
      const defaultWorkspaceDir = resolve(homedir(), '.cyrus', 'workspaces', repoNameSafe)
      const workspaceBaseDir = await question(`Workspace directory (default: ${defaultWorkspaceDir}): `) || defaultWorkspaceDir
      
      // Note: Prompt template is now hardcoded - no longer configurable
      
      // Ask for MCP configuration
      console.log('\n🔧 MCP (Model Context Protocol) Configuration')
      console.log('MCP allows Claude to access external tools and data sources.')
      console.log('Examples: filesystem access, database connections, API integrations')
      console.log('See: https://docs.anthropic.com/en/docs/claude-code/mcp')
      console.log('')
      const mcpConfigInput = await question('MCP config file path (optional, format: {"mcpServers": {...}}, e.g., ./mcp-config.json): ')
      const mcpConfigPath = mcpConfigInput.trim() || undefined
      
      // Ask for allowed tools configuration
      console.log('\n🔧 Tool Configuration')
      console.log('Available tools: Read(**),Edit(**),Bash,Task,WebFetch,WebSearch,TodoRead,TodoWrite,NotebookRead,NotebookEdit,Batch')
      console.log('')
      console.log('⚠️  SECURITY NOTE: Bash tool requires special configuration for safety:')
      console.log('   • Use "Bash" for full access (not recommended in production)')
      console.log('   • Use "Bash(npm:*)" to restrict to npm commands only')
      console.log('   • Use "Bash(git:*)" to restrict to git commands only')
      console.log('   • See: https://docs.anthropic.com/en/docs/claude-code/settings#permissions')
      console.log('')
      console.log('Default: All tools except Bash (leave blank for all non-Bash tools)')
      const allowedToolsInput = await question('Allowed tools (comma-separated, default: all except Bash): ')
      const allowedTools = allowedToolsInput ? allowedToolsInput.split(',').map(t => t.trim()) : undefined
      
      // Ask for team keys configuration
      console.log('\n🏷️ Team-Based Routing (Optional)')
      console.log('Configure specific Linear team keys to route issues to this repository.')
      console.log('Example: CEE,FRONT,BACK for teams with those prefixes')
      console.log('Leave blank to receive all issues from the workspace.')
      const teamKeysInput = await question('Team keys (comma-separated, optional): ')
      const teamKeys = teamKeysInput ? teamKeysInput.split(',').map(t => t.trim().toUpperCase()) : undefined

      // Ask for label-based system prompt configuration
      console.log('\n🎯 Label-Based System Prompts (Optional)')
      console.log('Cyrus can use different strategies based on Linear issue labels.')
      console.log('Configure which labels trigger each specialized mode:')
      console.log('• Debugger mode: Focuses on systematic problem investigation')
      console.log('• Builder mode: Emphasizes feature implementation and code quality')
      console.log('• Scoper mode: Helps analyze requirements and create technical plans')
      
      const debuggerLabelsInput = await question('Labels for debugger mode (comma-separated, e.g., "Bug"): ')
      const builderLabelsInput = await question('Labels for builder mode (comma-separated, e.g., "Feature,Improvement"): ')
      const scoperLabelsInput = await question('Labels for scoper mode (comma-separated, e.g., "PRD"): ')
      
      const labelPrompts = (debuggerLabelsInput || builderLabelsInput || scoperLabelsInput) ? {
        ...(debuggerLabelsInput && { debugger: debuggerLabelsInput.split(',').map(l => l.trim()) }),
        ...(builderLabelsInput && { builder: builderLabelsInput.split(',').map(l => l.trim()) }),
        ...(scoperLabelsInput && { scoper: scoperLabelsInput.split(',').map(l => l.trim()) })
      } : undefined
      
      rl.close()
      
      // Create repository configuration
      const repository: RepositoryConfig = {
        id: `${linearCredentials.linearWorkspaceId}-${Date.now()}`,
        name: repositoryName,
        repositoryPath: resolve(repositoryPath),
        baseBranch,
        linearWorkspaceId: linearCredentials.linearWorkspaceId,
        linearToken: linearCredentials.linearToken,
        workspaceBaseDir: resolve(workspaceBaseDir),
        isActive: true,
        ...(allowedTools && { allowedTools }),
        ...(mcpConfigPath && { mcpConfigPath: resolve(mcpConfigPath) }),
        ...(teamKeys && { teamKeys }),
        ...(labelPrompts && { labelPrompts })
      }
      
      return repository
      
    } catch (error) {
      rl.close()
      throw error
    }
  }

  
  
  /**
   * Start OAuth flow to get Linear token using EdgeWorker's shared server
   */
  async startOAuthFlow(proxyUrl: string): Promise<LinearCredentials> {
    if (this.edgeWorker) {
      // Use existing EdgeWorker's OAuth flow
      const port = this.edgeWorker.getServerPort()
      
      // Construct OAuth URL with callback
      const callbackBaseUrl = process.env.CYRUS_BASE_URL || `http://localhost:${port}`
      const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`
      
      console.log(`\n👉 Opening your browser to authorize with Linear...`)
      console.log(`If the browser doesn't open, visit: ${authUrl}`)
      
      open(authUrl).catch(() => {
        console.log(`\n⚠️  Could not open browser automatically`)
        console.log(`Please visit: ${authUrl}`)
      })
      
      console.log(`\n⏳ Waiting for authorization...`)
      
      return this.edgeWorker.startOAuthFlow(proxyUrl)
    } else {
      // Create temporary SharedApplicationServer for OAuth flow during initial setup
      const serverPort = process.env.CYRUS_SERVER_PORT ? parseInt(process.env.CYRUS_SERVER_PORT, 10) : 3456
      const tempServer = new SharedApplicationServer(serverPort)
      
      try {
        // Start the server
        await tempServer.start()
        const port = tempServer.getPort()
        
        // Construct OAuth URL with callback
        const callbackBaseUrl = process.env.CYRUS_BASE_URL || `http://localhost:${port}`
        const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`
        
        console.log(`\n👉 Opening your browser to authorize with Linear...`)
        console.log(`If the browser doesn't open, visit: ${authUrl}`)
        
        open(authUrl).catch(() => {
          console.log(`\n⚠️  Could not open browser automatically`)
          console.log(`Please visit: ${authUrl}`)
        })
        
        console.log(`\n⏳ Waiting for authorization...`)
        
        // Use temporary server's OAuth flow
        const result = await tempServer.startOAuthFlow(proxyUrl)
        
        return {
          linearToken: result.linearToken,
          linearWorkspaceId: result.linearWorkspaceId,
          linearWorkspaceName: result.linearWorkspaceName
        }
      } finally {
        // Clean up temporary server
        await tempServer.stop()
      }
    }
  }


  /**
   * Get ngrok auth token from config or prompt user
   */
  async getNgrokAuthToken(config: EdgeConfig): Promise<string | undefined> {
    // Return existing token if available
    if (config.ngrokAuthToken) {
      return config.ngrokAuthToken
    }

    // Prompt user for ngrok auth token
    console.log(`\n🔗 Ngrok Setup Required`)
    console.log(`─`.repeat(50))
    console.log(`Linear payloads need to reach your computer, so we use the secure technology ngrok for that.`)
    console.log(`This requires a free ngrok account and auth token.`)
    console.log(``)
    console.log(`To get your ngrok auth token:`)
    console.log(`1. Sign up at https://ngrok.com/ (free)`)
    console.log(`2. Go to https://dashboard.ngrok.com/get-started/your-authtoken`)
    console.log(`3. Copy your auth token`)
    console.log(``)
    console.log(`Alternatively, you can set CYRUS_HOST_EXTERNAL=true and CYRUS_BASE_URL`)
    console.log(`to handle port forwarding or reverse proxy yourself.`)
    console.log(``)

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise((resolve) => {
      rl.question(`Enter your ngrok auth token (or press Enter to skip): `, async (token) => {
        rl.close()
        
        if (!token.trim()) {
          console.log(`\n⚠️  Skipping ngrok setup. You can set CYRUS_HOST_EXTERNAL=true and CYRUS_BASE_URL manually.`)
          resolve(undefined)
          return
        }

        // Save token to config
        config.ngrokAuthToken = token.trim()
        try {
          this.saveEdgeConfig(config)
          console.log(`✅ Ngrok auth token saved to config`)
          resolve(token.trim())
        } catch (error) {
          console.error(`❌ Failed to save ngrok auth token:`, error)
          resolve(token.trim()) // Still use the token for this session
        }
      })
    })
  }

  
  /**
   * Start the EdgeWorker with given configuration
   */
  async startEdgeWorker({ proxyUrl, repositories }: { proxyUrl: string; repositories: RepositoryConfig[] }): Promise<void> {
    // Get ngrok auth token (prompt if needed and not external host)
    let ngrokAuthToken: string | undefined
    if (process.env.CYRUS_HOST_EXTERNAL !== "true") {
      const config = this.loadEdgeConfig()
      ngrokAuthToken = await this.getNgrokAuthToken(config)
    }

    // Create EdgeWorker configuration
    const config: EdgeWorkerConfig = {
      proxyUrl,
      repositories,
      defaultAllowedTools: process.env.ALLOWED_TOOLS?.split(",").map(t => t.trim()) || [],
      webhookBaseUrl: process.env.CYRUS_BASE_URL,
      serverPort: process.env.CYRUS_SERVER_PORT ? parseInt(process.env.CYRUS_SERVER_PORT, 10) : 3456,
      serverHost: process.env.CYRUS_HOST_EXTERNAL === "true" ? "0.0.0.0" : "localhost",
      ngrokAuthToken,
      features: {
        enableContinuation: true
      },
      handlers: {
        createWorkspace: async (issue: Issue, repository: RepositoryConfig): Promise<Workspace> => {
          return this.createGitWorktree(issue, repository)
        },
        onOAuthCallback: async (token: string, workspaceId: string, workspaceName: string): Promise<void> => {
          const linearCredentials: LinearCredentials = {
            linearToken: token,
            linearWorkspaceId: workspaceId,
            linearWorkspaceName: workspaceName
          }
          
          // Handle OAuth completion for repository setup
          if (this.edgeWorker) {
            console.log("\n📋 Setting up new repository for workspace:", workspaceName)
            console.log("─".repeat(50))
            
            try {
              const newRepo = await this.setupRepositoryWizard(linearCredentials)
              
              // Add to existing repositories
              let edgeConfig = this.loadEdgeConfig()
              console.log(`📊 Current config has ${edgeConfig.repositories?.length || 0} repositories`)
              edgeConfig.repositories = [...(edgeConfig.repositories || []), newRepo]
              console.log(`📊 Adding repository "${newRepo.name}", new total: ${edgeConfig.repositories.length}`)
              this.saveEdgeConfig(edgeConfig)
                            console.log('\n✅ Repository configured successfully!')
              console.log('📝 ~/.cyrus/config.json file has been updated with your new repository configuration.')
              console.log('💡 You can edit this file and restart Cyrus at any time to modify settings.')
              
              // Restart edge worker with new config
              await this.edgeWorker!.stop()
              this.edgeWorker = null
              
              // Give a small delay to ensure file is written
              await new Promise(resolve => setTimeout(resolve, 100))
              
              // Reload configuration and restart worker without going through setup
              const updatedConfig = this.loadEdgeConfig()
              console.log(`\n🔄 Reloading with ${updatedConfig.repositories?.length || 0} repositories from config file`)
              
              return this.startEdgeWorker({ 
                proxyUrl, 
                repositories: updatedConfig.repositories || [] 
              })
              
            } catch (error) {
              console.error('\n❌ Repository setup failed:', (error as Error).message)
            }
          }
        }
      }
    }
    
    // Create and start EdgeWorker
    this.edgeWorker = new EdgeWorker(config)
    
    // Set up event handlers
    this.setupEventHandlers()
    
    // Start the worker
    await this.edgeWorker.start()
    
    console.log('\n✅ Edge worker started successfully')
    console.log(`Configured proxy URL: ${config.proxyUrl}`)
    console.log(`Managing ${repositories.length} repositories:`)
    repositories.forEach(repo => {
      console.log(`  - ${repo.name} (${repo.repositoryPath})`)
    })
  }


  /**
   * Start the edge application
   */
  async start(): Promise<void> {
    try {
      // Set proxy URL with default
      const proxyUrl = process.env.PROXY_URL || 'https://cyrus-proxy.ceedar.workers.dev'
      
      // No need to validate Claude CLI - using Claude TypeScript SDK now
      
      
      // Load edge configuration
      let edgeConfig = this.loadEdgeConfig()
      let repositories = edgeConfig.repositories || []
      
      // Check if we need to set up
      const needsSetup = repositories.length === 0
      const hasLinearCredentials = repositories.some(r => r.linearToken) || process.env.LINEAR_OAUTH_TOKEN
      
      if (needsSetup) {
        console.log('🚀 Welcome to Cyrus Edge Worker!')
        
        // Check if they want to use existing credentials or add new workspace
        let linearCredentials: LinearCredentials | null = null
        
        if (hasLinearCredentials) {
          // Show available workspaces from existing repos
          const workspaces = new Map<string, { id: string; name: string; token: string }>()
          for (const repo of (edgeConfig.repositories || [])) {
            if (!workspaces.has(repo.linearWorkspaceId)) {
              workspaces.set(repo.linearWorkspaceId, {
                id: repo.linearWorkspaceId,
                name: 'Unknown Workspace',
                token: repo.linearToken
              })
            }
          }
          
          if (workspaces.size === 1) {
            // Only one workspace, use it
            const ws = Array.from(workspaces.values())[0]
            if (ws) {
              linearCredentials = {
                linearToken: ws.token,
                linearWorkspaceId: ws.id,
                linearWorkspaceName: ws.name
              }
              console.log(`\n📋 Using Linear workspace: ${linearCredentials.linearWorkspaceName}`)
            }
          } else if (workspaces.size > 1) {
            // Multiple workspaces, let user choose
            console.log('\n📋 Available Linear workspaces:')
            const workspaceList = Array.from(workspaces.values())
            workspaceList.forEach((ws, i) => {
              console.log(`${i + 1}. ${ws.name}`)
            })
            
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout
            })
            
            const choice = await new Promise<string>(resolve => {
              rl.question('\nSelect workspace (number) or press Enter for new: ', resolve)
            })
            rl.close()
            
            const index = parseInt(choice) - 1
            if (index >= 0 && index < workspaceList.length) {
              const ws = workspaceList[index]
              if (ws) {
                linearCredentials = {
                  linearToken: ws.token,
                  linearWorkspaceId: ws.id,
                  linearWorkspaceName: ws.name
                }
                console.log(`Using workspace: ${linearCredentials.linearWorkspaceName}`)
              }
            } else {
              // Get new credentials
              linearCredentials = null
            }
          } else if (process.env.LINEAR_OAUTH_TOKEN) {
            // Use env vars
            linearCredentials = {
              linearToken: process.env.LINEAR_OAUTH_TOKEN,
              linearWorkspaceId: process.env.LINEAR_WORKSPACE_ID || 'unknown',
              linearWorkspaceName: 'Your Workspace'
            }
          }
          
          if (linearCredentials) {
            console.log('(OAuth server will start with EdgeWorker to connect additional workspaces)')
          }
        } else {
          // Get new Linear credentials
          console.log('\n📋 Step 1: Connect to Linear')
          console.log('─'.repeat(50))
          
          try {
            linearCredentials = await this.startOAuthFlow(proxyUrl)
            console.log('\n✅ Linear connected successfully!')
          } catch (error) {
            console.error('\n❌ OAuth flow failed:', (error as Error).message)
            console.log('\nAlternatively, you can:')
            console.log('1. Visit', `${proxyUrl}/oauth/authorize`, 'in your browser')
            console.log('2. Copy the token after authorization')
            console.log('3. Add it to your .env.cyrus file as LINEAR_OAUTH_TOKEN')
            process.exit(1)
          }
        }
        
        if (!linearCredentials) {
          console.error('❌ No Linear credentials available')
          process.exit(1)
        }
        
        // Now set up repository
        console.log('\n📋 Step 2: Configure Repository')
        console.log('─'.repeat(50))
        
        try {
          const newRepo = await this.setupRepositoryWizard(linearCredentials)
          
          // Add to repositories
          repositories = [...(edgeConfig.repositories || []), newRepo]
          edgeConfig.repositories = repositories
          this.saveEdgeConfig(edgeConfig)
          
          console.log('\n✅ Repository configured successfully!')
          console.log('📝 ~/.cyrus/config.json file has been updated with your repository configuration.')
          console.log('💡 You can edit this file and restart Cyrus at any time to modify settings.')
          
          // Ask if they want to add another
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          })
          const addAnother = await new Promise<boolean>(resolve => {
            rl.question('\nAdd another repository? (y/N): ', answer => {
              rl.close()
              resolve(answer.toLowerCase() === 'y')
            })
          })
          
          if (addAnother) {
            // Restart setup flow
            return this.start()
          }
        } catch (error) {
          console.error('\n❌ Repository setup failed:', (error as Error).message)
          process.exit(1)
        }
      }
      
      // Validate we have repositories
      if (repositories.length === 0) {
        console.error('❌ No repositories configured')
        console.log('\nUse the authorization link above to configure your first repository.')
        process.exit(1)
      }
      
      // Start the edge worker
      await this.startEdgeWorker({ proxyUrl, repositories })
      
      // Display OAuth information after EdgeWorker is started
      const serverPort = this.edgeWorker?.getServerPort() || 3456
      const oauthCallbackBaseUrl = process.env.CYRUS_BASE_URL || `http://localhost:${serverPort}`
      console.log(`\n🔐 OAuth server running on port ${serverPort}`)
      console.log(`👉 To authorize Linear (new workspace or re-auth):`)
      console.log(`   ${proxyUrl}/oauth/authorize?callback=${oauthCallbackBaseUrl}/callback`)
      console.log('─'.repeat(70))
      
      // Handle graceful shutdown
      process.on('SIGINT', () => this.shutdown())
      process.on('SIGTERM', () => this.shutdown())
      
      // Handle uncaught exceptions and unhandled promise rejections
      process.on('uncaughtException', (error) => {
        console.error('🚨 Uncaught Exception:', error.message)
        console.error('Error type:', error.constructor.name)
        console.error('Stack:', error.stack)
        console.error('This error was caught by the global handler, preventing application crash')
        
        // Attempt graceful shutdown but don't wait indefinitely
        this.shutdown().finally(() => {
          console.error('Process exiting due to uncaught exception')
          process.exit(1)
        })
      })
      
      process.on('unhandledRejection', (reason, promise) => {
        console.error('🚨 Unhandled Promise Rejection at:', promise)
        console.error('Reason:', reason)
        console.error('This rejection was caught by the global handler, continuing operation')
        
        // Log stack trace if reason is an Error
        if (reason instanceof Error && reason.stack) {
          console.error('Stack:', reason.stack)
        }
        
        // Log the error but don't exit the process for promise rejections
        // as they might be recoverable
      })
      
    } catch (error: any) {
      console.error('\n❌ Failed to start edge application:', error.message)
      
      // Provide more specific guidance for common errors
      if (error.message?.includes('Failed to connect any repositories')) {
        console.error('\n💡 This usually happens when:')
        console.error('   - All Linear OAuth tokens have expired')
        console.error('   - The Linear API is temporarily unavailable')
        console.error('   - Your network connection is having issues')
        console.error('\nPlease check your edge configuration and try again.')
      }
      
      await this.shutdown()
      process.exit(1)
    }
  }

  
  /**
   * Set up event handlers for EdgeWorker
   */
  setupEventHandlers(): void {
    if (!this.edgeWorker) return
    
    // Session events
    this.edgeWorker.on('session:started', (issueId: string, _issue: Issue, repositoryId: string) => {
      console.log(`Started session for issue ${issueId} in repository ${repositoryId}`)
    })
    
    this.edgeWorker.on('session:ended', (issueId: string, exitCode: number | null, repositoryId: string) => {
      console.log(`Session for issue ${issueId} ended with exit code ${exitCode} in repository ${repositoryId}`)
    })
    
    // Connection events
    this.edgeWorker.on('connected', (token: string) => {
      console.log(`✅ Connected to proxy with token ending in ...${token.slice(-4)}`)
    })
    
    this.edgeWorker.on('disconnected', (token: string, reason?: string) => {
      console.error(`❌ Disconnected from proxy (token ...${token.slice(-4)}): ${reason || 'Unknown reason'}`)
    })
    
    // Error events
    this.edgeWorker.on('error', (error: Error) => {
      console.error('EdgeWorker error:', error)
    })
  }

  
  /**
   * Create a git worktree for an issue
   */
  async createGitWorktree(issue: Issue, repository: RepositoryConfig): Promise<Workspace> {
    const { execSync } = await import('child_process')
    const { existsSync } = await import('fs')
    const { join } = await import('path')
    
    try {
      // Verify this is a git repository
      try {
        execSync('git rev-parse --git-dir', {
          cwd: repository.repositoryPath,
          stdio: 'pipe'
        })
      } catch (e) {
        console.error(`${repository.repositoryPath} is not a git repository`)
        throw new Error('Not a git repository')
      }
      
      // Sanitize branch name by removing backticks to prevent command injection
      const sanitizeBranchName = (name: string): string => name ? name.replace(/`/g, '') : name
      
      // Use Linear's preferred branch name, or generate one if not available
      const rawBranchName = issue.branchName || `${issue.identifier}-${issue.title?.toLowerCase().replace(/\s+/g, '-').substring(0, 30)}`
      const branchName = sanitizeBranchName(rawBranchName)
      const workspacePath = join(repository.workspaceBaseDir, issue.identifier)
      
      // Ensure workspace directory exists
      execSync(`mkdir -p "${repository.workspaceBaseDir}"`, { 
        cwd: repository.repositoryPath,
        stdio: 'pipe'
      })
      
      // Check if worktree already exists
      try {
        const worktrees = execSync('git worktree list --porcelain', {
          cwd: repository.repositoryPath,
          encoding: 'utf-8'
        })
        
        if (worktrees.includes(workspacePath)) {
          console.log(`Worktree already exists at ${workspacePath}, using existing`)
          return {
            path: workspacePath,
            isGitWorktree: true
          }
        }
      } catch (e) {
        // git worktree command failed, continue with creation
      }
      
      // Check if branch already exists
      let createBranch = true
      try {
        execSync(`git rev-parse --verify "${branchName}"`, {
          cwd: repository.repositoryPath,
          stdio: 'pipe'
        })
        createBranch = false
      } catch (e) {
        // Branch doesn't exist, we'll create it
      }
      
      // Fetch latest changes from remote
      console.log('Fetching latest changes from remote...')
      let hasRemote = true
      try {
        execSync('git fetch origin', {
          cwd: repository.repositoryPath,
          stdio: 'pipe'
        })
      } catch (e) {
        console.warn('Warning: git fetch failed, proceeding with local branch:', (e as Error).message)
        hasRemote = false
      }

      // Create the worktree - use remote branch if available, otherwise local
      let worktreeCmd: string
      if (createBranch) {
        if (hasRemote) {
          const remoteBranch = `origin/${repository.baseBranch}`
          console.log(`Creating git worktree at ${workspacePath} from ${remoteBranch}`)
          worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${remoteBranch}"`
        } else {
          // No remote, use local base branch
          console.log(`Creating git worktree at ${workspacePath} from local ${repository.baseBranch}`)
          worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${repository.baseBranch}"`
        }
      } else {
        // Branch already exists, just check it out
        console.log(`Creating git worktree at ${workspacePath} with existing branch ${branchName}`)
        worktreeCmd = `git worktree add "${workspacePath}" "${branchName}"`
      }
      
      execSync(worktreeCmd, {
        cwd: repository.repositoryPath,
        stdio: 'pipe'
      })
      
      // Check for cyrus-setup.sh script in the repository root
      const setupScriptPath = join(repository.repositoryPath, 'cyrus-setup.sh')
      if (existsSync(setupScriptPath)) {
        console.log('Running cyrus-setup.sh in new worktree...')
        try {
          execSync('bash cyrus-setup.sh', {
            cwd: workspacePath,
            stdio: 'inherit',
            env: {
              ...process.env,
              LINEAR_ISSUE_ID: issue.id,
              LINEAR_ISSUE_IDENTIFIER: issue.identifier,
              LINEAR_ISSUE_TITLE: issue.title || ''
            }
          })
        } catch (error) {
          console.warn('Warning: cyrus-setup.sh failed:', (error as Error).message)
          // Continue despite setup script failure
        }
      }
      
      return {
        path: workspacePath,
        isGitWorktree: true
      }
    } catch (error) {
      console.error('Failed to create git worktree:', (error as Error).message)
      // Fall back to regular directory if git worktree fails
      const fallbackPath = join(repository.workspaceBaseDir, issue.identifier)
      execSync(`mkdir -p "${fallbackPath}"`, { stdio: 'pipe' })
      return {
        path: fallbackPath,
        isGitWorktree: false
      }
    }
  }


  /**
   * Shut down the application
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    
    console.log('\nShutting down edge worker...')
    
    // Stop edge worker (includes stopping shared application server)
    if (this.edgeWorker) {
      await this.edgeWorker.stop()
    }
    
    console.log('Shutdown complete')
    process.exit(0)
  }

}

// Helper function to check Linear token status
async function checkLinearToken(token: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({
        query: '{ viewer { id email name } }'
      })
    })
    
    const data = await response.json() as any
    
    if (data.errors) {
      return { valid: false, error: data.errors[0]?.message || 'Unknown error' }
    }
    
    return { valid: true }
  } catch (error) {

    return { valid: false, error: (error as Error).message }
  }

}

// Command: check-tokens
async function checkTokensCommand() {
  const app = new EdgeApp()
  const configPath = app.getEdgeConfigPath()
  
  if (!existsSync(configPath)) {
    console.error('No edge configuration found. Please run setup first.')
    process.exit(1)
  }

  
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as EdgeConfig
  
  console.log('Checking Linear tokens...\n')
  
  for (const repo of config.repositories) {
    process.stdout.write(`${repo.name} (${repo.linearWorkspaceName}): `)
    const result = await checkLinearToken(repo.linearToken)
    
    if (result.valid) {
      console.log('✅ Valid')
    } else {
      console.log(`❌ Invalid - ${result.error}`)
    }
  }

}

// Command: refresh-token
async function refreshTokenCommand() {
  const app = new EdgeApp()
  const configPath = app.getEdgeConfigPath()
  
  if (!existsSync(configPath)) {
    console.error('No edge configuration found. Please run setup first.')
    process.exit(1)
  }

  
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as EdgeConfig
  
  // Show repositories with their token status
  console.log('Checking current token status...\n')
  const tokenStatuses: Array<{ repo: RepositoryConfig; valid: boolean }> = []
  
  for (const repo of config.repositories) {
    const result = await checkLinearToken(repo.linearToken)
    tokenStatuses.push({ repo, valid: result.valid })
    console.log(`${tokenStatuses.length}. ${repo.name} (${repo.linearWorkspaceName}): ${result.valid ? '✅ Valid' : '❌ Invalid'}`)
  }

  
  // Ask which token to refresh
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  
  const answer = await new Promise<string>(resolve => {
    rl.question('\nWhich repository token would you like to refresh? (Enter number or "all"): ', resolve)
  })

  
  const indicesToRefresh: number[] = []
  
  if (answer.toLowerCase() === 'all') {
    indicesToRefresh.push(...Array.from({ length: tokenStatuses.length }, (_, i) => i))
  } else {

    const index = parseInt(answer) - 1
    if (isNaN(index) || index < 0 || index >= tokenStatuses.length) {
      console.error('Invalid selection')
      rl.close()
      process.exit(1)
    }
    indicesToRefresh.push(index)
  }

  
  // Refresh tokens
  for (const index of indicesToRefresh) {
    const tokenStatus = tokenStatuses[index]
    if (!tokenStatus) continue
    
    const { repo } = tokenStatus
    console.log(`\nRefreshing token for ${repo.name} (${repo.linearWorkspaceName || repo.linearWorkspaceId})...`)
    console.log('Opening Linear OAuth flow in your browser...')
    
    // Use the proxy's OAuth flow with a callback to localhost
    const serverPort = process.env.CYRUS_SERVER_PORT ? parseInt(process.env.CYRUS_SERVER_PORT, 10) : 3456
    const callbackUrl = `http://localhost:${serverPort}/callback`
    const oauthUrl = `https://cyrus-proxy.ceedar.workers.dev/oauth/authorize?callback=${encodeURIComponent(callbackUrl)}`
    
    console.log(`\nPlease complete the OAuth flow in your browser.`)
    console.log(`If the browser doesn't open automatically, visit:\n${oauthUrl}\n`)
    
    // Start a temporary server to receive the OAuth callback
    let tokenReceived: string | null = null
    
    const server = await new Promise<any>((resolve) => {
      const s = http.createServer((req: any, res: any) => {
        if (req.url?.startsWith('/callback')) {
          const url = new URL(req.url, `http://localhost:${serverPort}`)
          tokenReceived = url.searchParams.get('token')
          
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <html>
              <head>
                <meta charset="UTF-8">
              </head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h2>✅ Authorization successful!</h2>
                <p>You can close this window and return to your terminal.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `)
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
      })
      s.listen(serverPort, () => {
        console.log('Waiting for OAuth callback...')
        resolve(s)
      })
    })
    
    await open(oauthUrl)
    
    // Wait for the token with timeout
    const startTime = Date.now()
    while (!tokenReceived && Date.now() - startTime < 120000) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    server.close()
    
    const newToken = tokenReceived
    
    if (!newToken || !(newToken as string).startsWith('lin_oauth_')) {
      console.error('Invalid token received from OAuth flow')
      continue
    }
    
    // Verify the new token
    const verifyResult = await checkLinearToken(newToken)
    if (!verifyResult.valid) {
      console.error(`❌ New token is invalid: ${verifyResult.error}`)
      continue
    }
    
    // Update the config - update ALL repositories that had the same old token
    const oldToken = repo.linearToken
    let updatedCount = 0
    
    for (let i = 0; i < config.repositories.length; i++) {
      const currentRepo = config.repositories[i]
      if (currentRepo && currentRepo.linearToken === oldToken) {
        currentRepo.linearToken = newToken
        updatedCount++
        console.log(`✅ Updated token for ${currentRepo.name}`)
      }
    }
    
    if (updatedCount > 1) {
      console.log(`\n📝 Updated ${updatedCount} repositories that shared the same token`)
    }
  }

  
  // Save the updated config
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  console.log('\n✅ Configuration saved')
  
  rl.close()
}

// Parse command
const command = args[0] || 'start'

// Execute appropriate command
switch (command) {
  case 'check-tokens':
    checkTokensCommand().catch(error => {
      console.error('Error:', error)
      process.exit(1)
    })
    break
    
  case 'refresh-token':
    refreshTokenCommand().catch(error => {
      console.error('Error:', error)
      process.exit(1)
    })
    break
    
  case 'start':
  default:
    // Create and start the app
    const app = new EdgeApp()
    app.start().catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
    break
}