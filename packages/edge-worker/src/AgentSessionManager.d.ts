import { type LinearClient } from "@linear/sdk";
import type {
	ClaudeRunner,
	SDKMessage,
	SDKResultMessage,
	SDKSystemMessage,
} from "cyrus-claude-runner";
import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
	IssueMinimal,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
	Workspace,
} from "cyrus-core";
/**
 * Manages Linear Agent Sessions integration with Claude Code SDK
 * Transforms Claude streaming messages into Agent Session format
 * Handles session lifecycle: create → active → complete/error
 *
 * CURRENTLY BEING HANDLED 'per repository'
 */
export declare class AgentSessionManager {
	private linearClient;
	private sessions;
	private entries;
	private activeTasksBySession;
	private getParentSessionId?;
	private resumeParentSession?;
	constructor(
		linearClient: LinearClient,
		getParentSessionId?: (childSessionId: string) => string | undefined,
		resumeParentSession?: (
			parentSessionId: string,
			prompt: string,
			childSessionId: string,
		) => Promise<void>,
	);
	/**
	 * Initialize a Linear agent session from webhook
	 * The session is already created by Linear, we just need to track it
	 */
	createLinearAgentSession(
		linearAgentActivitySessionId: string,
		issueId: string,
		issueMinimal: IssueMinimal,
		workspace: Workspace,
	): CyrusAgentSession;
	/**
	 * Create a new Agent Session from Claude system initialization
	 */
	updateAgentSessionWithClaudeSessionId(
		linearAgentActivitySessionId: string,
		claudeSystemMessage: SDKSystemMessage,
	): void;
	/**
	 * Create a session entry from Claude user/assistant message (without syncing to Linear)
	 */
	private createSessionEntry;
	/**
	 * Format TodoWrite tool parameter as a nice checklist
	 */
	private formatTodoWriteParameter;
	/**
	 * Complete a session from Claude result message
	 */
	completeSession(
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void>;
	/**
	 * Handle streaming Claude messages and route to appropriate methods
	 */
	handleClaudeMessage(
		linearAgentActivitySessionId: string,
		message: SDKMessage,
	): Promise<void>;
	/**
	 * Update session status and metadata
	 */
	private updateSessionStatus;
	/**
	 * Add result entry from Claude result message
	 */
	private addResultEntry;
	/**
	 * Extract content from Claude message
	 */
	private extractContent;
	/**
	 * Extract tool information from Claude assistant message
	 */
	private extractToolInfo;
	/**
	 * Extract tool_use_id from Claude user message containing tool_result
	 */
	private extractToolResultId;
	/**
	 * Sync Agent Session Entry to Linear (create AgentActivity)
	 */
	private syncEntryToLinear;
	/**
	 * Get session by ID
	 */
	getSession(
		linearAgentActivitySessionId: string,
	): CyrusAgentSession | undefined;
	/**
	 * Get session entries by session ID
	 */
	getSessionEntries(
		linearAgentActivitySessionId: string,
	): CyrusAgentSessionEntry[];
	/**
	 * Get all active sessions
	 */
	getActiveSessions(): CyrusAgentSession[];
	/**
	 * Add or update ClaudeRunner for a session
	 */
	addClaudeRunner(
		linearAgentActivitySessionId: string,
		claudeRunner: ClaudeRunner,
	): void;
	/**
	 *  Get all ClaudeRunners
	 */
	getAllClaudeRunners(): ClaudeRunner[];
	/**
	 * Get all ClaudeRunners for a specific issue
	 */
	getClaudeRunnersForIssue(issueId: string): ClaudeRunner[];
	/**
	 * Get sessions by issue ID
	 */
	getSessionsByIssueId(issueId: string): CyrusAgentSession[];
	/**
	 * Get active sessions by issue ID
	 */
	getActiveSessionsByIssueId(issueId: string): CyrusAgentSession[];
	/**
	 * Get all sessions
	 */
	getAllSessions(): CyrusAgentSession[];
	/**
	 * Get ClaudeRunner for a specific session
	 */
	getClaudeRunner(
		linearAgentActivitySessionId: string,
	): ClaudeRunner | undefined;
	/**
	 * Check if a ClaudeRunner exists for a session
	 */
	hasClaudeRunner(linearAgentActivitySessionId: string): boolean;
	/**
	 * Create a thought activity
	 */
	createThoughtActivity(sessionId: string, body: string): Promise<void>;
	/**
	 * Create an action activity
	 */
	createActionActivity(
		sessionId: string,
		action: string,
		parameter: string,
		result?: string,
	): Promise<void>;
	/**
	 * Create a response activity
	 */
	createResponseActivity(sessionId: string, body: string): Promise<void>;
	/**
	 * Create an error activity
	 */
	createErrorActivity(sessionId: string, body: string): Promise<void>;
	/**
	 * Create an elicitation activity
	 */
	createElicitationActivity(sessionId: string, body: string): Promise<void>;
	/**
	 * Clear completed sessions older than specified time
	 */
	cleanup(olderThanMs?: number): void;
	/**
	 * Serialize Agent Session state for persistence
	 */
	serializeState(): {
		sessions: Record<string, SerializedCyrusAgentSession>;
		entries: Record<string, SerializedCyrusAgentSessionEntry[]>;
	};
	/**
	 * Restore Agent Session state from serialized data
	 */
	restoreState(
		serializedSessions: Record<string, SerializedCyrusAgentSession>,
		serializedEntries: Record<string, SerializedCyrusAgentSessionEntry[]>,
	): void;
	/**
	 * Post a thought about the model being used
	 */
	private postModelNotificationThought;
}
//# sourceMappingURL=AgentSessionManager.d.ts.map
