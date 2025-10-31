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
 * Agent Activity Types - Aliased from Linear SDK
 *
 * These types are imported from the Linear SDK to ensure compatibility with Linear's
 * Agent Activity API. All code should import these types from @cyrus/interfaces rather
 * than directly from @linear/sdk to maintain a centralized import point.
 *
 * Linear's AgentActivity supports 6 content types:
 * - action: Tool/action execution with action, parameter, and optional result
 * - elicitation: Request for user input (has body)
 * - error: Error message (has body)
 * - prompt: Prompt requesting user action (has body)
 * - response: Agent response (has body)
 * - thought: Agent thinking/reasoning (has body)
 *
 * Activities include metadata such as id, timestamps, ephemeral flag, and optional signal.
 *
 * @see https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 * @see https://studio.apollographql.com/public/Linear-API
 */
import type { LinearDocument } from "@linear/sdk";

/**
 * Main AgentActivity type from Linear SDK
 *
 * Includes:
 * - id: Unique identifier
 * - createdAt/updatedAt: Timestamps
 * - ephemeral: Whether activity disappears after next activity
 * - content: Discriminated union of activity content types
 * - signal: Optional control signal (auth, continue, select, stop)
 * - signalMetadata/sourceMetadata: Optional metadata
 */
export type AgentActivity = LinearDocument.AgentActivity;

/**
 * Union type of all possible agent activity content types
 */
export type AgentActivityContent = LinearDocument.AgentActivityContent;

/**
 * Activity type enum (action, elicitation, error, prompt, response, thought)
 */
export type AgentActivityType = LinearDocument.AgentActivityType;

/**
 * Activity signal enum (auth, continue, select, stop)
 */
export type AgentActivitySignal = LinearDocument.AgentActivitySignal;

/**
 * Individual content types
 */
export type AgentActivityActionContent =
	LinearDocument.AgentActivityActionContent;
export type AgentActivityElicitationContent =
	LinearDocument.AgentActivityElicitationContent;
export type AgentActivityErrorContent =
	LinearDocument.AgentActivityErrorContent;
export type AgentActivityPromptContent =
	LinearDocument.AgentActivityPromptContent;
export type AgentActivityResponseContent =
	LinearDocument.AgentActivityResponseContent;
export type AgentActivityThoughtContent =
	LinearDocument.AgentActivityThoughtContent;

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
