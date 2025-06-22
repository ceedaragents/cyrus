#!/usr/bin/env node

import { EdgeWorker, type EdgeWorkerConfig, type RepositoryConfig } from 'cyrus-edge-worker'
import type { Issue } from '@linear/sdk'
import dotenv from 'dotenv'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { createServer, type Server } from 'http'
import { URL } from 'url'
import open from 'open'
import readline from 'readline'
import type { IncomingMessage, ServerResponse } from 'http'

// Parse command line arguments
const args = process.argv.slice(2)
const envFileArg = args.find(arg => arg.startsWith('--env-file='))

// Get __dirname for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url))

// Handle --version argument
if (args.includes('--version')) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
    console.log(pkg.version)
  } catch {
    console.log('0.1.8') // fallback version
  }
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
}

interface OAuthCallback {
  resolve: (credentials: LinearCredentials) => void
  reject: (error: Error) => void
  id: string
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
  private oauthServer: Server | null = null
  private oauthCallbacks: Map<string, OAuthCallback> = new Map()
  private onOAuthComplete?: (credentials: LinearCredentials) => Promise<void>

  /**
   * Load edge configuration (credentials and repositories)
   * Note: Strips promptTemplatePath from all repositories to ensure built-in template is used
   */
  loadEdgeConfig(): EdgeConfig {
    const edgeConfigPath = './.edge-config.json'
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
    writeFileSync('./.edge-config.json', JSON.stringify(config, null, 2))
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
      const workspaceBaseDir = await question(`Workspace directory (default: ${repositoryPath}/workspaces): `) || `${repositoryPath}/workspaces`
      
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
        ...(teamKeys && { teamKeys })
      }
      
      return repository
      
    } catch (error) {
      rl.close()
      throw error
    }
  }
  
  /**
   * Start OAuth server to handle callbacks
   */
  startOAuthServer(port: number): void {
    if (this.oauthServer) return // Already running
    
    this.oauthCallbacks = new Map() // Store pending callbacks
    
    this.oauthServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url!, `http://localhost:${port}`)
      
      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token')
        const workspaceId = url.searchParams.get('workspaceId')
        const workspaceName = url.searchParams.get('workspaceName')
        
        if (token && workspaceId && workspaceName) {
          // Success! Return the Linear credentials (don't save yet)
          const linearCredentials: LinearCredentials = { 
            linearToken: token,
            linearWorkspaceId: workspaceId,
            linearWorkspaceName: workspaceName
          }
          
          // Send success response
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8">
                <title>Authorization Successful</title>
              </head>
              <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
                <h1>✅ Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <p>Your Linear workspace <strong>${workspaceName}</strong> has been connected.</p>
                <p style="margin-top: 30px;">
                  <a href="${process.env.PROXY_URL}/oauth/authorize?callback=http://localhost:${port}/callback" 
                     style="padding: 10px 20px; background: #5E6AD2; color: white; text-decoration: none; border-radius: 5px;">
                    Connect Another Workspace
                  </a>
                </p>
                <script>setTimeout(() => window.close(), 10000)</script>
              </body>
            </html>
          `)
          
          // Emit event for any waiting promise
          if (this.oauthCallbacks.size > 0) {
            const callback = this.oauthCallbacks.values().next().value
            if (callback) {
              callback.resolve(linearCredentials)
              this.oauthCallbacks.delete(callback.id)
            }
          }
          
          // Also emit event for edge app to handle
          if (this.onOAuthComplete) {
            this.onOAuthComplete(linearCredentials)
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<h1>Error: No token received</h1>')
          
          // Reject any waiting promises
          for (const [id, callback] of this.oauthCallbacks) {
            callback.reject(new Error('No token received'))
            this.oauthCallbacks.delete(id)
          }
        }
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    
    this.oauthServer.listen(port, () => {
      console.log(`OAuth callback server listening on port ${port}`)
    })
  }
  
  /**
   * Start OAuth flow to get Linear token
   */
  async startOAuthFlow(proxyUrl: string): Promise<LinearCredentials> {
    const port = 3457 // Different from proxy port
    
    // Ensure OAuth server is running
    if (!this.oauthServer) {
      this.startOAuthServer(port)
    }
    
    return new Promise<LinearCredentials>((resolve, reject) => {
      // Generate unique ID for this flow
      const flowId = Date.now().toString()
      
      // Store callback for this flow
      this.oauthCallbacks.set(flowId, { resolve, reject, id: flowId })
      
      // Construct OAuth URL with callback
      const authUrl = `${proxyUrl}/oauth/authorize?callback=http://localhost:${port}/callback`
      
      console.log(`\n👉 Opening your browser to authorize with Linear...`)
      console.log(`If the browser doesn't open, visit: ${authUrl}`)
      
      open(authUrl).catch(() => {
        console.log(`\n⚠️  Could not open browser automatically`)
        console.log(`Please visit: ${authUrl}`)
      })
      
      console.log(`\n⏳ Waiting for authorization...`)
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.oauthCallbacks.has(flowId)) {
          this.oauthCallbacks.delete(flowId)
          reject(new Error('OAuth timeout'))
        }
      }, 5 * 60 * 1000)
    })
  }
  
  /**
   * Start the EdgeWorker with given configuration
   */
  async startEdgeWorker({ proxyUrl, repositories }: { proxyUrl: string; repositories: RepositoryConfig[] }): Promise<void> {
    // Create EdgeWorker configuration
    const config: EdgeWorkerConfig = {
      proxyUrl,
      repositories,
      defaultAllowedTools: process.env.ALLOWED_TOOLS?.split(',').map(t => t.trim()) || [],
      features: {
        enableContinuation: true
      },
      handlers: {
        createWorkspace: async (issue: Issue, repository: RepositoryConfig): Promise<Workspace> => {
          return this.createGitWorktree(issue, repository)
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
    console.log(`Connected to proxy: ${config.proxyUrl}`)
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
      
      // Start OAuth server immediately for easy access
      const oauthPort = 3457
      if (!this.oauthServer) {
        this.startOAuthServer(oauthPort)
        console.log(`\n🔐 OAuth server running on port ${oauthPort}`)
        console.log(`👉 To authorize Linear (new workspace or re-auth):`)
        console.log(`   ${proxyUrl}/oauth/authorize?callback=http://localhost:${oauthPort}/callback`)
        console.log('─'.repeat(70))
        
        // Set up handler for OAuth completions to automatically trigger repository setup
        this.onOAuthComplete = async (linearCredentials: LinearCredentials): Promise<void> => {
          if (this.edgeWorker) {
            // If edge worker is already running, just set up a new repository
            console.log('\n📋 Setting up new repository for workspace:', linearCredentials.linearWorkspaceName)
            console.log('─'.repeat(50))
            
            try {
              const newRepo = await this.setupRepositoryWizard(linearCredentials)
              
              // Add to existing repositories
              let edgeConfig = this.loadEdgeConfig()
              console.log(`📊 Current config has ${edgeConfig.repositories?.length || 0} repositories`)
              edgeConfig.repositories = [...(edgeConfig.repositories || []), newRepo]
              console.log(`📊 Adding repository "${newRepo.name}", new total: ${edgeConfig.repositories.length}`)
              this.saveEdgeConfig(edgeConfig)
              
              console.log('\n✅ Repository configured successfully!')
              console.log('📝 .edge-config.json file has been updated with your new repository configuration.')
              console.log('💡 You can edit this file and restart Cyrus at any time to modify settings.')
              
              // Restart edge worker with new config
              await this.edgeWorker!.stop()
              this.edgeWorker = null
              
              // Give a small delay to ensure file is written
              await new Promise(resolve => setTimeout(resolve, 100))
              
              // Reload configuration and restart worker without going through setup
              const updatedConfig = this.loadEdgeConfig()
              console.log(`\n🔄 Reloading with ${updatedConfig.repositories?.length || 0} repositories from config file`)
              
              const proxyUrl = process.env.PROXY_URL || 'https://cyrus-proxy.ceedar.workers.dev'
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
            console.log('(Use the authorization link above to connect a different workspace)')
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
          console.log('📝 .edge-config.json file has been updated with your repository configuration.')
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
      
      // Handle graceful shutdown
      process.on('SIGINT', () => this.shutdown())
      process.on('SIGTERM', () => this.shutdown())
      
    } catch (error) {
      console.error('Failed to start edge application:', error)
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
      console.error(`❌ Connection lost for token ${token.substring(0, 8)}...${reason ? ': ' + reason : ''}`)
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
      try {
        execSync('git fetch origin', {
          cwd: repository.repositoryPath,
          stdio: 'pipe'
        })
      } catch (e) {
        console.warn('Warning: git fetch failed, proceeding with local branch:', (e as Error).message)
      }

      // Create the worktree from remote branch
      const remoteBranch = `origin/${repository.baseBranch}`
      console.log(`Creating git worktree at ${workspacePath} from ${remoteBranch}`)
      const worktreeCmd = createBranch 
        ? `git worktree add "${workspacePath}" -b "${branchName}" "${remoteBranch}"`
        : `git worktree add "${workspacePath}" "${branchName}"`
      
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
    
    // Close OAuth server if running
    if (this.oauthServer) {
      this.oauthServer.close()
    }
    
    // Stop edge worker
    if (this.edgeWorker) {
      await this.edgeWorker.stop()
    }
    
    console.log('Shutdown complete')
    process.exit(0)
  }
}

// Create and start the app
const app = new EdgeApp()
app.start().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})