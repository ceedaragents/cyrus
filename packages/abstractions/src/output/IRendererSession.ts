import type {
	IRendererActivity,
	IRendererMessage,
	IRendererStatus,
	ISessionContext,
} from "./types.js";

/**
 * Session-specific rendering interface
 *
 * Represents a single session in a renderer (e.g., a Linear issue comment thread,
 * a CLI terminal session, a Slack thread, etc.)
 *
 * The session is responsible for:
 * 1. Displaying messages from the agent
 * 2. Tracking agent activity
 * 3. Updating session status
 * 4. (Optionally) Reading user input
 *
 * Example usage:
 * ```typescript
 * const session = await renderer.createSession({
 *   taskId: 'PROJ-123',
 *   title: 'Fix login bug',
 *   description: 'Users cannot log in'
 * });
 *
 * await session.writeMessage({
 *   type: 'assistant',
 *   content: 'I will investigate the login bug',
 *   timestamp: new Date()
 * });
 *
 * await session.writeActivity({
 *   type: 'tool-use',
 *   description: 'Reading authentication code',
 *   timestamp: new Date()
 * });
 *
 * await session.updateStatus({
 *   state: 'working',
 *   message: 'Analyzing code',
 *   progress: 25
 * });
 * ```
 */
export interface IRendererSession {
	/**
	 * Unique identifier for this session
	 */
	readonly id: string;

	/**
	 * Context that was used to create this session
	 */
	readonly context: ISessionContext;

	/**
	 * Write a message to the session
	 *
	 * This is the primary way to display agent output.
	 * Messages are typically displayed in chronological order.
	 *
	 * @param message The message to write
	 */
	writeMessage(message: IRendererMessage): Promise<void>;

	/**
	 * Write an activity to the session
	 *
	 * Activities track what the agent is doing (thinking, using tools, etc.)
	 * Some renderers may display these in a timeline or activity log.
	 *
	 * @param activity The activity to record
	 */
	writeActivity(activity: IRendererActivity): Promise<void>;

	/**
	 * Update the session status
	 *
	 * This updates the overall state of the session (idle, working, completed, etc.)
	 * Renderers may display this as a status indicator or progress bar.
	 *
	 * @param status The new status
	 */
	updateStatus(status: IRendererStatus): Promise<void>;

	/**
	 * Read a message from the user (optional, for interactive renderers)
	 *
	 * Returns null if no message is available or if the renderer doesn't support input.
	 * This is useful for interactive sessions where the agent can ask questions.
	 *
	 * @returns The user's message, or null if none available
	 */
	readMessage?(): Promise<IRendererMessage | null>;

	/**
	 * Register a handler for user input (optional, for interactive renderers)
	 *
	 * This allows the renderer to push user input to the agent as it arrives,
	 * rather than requiring polling via readMessage().
	 *
	 * @param handler Callback function for when user input is received
	 */
	onUserInput?(handler: (input: string) => void): void;

	/**
	 * Get session metadata
	 *
	 * Returns any session-specific metadata (e.g., Linear issue URL, CLI pid, etc.)
	 *
	 * @returns Session metadata
	 */
	getMetadata(): Record<string, unknown>;

	/**
	 * Update session metadata
	 *
	 * Allows adding or updating metadata during the session lifecycle
	 *
	 * @param metadata Metadata to merge with existing metadata
	 */
	updateMetadata(metadata: Record<string, unknown>): Promise<void>;

	/**
	 * Close/complete the session
	 *
	 * Performs any necessary cleanup (e.g., final status update, resource cleanup)
	 * After closing, the session should not be used for further operations.
	 */
	close?(): Promise<void>;
}

/**
 * Type guard to check if an object implements IRendererSession
 */
export function isRendererSession(obj: unknown): obj is IRendererSession {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"id" in obj &&
		"context" in obj &&
		"writeMessage" in obj &&
		"writeActivity" in obj &&
		"updateStatus" in obj &&
		"getMetadata" in obj &&
		"updateMetadata" in obj &&
		typeof (obj as any).writeMessage === "function" &&
		typeof (obj as any).writeActivity === "function" &&
		typeof (obj as any).updateStatus === "function"
	);
}
