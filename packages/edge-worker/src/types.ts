import type { Workspace } from 'cyrus-core'
import type { Issue as LinearIssue } from '@linear/sdk'
import type { SDKMessage } from 'cyrus-claude-runner'


/**
 * Configuration for a single repository/workspace pair
 */
export interface RepositoryConfig {
  // Repository identification
  id: string                    // Unique identifier for this repo config
  name: string                  // Display name (e.g., "Frontend App")
  
  // Git configuration
  repositoryPath: string        // Local git repository path
  baseBranch: string           // Branch to create worktrees from (main, master, etc.)
  
  // Linear configuration
  linearWorkspaceId: string    // Linear workspace/team ID
  linearToken: string          // OAuth token for this Linear workspace
  teamKeys?: string[]          // Linear team keys for routing (e.g., ["CEE", "BOOK"])
  
  // Workspace configuration
  workspaceBaseDir: string     // Where to create issue workspaces for this repo
  
  // Optional settings
  isActive?: boolean           // Whether to process webhooks for this repo (default: true)
  promptTemplatePath?: string  // Custom prompt template for this repo
  allowedTools?: string[]      // Override Claude tools for this repository (overrides defaultAllowedTools)
  mcpConfigPath?: string       // Path to MCP configuration JSON file (format: {"mcpServers": {...}})
}

/**
 * Configuration for the EdgeWorker supporting multiple repositories
 */
export interface EdgeWorkerConfig {
  // Proxy connection config
  proxyUrl: string
  
  // Claude config (shared across all repos)
  defaultAllowedTools?: string[]
  
  // Repository configurations
  repositories: RepositoryConfig[]
  
  // Optional handlers that apps can implement
  handlers?: {
    // Called when workspace needs to be created
    // Now includes repository context
    createWorkspace?: (issue: LinearIssue, repository: RepositoryConfig) => Promise<Workspace>
    
    // Called with Claude messages (for UI updates, logging, etc)
    // Now includes repository ID
    onClaudeMessage?: (issueId: string, message: SDKMessage, repositoryId: string) => void
    
    // Called when session starts/ends
    // Now includes repository ID
    onSessionStart?: (issueId: string, issue: LinearIssue, repositoryId: string) => void
    onSessionEnd?: (issueId: string, exitCode: number | null, repositoryId: string) => void
    
    // Called on errors
    onError?: (error: Error, context?: any) => void
  }
  
  // Optional features (can be overridden per repository)
  features?: {
    enableContinuation?: boolean  // Support --continue flag (default: true)
    enableTokenLimitHandling?: boolean  // Auto-handle token limits (default: true)
    enableAttachmentDownload?: boolean  // Download issue attachments (default: false)
    promptTemplatePath?: string  // Path to custom prompt template
  }
}


/**
 * Events emitted by EdgeWorker
 */
export interface EdgeWorkerEvents {
  // Connection events (now includes token to identify which connection)
  'connected': (token: string) => void
  'disconnected': (token: string, reason?: string) => void
  
  // Session events (now includes repository ID)
  'session:started': (issueId: string, issue: LinearIssue, repositoryId: string) => void
  'session:ended': (issueId: string, exitCode: number | null, repositoryId: string) => void
  
  // Claude messages (now includes repository ID)
  'claude:message': (issueId: string, message: SDKMessage, repositoryId: string) => void
  'claude:response': (issueId: string, text: string, repositoryId: string) => void
  'claude:tool-use': (issueId: string, tool: string, input: any, repositoryId: string) => void
  
  // Error events
  'error': (error: Error, context?: any) => void
}