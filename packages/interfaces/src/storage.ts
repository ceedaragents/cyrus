/**
 * Session Storage Interface
 *
 * Abstract interface for persisting and retrieving session state
 * This interface decouples the core orchestration logic from specific storage mechanisms
 * (file system, database, in-memory, etc.)
 */

/**
 * Represents the complete state of an agent session
 */
export interface SessionState {
	/**
	 * Unique identifier for this session
	 */
	id: string;

	/**
	 * ID of the issue this session is processing
	 */
	issueId: string;

	/**
	 * ID of the agent session (from AgentRunner)
	 */
	agentSessionId: string;

	/**
	 * When the session started
	 */
	startedAt: Date;

	/**
	 * When the session ended (if completed)
	 */
	endedAt?: Date;

	/**
	 * Current status of the session
	 */
	status: SessionStatus;

	/**
	 * Messages exchanged during the session
	 */
	messages: Message[];

	/**
	 * Additional metadata about the session
	 */
	metadata: Record<string, unknown>;

	/**
	 * Working directory for the session
	 */
	workingDirectory?: string;

	/**
	 * Files modified during this session
	 */
	filesModified?: string[];

	/**
	 * Total number of turns/interactions
	 */
	turns?: number;
}

/**
 * Status of a session
 */
export type SessionStatus =
	| "running"
	| "completed"
	| "failed"
	| "stopped"
	| "paused";

/**
 * Represents a message in the session
 */
export interface Message {
	/**
	 * Message ID
	 */
	id: string;

	/**
	 * Role of the message sender
	 */
	role: MessageRole;

	/**
	 * Message content
	 */
	content: string;

	/**
	 * When the message was sent
	 */
	timestamp: Date;

	/**
	 * Optional attachments
	 */
	attachments?: MessageAttachment[];

	/**
	 * Optional metadata
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Role of a message sender
 */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/**
 * Represents an attachment in a message
 */
export interface MessageAttachment {
	/**
	 * Attachment name
	 */
	name: string;

	/**
	 * Path or URL to the attachment
	 */
	path: string;

	/**
	 * MIME type
	 */
	mimeType?: string;

	/**
	 * Size in bytes
	 */
	size?: number;
}

/**
 * Filters for querying sessions
 */
export interface SessionFilters {
	/**
	 * Filter by issue ID
	 */
	issueId?: string;

	/**
	 * Filter by status
	 */
	status?: SessionStatus | SessionStatus[];

	/**
	 * Filter by creation date range
	 */
	startedAfter?: Date;
	startedBefore?: Date;

	/**
	 * Filter by end date range
	 */
	endedAfter?: Date;
	endedBefore?: Date;

	/**
	 * Maximum number of results
	 */
	limit?: number;

	/**
	 * Offset for pagination
	 */
	offset?: number;

	/**
	 * Sort order
	 */
	sortBy?: "startedAt" | "endedAt";
	sortOrder?: "asc" | "desc";
}

/**
 * Abstract interface for persisting session state
 *
 * Implementations of this interface handle the details of storing and retrieving
 * session data through specific mechanisms (file system, database, in-memory cache, etc.)
 */
export interface SessionStorage {
	/**
	 * Save or update a session state
	 *
	 * @param session - Session state to save
	 * @returns Promise that resolves when save is complete
	 * @throws Error if save fails
	 */
	saveSession(session: SessionState): Promise<void>;

	/**
	 * Load a session state by ID
	 *
	 * @param sessionId - ID of the session to load
	 * @returns Promise that resolves to the session state, or null if not found
	 */
	loadSession(sessionId: string): Promise<SessionState | null>;

	/**
	 * List all sessions for a specific issue
	 *
	 * @param issueId - ID of the issue
	 * @returns Promise that resolves to array of session states
	 */
	listSessions(issueId: string): Promise<SessionState[]>;

	/**
	 * Query sessions with filters
	 *
	 * @param filters - Filters to apply
	 * @returns Promise that resolves to array of session states
	 */
	querySessions(filters: SessionFilters): Promise<SessionState[]>;

	/**
	 * Delete a session by ID
	 *
	 * @param sessionId - ID of the session to delete
	 * @returns Promise that resolves when deletion is complete
	 * @throws Error if session is not found or deletion fails
	 */
	deleteSession(sessionId: string): Promise<void>;

	/**
	 * Check if a session exists
	 *
	 * @param sessionId - ID of the session to check
	 * @returns Promise that resolves to true if session exists, false otherwise
	 */
	sessionExists(sessionId: string): Promise<boolean>;

	/**
	 * Add a message to an existing session
	 *
	 * @param sessionId - ID of the session
	 * @param message - Message to add
	 * @returns Promise that resolves when message is added
	 * @throws Error if session is not found or message cannot be added
	 */
	addMessage(sessionId: string, message: Message): Promise<void>;

	/**
	 * Update session status
	 *
	 * @param sessionId - ID of the session
	 * @param status - New status
	 * @returns Promise that resolves when status is updated
	 * @throws Error if session is not found or status cannot be updated
	 */
	updateStatus(sessionId: string, status: SessionStatus): Promise<void>;
}
