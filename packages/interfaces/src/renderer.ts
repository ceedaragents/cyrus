/**
 * Renderer Interface
 *
 * Abstract interface for rendering agent activity to users
 * This interface decouples the core orchestration logic from specific output mechanisms
 * (Linear comments, CLI terminal, HTTP responses, etc.)
 */

import type { AgentSignal, Attachment } from "./issue-tracker.js";

/**
 * Represents a session that can be rendered to the user
 */
export interface RenderableSession {
	/**
	 * Unique identifier for the session
	 */
	id: string;

	/**
	 * ID of the issue this session is processing
	 */
	issueId: string;

	/**
	 * Title of the issue
	 */
	issueTitle: string;

	/**
	 * When the session started
	 */
	startedAt: Date;

	/**
	 * Optional additional metadata
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Summary information when a session completes
 */
export interface SessionSummary {
	/**
	 * Total number of turns/interactions
	 */
	turns: number;

	/**
	 * Total number of tools used
	 */
	toolsUsed: number;

	/**
	 * List of files that were modified
	 */
	filesModified: string[];

	/**
	 * Agent's final summary text
	 */
	summary?: string;

	/**
	 * Exit code (0 = success, non-zero = error)
	 */
	exitCode: number;

	/**
	 * Additional metrics or metadata
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Types of agent activity that can be rendered
 * Uses discriminated union for type safety
 */
export type AgentActivity =
	| ThinkingActivity
	| FileModifiedActivity
	| VerificationActivity
	| StatusActivity;

/**
 * Agent is thinking/processing
 */
export interface ThinkingActivity {
	type: "thinking";
	/**
	 * What the agent is thinking about
	 */
	message: string;
}

/**
 * Agent modified a file
 */
export interface FileModifiedActivity {
	type: "file-modified";
	/**
	 * Path to the modified file
	 */
	path: string;
	/**
	 * Number of lines changed
	 */
	changes: number;
	/**
	 * Type of change (added, modified, deleted)
	 */
	changeType?: "added" | "modified" | "deleted";
}

/**
 * Agent is verifying something (tests, builds, etc.)
 */
export interface VerificationActivity {
	type: "verification";
	/**
	 * Current status of verification
	 */
	status: "running" | "passed" | "failed";
	/**
	 * Details about what is being verified
	 */
	details: string;
	/**
	 * Optional output from verification
	 */
	output?: string;
}

/**
 * General status update
 */
export interface StatusActivity {
	type: "status";
	/**
	 * Status message
	 */
	message: string;
	/**
	 * Optional severity level
	 */
	level?: "info" | "warning" | "error";
}

/**
 * User input types
 * Uses discriminated union for type safety
 */
export type UserInput = MessageInput | SignalInput;

/**
 * User sent a text message
 */
export interface MessageInput {
	type: "message";
	/**
	 * Message content
	 */
	content: string;
	/**
	 * Optional attachments
	 */
	attachments?: Attachment[];
	/**
	 * When the message was sent
	 */
	timestamp?: Date;
}

/**
 * User sent a control signal
 */
export interface SignalInput {
	type: "signal";
	/**
	 * The signal that was sent
	 */
	signal: AgentSignal;
}

/**
 * Abstract interface for rendering agent activity
 *
 * Implementations of this interface handle the details of displaying agent
 * progress and collecting user input through specific channels (Linear comments,
 * terminal UI, web interface, etc.)
 */
export interface Renderer {
	/**
	 * Render the start of an agent session
	 *
	 * @param session - Session information to display
	 * @returns Promise that resolves when rendering is complete
	 */
	renderSessionStart(session: RenderableSession): Promise<void>;

	/**
	 * Render agent activity/progress update
	 *
	 * @param sessionId - ID of the session
	 * @param activity - Activity to render
	 * @returns Promise that resolves when rendering is complete
	 */
	renderActivity(sessionId: string, activity: AgentActivity): Promise<void>;

	/**
	 * Render text response from the agent
	 *
	 * @param sessionId - ID of the session
	 * @param text - Text to display
	 * @returns Promise that resolves when rendering is complete
	 */
	renderText(sessionId: string, text: string): Promise<void>;

	/**
	 * Render tool usage by the agent
	 *
	 * @param sessionId - ID of the session
	 * @param tool - Name of the tool being used
	 * @param input - Input parameters for the tool
	 * @returns Promise that resolves when rendering is complete
	 */
	renderToolUse(sessionId: string, tool: string, input: unknown): Promise<void>;

	/**
	 * Render session completion
	 *
	 * @param sessionId - ID of the session
	 * @param summary - Summary of the completed session
	 * @returns Promise that resolves when rendering is complete
	 */
	renderComplete(sessionId: string, summary: SessionSummary): Promise<void>;

	/**
	 * Render an error
	 *
	 * @param sessionId - ID of the session
	 * @param error - Error that occurred
	 * @returns Promise that resolves when rendering is complete
	 */
	renderError(sessionId: string, error: Error): Promise<void>;

	/**
	 * Get user input stream for interactive renderers
	 *
	 * For non-interactive renderers (e.g., one-way Linear comments),
	 * this may return an empty async iterable
	 *
	 * @param sessionId - ID of the session
	 * @returns Async iterable of user inputs
	 */
	getUserInput(sessionId: string): AsyncIterable<UserInput>;
}
