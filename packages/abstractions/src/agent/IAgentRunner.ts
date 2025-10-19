import type { IAgentMessage } from "./IAgentMessage.js";
import type { IAgentSession } from "./IAgentSession.js";

/**
 * Events emitted by an agent runner
 */
export type AgentRunnerEvent =
	| "message" // Any message from the agent
	| "text" // Text output from the agent
	| "assistant" // Assistant response
	| "tool-use" // Agent is using a tool
	| "error" // An error occurred
	| "complete"; // Session completed

/**
 * Event handler types for type safety
 */
export interface IAgentRunnerEvents {
	message: (message: IAgentMessage) => void;
	text: (text: string) => void;
	assistant: (text: string) => void;
	"tool-use": (toolName: string, input: unknown) => void;
	error: (error: Error) => void;
	complete: (messages: IAgentMessage[]) => void;
}

/**
 * Abstract interface for any CLI-based agent tool
 *
 * This interface abstracts CLI tools like Claude Code, GPT Engineer, Devin, etc.
 * It provides a unified way to interact with different agent implementations.
 *
 * Key design principles:
 * 1. Platform-agnostic: Works with any agent tool
 * 2. Event-driven: Uses events for async communication
 * 3. Streaming-capable: Supports both single-shot and streaming inputs
 * 4. Testable: Easy to mock and test
 *
 * Example usage:
 * ```typescript
 * const runner = factory.create({ type: 'claude', model: 'sonnet' });
 * runner.on('assistant', (text) => console.log(text));
 * runner.on('complete', (messages) => console.log('Done!'));
 * await runner.start('Please help me fix this bug');
 * ```
 */
export interface IAgentRunner {
	/**
	 * Start a new agent session
	 *
	 * @param prompt Either a string prompt or an async iterable for streaming inputs
	 * @returns Promise resolving to session information
	 *
	 * For single-shot mode:
	 * ```typescript
	 * await runner.start('Please help me with this task');
	 * ```
	 *
	 * For streaming mode:
	 * ```typescript
	 * const stream = createMessageStream();
	 * await runner.start(stream);
	 * // Later...
	 * stream.addMessage('Additional context');
	 * stream.complete();
	 * ```
	 */
	start(prompt: string | AsyncIterable<IAgentMessage>): Promise<IAgentSession>;

	/**
	 * Stop the current session
	 *
	 * This should gracefully stop the agent, allowing it to clean up resources.
	 * After calling stop(), isRunning() should return false.
	 */
	stop(): void;

	/**
	 * Check if a session is currently running
	 *
	 * @returns true if a session is active, false otherwise
	 */
	isRunning(): boolean;

	/**
	 * Add a message to a streaming session
	 *
	 * Only works when the session was started with streaming mode.
	 * Throws an error if called in single-shot mode.
	 *
	 * @param content Message content to add
	 * @throws Error if not in streaming mode
	 */
	addMessage(content: string): void;

	/**
	 * Complete the streaming input
	 *
	 * Signals that no more messages will be added to the stream.
	 * The agent will continue processing until it reaches a natural completion.
	 */
	completeStream(): void;

	/**
	 * Check if currently in streaming mode
	 *
	 * @returns true if in streaming mode and stream is not yet completed
	 */
	isStreaming(): boolean;

	/**
	 * Get current session information
	 *
	 * @returns Current session info, or null if no session has been started
	 */
	getSessionInfo(): IAgentSession | null;

	/**
	 * Get all messages from the current session
	 *
	 * @returns Array of messages (empty if no session)
	 */
	getMessages(): IAgentMessage[];

	/**
	 * Register an event handler
	 *
	 * @param event Event name to listen for
	 * @param handler Callback function for the event
	 *
	 * Example:
	 * ```typescript
	 * runner.on('assistant', (text) => {
	 *   console.log('Agent says:', text);
	 * });
	 * ```
	 */
	on<K extends keyof IAgentRunnerEvents>(
		event: K,
		handler: IAgentRunnerEvents[K],
	): void;

	/**
	 * Unregister an event handler
	 *
	 * @param event Event name to stop listening for
	 * @param handler Callback function to remove
	 */
	off<K extends keyof IAgentRunnerEvents>(
		event: K,
		handler: IAgentRunnerEvents[K],
	): void;
}

/**
 * Type guard to check if an object implements IAgentRunner
 */
export function isAgentRunner(obj: unknown): obj is IAgentRunner {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"start" in obj &&
		"stop" in obj &&
		"isRunning" in obj &&
		"getSessionInfo" in obj &&
		"getMessages" in obj &&
		"on" in obj &&
		"off" in obj &&
		typeof (obj as any).start === "function" &&
		typeof (obj as any).stop === "function" &&
		typeof (obj as any).isRunning === "function"
	);
}
