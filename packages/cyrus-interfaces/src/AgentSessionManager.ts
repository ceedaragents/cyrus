import type { AgentActivity, AgentSession, ChatMessage } from "./types.js";

/**
 * Options for creating an agent session.
 */
export interface CreateSessionOptions {
	/** Associated issue ID */
	issueId: string;
	/** Repository path */
	repositoryPath?: string;
	/** Git branch */
	branch?: string;
	/** Initial context or prompt */
	initialContext?: string;
	/** Session metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Session event types.
 */
export enum SessionEventType {
	/** Session was created */
	Created = "created",
	/** Session status changed */
	StatusChanged = "status_changed",
	/** New activity added */
	ActivityAdded = "activity_added",
	/** Message received */
	MessageReceived = "message_received",
	/** Session completed */
	Completed = "completed",
	/** Session failed */
	Failed = "failed",
	/** Session canceled */
	Canceled = "canceled",
}

/**
 * Session event data.
 */
export interface SessionEvent {
	/** Event type */
	type: SessionEventType;
	/** Session ID */
	sessionId: string;
	/** Event timestamp */
	timestamp: Date;
	/** Event-specific data */
	data?: unknown;
}

/**
 * Abstract interface for managing agent sessions.
 *
 * This interface handles the lifecycle of agent sessions, including creation,
 * tracking activities, processing messages, and managing session state. It serves
 * as the bridge between the chat executor (e.g., Claude) and the issue tracking system.
 *
 * @example
 * ```typescript
 * const manager: AgentSessionManager = new LinearAgentSessionManager(client);
 *
 * // Create a new session
 * const session = await manager.createSession({
 *   issueId: 'ISSUE-123',
 *   repositoryPath: '/path/to/repo',
 *   branch: 'feature-branch'
 * });
 *
 * // Process incoming messages
 * await manager.processMessage(session.id, {
 *   role: 'user',
 *   content: 'Please implement this feature'
 * });
 *
 * // Listen for events
 * manager.on(SessionEventType.ActivityAdded, (event) => {
 *   console.log('New activity:', event.data);
 * });
 * ```
 */
export interface AgentSessionManager {
	/**
	 * Creates a new agent session.
	 *
	 * @param options - Session creation options
	 * @returns The created session
	 */
	createSession(options: CreateSessionOptions): Promise<AgentSession>;

	/**
	 * Retrieves an existing session by ID.
	 *
	 * @param sessionId - The session ID
	 * @returns The session object
	 * @throws Error if session not found
	 */
	getSession(sessionId: string): Promise<AgentSession>;

	/**
	 * Lists all active sessions.
	 *
	 * @returns Array of active sessions
	 */
	listActiveSessions(): Promise<AgentSession[]>;

	/**
	 * Processes an incoming message for a session.
	 *
	 * This method handles transforming chat messages into activities and
	 * updating the session state accordingly.
	 *
	 * @param sessionId - The session ID
	 * @param message - The chat message to process
	 */
	processMessage(sessionId: string, message: ChatMessage): Promise<void>;

	/**
	 * Adds an activity to a session.
	 *
	 * @param sessionId - The session ID
	 * @param activity - The activity to add
	 * @returns The created activity
	 */
	addActivity(
		sessionId: string,
		activity: Omit<AgentActivity, "id" | "timestamp">,
	): Promise<AgentActivity>;

	/**
	 * Retrieves all activities for a session.
	 *
	 * @param sessionId - The session ID
	 * @returns Array of activities in chronological order
	 */
	getActivities(sessionId: string): Promise<AgentActivity[]>;

	/**
	 * Completes a session successfully.
	 *
	 * @param sessionId - The session ID
	 * @param summary - Optional completion summary
	 */
	completeSession(sessionId: string, summary?: string): Promise<void>;

	/**
	 * Fails a session with an error.
	 *
	 * @param sessionId - The session ID
	 * @param error - Error message or object
	 */
	failSession(sessionId: string, error: string | Error): Promise<void>;

	/**
	 * Cancels a session.
	 *
	 * @param sessionId - The session ID
	 * @param reason - Optional cancellation reason
	 */
	cancelSession(sessionId: string, reason?: string): Promise<void>;

	/**
	 * Pauses a session.
	 *
	 * This is useful for handling approval workflows or waiting for user input.
	 *
	 * @param sessionId - The session ID
	 * @param reason - Optional pause reason
	 */
	pauseSession(sessionId: string, reason?: string): Promise<void>;

	/**
	 * Resumes a paused session.
	 *
	 * @param sessionId - The session ID
	 * @param context - Optional resume context
	 */
	resumeSession(sessionId: string, context?: string): Promise<void>;

	/**
	 * Registers an event listener.
	 *
	 * @param eventType - The event type to listen for
	 * @param listener - The callback function
	 */
	on(
		eventType: SessionEventType,
		listener: (event: SessionEvent) => void,
	): void;

	/**
	 * Removes an event listener.
	 *
	 * @param eventType - The event type
	 * @param listener - The callback function to remove
	 */
	off(
		eventType: SessionEventType,
		listener: (event: SessionEvent) => void,
	): void;

	/**
	 * Retrieves session metadata.
	 *
	 * @param sessionId - The session ID
	 * @returns Session metadata
	 */
	getMetadata(sessionId: string): Promise<Record<string, unknown>>;

	/**
	 * Updates session metadata.
	 *
	 * @param sessionId - The session ID
	 * @param metadata - Metadata to merge with existing metadata
	 */
	updateMetadata(
		sessionId: string,
		metadata: Record<string, unknown>,
	): Promise<void>;

	/**
	 * Cleans up completed or failed sessions older than the specified duration.
	 *
	 * @param olderThan - Duration in milliseconds
	 * @returns Number of sessions cleaned up
	 */
	cleanup(olderThan: number): Promise<number>;
}
