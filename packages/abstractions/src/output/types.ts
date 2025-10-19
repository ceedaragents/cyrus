/**
 * Context for creating a renderer session
 *
 * This provides the necessary information to initialize a session
 * in the target output system (Linear issue, CLI terminal, Slack thread, etc.)
 */
export interface ISessionContext {
	/**
	 * Unique identifier for the task being worked on
	 * (e.g., Linear issue ID, GitHub issue number)
	 */
	taskId: string;

	/**
	 * Human-readable title for the task
	 */
	title: string;

	/**
	 * Optional detailed description of the task
	 */
	description?: string;

	/**
	 * Optional parent session ID for sub-tasks
	 */
	parentSessionId?: string;

	/**
	 * Additional context-specific metadata
	 * Can include:
	 * - priority: task priority
	 * - labels: task labels/tags
	 * - assignee: who the task is assigned to
	 * - repository: code repository information
	 * - workspace: workspace/working directory
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Message to be rendered
 *
 * Represents a message from or to the agent that needs to be displayed
 */
export interface IRendererMessage {
	/**
	 * Type of message
	 */
	type: "user" | "assistant" | "system" | "error";

	/**
	 * Message content (may include markdown formatting)
	 */
	content: string;

	/**
	 * When the message was created
	 */
	timestamp: Date;

	/**
	 * Optional metadata
	 * Can include:
	 * - author: who sent the message
	 * - formatting: formatting hints
	 * - attachments: file attachments
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Activity tracking
 *
 * Similar to Linear's agent activity system - tracks what the agent is doing
 */
export interface IRendererActivity {
	/**
	 * Type of activity
	 * - thinking: Agent is analyzing/planning
	 * - tool-use: Agent is using a tool
	 * - result: Result of an operation
	 * - error: An error occurred
	 * - status: Status update
	 */
	type: "thinking" | "tool-use" | "result" | "error" | "status";

	/**
	 * Short description of the activity
	 */
	description: string;

	/**
	 * Optional detailed information
	 */
	details?: string;

	/**
	 * When the activity occurred
	 */
	timestamp: Date;

	/**
	 * Optional metadata
	 * Can include:
	 * - toolName: name of tool being used
	 * - duration: how long the activity took
	 * - exitCode: exit code if applicable
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Status update for a session
 *
 * Indicates the current state of the agent session
 */
export interface IRendererStatus {
	/**
	 * Current state
	 * - idle: Not doing anything
	 * - thinking: Planning/analyzing
	 * - working: Actively executing
	 * - waiting: Waiting for user input or external event
	 * - completed: Successfully finished
	 * - failed: Failed with errors
	 */
	state: "idle" | "thinking" | "working" | "waiting" | "completed" | "failed";

	/**
	 * Optional status message
	 */
	message?: string;

	/**
	 * Optional progress indicator (0-100)
	 */
	progress?: number;

	/**
	 * Optional metadata
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Capabilities that a renderer may support
 *
 * Different renderers have different capabilities. For example:
 * - CLI renderer: text-output, interactive-input, activity-tracking
 * - Linear renderer: text-output, rich-formatting, activity-tracking, threading
 * - Log file renderer: text-output only
 */
export type RendererCapability =
	| "text-output" // Can display text messages
	| "rich-formatting" // Supports markdown, colors, etc.
	| "interactive-input" // Can receive user input interactively
	| "activity-tracking" // Can display activity timeline
	| "file-attachments" // Can handle file attachments
	| "threading" // Supports nested/threaded conversations
	| "real-time-updates" // Supports live updates
	| "persistence"; // Persists session history

/**
 * Type guards
 */

export function isSessionContext(obj: unknown): obj is ISessionContext {
	return (
		typeof obj === "object" && obj !== null && "taskId" in obj && "title" in obj
	);
}

export function isRendererMessage(obj: unknown): obj is IRendererMessage {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"type" in obj &&
		"content" in obj &&
		"timestamp" in obj
	);
}

export function isRendererActivity(obj: unknown): obj is IRendererActivity {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"type" in obj &&
		"description" in obj &&
		"timestamp" in obj
	);
}

export function isRendererStatus(obj: unknown): obj is IRendererStatus {
	return typeof obj === "object" && obj !== null && "state" in obj;
}
