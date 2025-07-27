import { EventEmitter } from 'events'
import { LinearClient, Issue as LinearIssue, Comment } from '@linear/sdk'
import { NdjsonClient } from 'cyrus-ndjson-client'
import { ClaudeRunner, getSafeTools } from 'cyrus-claude-runner'
import type { McpServerConfig } from 'cyrus-claude-runner'
import { PersistenceManager } from 'cyrus-core'
import type { IssueMinimal, SerializableEdgeWorkerState, SerializedCyrusAgentSession, SerializedCyrusAgentSessionEntry } from 'cyrus-core'
import type {
  LinearWebhook,
  // LinearIssueAssignedWebhook,
  // LinearIssueCommentMentionWebhook,
  // LinearIssueNewCommentWebhook,
  LinearIssueUnassignedWebhook,
  LinearAgentSessionCreatedWebhook,
  LinearAgentSessionPromptedWebhook,
  LinearWebhookIssue,
  LinearWebhookComment
} from 'cyrus-core'
import { SharedApplicationServer } from './SharedApplicationServer.js'
import { AgentSessionManager } from './AgentSessionManager.js'
import {
  isIssueAssignedWebhook,
  isIssueCommentMentionWebhook,
  isIssueNewCommentWebhook,
  isIssueUnassignedWebhook,
  isAgentSessionCreatedWebhook,
  isAgentSessionPromptedWebhook
} from 'cyrus-core'
import type { EdgeWorkerConfig, EdgeWorkerEvents, RepositoryConfig } from './types.js'
import type { SDKMessage } from 'cyrus-claude-runner'
import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { resolve, dirname, join, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { fileTypeFromBuffer } from 'file-type'

export declare interface EdgeWorker {
  on<K extends keyof EdgeWorkerEvents>(event: K, listener: EdgeWorkerEvents[K]): this
  emit<K extends keyof EdgeWorkerEvents>(event: K, ...args: Parameters<EdgeWorkerEvents[K]>): boolean
}

/**
 * Unified edge worker that **orchestrates**
 *   capturing Linear webhooks,
 *   managing Claude Code processes, and
 *   processes results through to Linear Agent Activity Sessions
 */
export class EdgeWorker extends EventEmitter {
  private config: EdgeWorkerConfig
  private repositories: Map<string, RepositoryConfig> = new Map() // repository 'id' (internal, stored in config.json) mapped to the full repo config
  private agentSessionManagers: Map<string, AgentSessionManager> = new Map() // Maps repository ID to AgentSessionManager, which manages ClaudeRunners for a repo
  private linearClients: Map<string, LinearClient> = new Map() // one linear client per 'repository'
  private ndjsonClients: Map<string, NdjsonClient> = new Map() // listeners for webhook events, one per linear token
  private persistenceManager: PersistenceManager
  private sharedApplicationServer: SharedApplicationServer

  constructor(config: EdgeWorkerConfig) {
    super()
    this.config = config
    this.persistenceManager = new PersistenceManager()

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
        const linearClient = new LinearClient({
          accessToken: repo.linearToken
        })
        this.linearClients.set(repo.id, linearClient)

        // Create AgentSessionManager for this repository
        this.agentSessionManagers.set(repo.id, new AgentSessionManager(linearClient))
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
    try {
      await this.savePersistedState()
      console.log('✅ EdgeWorker state saved successfully')
    } catch (error) {
      console.error('❌ Failed to save EdgeWorker state during shutdown:', error)
    }

    // get all claudeRunners
    const claudeRunners: ClaudeRunner[] = []
    for (const agentSessionManager of this.agentSessionManagers.values()) {
      claudeRunners.push(...agentSessionManager.getAllClaudeRunners())
    }

    // Kill all Claude processes with null checking
    for (const runner of claudeRunners) {
      if (runner) {
        try {
          runner.stop()
        } catch (error) {
          console.error('Error stopping Claude runner:', error)
        }
      }
    }

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
      // NOTE: Traditional webhooks (assigned, comment) are disabled in favor of agent session events
      if (isIssueAssignedWebhook(webhook)) {
        console.log(`[EdgeWorker] Ignoring traditional issue assigned webhook - using agent session events instead`)
        return
      } else if (isIssueCommentMentionWebhook(webhook)) {
        console.log(`[EdgeWorker] Ignoring traditional comment mention webhook - using agent session events instead`)
        return
      } else if (isIssueNewCommentWebhook(webhook)) {
        console.log(`[EdgeWorker] Ignoring traditional new comment webhook - using agent session events instead`)
        return
      } else if (isIssueUnassignedWebhook(webhook)) {
        // Keep unassigned webhook active
        await this.handleIssueUnassignedWebhook(webhook, repository)
      } else if (isAgentSessionCreatedWebhook(webhook)) {
        await this.handleAgentSessionCreatedWebhook(webhook, repository)
      } else if (isAgentSessionPromptedWebhook(webhook)) {
        await this.handleUserPostedAgentActivity(webhook, repository)
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

    // Handle agent session webhooks which have different structure
    if (isAgentSessionCreatedWebhook(webhook) || isAgentSessionPromptedWebhook(webhook)) {
      const teamKey = webhook.agentSession?.issue?.team?.key
      if (teamKey) {
        const repo = repos.find(r => r.teamKeys && r.teamKeys.includes(teamKey))
        if (repo) return repo
      }

      // Try parsing issue identifier as fallback
      const issueId = webhook.agentSession?.issue?.identifier
      if (issueId && issueId.includes('-')) {
        const prefix = issueId.split('-')[0]
        if (prefix) {
          const repo = repos.find(r => r.teamKeys && r.teamKeys.includes(prefix))
          if (repo) return repo
        }
      }
    } else {
      // Original logic for other webhook types
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
    }

    // Original workspace fallback - find first repo without teamKeys or matching workspace
    return repos.find(repo =>
      repo.linearWorkspaceId === workspaceId && (!repo.teamKeys || repo.teamKeys.length === 0)
    ) || repos.find(repo => repo.linearWorkspaceId === workspaceId) || null
  }

  /**
   * Handle agent session created webhook
   * . Can happen due to being 'delegated' or @ mentioned in a new thread
   * @param webhook 
   * @param repository Repository configuration
   */
  private async handleAgentSessionCreatedWebhook(webhook: LinearAgentSessionCreatedWebhook, repository: RepositoryConfig): Promise<void> {
    console.log(`[EdgeWorker] Handling agent session created: ${webhook.agentSession.issue.identifier}`)
    const { agentSession } = webhook
    const linearAgentActivitySessionId = agentSession.id
    const { issue } = agentSession
    // Initialize the agent session in AgentSessionManager
    const agentSessionManager = this.agentSessionManagers.get(repository.id)
    if (!agentSessionManager) {
      console.error('There was no agentSessionManage for the repository with id', repository.id)
      return
    }

    // Post instant acknowledgment thought
    await this.postInstantAcknowledgment(linearAgentActivitySessionId, repository.id)

    // Fetch full Linear issue details immediately
    const fullIssue = await this.fetchFullIssueDetails(issue.id, repository.id)
    if (!fullIssue) {
      throw new Error(`Failed to fetch full issue details for ${issue.id}`)
    }

    // Move issue to started state automatically, in case it's not already
    await this.moveIssueToStartedState(fullIssue, repository.id)

    // Create workspace using full issue data
    const workspace = this.config.handlers?.createWorkspace
      ? await this.config.handlers.createWorkspace(fullIssue, repository)
      : {
        path: `${repository.workspaceBaseDir}/${fullIssue.identifier}`,
        isGitWorktree: false
      }

    console.log(`[EdgeWorker] Workspace created at: ${workspace.path}`)

    const issueMinimal = this.convertLinearIssueToCore(fullIssue)
    agentSessionManager.createLinearAgentSession(linearAgentActivitySessionId, issue.id, issueMinimal, workspace)

    // Download attachments before creating Claude runner
    const attachmentResult = await this.downloadIssueAttachments(fullIssue, repository, workspace.path)

    // Build allowed directories list
    const allowedDirectories: string[] = []
    if (attachmentResult.attachmentsDir) {
      allowedDirectories.push(attachmentResult.attachmentsDir)
    }

    // Build allowed tools list with Linear MCP tools
    const allowedTools = this.buildAllowedTools(repository)

    // Fetch issue labels and determine system prompt
    const labels = await this.fetchIssueLabels(fullIssue)
    const systemPrompt = await this.determineSystemPromptFromLabels(labels, repository)

    // Post thought about system prompt selection
    if (systemPrompt) {
      await this.postSystemPromptSelectionThought(linearAgentActivitySessionId, labels, repository.id)
    }

    // Create Claude runner with attachment directory access and optional system prompt
    const runner = new ClaudeRunner({
      workingDirectory: workspace.path,
      allowedTools,
      allowedDirectories,
      workspaceName: fullIssue.identifier,
      mcpConfigPath: repository.mcpConfigPath,
      mcpConfig: this.buildMcpConfig(repository),
      ...(systemPrompt && { appendSystemPrompt: systemPrompt }),
      onMessage: (message) => this.handleClaudeMessage(linearAgentActivitySessionId, message, repository.id),
      // onComplete: (messages) => this.handleClaudeComplete(initialComment.id, messages, repository.id),
      onError: (error) => this.handleClaudeError(error)
    })

    // Store runner by comment ID
    agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner)

    // Save state after mapping changes
    await this.savePersistedState()

    // Emit events using full Linear issue
    this.emit('session:started', fullIssue.id, fullIssue, repository.id)
    this.config.handlers?.onSessionStart?.(fullIssue.id, fullIssue, repository.id)

    // Build and start Claude with initial prompt using full issue (streaming mode)
    console.log(`[EdgeWorker] Building initial prompt for issue ${fullIssue.identifier}`)
    try {
      // Choose the appropriate prompt builder based on system prompt availability
      const prompt = systemPrompt
        ? await this.buildLabelBasedPrompt(fullIssue, repository, attachmentResult.manifest)
        : await this.buildPromptV2(fullIssue, repository, undefined, attachmentResult.manifest)
      
      console.log(`[EdgeWorker] Initial prompt built successfully using ${systemPrompt ? 'label-based' : 'fallback'} workflow, length: ${prompt.length} characters`)
      console.log(`[EdgeWorker] Starting Claude streaming session`)
      const sessionInfo = await runner.startStreaming(prompt)
      console.log(`[EdgeWorker] Claude streaming session started: ${sessionInfo.sessionId}`)
      // Note: AgentSessionManager will be initialized automatically when the first system message 
      // is received via handleClaudeMessage() callback
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
  private async handleUserPostedAgentActivity(webhook: LinearAgentSessionPromptedWebhook, repository: RepositoryConfig): Promise<void> {

    // Look for existing session for this comment thread
    const { agentSession } = webhook
    const linearAgentActivitySessionId = agentSession.id
    const { issue } = agentSession

    const promptBody = webhook.agentActivity.content.body

    // Initialize the agent session in AgentSessionManager
    const agentSessionManager = this.agentSessionManagers.get(repository.id)
    if (!agentSessionManager) {
      console.error('Unexpected: There was no agentSessionManage for the repository with id', repository.id)
      return
    }

    const session = agentSessionManager.getSession(linearAgentActivitySessionId)
    if (!session) {
      console.error(`Unexpected: could not find Cyrus Agent Session for agent activity session: ${linearAgentActivitySessionId}`)
      return
    }

    // Check if there's an existing runner for this comment thread
    const existingRunner = session.claudeRunner
    if (existingRunner && existingRunner.isStreaming()) {
      // Post immediate reply for streaming case
      // parentId ensures correct nesting: replies to parent if this is a reply, or to comment itself if root
      // TODO____ REACT
      // await this.postComment(
      //   issue.id,
      //   "I've queued up your message to address it right after I resolve my current focus.",
      //   repository.id,
      //   parentCommentId || comment.id  // Same nesting level as the triggering comment
      // )

      // Add comment to existing stream instead of restarting
      console.log(`[EdgeWorker] Adding comment to existing stream for agent activity session ${linearAgentActivitySessionId}`)
      existingRunner.addStreamMessage(promptBody)
      return // Exit early - comment has been added to stream
    }

    // Stop existing runner if it's not streaming or stream addition failed
    if (existingRunner) {
      existingRunner.stop()
    }

    if (!session.claudeSessionId) {
      console.error(`Unexpected: Handling a 'prompted' webhook but did not find an existing claudeSessionId for the linearAgentActivitySessionId ${linearAgentActivitySessionId}. Not continuing.`)
      return
    }

    try {
      // Build allowed tools list with Linear MCP tools
      const allowedTools = this.buildAllowedTools(repository)

      // Create new runner with resume mode if we have a Claude session ID
      const runner = new ClaudeRunner({
        workingDirectory: session.workspace.path,
        allowedTools,
        resumeSessionId: session.claudeSessionId,
        workspaceName: issue.identifier,
        mcpConfigPath: repository.mcpConfigPath,
        mcpConfig: this.buildMcpConfig(repository),
        onMessage: (message) => {
          this.handleClaudeMessage(linearAgentActivitySessionId, message, repository.id)
        },
        // onComplete: (messages) => this.handleClaudeComplete(threadRootCommentId, messages, repository.id),
        onError: (error) => this.handleClaudeError(error)
      })

      // Store new runner by comment thread root
      // Store runner by comment ID
      agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner)

      // Save state after mapping changes
      await this.savePersistedState()

      // Start streaming session with the comment as initial prompt
      console.log(`[EdgeWorker] Starting new streaming session for issue ${issue.identifier}`)
      await runner.startStreaming(promptBody)

    } catch (error) {
      console.error('Failed to continue conversation:', error)
      // Remove any partially created session
      // this.sessionManager.removeSession(threadRootCommentId)
      // this.commentToRepo.delete(threadRootCommentId)
      // this.commentToIssue.delete(threadRootCommentId)
      // // Start fresh for root comments, or fall back to issue assignment
      // if (isRootComment) {
      //   await this.handleNewRootComment(issue, comment, repository)
      // } else {
      //   await this.handleIssueAssigned(issue, repository)
      // }
    }
  }

  /**
   * Handle issue unassignment
   * @param issue Linear issue object from webhook data
   * @param repository Repository configuration
   */
  private async handleIssueUnassigned(issue: LinearWebhookIssue, repository: RepositoryConfig): Promise<void> {
    const agentSessionManager = this.agentSessionManagers.get(repository.id)
    if (!agentSessionManager) {
      console.log('No agentSessionManager for unassigned issue, so no sessions to stop')
      return
    }

    // Get all Claude runners for this specific issue
    const claudeRunners = agentSessionManager.getClaudeRunnersForIssue(issue.id)

    // Stop all Claude runners for this issue
    const activeThreadCount = claudeRunners.length
    for (const runner of claudeRunners) {
      console.log(`[EdgeWorker] Stopping Claude runner for issue ${issue.identifier}`)
      runner.stop()
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

    // Emit events
    console.log(`[EdgeWorker] Stopped ${activeThreadCount} sessions for unassigned issue ${issue.identifier}`)
  }

  /**
   * Handle Claude messages
   */
  private async handleClaudeMessage(linearAgentActivitySessionId: string, message: SDKMessage, repositoryId: string): Promise<void> {
    const agentSessionManager = this.agentSessionManagers.get(repositoryId)
    // Integrate with AgentSessionManager to capture streaming messages
    if (agentSessionManager) {
      await agentSessionManager.handleClaudeMessage(linearAgentActivitySessionId, message)
    }
  }

  /**
   * Handle Claude session error
   * TODO: improve this
   */
  private async handleClaudeError(error: Error): Promise<void> {
    console.error('Unhandled claude error:', error)
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
   * Fetch issue labels for a given issue
   */
  private async fetchIssueLabels(issue: LinearIssue): Promise<string[]> {
    try {
      const labels = await issue.labels()
      return labels.nodes.map(label => label.name)
    } catch (error) {
      console.error(`[EdgeWorker] Failed to fetch labels for issue ${issue.id}:`, error)
      return []
    }
  }

  /**
   * Determine system prompt based on issue labels and repository configuration
   */
  private async determineSystemPromptFromLabels(labels: string[], repository: RepositoryConfig): Promise<string | undefined> {
    if (!repository.labelPrompts || labels.length === 0) {
      return undefined
    }

    // Check each prompt type for matching labels
    const promptTypes = ['debugger', 'builder', 'scoper'] as const
    
    for (const promptType of promptTypes) {
      const configuredLabels = repository.labelPrompts[promptType]
      if (configuredLabels && configuredLabels.some(label => labels.includes(label))) {
        try {
          // Load the prompt template from file
          const __filename = fileURLToPath(import.meta.url)
          const __dirname = dirname(__filename)
          const promptPath = join(__dirname, '..', 'prompts', `${promptType}.md`)
          const promptContent = await readFile(promptPath, 'utf-8')
          console.log(`[EdgeWorker] Using ${promptType} system prompt for labels: ${labels.join(', ')}`)
          return promptContent
        } catch (error) {
          console.error(`[EdgeWorker] Failed to load ${promptType} prompt template:`, error)
          return undefined
        }
      }
    }

    return undefined
  }

  /**
   * Build simplified prompt for label-based workflows
   * @param issue Full Linear issue
   * @param repository Repository configuration
   * @returns Formatted prompt string
   */
  private async buildLabelBasedPrompt(
    issue: LinearIssue,
    repository: RepositoryConfig,
    attachmentManifest: string = ''
  ): Promise<string> {
    console.log(`[EdgeWorker] buildLabelBasedPrompt called for issue ${issue.identifier}`)

    try {
      // Load the label-based prompt template
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const templatePath = resolve(__dirname, '../label-prompt-template.md')
      
      console.log(`[EdgeWorker] Loading label prompt template from: ${templatePath}`)
      const template = await readFile(templatePath, 'utf-8')
      console.log(`[EdgeWorker] Template loaded, length: ${template.length} characters`)

      // Build the simplified prompt with only essential variables
      let prompt = template
        .replace(/{{repository_name}}/g, repository.name)
        .replace(/{{base_branch}}/g, repository.baseBranch)
        .replace(/{{issue_id}}/g, issue.id || '')
        .replace(/{{issue_identifier}}/g, issue.identifier || '')
        .replace(/{{issue_title}}/g, issue.title || '')
        .replace(/{{issue_description}}/g, issue.description || 'No description provided')
        .replace(/{{issue_url}}/g, issue.url || '')

      if (attachmentManifest) {
        console.log(`[EdgeWorker] Adding attachment manifest to label-based prompt, length: ${attachmentManifest.length} characters`)
        prompt = prompt + '\n\n' + attachmentManifest
      }

      console.log(`[EdgeWorker] Label-based prompt built successfully, length: ${prompt.length} characters`)
      return prompt

    } catch (error) {
      console.error(`[EdgeWorker] Error building label-based prompt:`, error)
      throw error
    }
  }

  /**
   * Convert full Linear SDK issue to CoreIssue interface for Session creation
   */
  private convertLinearIssueToCore(issue: LinearIssue): IssueMinimal {
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title || '',
      description: issue.description || undefined,
      branchName: issue.branchName // Use the real branchName property!
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
        templatePath = resolve(__dirname, '../prompt-template-v2.md')
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

          const commentNodes = comments.nodes
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
  // private async postInitialComment(issueId: string, repositoryId: string): Promise<void> {
  //   const body = "I'm getting started right away."
  //   // Get the Linear client for this repository
  //   const linearClient = this.linearClients.get(repositoryId)
  //   if (!linearClient) {
  //     throw new Error(`No Linear client found for repository ${repositoryId}`)
  //   }
  //   const commentData = {
  //     issueId,
  //     body
  //   }
  //   await linearClient.createComment(commentData)
  // }

  /**
   * Post a comment to Linear
   */
  private async postComment(issueId: string, body: string, repositoryId: string, parentId?: string): Promise<void> {
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
    await linearClient.createComment(commentData)
  }

  /**
   * Format todos as Linear checklist markdown
   */
  // private formatTodosAsChecklist(todos: Array<{id: string, content: string, status: string, priority: string}>): string {
  //   return todos.map(todo => {
  //     const checkbox = todo.status === 'completed' ? '[x]' : '[ ]'
  //     const statusEmoji = todo.status === 'in_progress' ? ' 🔄' : ''
  //     return `- ${checkbox} ${todo.content}${statusEmoji}`
  //   }).join('\n')
  // }

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
          const commentNodes = comments.nodes
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

  // /**
  //  * Check if the agent (Cyrus) is mentioned in a comment
  //  * @param comment Linear comment object from webhook data
  //  * @param repository Repository configuration
  //  * @returns true if the agent is mentioned, false otherwise
  //  */
  // private async isAgentMentionedInComment(comment: LinearWebhookComment, repository: RepositoryConfig): Promise<boolean> {
  //   try {
  //     const linearClient = this.linearClients.get(repository.id)
  //     if (!linearClient) {
  //       console.warn(`No Linear client found for repository ${repository.id}`)
  //       return false
  //     }

  //     // Get the current user (agent) information
  //     const viewer = await linearClient.viewer
  //     if (!viewer) {
  //       console.warn('Unable to fetch viewer information')
  //       return false
  //     }

  //     // Check for mentions in the comment body
  //     // Linear mentions can be in formats like:
  //     // @username, @"Display Name", or @userId
  //     const commentBody = comment.body

  //     // Check for mention by user ID (most reliable)
  //     if (commentBody.includes(`@${viewer.id}`)) {
  //       return true
  //     }

  //     // Check for mention by name (case-insensitive)
  //     if (viewer.name) {
  //       const namePattern = new RegExp(`@"?${viewer.name}"?`, 'i')
  //       if (namePattern.test(commentBody)) {
  //         return true
  //       }
  //     }

  //     // Check for mention by display name (case-insensitive)
  //     if (viewer.displayName && viewer.displayName !== viewer.name) {
  //       const displayNamePattern = new RegExp(`@"?${viewer.displayName}"?`, 'i')
  //       if (displayNamePattern.test(commentBody)) {
  //         return true
  //       }
  //     }

  //     // Check for mention by email (less common but possible)
  //     if (viewer.email) {
  //       const emailPattern = new RegExp(`@"?${viewer.email}"?`, 'i')
  //       if (emailPattern.test(commentBody)) {
  //         return true
  //       }
  //     }

  //     return false
  //   } catch (error) {
  //     console.error('Failed to check if agent is mentioned in comment:', error)
  //     // If we can't determine, err on the side of caution and allow the trigger
  //     return true
  //   }
  // }

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
   * Get Agent Sessions for an issue
   */
  public getAgentSessionsForIssue(issueId: string, repositoryId: string): any[] {
    const agentSessionManager = this.agentSessionManagers.get(repositoryId)
    if (!agentSessionManager) {
      return []
    }

    return agentSessionManager.getSessionsByIssueId(issueId)
  }

  /**
   * Load persisted EdgeWorker state for all repositories
   */
  private async loadPersistedState(): Promise<void> {
    try {
      const state = await this.persistenceManager.loadEdgeWorkerState()
      if (state) {
        this.restoreMappings(state)
        console.log(`✅ Loaded persisted EdgeWorker state with ${Object.keys(state.agentSessions || {}).length} repositories`)
      }
    } catch (error) {
      console.error(`Failed to load persisted EdgeWorker state:`, error)
    }
  }

  /**
   * Save current EdgeWorker state for all repositories
   */
  private async savePersistedState(): Promise<void> {
    try {
      const state = this.serializeMappings()
      await this.persistenceManager.saveEdgeWorkerState(state)
      console.log(`✅ Saved EdgeWorker state for ${Object.keys(state.agentSessions || {}).length} repositories`)
    } catch (error) {
      console.error(`Failed to save persisted EdgeWorker state:`, error)
    }
  }

  /**
   * Serialize EdgeWorker mappings to a serializable format
   */
  public serializeMappings(): SerializableEdgeWorkerState {
    // Serialize Agent Session state for all repositories
    const agentSessions: Record<string, Record<string, SerializedCyrusAgentSession>> = {}
    const agentSessionEntries: Record<string, Record<string, SerializedCyrusAgentSessionEntry[]>> = {}
    for (const [repositoryId, agentSessionManager] of this.agentSessionManagers.entries()) {
      const serializedState = agentSessionManager.serializeState()
      agentSessions[repositoryId] = serializedState.sessions
      agentSessionEntries[repositoryId] = serializedState.entries
    }
    return {
      agentSessions,
      agentSessionEntries,
    }
  }

  /**
   * Restore EdgeWorker mappings from serialized state
   */
  public restoreMappings(state: SerializableEdgeWorkerState): void {

    // Restore Agent Session state for all repositories
    if (state.agentSessions && state.agentSessionEntries) {
      for (const [repositoryId, agentSessionManager] of this.agentSessionManagers.entries()) {
        const repositorySessions = state.agentSessions[repositoryId] || {}
        const repositoryEntries = state.agentSessionEntries[repositoryId] || {}

        if (Object.keys(repositorySessions).length > 0 || Object.keys(repositoryEntries).length > 0) {
          agentSessionManager.restoreState(repositorySessions, repositoryEntries)
          console.log(`[EdgeWorker] Restored Agent Session state for repository ${repositoryId}`)
        }
      }
    }
  }

  /**
   * Post instant acknowledgment thought when agent session is created
   */
  private async postInstantAcknowledgment(linearAgentActivitySessionId: string, repositoryId: string): Promise<void> {
    try {
      const linearClient = this.linearClients.get(repositoryId)
      if (!linearClient) {
        console.warn(`[EdgeWorker] No Linear client found for repository ${repositoryId}`)
        return
      }

      const activityInput = {
        agentSessionId: linearAgentActivitySessionId,
        content: {
          type: 'thought',
          body: 'I\'ve received your request and I\'m starting to work on it. Let me analyze the issue and prepare my approach.'
        }
      }

      const result = await linearClient.createAgentActivity(activityInput)
      if (result.success) {
        console.log(`[EdgeWorker] Posted instant acknowledgment thought for session ${linearAgentActivitySessionId}`)
      } else {
        console.error(`[EdgeWorker] Failed to post instant acknowledgment:`, result)
      }
    } catch (error) {
      console.error(`[EdgeWorker] Error posting instant acknowledgment:`, error)
    }
  }

  /**
   * Post thought about system prompt selection based on labels
   */
  private async postSystemPromptSelectionThought(linearAgentActivitySessionId: string, labels: string[], repositoryId: string): Promise<void> {
    try {
      const linearClient = this.linearClients.get(repositoryId)
      if (!linearClient) {
        console.warn(`[EdgeWorker] No Linear client found for repository ${repositoryId}`)
        return
      }

      // Determine which prompt type was selected and which label triggered it
      let selectedPromptType: string | null = null
      let triggerLabel: string | null = null
      const repository = Array.from(this.repositories.values()).find(r => r.id === repositoryId)
      
      if (repository?.labelPrompts) {
        // Check debugger labels
        const debuggerLabel = repository.labelPrompts.debugger?.find(label => labels.includes(label))
        if (debuggerLabel) {
          selectedPromptType = 'debugger'
          triggerLabel = debuggerLabel
        } else {
          // Check builder labels
          const builderLabel = repository.labelPrompts.builder?.find(label => labels.includes(label))
          if (builderLabel) {
            selectedPromptType = 'builder'
            triggerLabel = builderLabel
          } else {
            // Check scoper labels
            const scoperLabel = repository.labelPrompts.scoper?.find(label => labels.includes(label))
            if (scoperLabel) {
              selectedPromptType = 'scoper'
              triggerLabel = scoperLabel
            }
          }
        }
      }

      // Only post if a role was actually triggered
      if (!selectedPromptType || !triggerLabel) {
        return
      }

      const activityInput = {
        agentSessionId: linearAgentActivitySessionId,
        content: {
          type: 'thought',
          body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`
        }
      }

      const result = await linearClient.createAgentActivity(activityInput)
      if (result.success) {
        console.log(`[EdgeWorker] Posted system prompt selection thought for session ${linearAgentActivitySessionId} (${selectedPromptType} mode)`)
      } else {
        console.error(`[EdgeWorker] Failed to post system prompt selection thought:`, result)
      }
    } catch (error) {
      console.error(`[EdgeWorker] Error posting system prompt selection thought:`, error)
    }
  }
}
