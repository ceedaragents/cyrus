/**
 * Generic input event structure
 *
 * Represents an event from any input source (webhooks, HTTP, CLI, etc.)
 * All input sources should transform their native events into this structure.
 */
export interface IInputEvent {
	/**
	 * Unique identifier for this event
	 */
	id: string;

	/**
	 * Event type (e.g., 'task-created', 'comment-added', 'status-changed')
	 * The specific types available depend on the input source
	 */
	type: string;

	/**
	 * When the event occurred
	 */
	timestamp: Date;

	/**
	 * Event payload data
	 * Structure varies by event type and source
	 */
	data: unknown;

	/**
	 * Source identifier (e.g., 'linear', 'github', 'cli')
	 */
	source: string;

	/**
	 * Optional metadata
	 * Can include:
	 * - priority: event priority
	 * - userId: user who triggered the event
	 * - correlationId: for tracking related events
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Status update for event processing
 *
 * Used to report back to the input source about event handling status
 */
export interface IStatusUpdate {
	/**
	 * ID of the event being processed
	 */
	eventId: string;

	/**
	 * Current processing status
	 */
	status: "processing" | "completed" | "failed";

	/**
	 * Error message if status is 'failed'
	 */
	error?: string;

	/**
	 * Optional metadata about processing
	 * Can include:
	 * - sessionId: ID of the agent session handling this event
	 * - startTime: when processing started
	 * - duration: how long processing took
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Type guard to check if an object is an IInputEvent
 */
export function isInputEvent(obj: unknown): obj is IInputEvent {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"id" in obj &&
		"type" in obj &&
		"timestamp" in obj &&
		"data" in obj &&
		"source" in obj
	);
}

/**
 * Type guard to check if an object is an IStatusUpdate
 */
export function isStatusUpdate(obj: unknown): obj is IStatusUpdate {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"eventId" in obj &&
		"status" in obj
	);
}
