import { EventEmitter } from "node:events";
import { type Issue as LinearIssue } from "@linear/sdk";
import type {
	CyrusAgentSession,
	SerializableEdgeWorkerState,
} from "cyrus-core";
import { AgentSessionManager } from "./AgentSessionManager.js";
import type {
	EdgeWorkerConfig,
	EdgeWorkerEvents,
	RepositoryConfig,
} from "./types.js";
export declare interface EdgeWorker {
	on<K extends keyof EdgeWorkerEvents>(
		event: K,
		listener: EdgeWorkerEvents[K],
	): this;
	emit<K extends keyof EdgeWorkerEvents>(
		event: K,
		...args: Parameters<EdgeWorkerEvents[K]>
	): boolean;
}
/**
 * Unified edge worker that **orchestrates**
 *   capturing Linear webhooks,
 *   managing Claude Code processes, and
 *   processes results through to Linear Agent Activity Sessions
 */
export declare class EdgeWorker extends EventEmitter {
	private config;
	private repositories;
	private agentSessionManagers;
	private linearClients;
	private ndjsonClients;
	private persistenceManager;
	private sharedApplicationServer;
	private cyrusHome;
	private childToParentAgentSession;
	private runnerFactory;
	private sessionRunnerSelections;
	private nonClaudeRunners;
	private openCodeSessionCache;
	constructor(config: EdgeWorkerConfig);
	private debugLog;
	/**
	 * Start the edge worker
	 */
	start(): Promise<void>;
	/**
	 * Stop the edge worker
	 */
	stop(): Promise<void>;
	/**
	 * Handle connection established
	 */
	private handleConnect;
	/**
	 * Handle disconnection
	 */
	private handleDisconnect;
	/**
	 * Handle errors
	 */
	private handleError;
	/**
	 * Handle webhook events from proxy - now accepts native webhook payloads
	 */
	private handleWebhook;
	/**
	 * Handle issue unassignment webhook
	 */
	private handleIssueUnassignedWebhook;
	/**
	 * Find the repository configuration for a webhook
	 * Now supports async operations for label-based and project-based routing
	 * Priority: routingLabels > projectKeys > teamKeys
	 */
	private findRepositoryForWebhook;
	/**
	 * Helper method to find repository by project name
	 */
	private findRepositoryByProject;
	/**
	 * Create a new Linear agent session with all necessary setup
	 * @param linearAgentActivitySessionId The Linear agent activity session ID
	 * @param issue Linear issue object
	 * @param repository Repository configuration
	 * @param agentSessionManager Agent session manager instance
	 * @returns Object containing session details and setup information
	 */
	private createLinearAgentSession;
	/**
	 * Handle agent session created webhook
	 * . Can happen due to being 'delegated' or @ mentioned in a new thread
	 * @param webhook
	 * @param repository Repository configuration
	 */
	private handleAgentSessionCreatedWebhook;
	/**
	 * Handle new comment on issue (updated for comment-based sessions)
	 * @param issue Linear issue object from webhook data
	 * @param comment Linear comment object from webhook data
	 * @param repository Repository configuration
	 */
	private handleUserPostedAgentActivity;
	/**
	 * Handle issue unassignment
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 */
	private handleIssueUnassigned;
	/**
	 * Handle Claude messages
	 */
	private handleClaudeMessage;
	/**
	 * Handle Claude session error
	 * TODO: improve this
	 */
	private handleClaudeError;
	/**
	 * Fetch issue labels for a given issue
	 */
	private fetchIssueLabels;
	private resolveRunnerSelection;
	private getOpenAiApiKey;
	private normalizeError;
	private buildPromptPathCandidates;
	private loadPromptTemplateFromPath;
	private loadBuiltInPrompt;
	/**
	 * Determine system prompt based on issue labels and repository configuration
	 */
	private determineSystemPromptFromLabels;
	/**
	 * Build simplified prompt for label-based workflows
	 * @param issue Full Linear issue
	 * @param repository Repository configuration
	 * @returns Formatted prompt string
	 */
	private buildLabelBasedPrompt;
	/**
	 * Build prompt for mention-triggered sessions
	 * @param issue Full Linear issue object
	 * @param repository Repository configuration
	 * @param agentSession The agent session containing the mention
	 * @param attachmentManifest Optional attachment manifest to append
	 * @returns The constructed prompt and optional version tag
	 */
	private buildMentionPrompt;
	/**
	 * Extract version tag from template content
	 * @param templateContent The template content to parse
	 * @returns The version value if found, undefined otherwise
	 */
	private extractVersionTag;
	/**
	 * Check if a branch exists locally or remotely
	 */
	private branchExists;
	/**
	 * Determine the base branch for an issue, considering parent issues
	 */
	private determineBaseBranch;
	/**
	 * Convert full Linear SDK issue to CoreIssue interface for Session creation
	 */
	private convertLinearIssueToCore;
	/**
	 * Sanitize branch name by removing backticks to prevent command injection
	 */
	private sanitizeBranchName;
	/**
	 * Format Linear comments into a threaded structure that mirrors the Linear UI
	 * @param comments Array of Linear comments
	 * @returns Formatted string showing comment threads
	 */
	private formatCommentThreads;
	/**
	 * Build a prompt for Claude using the improved XML-style template
	 * @param issue Full Linear issue
	 * @param repository Repository configuration
	 * @param newComment Optional new comment to focus on (for handleNewRootComment)
	 * @param attachmentManifest Optional attachment manifest
	 * @returns Formatted prompt string
	 */
	private buildPromptV2;
	/**
	 * Get connection status by repository ID
	 */
	getConnectionStatus(): Map<string, boolean>;
	/**
	 * Get NDJSON client by token (for testing purposes)
	 * @internal
	 */
	_getClientByToken(token: string): any;
	/**
	 * Start OAuth flow using the shared application server
	 */
	startOAuthFlow(proxyUrl?: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}>;
	/**
	 * Get the server port
	 */
	getServerPort(): number;
	/**
	 * Get the OAuth callback URL
	 */
	getOAuthCallbackUrl(): string;
	/**
	 * Move issue to started state when assigned
	 * @param issue Full Linear issue object from Linear SDK
	 * @param repositoryId Repository ID for Linear client lookup
	 */
	private moveIssueToStartedState;
	/**
	 * Post initial comment when assigned to issue
	 */
	/**
	 * Post a comment to Linear
	 */
	private postComment;
	/**
	 * Format todos as Linear checklist markdown
	 */
	/**
	 * Extract attachment URLs from text (issue description or comment)
	 */
	private extractAttachmentUrls;
	/**
	 * Download attachments from Linear issue
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 * @param workspacePath Path to workspace directory
	 */
	private downloadIssueAttachments;
	/**
	 * Download a single attachment from Linear
	 */
	private downloadAttachment;
	/**
	 * Download attachments from a specific comment
	 * @param commentBody The body text of the comment
	 * @param attachmentsDir Directory where attachments should be saved
	 * @param linearToken Linear API token
	 * @param existingAttachmentCount Current number of attachments already downloaded
	 */
	private downloadCommentAttachments;
	/**
	 * Count existing images in the attachments directory
	 */
	private countExistingImages;
	/**
	 * Generate attachment manifest for new comment attachments
	 */
	private generateNewAttachmentManifest;
	/**
	 * Generate a markdown section describing downloaded attachments
	 */
	private generateAttachmentManifest;
	/**
	 * Build MCP configuration with automatic Linear server injection and inline cyrus tools
	 */
	private buildMcpConfig;
	/**
	 * Resolve tool preset names to actual tool lists
	 */
	private resolveToolPreset;
	/**
	 * Build prompt for a session - handles both new and existing sessions
	 */
	private buildSessionPrompt;
	/**
	 * Build Claude runner configuration with common settings
	 */
	private buildClaudeRunnerConfig;
	/**
	 * Build disallowed tools list following the same hierarchy as allowed tools
	 */
	private buildDisallowedTools;
	/**
	 * Build allowed tools list with Linear MCP tools automatically included
	 */
	private buildAllowedTools;
	/**
	 * Get Agent Sessions for an issue
	 */
	getAgentSessionsForIssue(issueId: string, repositoryId: string): any[];
	/**
	 * Load persisted EdgeWorker state for all repositories
	 */
	private loadPersistedState;
	/**
	 * Save current EdgeWorker state for all repositories
	 */
	private savePersistedState;
	/**
	 * Serialize EdgeWorker mappings to a serializable format
	 */
	serializeMappings(): SerializableEdgeWorkerState;
	/**
	 * Restore EdgeWorker mappings from serialized state
	 */
	restoreMappings(state: SerializableEdgeWorkerState): void;
	/**
	 * Post instant acknowledgment thought when agent session is created
	 */
	private postInstantAcknowledgment;
	private postThought;
	private startNonClaudeRunner;
	private handleNonClaudeFollowUp;
	/**
	 * Post parent resume acknowledgment thought when parent session is resumed from child
	 */
	private postParentResumeAcknowledgment;
	/**
	 * Post thought about system prompt selection based on labels
	 */
	private postSystemPromptSelectionThought;
	/**
	 * Resume or create a Claude session with the given prompt
	 * This is the core logic for handling prompted agent activities
	 * @param session The Cyrus agent session
	 * @param repository The repository configuration
	 * @param linearAgentActivitySessionId The Linear agent session ID
	 * @param agentSessionManager The agent session manager
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest
	 * @param isNewSession Whether this is a new session
	 */
	resumeClaudeSession(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		linearAgentActivitySessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest?: string,
		isNewSession?: boolean,
		additionalAllowedDirectories?: string[],
	): Promise<void>;
	/**
	 * Post instant acknowledgment thought when receiving prompted webhook
	 */
	private postInstantPromptedAcknowledgment;
	/**
	 * Fetch complete issue details from Linear API
	 */
	fetchFullIssueDetails(
		issueId: string,
		repositoryId: string,
	): Promise<LinearIssue | null>;
}
//# sourceMappingURL=EdgeWorker.d.ts.map
