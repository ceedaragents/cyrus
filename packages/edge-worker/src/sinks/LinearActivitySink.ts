import {
	type AgentActivityContent,
	AgentActivitySignal,
	type IIssueTrackerService,
} from "cyrus-core";
import type {
	ActivityPostOptions,
	ActivityPostResult,
	ActivitySignal,
	IActivitySink,
} from "./IActivitySink.js";

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
 * const result = await sink.postActivity(sessionId, {
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
	 * Map a platform-agnostic ActivitySignal string to Linear's AgentActivitySignal enum.
	 */
	private mapSignal(signal: ActivitySignal): AgentActivitySignal {
		switch (signal) {
			case "auth":
				return AgentActivitySignal.Auth;
			case "select":
				return AgentActivitySignal.Select;
			case "stop":
				return AgentActivitySignal.Stop;
			case "continue":
				return AgentActivitySignal.Continue;
		}
	}

	/**
	 * Post an activity to an existing agent session.
	 *
	 * Wraps IIssueTrackerService.createAgentActivity() to provide a simplified
	 * interface for activity posting.
	 *
	 * @param sessionId - The agent session ID to post to
	 * @param activity - The activity content (thought, action, response, error, etc.)
	 * @param options - Optional settings for ephemeral, signal, signalMetadata
	 * @returns Promise that resolves with the activity post result
	 */
	async postActivity(
		sessionId: string,
		activity: AgentActivityContent,
		options?: ActivityPostOptions,
	): Promise<ActivityPostResult> {
		const result = await this.issueTracker.createAgentActivity({
			agentSessionId: sessionId,
			content: activity,
			...(options?.ephemeral !== undefined && { ephemeral: options.ephemeral }),
			...(options?.signal && { signal: this.mapSignal(options.signal) }),
			...(options?.signalMetadata && {
				signalMetadata: options.signalMetadata,
			}),
		});

		// `result.agentActivity` is an unmemoized getter: every access constructs
		// a fresh AgentActivityQuery and issues another round trip to read back
		// the activity we just created. Only the id was ever consumed, and
		// `result.agentActivityId` returns it from the mutation response the SDK
		// is already holding, at no request cost.
		const activityId = result.agentActivityId;

		if (result.success && activityId) {
			return { activityId };
		}

		return {};
	}

	/**
	 * Create a new agent session on an issue.
	 *
	 * Wraps IIssueTrackerService.createAgentSessionOnIssue() to provide a simplified
	 * interface for session creation.
	 *
	 * @param issueId - The issue ID to attach the session to
	 * @returns Promise that resolves with the created session ID
	 */
	async createAgentSession(issueId: string): Promise<string> {
		const result = await this.issueTracker.createAgentSessionOnIssue({
			issueId,
		});

		if (!result.success) {
			throw new Error(
				`Failed to create agent session for issue ${issueId}: request was not successful`,
			);
		}

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
