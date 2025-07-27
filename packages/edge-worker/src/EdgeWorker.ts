import { EventEmitter } from 'events'
import { LinearClient, Issue as LinearIssue, Comment } from '@linear/sdk'
import { NdjsonClient } from 'cyrus-ndjson-client'
import { ClaudeRunner, getSafeTools } from 'cyrus-claude-runner'
import type { McpServerConfig } from 'cyrus-claude-runner'
import { SessionManager, Session, PersistenceManager } from 'cyrus-core'
import type { Issue as CoreIssue, SerializableEdgeWorkerState } from 'cyrus-core'
import type {
  LinearWebhook,
  LinearIssueAssignedWebhook,
  LinearIssueCommentMentionWebhook,
  LinearIssueNewCommentWebhook,
  LinearIssueUnassignedWebhook,
  LinearWebhookIssue,
  LinearWebhookComment
} from 'cyrus-core'
import { SharedApplicationServer } from './SharedApplicationServer.js'
import {
  isIssueAssignedWebhook,
  isIssueCommentMentionWebhook,
  isIssueNewCommentWebhook,
  isIssueUnassignedWebhook
} from 'cyrus-core'
import type { EdgeWorkerConfig, EdgeWorkerEvents, RepositoryConfig } from './types.js'
import type { SDKMessage } from 'cyrus-claude-runner'
import { readFile, writeFile, mkdir, rename, readdir } from 'fs/promises'
import { resolve, dirname, join, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { fileTypeFromBuffer } from 'file-type'
import { existsSync } from 'fs'

export declare interface EdgeWorker {
  on<K extends keyof EdgeWorkerEvents>(event: K, listener: EdgeWorkerEvents[K]): this
  emit<K extends keyof EdgeWorkerEvents>(event: K, ...args: Parameters<EdgeWorkerEvents[K]>): boolean
}

/**
 * Unified edge worker that orchestrates NDJSON streaming, Claude processing, and Linear integration
 */
export class EdgeWorker extends EventEmitter {
  private config: EdgeWorkerConfig
  private repositories: Map<string, RepositoryConfig> = new Map()
  private linearClients: Map<string, LinearClient> = new Map()
  private ndjsonClients: Map<string, NdjsonClient> = new Map()
  private sessionManager: SessionManager
  private persistenceManager: PersistenceManager
  private claudeRunners: Map<string, ClaudeRunner> = new Map() // Maps comment ID to ClaudeRunner
  private commentToRepo: Map<string, string> = new Map() // Maps comment ID to repository ID
  private commentToIssue: Map<string, string> = new Map() // Maps comment ID to issue ID
  private commentToLatestAgentReply: Map<string, string> = new Map() // Maps thread root comment ID to latest agent comment
  private issueToCommentThreads: Map<string, Set<string>> = new Map() // Maps issue ID to all comment thread IDs
  private tokenToClientId: Map<string, string> = new Map() // Maps token to NDJSON client ID
  private issueToReplyContext: Map<string, { commentId: string; parentId?: string }> = new Map() // Maps issue ID to reply context
  private sharedApplicationServer: SharedApplicationServer

  constructor(config: EdgeWorkerConfig) {
    super()
    this.config = config
    this.persistenceManager = new PersistenceManager()
    this.sessionManager = new SessionManager(this.persistenceManager)

    // Initialize shared application server
    const serverPort = config.serverPort || config.webhookPort || 3456
    const serverHost = config.serverHost || 'localhost'
    this.sharedApplicationServer = new SharedApplicationServer(serverPort, serverHost, config.ngrokAuthToken, config.proxyUrl)
    
    // Register OAuth callback handler if provided
    if (config.handlers?.onOAuthCallback) {
      this.sharedApplicationServer.registerOAuthCallbackHandler(config.handlers.onOAuthCallback)
    }

    // Initialize repositories
    for (const repo of config.repositories) {
      if (repo.isActive !== false) {
        this.repositories.set(repo.id, repo)
        
        // Create Linear client for this repository's workspace
        this.linearClients.set(repo.id, new LinearClient({
          accessToken: repo.linearToken
        }))
      }
    }

    // Group repositories by token to minimize NDJSON connections
    const tokenToRepos = new Map<string, RepositoryConfig[]>()
    for (const repo of this.repositories.values()) {
      const repos = tokenToRepos.get(repo.linearToken) || []
      repos.push(repo)
      tokenToRepos.set(repo.linearToken, repos)
    }

    // Create one NDJSON client per unique token using shared application server
    for (const [token, repos] of tokenToRepos) {
      if (!repos || repos.length === 0) continue
      const firstRepo = repos[0]
      if (!firstRepo) continue
      const primaryRepoId = firstRepo.id
      const ndjsonClient = new NdjsonClient({
        proxyUrl: config.proxyUrl,
        token: token,
        name: repos.map(r => r.name).join(', '), // Pass repository names
        transport: 'webhook',
        // Use shared application server instead of individual servers
        useExternalWebhookServer: true,
        externalWebhookServer: this.sharedApplicationServer,
        webhookPort: serverPort, // All clients use same port
        webhookPath: '/webhook',
        webhookHost: serverHost,
        ...(config.baseUrl && { webhookBaseUrl: config.baseUrl }),
        // Legacy fallback support
        ...(!config.baseUrl && config.webhookBaseUrl && { webhookBaseUrl: config.webhookBaseUrl }),
        onConnect: () => this.handleConnect(primaryRepoId, repos),
        onDisconnect: (reason) => this.handleDisconnect(primaryRepoId, repos, reason),
        onError: (error) => this.handleError(error)
      })

      // Set up webhook handler - data should be the native webhook payload
      ndjsonClient.on('webhook', (data) => this.handleWebhook(data as LinearWebhook, repos))
      
      // Optional heartbeat logging
      if (process.env.DEBUG_EDGE === 'true') {
        ndjsonClient.on('heartbeat', () => {
          console.log(`❤️ Heartbeat received for token ending in ...${token.slice(-4)}`)
        })
      }

      // Store with the first repo's ID as the key (for error messages)
      // But also store the token mapping for lookup
      this.ndjsonClients.set(primaryRepoId, ndjsonClient)
      
      // Store token to client mapping for other lookups if needed
      this.tokenToClientId.set(token, primaryRepoId)
    }
  }

  /**
   * Start the edge worker
   */
  async start(): Promise<void> {
    // Load persisted state for each repository
    await this.loadPersistedState()
    
    // Start shared application server first
    await this.sharedApplicationServer.start()
    
    // Connect all NDJSON clients
    const connections = Array.from(this.ndjsonClients.entries()).map(async ([repoId, client]) => {
      try {
        await client.connect()
      } catch (error: any) {
        const repoConfig = this.config.repositories.find(r => r.id === repoId)
        const repoName = repoConfig?.name || repoId
        
        // Check if it's an authentication error
        if (error.isAuthError || error.code === 'LINEAR_AUTH_FAILED') {
          console.error(`\n❌ Linear authentication failed for repository: ${repoName}`)
          console.error(`   Workspace: ${repoConfig?.linearWorkspaceName || repoConfig?.linearWorkspaceId || 'Unknown'}`)
          console.error(`   Error: ${error.message}`)
          console.error(`\n   To fix this issue:`)
          console.error(`   1. Run: cyrus refresh-token`)
          console.error(`   2. Complete the OAuth flow in your browser`)
          console.error(`   3. The configuration will be automatically updated\n`)
          console.error(`   You can also check all tokens with: cyrus check-tokens\n`)
          
          // Continue with other repositories instead of failing completely
          return { repoId, success: false, error }
        }
        
        // For other errors, still log but with less guidance
        console.error(`\n❌ Failed to connect repository: ${repoName}`)
        console.error(`   Error: ${error.message}\n`)
        return { repoId, success: false, error }
      }
      return { repoId, success: true }
    })
    
    const results = await Promise.all(connections)
    const failures = results.filter(r => !r.success)
    
    if (failures.length === this.ndjsonClients.size) {
      // All connections failed
      throw new Error('Failed to connect any repositories. Please check your configuration and Linear tokens.')
    } else if (failures.length > 0) {
      // Some connections failed
      console.warn(`\n⚠️  Connected ${results.length - failures.length} out of ${results.length} repositories`)
      console.warn(`   The following repositories could not be connected:`)
      failures.forEach(f => {
        const repoConfig = this.config.repositories.find(r => r.id === f.repoId)
        console.warn(`   - ${repoConfig?.name || f.repoId}`)
      })
      console.warn(`\n   Cyrus will continue running with the available repositories.\n`)
    }
  }

  /**
   * Stop the edge worker
   */
  async stop(): Promise<void> {
    // Kill all Claude processes with null checking
    for (const [, runner] of this.claudeRunners) {
      if (runner && typeof runner.stop === 'function') {
        try {
          runner.stop()
        } catch (error) {
          console.error('Error stopping Claude runner:', error)
        }
      }
    }
    this.claudeRunners.clear()
    
    // Clear all sessions
    for (const [commentId] of this.sessionManager.getAllSessions()) {
      this.sessionManager.removeSession(commentId)
    }
    this.commentToRepo.clear()
    this.commentToIssue.clear()
    this.commentToLatestAgentReply.clear()
    this.issueToCommentThreads.clear()
    
    // Disconnect all NDJSON clients
    for (const client of this.ndjsonClients.values()) {
      client.disconnect()
    }
    
    // Stop shared application server
    await this.sharedApplicationServer.stop()
  }

  /**
   * Handle connection established
   */
  private handleConnect(clientId: string, repos: RepositoryConfig[]): void {
    // Get the token for backward compatibility with events
    const token = repos[0]?.linearToken || clientId
    this.emit('connected', token)
    // Connection logged by CLI app event handler
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(clientId: string, repos: RepositoryConfig[], reason?: string): void {
    // Get the token for backward compatibility with events
    const token = repos[0]?.linearToken || clientId
    this.emit('disconnected', token, reason)
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    this.emit('error', error)
    this.config.handlers?.onError?.(error)
  }

  /**
   * Check if Claude logs exist for a workspace
   */
  private async hasExistingLogs(workspaceName: string): Promise<boolean> {
    try {
      const logsDir = join(homedir(), '.cyrus', 'logs', workspaceName)
      
      // Check if directory exists
      if (!existsSync(logsDir)) {
        return false
      }
      
      // Check if directory has any log files
      const files = await readdir(logsDir)
      return files.some(file => file.endsWith('.jsonl'))
    } catch (error) {
      console.error(`Failed to check logs for workspace ${workspaceName}:`, error)
      return false
    }
  }

  /**
   * Handle webhook events from proxy - now accepts native webhook payloads
   */
  private async handleWebhook(webhook: LinearWebhook, repos: RepositoryConfig[]): Promise<void> {
    console.log(`[EdgeWorker] Processing webhook: ${webhook.type}`)
    
    // Log verbose webhook info if enabled
    if (process.env.CYRUS_WEBHOOK_DEBUG === 'true') {
      console.log(`[EdgeWorker] Webhook payload:`, JSON.stringify(webhook, null, 2))
    }
    
    // Find the appropriate repository for this webhook
    const repository = this.findRepositoryForWebhook(webhook, repos)
    if (!repository) {
      console.log('No repository configured for webhook from workspace', webhook.organizationId)
      if (process.env.CYRUS_WEBHOOK_DEBUG === 'true') {
        console.log('Available repositories:', repos.map(r => ({ 
          name: r.name, 
          workspaceId: r.linearWorkspaceId,
          teamKeys: r.teamKeys 
        })))
      }
      return
    }
    
    console.log(`[EdgeWorker] Webhook matched to repository: ${repository.name}`)
    
    try {
      // Handle specific webhook types with proper typing
      if (isIssueAssignedWebhook(webhook)) {
        await this.handleIssueAssignedWebhook(webhook, repository)
      } else if (isIssueCommentMentionWebhook(webhook)) {
        await this.handleIssueCommentMentionWebhook(webhook, repository)
      } else if (isIssueNewCommentWebhook(webhook)) {
        await this.handleIssueNewCommentWebhook(webhook, repository)
      } else if (isIssueUnassignedWebhook(webhook)) {
        await this.handleIssueUnassignedWebhook(webhook, repository)
      } else {
        console.log(`Unhandled webhook type: ${(webhook as any).action}`)
      }
      
    } catch (error) {
      console.error(`[EdgeWorker] Failed to process webhook: ${(webhook as any).action}`, error)
      // Don't re-throw webhook processing errors to prevent application crashes
      // The error has been logged and individual webhook failures shouldn't crash the entire system
    }
  }

  /**
   * Handle issue assignment webhook
   */
  private async handleIssueAssignedWebhook(webhook: LinearIssueAssignedWebhook, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] Handling issue assignment: ${webhook.notification.issue.identifier}`)
    await this.handleIssueAssigned(webhook.notification.issue, repository)
  }

  /**
   * Handle issue comment mention webhook
   */
  private async handleIssueCommentMentionWebhook(webhook: LinearIssueCommentMentionWebhook, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] Handling comment mention: ${webhook.notification.issue.identifier}`)
    await this.handleNewComment(webhook.notification.issue, webhook.notification.comment, repository)
  }

  /**
   * Handle issue new comment webhook
   */
  private async handleIssueNewCommentWebhook(webhook: LinearIssueNewCommentWebhook, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] Handling new comment: ${webhook.notification.issue.identifier}`)
    
    // Check if the comment mentions the agent (Cyrus) before proceeding
    if (!(await this.isAgentMentionedInComment(webhook.notification.comment, repository))) {
      console.log(`[EdgeWorker] Comment does not mention agent, ignoring: ${webhook.notification.issue.identifier}`)
      return
    }
    
    await this.handleNewComment(webhook.notification.issue, webhook.notification.comment, repository)
  }

  /**
   * Handle issue unassignment webhook
   */
  private async handleIssueUnassignedWebhook(webhook: LinearIssueUnassignedWebhook, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] Handling issue unassignment: ${webhook.notification.issue.identifier}`)
    
    // Log the complete webhook payload for TypeScript type definition
    // console.log('=== ISSUE UNASSIGNMENT WEBHOOK PAYLOAD ===')
    // console.log(JSON.stringify(webhook, null, 2))
    // console.log('=== END WEBHOOK PAYLOAD ===')
    
    await this.handleIssueUnassigned(webhook.notification.issue, repository)
  }

  /**
   * Find the repository configuration for a webhook
   */
  private findRepositoryForWebhook(webhook: LinearWebhook, repos: RepositoryConfig[]): RepositoryConfig | null {
    const workspaceId = webhook.organizationId
    if (!workspaceId) return repos[0] || null // Fallback to first repo if no workspace ID

    // Try team-based routing first
    const teamKey = webhook.notification?.issue?.team?.key
    if (teamKey) {
      const repo = repos.find(r => r.teamKeys && r.teamKeys.includes(teamKey))
      if (repo) return repo
    }
    
    // Try parsing issue identifier as fallback
    const issueId = webhook.notification?.issue?.identifier
    if (issueId && issueId.includes('-')) {
      const prefix = issueId.split('-')[0]
      if (prefix) {
        const repo = repos.find(r => r.teamKeys && r.teamKeys.includes(prefix))
        if (repo) return repo
      }
    }
    
    // Original workspace fallback - find first repo without teamKeys or matching workspace
    return repos.find(repo => 
      repo.linearWorkspaceId === workspaceId && (!repo.teamKeys || repo.teamKeys.length === 0)
    ) || repos.find(repo => repo.linearWorkspaceId === workspaceId) || null
  }

  /**
   * Handle issue assignment
   * @param issue Linear issue object from webhook data (contains full Linear SDK properties)
   * @param repository Repository configuration
   */
  private async handleIssueAssigned(issue: LinearWebhookIssue, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] handleIssueAssigned started for issue ${issue.identifier} (${issue.id})`)
    
    // Fetch full Linear issue details immediately
    const fullIssue = await this.fetchFullIssueDetails(issue.id, repository.id)
    if (!fullIssue) {
      throw new Error(`Failed to fetch full issue details for ${issue.id}`)
    }
    console.log(`[EdgeWorker] Fetched full issue details for ${issue.identifier}`)
    
    await this.handleIssueAssignedWithFullIssue(fullIssue, repository)
  }

  private async handleIssueAssignedWithFullIssue(fullIssue: LinearIssue, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] handleIssueAssignedWithFullIssue started for issue ${fullIssue.identifier} (${fullIssue.id})`)
    
    // Move issue to started state automatically
    await this.moveIssueToStartedState(fullIssue, repository.id)
    
    // Post initial comment immediately
    const initialComment = await this.postInitialComment(fullIssue.id, repository.id)
    
    if (!initialComment?.id) {
      throw new Error(`Failed to create initial comment for issue ${fullIssue.identifier}`)
    }
    
    
    // Create workspace using full issue data
    const workspace = this.config.handlers?.createWorkspace
      ? await this.config.handlers.createWorkspace(fullIssue, repository)
      : {
          path: `${repository.workspaceBaseDir}/${fullIssue.identifier}`,
          isGitWorktree: false
        }

    console.log(`[EdgeWorker] Workspace created at: ${workspace.path}`)

    // Download attachments before creating Claude runner
    const attachmentResult = await this.downloadIssueAttachments(fullIssue, repository, workspace.path)
    
    // Build allowed directories list
    const allowedDirectories: string[] = []
    if (attachmentResult.attachmentsDir) {
      allowedDirectories.push(attachmentResult.attachmentsDir)
    }

    // Build allowed tools list with Linear MCP tools
    const allowedTools = this.buildAllowedTools(repository)

    // Create Claude runner with attachment directory access
    const runner = new ClaudeRunner({
      workingDirectory: workspace.path,
      allowedTools,
      allowedDirectories,
      workspaceName: fullIssue.identifier,
      mcpConfigPath: repository.mcpConfigPath,
      mcpConfig: this.buildMcpConfig(repository),
      onMessage: (message) => this.handleClaudeMessage(initialComment.id, message, repository.id),
      onComplete: (messages) => this.handleClaudeComplete(initialComment.id, messages, repository.id),
      onError: (error) => this.handleClaudeError(initialComment.id, error, repository.id)
    })

    // Store runner by comment ID
    this.claudeRunners.set(initialComment.id, runner)
    this.commentToRepo.set(initialComment.id, repository.id)
    this.commentToIssue.set(initialComment.id, fullIssue.id)

    // Create session using full Linear issue (convert LinearIssue to CoreIssue)
    const session = new Session({
      issue: this.convertLinearIssueToCore(fullIssue),
      workspace,
      startedAt: new Date(),
      agentRootCommentId: initialComment.id
    })
    
    // Store session by comment ID
    this.sessionManager.addSession(initialComment.id, session)
    
    // Track this thread for the issue
    const threads = this.issueToCommentThreads.get(fullIssue.id) || new Set()
    threads.add(initialComment.id)
    this.issueToCommentThreads.set(fullIssue.id, threads)

    // Save state after mapping changes
    await this.savePersistedState()

    // Emit events using full Linear issue
    this.emit('session:started', fullIssue.id, fullIssue, repository.id)
    this.config.handlers?.onSessionStart?.(fullIssue.id, fullIssue, repository.id)

    // Build and start Claude with initial prompt using full issue (streaming mode)
    console.log(`[EdgeWorker] Building initial prompt for issue ${fullIssue.identifier}`)
    try {
      // Use buildPromptV2 without a new comment for issue assignment
      const prompt = await this.buildPromptV2(fullIssue, repository, undefined, attachmentResult.manifest)
      console.log(`[EdgeWorker] Initial prompt built successfully, length: ${prompt.length} characters`)
      console.log(`[EdgeWorker] Starting Claude streaming session`)
      const sessionInfo = await runner.startStreaming(prompt)
      console.log(`[EdgeWorker] Claude streaming session started: ${sessionInfo.sessionId}`)
    } catch (error) {
      console.error(`[EdgeWorker] Error in prompt building/starting:`, error)
      throw error
    }
  }

  /**
   * Find the root comment of a comment thread by traversing parent relationships
   */

  /**
   * Handle new root comment - creates a new Claude session for a new comment thread
   * @param issue Linear issue object from webhook data
   * @param comment Linear comment object from webhook data
   * @param repository Repository configuration
   */
  private async handleNewRootComment(issue: LinearWebhookIssue, comment: LinearWebhookComment, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] Handling new root comment ${comment.id} on issue ${issue.identifier}`)
    
    // Fetch full Linear issue details
    const fullIssue = await this.fetchFullIssueDetails(issue.id, repository.id)
    if (!fullIssue) {
      throw new Error(`Failed to fetch full issue details for ${issue.id}`)
    }
    
    // Post immediate acknowledgment
    const acknowledgment = await this.postComment(
      issue.id,
      "I'm getting started on that right away. I'll update this comment with my plan as I work through it.",
      repository.id,
      comment.id  // Reply to the new root comment
    )
    
    if (!acknowledgment?.id) {
      throw new Error(`Failed to create acknowledgment for root comment ${comment.id}`)
    }
    
    // Create or get workspace
    const workspace = this.config.handlers?.createWorkspace
      ? await this.config.handlers.createWorkspace(fullIssue, repository)
      : {
          path: `${repository.workspaceBaseDir}/${fullIssue.identifier}`,
          isGitWorktree: false
        }
    
    console.log(`[EdgeWorker] Using workspace at: ${workspace.path}`)
    
    // Download attachments if any
    const attachmentResult = await this.downloadIssueAttachments(fullIssue, repository, workspace.path)
    
    // Build allowed directories and tools
    const allowedDirectories: string[] = []
    if (attachmentResult.attachmentsDir) {
      allowedDirectories.push(attachmentResult.attachmentsDir)
    }
    const allowedTools = this.buildAllowedTools(repository)
    
    // Create Claude runner for this new comment thread
    const runner = new ClaudeRunner({
      workingDirectory: workspace.path,
      allowedTools,
      allowedDirectories,
      workspaceName: fullIssue.identifier,
      mcpConfigPath: repository.mcpConfigPath,
      mcpConfig: this.buildMcpConfig(repository),
      onMessage: (message) => {
        // Update session with Claude session ID when first received
        if (!session.claudeSessionId && message.session_id) {
          session.claudeSessionId = message.session_id
          console.log(`[EdgeWorker] Claude session ID assigned: ${message.session_id}`)
        }
        this.handleClaudeMessage(acknowledgment.id, message, repository.id)
      },
      onComplete: (messages) => this.handleClaudeComplete(acknowledgment.id, messages, repository.id),
      onError: (error) => this.handleClaudeError(acknowledgment.id, error, repository.id)
    })
    
    // Store runner and mappings
    this.claudeRunners.set(comment.id, runner)
    this.commentToRepo.set(comment.id, repository.id)
    this.commentToIssue.set(comment.id, fullIssue.id)
    
    // Create session for this new comment thread
    const session = new Session({
      issue: this.convertLinearIssueToCore(fullIssue),
      workspace,
      startedAt: new Date(),
      agentRootCommentId: comment.id
    })
    
    this.sessionManager.addSession(comment.id, session)
    
    // Track this new thread for the issue
    const threads = this.issueToCommentThreads.get(issue.id) || new Set()
    threads.add(comment.id)
    this.issueToCommentThreads.set(issue.id, threads)
    
    // Track latest reply
    this.commentToLatestAgentReply.set(comment.id, acknowledgment.id)
    
    // Save state after mapping changes
    await this.savePersistedState()
    
    // Emit session start event
    this.config.handlers?.onSessionStart?.(fullIssue.id, fullIssue, repository.id)
    
    // Build prompt with new comment focus using V2 template
    console.log(`[EdgeWorker] Building prompt for new root comment`)
    try {
      const prompt = await this.buildPromptV2(fullIssue, repository, comment, attachmentResult.manifest)
      console.log(`[EdgeWorker] Prompt built successfully, length: ${prompt.length} characters`)
      console.log(`[EdgeWorker] Starting Claude streaming session for new comment thread`)
      const sessionInfo = await runner.startStreaming(prompt)
      console.log(`[EdgeWorker] Claude streaming session started: ${sessionInfo.sessionId}`)
    } catch (error) {
      console.error(`[EdgeWorker] Error in prompt building/starting:`, error)
      throw error
    }
  }

  /**
   * Handle new comment on issue (updated for comment-based sessions)
   * @param issue Linear issue object from webhook data
   * @param comment Linear comment object from webhook data
   * @param repository Repository configuration
   */
  private async handleNewComment(issue: LinearWebhookIssue, comment: LinearWebhookComment, repository: RepositoryConfig): Promise<void> {
    // Check if continuation is enabled
    if (!this.config.features?.enableContinuation) {
      console.log('Continuation not enabled, ignoring comment')
      return
    }

    // Fetch full Linear issue details
    const fullIssue = await this.fetchFullIssueDetails(issue.id, repository.id)
    if (!fullIssue) {
      throw new Error(`Failed to fetch full issue details for ${issue.id}`)
    }

    // IMPORTANT: Linear has exactly ONE level of comment nesting:
    // - Root comments (no parent)
    // - Reply comments (have a parent, which must be a root comment)
    // There is NO recursion - a reply cannot have replies
    
    // Fetch full comment to determine if this is a root or reply
    let parentCommentId: string | null = null
    let rootCommentId: string = comment.id // Default to this comment being the root
    
    try {
      const linearClient = this.linearClients.get(repository.id)
      if (linearClient && comment.id) {
        const fullComment = await linearClient.comment({ id: comment.id })
        
        // Check if comment has a parent (making it a reply)
        if (fullComment.parent) {
          const parent = await fullComment.parent
          if (parent?.id) {
            parentCommentId = parent.id
            // In Linear's 2-level structure, the parent IS always the root
            // No need for recursion - replies can't have replies
            rootCommentId = parent.id
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch full comment data:', error)
    }
    
    // Determine comment type based on whether it has a parent
    const isRootComment = parentCommentId === null
    const threadRootCommentId = rootCommentId
    
    console.log(`[EdgeWorker] Comment ${comment.id} - isRoot: ${isRootComment}, threadRoot: ${threadRootCommentId}, parent: ${parentCommentId}`)
    
    // Store reply context for Linear commenting
    // parentId will be: the parent comment ID (if this is a reply) OR this comment's ID (if root)
    // This ensures our bot's replies appear at the correct nesting level
    this.issueToReplyContext.set(issue.id, {
      commentId: comment.id,
      parentId: parentCommentId || comment.id
    })
    
    // Look for existing session for this comment thread
    let session = this.sessionManager.getSession(threadRootCommentId)
    
    // If no session exists, we need to create one
    if (!session) {
      console.log(`No active session for issue ${issue.identifier}, checking for existing logs...`)
      
      // Check if we have existing logs for this issue
      const hasLogs = await this.hasExistingLogs(issue.identifier)
      
      if (!hasLogs) {
        console.log(`No existing logs found for ${issue.identifier}, treating as new assignment`)
        // Start fresh - treat it like a new assignment
        await this.handleIssueAssigned(issue, repository)
        return
      }
      
      console.log(`Found existing logs for ${issue.identifier}, creating session for continuation`)
      
      // Create workspace (or get existing one)
      const workspace = this.config.handlers?.createWorkspace
        ? await this.config.handlers.createWorkspace(fullIssue, repository)
        : {
            path: `${repository.workspaceBaseDir}/${fullIssue.identifier}`,
            isGitWorktree: false
          }
      
      // Create session for this comment thread
      session = new Session({
        issue: this.convertLinearIssueToCore(fullIssue),
        workspace,
        process: null,
        startedAt: new Date(),
        agentRootCommentId: threadRootCommentId
      })
      
      this.sessionManager.addSession(threadRootCommentId, session)
      this.commentToRepo.set(threadRootCommentId, repository.id)
      this.commentToIssue.set(threadRootCommentId, issue.id)
      
      // Track this thread for the issue
      const threads = this.issueToCommentThreads.get(issue.id) || new Set()
      threads.add(threadRootCommentId)
      this.issueToCommentThreads.set(issue.id, threads)
      
      // Save state after mapping changes
      await this.savePersistedState()
    }

    // Check if there's an existing runner for this comment thread
    const existingRunner = this.claudeRunners.get(threadRootCommentId)
    if (existingRunner && existingRunner.isStreaming()) {
      // Post immediate reply for streaming case
      // parentId ensures correct nesting: replies to parent if this is a reply, or to comment itself if root
      await this.postComment(
        issue.id,
        "I've queued up your message to address it right after I resolve my current focus.",
        repository.id,
        parentCommentId || comment.id  // Same nesting level as the triggering comment
      )
      
      // Add comment to existing stream instead of restarting
      console.log(`[EdgeWorker] Adding comment to existing stream for thread ${threadRootCommentId}`)
      try {
        existingRunner.addStreamMessage(comment.body || '')
        return // Exit early - comment has been added to stream
      } catch (error) {
        console.error(`[EdgeWorker] Failed to add comment to stream, will stop the existing session and start a new one: ${error}`)
        // Fall through to restart logic below
      }
    }

    // For root comments without existing sessions, call placeholder handler
    if (isRootComment && !session) {
      console.log(`[EdgeWorker] Detected new root comment ${comment.id}, delegating to handleNewRootComment`)
      await this.handleNewRootComment(issue, comment, repository)
      return
    }

    // Post immediate reply for continuing existing thread
    // parentId ensures correct nesting: replies to parent if this is a reply, or to comment itself if root
    await this.postComment(
      issue.id,
      "I'm getting started on that right away. I'll update this comment with my plan as I work through it.",
      repository.id,
      parentCommentId || comment.id  // Same nesting level as the triggering comment
    )

    // Stop existing runner if it's not streaming or stream addition failed
    if (existingRunner) {
      existingRunner.stop()
    }

    try {
      // Build allowed tools list with Linear MCP tools
      const allowedTools = this.buildAllowedTools(repository)

      // Create new runner with resume mode if we have a Claude session ID
      const runner = new ClaudeRunner({
        workingDirectory: session.workspace.path,
        allowedTools,
        resumeSessionId: session.claudeSessionId || undefined,
        workspaceName: issue.identifier,
        mcpConfigPath: repository.mcpConfigPath,
        mcpConfig: this.buildMcpConfig(repository),
        onMessage: (message) => {
          // Update session with Claude session ID when first received
          if (!session.claudeSessionId && message.session_id) {
            session.claudeSessionId = message.session_id
            console.log(`[EdgeWorker] Stored Claude session ID ${message.session_id} for comment thread ${threadRootCommentId}`)
          }
          
          // Check for continuation errors
          if (message.type === 'assistant' && 'message' in message && message.message?.content) {
            const content = Array.isArray(message.message.content) ? message.message.content : [message.message.content]
            for (const item of content) {
              if (item?.type === 'text' && item.text?.includes('tool_use` ids were found without `tool_result` blocks')) {
                console.log('Detected corrupted conversation history, will restart fresh')
                // Kill this runner
                runner.stop()
                // Remove from map
                this.claudeRunners.delete(threadRootCommentId)
                // Start fresh by calling root comment handler
                this.handleNewRootComment(issue, comment, repository).catch(error => {
                  console.error(`[EdgeWorker] Failed to restart fresh session for comment thread ${threadRootCommentId}:`, error)
                  // Clean up any partial state
                  this.claudeRunners.delete(threadRootCommentId)
                  this.commentToRepo.delete(threadRootCommentId)
                  this.commentToIssue.delete(threadRootCommentId)
                  // Emit error event to notify handlers
                  this.emit('session:ended', threadRootCommentId, 1, repository.id)
                  this.config.handlers?.onSessionEnd?.(threadRootCommentId, 1, repository.id)
                })
                return
              }
            }
          }
          this.handleClaudeMessage(threadRootCommentId, message, repository.id)
        },
        onComplete: (messages) => this.handleClaudeComplete(threadRootCommentId, messages, repository.id),
        onError: (error) => this.handleClaudeError(threadRootCommentId, error, repository.id)
      })

      // Store new runner by comment thread root
      this.claudeRunners.set(threadRootCommentId, runner)

      // Start streaming session with the comment as initial prompt
      console.log(`[EdgeWorker] Starting new streaming session for issue ${issue.identifier}`)
      await runner.startStreaming(comment.body || '')
    } catch (error) {
      console.error('Failed to continue conversation, starting fresh:', error)
      // Remove any partially created session
      this.sessionManager.removeSession(threadRootCommentId)
      this.commentToRepo.delete(threadRootCommentId)
      this.commentToIssue.delete(threadRootCommentId)
      // Start fresh for root comments, or fall back to issue assignment
      if (isRootComment) {
        await this.handleNewRootComment(issue, comment, repository)
      } else {
        await this.handleIssueAssigned(issue, repository)
      }
    }
  }

  /**
   * Handle issue unassignment
   * @param issue Linear issue object from webhook data
   * @param repository Repository configuration
   */
  private async handleIssueUnassigned(issue: LinearWebhookIssue, repository: RepositoryConfig): Promise<void> {
    // Get all comment threads for this issue
    const threadRootCommentIds = this.issueToCommentThreads.get(issue.id) || new Set()
    
    // Stop all Claude runners for this issue
    let activeThreadCount = 0
    for (const threadRootCommentId of threadRootCommentIds) {
      const runner = this.claudeRunners.get(threadRootCommentId)
      if (runner) {
        console.log(`[EdgeWorker] Stopping Claude runner for thread ${threadRootCommentId}`)
        await runner.stop()
        activeThreadCount++
      }
    }
    
    // Post ONE farewell comment on the issue (not in any thread) if there were active sessions
    if (activeThreadCount > 0) {
      await this.postComment(
        issue.id,
        "I've been unassigned and am stopping work now.",
        repository.id
        // No parentId - post as a new comment on the issue
      )
    }
    
    // Clean up thread mappings for each stopped thread
    for (const threadRootCommentId of threadRootCommentIds) {
      // Remove from runners map
      this.claudeRunners.delete(threadRootCommentId)
      
      // Clean up comment mappings
      this.commentToRepo.delete(threadRootCommentId)
      this.commentToIssue.delete(threadRootCommentId)
      this.commentToLatestAgentReply.delete(threadRootCommentId)
      
      // Remove session
      this.sessionManager.removeSession(threadRootCommentId)
    }
    
    // Clean up issue-level mappings
    this.issueToCommentThreads.delete(issue.id)
    this.issueToReplyContext.delete(issue.id)

    // Save state after mapping changes
    await this.savePersistedState()

    // Emit events
    console.log(`[EdgeWorker] Stopped ${activeThreadCount} sessions for unassigned issue ${issue.identifier}`)
    this.emit('session:ended', issue.id, null, repository.id)
    this.config.handlers?.onSessionEnd?.(issue.id, null, repository.id)
  }

  /**
   * Handle Claude messages
   */
  private async handleClaudeMessage(commentId: string, message: SDKMessage, repositoryId: string): Promise<void> {
    // Get issue ID from comment mapping
    const issueId = this.commentToIssue.get(commentId)
    if (!issueId) {
      console.error(`[EdgeWorker] No issue mapping found for comment ${commentId}`)
      return
    }
    
    // Emit generic message event
    this.emit('claude:message', issueId, message, repositoryId)
    this.config.handlers?.onClaudeMessage?.(issueId, message, repositoryId)

    // Handle specific messages
    if (message.type === 'assistant') {
      const content = this.extractTextContent(message)
      if (content) {
        this.emit('claude:response', issueId, content, repositoryId)
        // Don't post assistant messages anymore - wait for result
      }
      
      // Also check for tool use in assistant messages
      if ('message' in message && message.message && 'content' in message.message) {
        const messageContent = Array.isArray(message.message.content) ? message.message.content : [message.message.content]
        for (const item of messageContent) {
          if (item && typeof item === 'object' && 'type' in item && item.type === 'tool_use') {
            this.emit('claude:tool-use', issueId, item.name, item.input, repositoryId)
            
            // Handle TodoWrite tool specifically
            if ('name' in item && item.name === 'TodoWrite' && 'input' in item && item.input?.todos) {
              console.log(`[EdgeWorker] Detected TodoWrite tool use with ${item.input.todos.length} todos`)
              await this.updateCommentWithTodos(item.input.todos, repositoryId, commentId)
            }
          }
        }
      }
    } else if (message.type === 'result') {
      if (message.subtype === 'success' && 'result' in message && message.result) {
        // Post the successful result to Linear
        // For comment-based sessions, reply to the root comment of this thread
        await this.postComment(issueId, message.result, repositoryId, commentId)
      } else if (message.subtype === 'error_max_turns' || message.subtype === 'error_during_execution') {
        // Handle error results
        const errorMessage = message.subtype === 'error_max_turns' 
          ? 'Maximum turns reached' 
          : 'Error during execution'
        this.handleError(new Error(`Claude error: ${errorMessage}`))
        
        // Handle token limit specifically for max turns error
        if (this.config.features?.enableTokenLimitHandling && message.subtype === 'error_max_turns') {
          await this.handleTokenLimit(commentId, repositoryId)
        }
      }
    }
  }

  /**
   * Handle Claude session completion (successful)
   */
  private async handleClaudeComplete(commentId: string, messages: SDKMessage[], repositoryId: string): Promise<void> {
    const issueId = this.commentToIssue.get(commentId)
    console.log(`[EdgeWorker] Claude session completed for comment thread ${commentId} (issue ${issueId}) with ${messages.length} messages`)
    this.claudeRunners.delete(commentId)

    if (issueId) {
      this.emit('session:ended', issueId, 0, repositoryId)  // 0 indicates success
      this.config.handlers?.onSessionEnd?.(issueId, 0, repositoryId)
    }
  }

  /**
   * Handle Claude session error
   */
  private async handleClaudeError(commentId: string, error: Error, repositoryId: string): Promise<void> {
    const issueId = this.commentToIssue.get(commentId)
    console.error(`[EdgeWorker] Claude session error for comment thread ${commentId} (issue ${issueId}):`, error.message)
    console.error(`[EdgeWorker] Error type: ${error.constructor.name}`)
    if (error.stack) {
      console.error(`[EdgeWorker] Stack trace:`, error.stack)
    }
    
    // Clean up resources
    this.claudeRunners.delete(commentId)
    if (issueId) {
      // Emit events for external handlers
      this.emit('session:ended', issueId, 1, repositoryId)  // 1 indicates error
      this.config.handlers?.onSessionEnd?.(issueId, 1, repositoryId)
    }
    
    console.log(`[EdgeWorker] Cleaned up resources for failed session ${commentId}`)
  }


  /**
   * Handle token limit by restarting session
   */
  private async handleTokenLimit(commentId: string, repositoryId: string): Promise<void> {
    const session = this.sessionManager.getSession(commentId)
    if (!session) return

    const repository = this.repositories.get(repositoryId)
    if (!repository) return

    const issueId = this.commentToIssue.get(commentId)
    if (!issueId) return

    // Post warning to Linear
    await this.postComment(
      issueId,
      '[System] Token limit reached. Starting fresh session with issue context.',
      repositoryId,
      commentId
    )

    // Fetch fresh LinearIssue data and restart session for this comment thread
    const linearIssue = await this.fetchFullIssueDetails(issueId, repositoryId)
    if (!linearIssue) {
      throw new Error(`Failed to fetch full issue details for ${issueId}`)
    }
    
    // For now, fall back to creating a new root comment handler
    // TODO: Implement proper comment thread restart
    await this.handleIssueAssignedWithFullIssue(linearIssue, repository)
  }

  /**
   * Fetch complete issue details from Linear API
   */
  private async fetchFullIssueDetails(issueId: string, repositoryId: string): Promise<LinearIssue | null> {
    const linearClient = this.linearClients.get(repositoryId)
    if (!linearClient) {
      console.warn(`[EdgeWorker] No Linear client found for repository ${repositoryId}`)
      return null
    }

    try {
      console.log(`[EdgeWorker] Fetching full issue details for ${issueId}`)
      const fullIssue = await linearClient.issue(issueId)
      console.log(`[EdgeWorker] Successfully fetched issue details for ${issueId}`)
      return fullIssue
    } catch (error) {
      console.error(`[EdgeWorker] Failed to fetch full issue details for ${issueId}:`, error)
      return null
    }
  }

  /**
   * Convert full Linear SDK issue to CoreIssue interface for Session creation
   */
  private convertLinearIssueToCore(issue: LinearIssue): CoreIssue {
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title || '',
      description: issue.description || undefined,
      getBranchName(): string {
        return issue.branchName // Use the real branchName property!
      }
    }
  }



  /**
   * Sanitize branch name by removing backticks to prevent command injection
   */
  private sanitizeBranchName(name: string): string {
    return name ? name.replace(/`/g, '') : name
  }

  /**
   * Format Linear comments into a threaded structure that mirrors the Linear UI
   * @param comments Array of Linear comments
   * @returns Formatted string showing comment threads
   */
  private async formatCommentThreads(comments: Comment[]): Promise<string> {
    if (comments.length === 0) {
      return 'No comments yet.'
    }

    // Group comments by thread (root comments and their replies)
    const threads = new Map<string, { root: Comment, replies: Comment[] }>()
    const rootComments: Comment[] = []

    // First pass: identify root comments and create thread structure
    for (const comment of comments) {
      const parent = await comment.parent
      if (!parent) {
        // This is a root comment
        rootComments.push(comment)
        threads.set(comment.id, { root: comment, replies: [] })
      }
    }

    // Second pass: assign replies to their threads
    for (const comment of comments) {
      const parent = await comment.parent
      if (parent?.id) {
        const thread = threads.get(parent.id)
        if (thread) {
          thread.replies.push(comment)
        }
      }
    }

    // Format threads in chronological order
    const formattedThreads: string[] = []
    
    for (const rootComment of rootComments) {
      const thread = threads.get(rootComment.id)
      if (!thread) continue

      // Format root comment
      const rootUser = await rootComment.user
      const rootAuthor = rootUser?.displayName || rootUser?.name || rootUser?.email || 'Unknown'
      const rootTime = new Date(rootComment.createdAt).toLocaleString()
      
      let threadText = `<comment_thread>
  <root_comment>
    <author>@${rootAuthor}</author>
    <timestamp>${rootTime}</timestamp>
    <content>
${rootComment.body}
    </content>
  </root_comment>`

      // Format replies if any
      if (thread.replies.length > 0) {
        threadText += '\n  <replies>'
        for (const reply of thread.replies) {
          const replyUser = await reply.user
          const replyAuthor = replyUser?.displayName || replyUser?.name || replyUser?.email || 'Unknown'
          const replyTime = new Date(reply.createdAt).toLocaleString()
          
          threadText += `
    <reply>
      <author>@${replyAuthor}</author>
      <timestamp>${replyTime}</timestamp>
      <content>
${reply.body}
      </content>
    </reply>`
        }
        threadText += '\n  </replies>'
      }
      
      threadText += '\n</comment_thread>'
      formattedThreads.push(threadText)
    }

    return formattedThreads.join('\n\n')
  }

  /**
   * Build a prompt for Claude using the improved XML-style template
   * @param issue Full Linear issue
   * @param repository Repository configuration  
   * @param newComment Optional new comment to focus on (for handleNewRootComment)
   * @param attachmentManifest Optional attachment manifest
   * @returns Formatted prompt string
   */
  private async buildPromptV2(
    issue: LinearIssue, 
    repository: RepositoryConfig, 
    newComment?: LinearWebhookComment,
    attachmentManifest: string = ''
  ): Promise<string> {
    console.log(`[EdgeWorker] buildPromptV2 called for issue ${issue.identifier}${newComment ? ' with new comment' : ''}`)
    
    try {
      // Use custom template if provided (repository-specific takes precedence)
      let templatePath = repository.promptTemplatePath || this.config.features?.promptTemplatePath
      
      // If no custom template, use the v2 template
      if (!templatePath) {
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = dirname(__filename)
        templatePath = resolve(__dirname, '../prompt-template.md')
      }

      // Load the template
      console.log(`[EdgeWorker] Loading prompt template from: ${templatePath}`)
      const template = await readFile(templatePath, 'utf-8')
      console.log(`[EdgeWorker] Template loaded, length: ${template.length} characters`)
      
      // Get state name from Linear API
      const state = await issue.state
      const stateName = state?.name || 'Unknown'
      
      // Get formatted comment threads
      const linearClient = this.linearClients.get(repository.id)
      let commentThreads = 'No comments yet.'
      
      if (linearClient && issue.id) {
        try {
          console.log(`[EdgeWorker] Fetching comments for issue ${issue.identifier}`)
          const comments = await linearClient.comments({
            filter: { issue: { id: { eq: issue.id } } }
          })
          
          const commentNodes = await comments.nodes
          if (commentNodes.length > 0) {
            commentThreads = await this.formatCommentThreads(commentNodes)
            console.log(`[EdgeWorker] Formatted ${commentNodes.length} comments into threads`)
          }
        } catch (error) {
          console.error('Failed to fetch comments:', error)
        }
      }
      
      // Build the prompt with all variables
      let prompt = template
        .replace(/{{repository_name}}/g, repository.name)
        .replace(/{{issue_id}}/g, issue.id || '')
        .replace(/{{issue_identifier}}/g, issue.identifier || '')
        .replace(/{{issue_title}}/g, issue.title || '')
        .replace(/{{issue_description}}/g, issue.description || 'No description provided')
        .replace(/{{issue_state}}/g, stateName)
        .replace(/{{issue_priority}}/g, issue.priority?.toString() || 'None')
        .replace(/{{issue_url}}/g, issue.url || '')
        .replace(/{{comment_threads}}/g, commentThreads)
        .replace(/{{working_directory}}/g, this.config.handlers?.createWorkspace ? 
          'Will be created based on issue' : repository.repositoryPath)
        .replace(/{{base_branch}}/g, repository.baseBranch)
        .replace(/{{branch_name}}/g, this.sanitizeBranchName(issue.branchName))
      
      // Handle the optional new comment section
      if (newComment) {
        // Replace the conditional block
        const newCommentSection = `<new_comment_to_address>
  <author>{{new_comment_author}}</author>
  <timestamp>{{new_comment_timestamp}}</timestamp>
  <content>
{{new_comment_content}}
  </content>
</new_comment_to_address>

IMPORTANT: Focus specifically on addressing the new comment above. This is a new request that requires your attention.`
        
        prompt = prompt.replace(/{{#if new_comment}}[\s\S]*?{{\/if}}/g, newCommentSection)
        
        // Now replace the new comment variables
        // We'll need to fetch the comment author
        let authorName = 'Unknown'
        if (linearClient) {
          try {
            const fullComment = await linearClient.comment({ id: newComment.id })
            const user = await fullComment.user
            authorName = user?.displayName || user?.name || user?.email || 'Unknown'
          } catch (error) {
            console.error('Failed to fetch comment author:', error)
          }
        }
        
        prompt = prompt
          .replace(/{{new_comment_author}}/g, authorName)
          .replace(/{{new_comment_timestamp}}/g, new Date().toLocaleString())
          .replace(/{{new_comment_content}}/g, newComment.body || '')
      } else {
        // Remove the new comment section entirely
        prompt = prompt.replace(/{{#if new_comment}}[\s\S]*?{{\/if}}/g, '')
      }
      
      // Append attachment manifest if provided
      if (attachmentManifest) {
        console.log(`[EdgeWorker] Adding attachment manifest, length: ${attachmentManifest.length} characters`)
        prompt = prompt + '\n\n' + attachmentManifest
      }
      
      // Append repository-specific instruction if provided
      if (repository.appendInstruction) {
        console.log(`[EdgeWorker] Adding repository-specific instruction`)
        prompt = prompt + '\n\n<repository-specific-instruction>\n' + repository.appendInstruction + '\n</repository-specific-instruction>'
      }
      
      console.log(`[EdgeWorker] Final prompt length: ${prompt.length} characters`)
      return prompt
      
    } catch (error) {
      console.error('[EdgeWorker] Failed to load prompt template:', error)
      
      // Fallback to simple prompt
      const state = await issue.state
      const stateName = state?.name || 'Unknown'
      
      return `Please help me with the following Linear issue:

Repository: ${repository.name}
Issue: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || 'No description provided'}
State: ${stateName}
Priority: ${issue.priority?.toString() || 'None'}
Branch: ${issue.branchName}

Working directory: ${repository.repositoryPath}
Base branch: ${repository.baseBranch}

${newComment ? `New comment to address:\n${newComment.body}\n\n` : ''}Please analyze this issue and help implement a solution.`
    }
  }

  /**
   * Extract text content from Claude message
   */
  private extractTextContent(sdkMessage: SDKMessage): string | null {
    if (sdkMessage.type !== 'assistant') return null
    
    const message = sdkMessage.message
    if (!message?.content) return null

    if (typeof message.content === 'string') {
      return message.content
    }

    if (Array.isArray(message.content)) {
      const textBlocks: string[] = []
      for (const block of message.content) {
        if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block) {
          textBlocks.push(block.text as string)
        }
      }
      return textBlocks.join('')
    }

    return null
  }

  /**
   * Get connection status by repository ID
   */
  getConnectionStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>()
    for (const [repoId, client] of this.ndjsonClients) {
      status.set(repoId, client.isConnected())
    }
    return status
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessionManager.getAllSessions().keys())
  }

  /**
   * Get NDJSON client by token (for testing purposes)
   * @internal
   */
  _getClientByToken(token: string): any {
    for (const [repoId, client] of this.ndjsonClients) {
      const repo = this.repositories.get(repoId)
      if (repo?.linearToken === token) {
        return client
      }
    }
    return undefined
  }

  /**
   * Start OAuth flow using the shared application server
   */
  async startOAuthFlow(proxyUrl?: string): Promise<{ linearToken: string; linearWorkspaceId: string; linearWorkspaceName: string }> {
    const oauthProxyUrl = proxyUrl || this.config.proxyUrl
    return this.sharedApplicationServer.startOAuthFlow(oauthProxyUrl)
  }

  /**
   * Get the server port
   */
  getServerPort(): number {
    return this.config.serverPort || this.config.webhookPort || 3456
  }

  /**
   * Get the OAuth callback URL
   */
  getOAuthCallbackUrl(): string {
    return this.sharedApplicationServer.getOAuthCallbackUrl()
  }

  /**
   * Move issue to started state when assigned
   * @param issue Full Linear issue object from Linear SDK
   * @param repositoryId Repository ID for Linear client lookup
   */
  private async moveIssueToStartedState(issue: LinearIssue, repositoryId: string): Promise<void> {
    try {
      const linearClient = this.linearClients.get(repositoryId)
      if (!linearClient) {
        console.warn(`No Linear client found for repository ${repositoryId}, skipping state update`)
        return
      }

      // Check if issue is already in a started state
      const currentState = await issue.state
      if (currentState?.type === 'started') {
        console.log(`Issue ${issue.identifier} is already in started state (${currentState.name})`)
        return
      }

      // Get team for the issue
      const team = await issue.team
      if (!team) {
        console.warn(`No team found for issue ${issue.identifier}, skipping state update`)
        return
      }

      // Get available workflow states for the issue's team
      const teamStates = await linearClient.workflowStates({
        filter: { team: { id: { eq: team.id } } }
      })
      
      const states = await teamStates
      
      // Find all states with type "started" and pick the one with lowest position
      // This ensures we pick "In Progress" over "In Review" when both have type "started"
      // Linear uses standardized state types: triage, backlog, unstarted, started, completed, canceled
      const startedStates = states.nodes.filter(state => state.type === 'started')
      const startedState = startedStates.sort((a, b) => a.position - b.position)[0]
      
      if (!startedState) {
        throw new Error('Could not find a state with type "started" for this team')
      }

      // Update the issue state
      console.log(`Moving issue ${issue.identifier} to started state: ${startedState.name}`)
      if (!issue.id) {
        console.warn(`Issue ${issue.identifier} has no ID, skipping state update`)
        return
      }
      
      await linearClient.updateIssue(issue.id, {
        stateId: startedState.id
      })
      
      console.log(`✅ Successfully moved issue ${issue.identifier} to ${startedState.name} state`)
    } catch (error) {
      console.error(`Failed to move issue ${issue.identifier} to started state:`, error)
      // Don't throw - we don't want to fail the entire assignment process due to state update failure
    }
  }

  /**
   * Post initial comment when assigned to issue
   */
  private async postInitialComment(issueId: string, repositoryId: string): Promise<Comment | null> {
    try {
      const body = "I've been assigned to this issue and am getting started right away. I'll update this comment with my plan shortly."
      
      // Get the Linear client for this repository
      const linearClient = this.linearClients.get(repositoryId)
      if (!linearClient) {
        throw new Error(`No Linear client found for repository ${repositoryId}`)
      }

      const commentData = {
        issueId,
        body
      }

      const response = await linearClient.createComment(commentData)

      // Linear SDK returns CommentPayload with structure: { comment, success, lastSyncId }
      if (response && response.comment) {
        const comment = await response.comment
        console.log(`✅ Posted initial comment on issue ${issueId} (ID: ${comment.id})`)
        
        // Track this as the latest agent reply for the thread (initial comment is its own root)
        if (comment.id) {
          this.commentToLatestAgentReply.set(comment.id, comment.id)
          
          // Save state after successful comment creation and mapping update
          await this.savePersistedState()
        }
        
        return comment
      } else {
        throw new Error('Initial comment creation failed')
      }
    } catch (error) {
      console.error(`Failed to create initial comment on issue ${issueId}:`, error)
      return null
    }
  }

  /**
   * Post a comment to Linear
   */
  private async postComment(issueId: string, body: string, repositoryId: string, parentId?: string): Promise<Comment | null> {
    try {
      // Get the Linear client for this repository
      const linearClient = this.linearClients.get(repositoryId)
      if (!linearClient) {
        throw new Error(`No Linear client found for repository ${repositoryId}`)
      }

      const commentData: { issueId: string; body: string; parentId?: string } = {
        issueId,
        body
      }

      // Add parent ID if provided (for reply)
      if (parentId) {
        commentData.parentId = parentId
      }

      const response = await linearClient.createComment(commentData)

      // Linear SDK returns CommentPayload with structure: { comment, success, lastSyncId }
      if (response && response.comment) {
        console.log(`✅ Successfully created comment on issue ${issueId}`)
        const comment = await response.comment
        if (comment?.id) {
          console.log(`Comment ID: ${comment.id}`)
          
          // Track this as the latest agent reply for the thread
          // If parentId exists, that's the thread root; otherwise this comment IS the root
          const threadRootCommentId = parentId || comment.id
          this.commentToLatestAgentReply.set(threadRootCommentId, comment.id)
          
          // Save state after successful comment creation and mapping update
          await this.savePersistedState()
          
          return comment
        }
        return null
      } else {
        throw new Error('Comment creation failed')
      }
    } catch (error) {
      console.error(`Failed to create comment on issue ${issueId}:`, error)
      // Don't re-throw - just log the error so the edge worker doesn't crash
      // TODO: Implement retry logic or token refresh
      return null
    }
  }

  /**
   * Update initial comment with TODO checklist
   */
  private async updateCommentWithTodos(todos: Array<{id: string, content: string, status: string, priority: string}>, repositoryId: string, threadRootCommentId: string): Promise<void> {
    try {
      // Get the latest agent comment in this thread
      const commentId = this.commentToLatestAgentReply.get(threadRootCommentId) || threadRootCommentId
      if (!commentId) {
        console.log('No comment ID found for thread, cannot update with todos')
        return
      }

      // Convert todos to Linear checklist format
      const checklist = this.formatTodosAsChecklist(todos)
      const body = `I've been assigned to this issue and am getting started right away. Here's my plan:\n\n${checklist}`

      // Get the Linear client
      const linearClient = this.linearClients.get(repositoryId)
      if (!linearClient) {
        throw new Error(`No Linear client found for repository ${repositoryId}`)
      }

      // Update the comment
      const response = await linearClient.updateComment(commentId, { body })
      
      if (response) {
        console.log(`✅ Updated comment ${commentId} with ${todos.length} todos`)
      }
    } catch (error) {
      console.error(`Failed to update comment with todos:`, error)
    }
  }

  /**
   * Format todos as Linear checklist markdown
   */
  private formatTodosAsChecklist(todos: Array<{id: string, content: string, status: string, priority: string}>): string {
    return todos.map(todo => {
      const checkbox = todo.status === 'completed' ? '[x]' : '[ ]'
      const statusEmoji = todo.status === 'in_progress' ? ' 🔄' : ''
      return `- ${checkbox} ${todo.content}${statusEmoji}`
    }).join('\n')
  }
  
  /**
   * Extract attachment URLs from text (issue description or comment)
   */
  private extractAttachmentUrls(text: string): string[] {
    if (!text) return []
    
    // Match URLs that start with https://uploads.linear.app
    const regex = /https:\/\/uploads\.linear\.app\/[^\s<>"')]+/gi
    const matches = text.match(regex) || []
    
    // Remove duplicates
    return [...new Set(matches)]
  }
  
  /**
   * Download attachments from Linear issue
   * @param issue Linear issue object from webhook data
   * @param repository Repository configuration
   * @param workspacePath Path to workspace directory
   */
  private async downloadIssueAttachments(issue: LinearIssue, repository: RepositoryConfig, workspacePath: string): Promise<{ manifest: string, attachmentsDir: string | null }> {
    try {
      const attachmentMap: Record<string, string> = {}
      const imageMap: Record<string, string> = {}
      let attachmentCount = 0
      let imageCount = 0
      let skippedCount = 0
      let failedCount = 0
      const maxAttachments = 10
      
      // Create attachments directory in home directory
      const workspaceFolderName = basename(workspacePath)
      const attachmentsDir = join(
        homedir(),
        '.cyrus',
        workspaceFolderName,
        'attachments'
      )
      
      // Ensure directory exists
      await mkdir(attachmentsDir, { recursive: true })
      
      // Extract URLs from issue description
      const descriptionUrls = this.extractAttachmentUrls(issue.description || '')
      
      // Extract URLs from comments if available
      const commentUrls: string[] = []
      const linearClient = this.linearClients.get(repository.id)
      if (linearClient && issue.id) {
        try {
          const comments = await linearClient.comments({
            filter: { issue: { id: { eq: issue.id } } }
          })
          const commentNodes = await comments.nodes
          for (const comment of commentNodes) {
            const urls = this.extractAttachmentUrls(comment.body)
            commentUrls.push(...urls)
          }
        } catch (error) {
          console.error('Failed to fetch comments for attachments:', error)
        }
      }
      
      // Combine and deduplicate all URLs
      const allUrls = [...new Set([...descriptionUrls, ...commentUrls])]
      
      console.log(`Found ${allUrls.length} unique attachment URLs in issue ${issue.identifier}`)
      
      if (allUrls.length > maxAttachments) {
        console.warn(`Warning: Found ${allUrls.length} attachments but limiting to ${maxAttachments}. Skipping ${allUrls.length - maxAttachments} attachments.`)
      }
      
      // Download attachments up to the limit
      for (const url of allUrls) {
        if (attachmentCount >= maxAttachments) {
          skippedCount++
          continue
        }
        
        // Generate a temporary filename
        const tempFilename = `attachment_${attachmentCount + 1}.tmp`
        const tempPath = join(attachmentsDir, tempFilename)
        
        const result = await this.downloadAttachment(url, tempPath, repository.linearToken)
        
        if (result.success) {
          // Determine the final filename based on type
          let finalFilename: string
          if (result.isImage) {
            imageCount++
            finalFilename = `image_${imageCount}${result.fileType || '.png'}`
          } else {
            finalFilename = `attachment_${attachmentCount + 1}${result.fileType || ''}`
          }
          
          const finalPath = join(attachmentsDir, finalFilename)
          
          // Rename the file to include the correct extension
          await rename(tempPath, finalPath)
          
          // Store in appropriate map
          if (result.isImage) {
            imageMap[url] = finalPath
          } else {
            attachmentMap[url] = finalPath
          }
          attachmentCount++
        } else {
          failedCount++
          console.warn(`Failed to download attachment: ${url}`)
        }
      }
      
      // Generate attachment manifest
      const manifest = this.generateAttachmentManifest({
        attachmentMap,
        imageMap,
        totalFound: allUrls.length,
        downloaded: attachmentCount,
        imagesDownloaded: imageCount,
        skipped: skippedCount,
        failed: failedCount
      })
      
      // Return manifest and directory path if any attachments were downloaded
      return {
        manifest,
        attachmentsDir: attachmentCount > 0 ? attachmentsDir : null
      }
    } catch (error) {
      console.error('Error downloading attachments:', error)
      return { manifest: '', attachmentsDir: null } // Return empty manifest on error
    }
  }
  
  /**
   * Download a single attachment from Linear
   */
  private async downloadAttachment(
    attachmentUrl: string, 
    destinationPath: string, 
    linearToken: string
  ): Promise<{ success: boolean, fileType?: string, isImage?: boolean }> {
    try {
      console.log(`Downloading attachment from: ${attachmentUrl}`)
      
      const response = await fetch(attachmentUrl, {
        headers: {
          'Authorization': `Bearer ${linearToken}`
        }
      })
      
      if (!response.ok) {
        console.error(`Attachment download failed: ${response.status} ${response.statusText}`)
        return { success: false }
      }
      
      const buffer = Buffer.from(await response.arrayBuffer())
      
      // Detect the file type from the buffer
      const fileType = await fileTypeFromBuffer(buffer)
      let detectedExtension: string | undefined = undefined
      let isImage = false
      
      if (fileType) {
        detectedExtension = `.${fileType.ext}`
        isImage = fileType.mime.startsWith('image/')
        console.log(`Detected file type: ${fileType.mime} (${fileType.ext}), is image: ${isImage}`)
      } else {
        // Try to get extension from URL
        const urlPath = new URL(attachmentUrl).pathname
        const urlExt = extname(urlPath)
        if (urlExt) {
          detectedExtension = urlExt
          console.log(`Using extension from URL: ${detectedExtension}`)
        }
      }
      
      // Write the attachment to disk
      await writeFile(destinationPath, buffer)
      
      console.log(`Successfully downloaded attachment to: ${destinationPath}`)
      return { success: true, fileType: detectedExtension, isImage }
    } catch (error) {
      console.error(`Error downloading attachment:`, error)
      return { success: false }
    }
  }
  
  /**
   * Generate a markdown section describing downloaded attachments
   */
  private generateAttachmentManifest(downloadResult: {
    attachmentMap: Record<string, string>
    imageMap: Record<string, string>
    totalFound: number
    downloaded: number
    imagesDownloaded: number
    skipped: number
    failed: number
  }): string {
    const { attachmentMap, imageMap, totalFound, downloaded, imagesDownloaded, skipped, failed } = downloadResult
    
    let manifest = '\n## Downloaded Attachments\n\n'
    
    if (totalFound === 0) {
      manifest += 'No attachments were found in this issue.\n'
      return manifest
    }
    
    manifest += `Found ${totalFound} attachments. Downloaded ${downloaded}`
    if (imagesDownloaded > 0) {
      manifest += ` (including ${imagesDownloaded} images)`
    }
    if (skipped > 0) {
      manifest += `, skipped ${skipped} due to ${downloaded} attachment limit`
    }
    if (failed > 0) {
      manifest += `, failed to download ${failed}`
    }
    manifest += '.\n\n'
    
    if (failed > 0) {
      manifest += '**Note**: Some attachments failed to download. This may be due to authentication issues or the files being unavailable. The agent will continue processing the issue with the available information.\n\n'
    }
    
    manifest += 'Attachments have been downloaded to the `~/.cyrus/<workspace>/attachments` directory:\n\n'
    
    // List images first
    if (Object.keys(imageMap).length > 0) {
      manifest += '### Images\n'
      Object.entries(imageMap).forEach(([url, localPath], index) => {
        const filename = basename(localPath)
        manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`
        manifest += `   Local path: ${localPath}\n\n`
      })
      manifest += 'You can use the Read tool to view these images.\n\n'
    }
    
    // List other attachments
    if (Object.keys(attachmentMap).length > 0) {
      manifest += '### Other Attachments\n'
      Object.entries(attachmentMap).forEach(([url, localPath], index) => {
        const filename = basename(localPath)
        manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`
        manifest += `   Local path: ${localPath}\n\n`
      })
      manifest += 'You can use the Read tool to view these files.\n\n'
    }
    
    return manifest
  }

  /**
   * Check if the agent (Cyrus) is mentioned in a comment
   * @param comment Linear comment object from webhook data
   * @param repository Repository configuration
   * @returns true if the agent is mentioned, false otherwise
   */
  private async isAgentMentionedInComment(comment: LinearWebhookComment, repository: RepositoryConfig): Promise<boolean> {
    try {
      const linearClient = this.linearClients.get(repository.id)
      if (!linearClient) {
        console.warn(`No Linear client found for repository ${repository.id}`)
        return false
      }

      // Get the current user (agent) information
      const viewer = await linearClient.viewer
      if (!viewer) {
        console.warn('Unable to fetch viewer information')
        return false
      }

      // Check for mentions in the comment body
      // Linear mentions can be in formats like:
      // @username, @"Display Name", or @userId
      const commentBody = comment.body
      
      // Check for mention by user ID (most reliable)
      if (commentBody.includes(`@${viewer.id}`)) {
        return true
      }
      
      // Check for mention by name (case-insensitive)
      if (viewer.name) {
        const namePattern = new RegExp(`@"?${viewer.name}"?`, 'i')
        if (namePattern.test(commentBody)) {
          return true
        }
      }
      
      // Check for mention by display name (case-insensitive)
      if (viewer.displayName && viewer.displayName !== viewer.name) {
        const displayNamePattern = new RegExp(`@"?${viewer.displayName}"?`, 'i')
        if (displayNamePattern.test(commentBody)) {
          return true
        }
      }

      // Check for mention by email (less common but possible)
      if (viewer.email) {
        const emailPattern = new RegExp(`@"?${viewer.email}"?`, 'i')
        if (emailPattern.test(commentBody)) {
          return true
        }
      }

      return false
    } catch (error) {
      console.error('Failed to check if agent is mentioned in comment:', error)
      // If we can't determine, err on the side of caution and allow the trigger
      return true
    }
  }

  /**
   * Build MCP configuration with automatic Linear server injection
   */
  private buildMcpConfig(repository: RepositoryConfig): Record<string, McpServerConfig> {
    // Always inject the Linear MCP server with the repository's token
    const mcpConfig: Record<string, McpServerConfig> = {
      linear: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@tacticlaunch/mcp-linear'],
        env: {
          LINEAR_API_TOKEN: repository.linearToken
        }
      }
    }

    return mcpConfig
  }

  /**
   * Build allowed tools list with Linear MCP tools automatically included
   */
  private buildAllowedTools(repository: RepositoryConfig): string[] {
    // Start with configured tools or defaults
    const baseTools = repository.allowedTools || this.config.defaultAllowedTools || getSafeTools()
    
    // Ensure baseTools is an array
    const baseToolsArray = Array.isArray(baseTools) ? baseTools : []
    
    // Linear MCP tools that should always be available
    // See: https://docs.anthropic.com/en/docs/claude-code/iam#tool-specific-permission-rules
    const linearMcpTools = [
      "mcp__linear"
    ]
    
    // Combine and deduplicate
    const allTools = [...new Set([...baseToolsArray, ...linearMcpTools])]
    
    return allTools
  }

  /**
   * Load persisted EdgeWorker state for all repositories
   */
  private async loadPersistedState(): Promise<void> {
    for (const repo of this.repositories.values()) {
      try {
        const state = await this.persistenceManager.loadEdgeWorkerState(repo.id)
        if (state) {
          this.restoreMappings(state)
          console.log(`✅ Loaded persisted state for repository: ${repo.name}`)
        }
      } catch (error) {
        console.error(`Failed to load persisted state for repository ${repo.name}:`, error)
      }
    }
  }

  /**
   * Save current EdgeWorker state for all repositories
   */
  private async savePersistedState(): Promise<void> {
    for (const repo of this.repositories.values()) {
      try {
        const state = this.serializeMappings()
        await this.persistenceManager.saveEdgeWorkerState(repo.id, state)
      } catch (error) {
        console.error(`Failed to save persisted state for repository ${repo.name}:`, error)
      }
    }
  }

  /**
   * Serialize EdgeWorker mappings to a serializable format
   */
  public serializeMappings(): SerializableEdgeWorkerState {
    // Convert issueToCommentThreads Map<string, Set<string>> to Record<string, string[]>
    const issueToCommentThreads: Record<string, string[]> = {}
    for (const [issueId, threadSet] of this.issueToCommentThreads.entries()) {
      issueToCommentThreads[issueId] = Array.from(threadSet)
    }

    // Serialize session manager state
    const sessionManagerState = this.sessionManager.serializeSessions()

    return {
      commentToRepo: PersistenceManager.mapToRecord(this.commentToRepo),
      commentToIssue: PersistenceManager.mapToRecord(this.commentToIssue),
      commentToLatestAgentReply: PersistenceManager.mapToRecord(this.commentToLatestAgentReply),
      issueToCommentThreads,
      issueToReplyContext: PersistenceManager.mapToRecord(this.issueToReplyContext),
      sessionsByCommentId: sessionManagerState.sessionsByCommentId,
      sessionsByIssueId: sessionManagerState.sessionsByIssueId
    }
  }

  /**
   * Restore EdgeWorker mappings from serialized state
   */
  public restoreMappings(state: SerializableEdgeWorkerState): void {
    // Restore basic mappings
    this.commentToRepo = PersistenceManager.recordToMap(state.commentToRepo)
    this.commentToIssue = PersistenceManager.recordToMap(state.commentToIssue)
    this.commentToLatestAgentReply = PersistenceManager.recordToMap(state.commentToLatestAgentReply)
    this.issueToReplyContext = PersistenceManager.recordToMap(state.issueToReplyContext)

    // Restore issueToCommentThreads Record<string, string[]> to Map<string, Set<string>>
    this.issueToCommentThreads.clear()
    for (const [issueId, threadArray] of Object.entries(state.issueToCommentThreads)) {
      this.issueToCommentThreads.set(issueId, new Set(threadArray))
    }

    // Restore session manager state
    this.sessionManager.deserializeSessions({
      sessionsByCommentId: state.sessionsByCommentId,
      sessionsByIssueId: state.sessionsByIssueId
    })
  }

  /**
   * Save state and cleanup on shutdown
   */
  public async shutdown(): Promise<void> {
    try {
      await this.savePersistedState()
      console.log('✅ EdgeWorker state saved successfully')
    } catch (error) {
      console.error('❌ Failed to save EdgeWorker state during shutdown:', error)
    }

    // Stop all Claude runners
    for (const [commentId, runner] of this.claudeRunners.entries()) {
      try {
        await runner.stop()
      } catch (error) {
        console.error(`Failed to stop Claude runner for comment ${commentId}:`, error)
      }
    }

    // Stop shared application server
    try {
      await this.sharedApplicationServer.stop()
    } catch (error) {
      console.error('Failed to stop shared application server:', error)
    }
  }
}
