import type { AgentActivityContent } from "cyrus-core";

/**
 * Interface for activity sinks that receive and process agent session activities.
 *
 * IActivitySink decouples activity posting from IIssueTrackerService, enabling
 * multiple activity sinks (Linear workspaces, GitHub, etc.) to receive session
 * activities based on session context.
 *
 * Implementations should:
 * - Provide a unique identifier (workspace ID, org ID, etc.)
 * - Support posting activities to agent sessions
 * - Support creating new agent sessions on issues
 */
export interface IActivitySink {
	/**
	 * Unique identifier for this sink (e.g., Linear workspace ID, GitHub org ID).
	 * Used by GlobalSessionRegistry to route activities to the correct sink.
	 */
	readonly id: string;

	/**
	 * Post an activity to an existing agent session.
	 *
	 * @param sessionId - The agent session ID to post to
	 * @param activity - The activity content (thought, action, response, error, etc.)
	 * @returns Promise that resolves when the activity is posted
	 */
	postActivity(
		sessionId: string,
		activity: AgentActivityContent,
	): Promise<void>;

	/**
	 * Create a new agent session on an issue.
	 *
	 * @param issueId - The issue ID to attach the session to
	 * @returns Promise that resolves with the created session ID
	 */
	createAgentSession(issueId: string): Promise<string>;
}
