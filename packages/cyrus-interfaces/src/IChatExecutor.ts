import type { ChatMessage } from "./types.js";

/**
 * Session information for a Claude Code execution
 */
export interface ChatSessionInfo {
	sessionId: string | null;
	startedAt: Date;
	isRunning: boolean;
	model?: string;
	tools?: string[];
}

/**
 * Configuration for chat execution
 */
export interface ChatExecutorConfig {
	workingDirectory?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	allowedDirectories?: string[];
	resumeSessionId?: string;
	model?: string;
	fallbackModel?: string;
	maxTurns?: number;
	cyrusHome: string;
}

/**
 * Main interface for Claude Code execution
 *
 * This interface provides methods for managing Claude Code sessions,
 * including starting, stopping, and monitoring execution.
 */
export interface IChatExecutor {
	/**
	 * Session lifecycle management
	 */

	/**
	 * Start a new Claude session with a string prompt
	 * @param prompt - The initial prompt to send to Claude
	 * @returns Session information including session ID
	 */
	startSession(prompt: string): Promise<ChatSessionInfo>;

	/**
	 * Start a new Claude session with streaming input
	 * @param initialPrompt - Optional initial prompt
	 * @returns Session information including session ID
	 */
	startStreamingSession(initialPrompt?: string): Promise<ChatSessionInfo>;

	/**
	 * Streaming control methods
	 */

	/**
	 * Add a message to the streaming session
	 * @param content - The message content to add
	 */
	addStreamMessage(content: string): void;

	/**
	 * Complete the streaming session (no more messages will be added)
	 */
	completeStream(): void;

	/**
	 * Stop the current session
	 */
	stopSession(): void;

	/**
	 * State query methods
	 */

	/**
	 * Check if a session is currently running
	 * @returns True if a session is active
	 */
	isRunning(): boolean;

	/**
	 * Check if the session is in streaming mode
	 * @returns True if streaming is active
	 */
	isStreaming(): boolean;

	/**
	 * Get current session information
	 * @returns Session info or null if no session is active
	 */
	getSessionInfo(): ChatSessionInfo | null;

	/**
	 * Get all messages from the current session
	 * @returns Array of chat messages
	 */
	getMessages(): ChatMessage[];

	/**
	 * Event handling
	 */

	/**
	 * Register event listener
	 * @param event - Event type to listen for
	 * @param handler - Callback function to handle the event
	 */
	on(
		event: "message" | "error" | "complete",
		handler: (data: any) => void | Promise<void>,
	): void;

	/**
	 * Deregister event listener
	 * @param event - Event type to stop listening for
	 * @param handler - The callback function to remove
	 */
	off(
		event: "message" | "error" | "complete",
		handler: (data: any) => void | Promise<void>,
	): void;
}
