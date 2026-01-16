import type { AgentActivityContent, IIssueTrackerService } from "cyrus-core";
import type { IActivitySink } from "./IActivitySink.js";

/**
 * Linear-specific implementation of IActivitySink.
 *
 * LinearActivitySink wraps an IIssueTrackerService instance to provide activity
 * sink functionality for Linear workspaces. It delegates activity posting and
 * session creation to the underlying issue tracker service.
 *
 * @example
 * ```typescript
 * const issueTracker = new LinearIssueTrackerService(linearClient, {
 *   workspaceId: 'workspace-123',
 *   // ... other OAuth config
 * });
 *
 * const sink = new LinearActivitySink(issueTracker, 'workspace-123');
 *
 * // Create a session
 * const sessionId = await sink.createAgentSession('issue-id-456');
 *
 * // Post activities
 * await sink.postActivity(sessionId, {
 *   type: 'thought',
 *   body: 'Analyzing the issue...'
 * });
 * ```
 */
export class LinearActivitySink implements IActivitySink {
	/**
	 * Unique identifier for this sink (Linear workspace ID).
	 */
	public readonly id: string;

	private readonly issueTracker: IIssueTrackerService;

	/**
	 * Create a new LinearActivitySink.
	 *
	 * @param issueTracker - The IIssueTrackerService instance to delegate to
	 * @param workspaceId - The Linear workspace ID (used as sink ID)
	 */
	constructor(issueTracker: IIssueTrackerService, workspaceId: string) {
		this.issueTracker = issueTracker;
		this.id = workspaceId;
	}

	/**
	 * Post an activity to an existing agent session.
	 *
	 * Wraps IIssueTrackerService.createAgentActivity() to provide a simplified
	 * interface for activity posting.
	 *
	 * @param sessionId - The agent session ID to post to
	 * @param activity - The activity content (thought, action, response, error, etc.)
	 * @returns Promise that resolves when the activity is posted
	 *
	 * @example
	 * ```typescript
	 * // Post a thought activity
	 * await sink.postActivity(sessionId, {
	 *   type: 'thought',
	 *   body: 'Analyzing the codebase...'
	 * });
	 *
	 * // Post an action activity
	 * await sink.postActivity(sessionId, {
	 *   type: 'action',
	 *   action: 'read_file',
	 *   parameter: 'src/index.ts',
	 *   result: 'File contents...'
	 * });
	 * ```
	 */
	async postActivity(
		sessionId: string,
		activity: AgentActivityContent,
	): Promise<void> {
		await this.issueTracker.createAgentActivity({
			agentSessionId: sessionId,
			content: activity,
		});
	}

	/**
	 * Create a new agent session on an issue.
	 *
	 * Wraps IIssueTrackerService.createAgentSessionOnIssue() to provide a simplified
	 * interface for session creation.
	 *
	 * @param issueId - The issue ID to attach the session to
	 * @returns Promise that resolves with the created session ID
	 *
	 * @example
	 * ```typescript
	 * const sessionId = await sink.createAgentSession('issue-uuid-123');
	 * console.log(`Created session: ${sessionId}`);
	 * ```
	 */
	async createAgentSession(issueId: string): Promise<string> {
		const result = await this.issueTracker.createAgentSessionOnIssue({
			issueId,
		});

		// Extract session ID from the result
		// Result has `agentSession` property that may be a Promise
		const session = await result.agentSession;
		if (!session) {
			throw new Error(
				`Failed to create agent session for issue ${issueId}: session is undefined`,
			);
		}
		return session.id;
	}
}
