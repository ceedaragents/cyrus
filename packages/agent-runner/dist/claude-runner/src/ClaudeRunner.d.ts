import { EventEmitter } from "node:events";
import {
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-code";
export declare class AbortError extends Error {
	constructor(message?: string);
}
import type {
	ClaudeRunnerConfig,
	ClaudeRunnerEvents,
	ClaudeSessionInfo,
} from "./types.js";
/**
 * Streaming prompt controller that implements AsyncIterable<SDKUserMessage>
 */
export declare class StreamingPrompt {
	private messageQueue;
	private resolvers;
	private isComplete;
	private sessionId;
	constructor(sessionId: string | null, initialPrompt?: string);
	/**
	 * Update the session ID (used when session ID is received from Claude)
	 */
	updateSessionId(sessionId: string): void;
	/**
	 * Add a new message to the stream
	 */
	addMessage(content: string): void;
	/**
	 * Mark the stream as complete (no more messages will be added)
	 */
	complete(): void;
	/**
	 * Process pending resolvers with queued messages
	 */
	private processQueue;
	/**
	 * AsyncIterable implementation
	 */
	[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage>;
}
export declare interface ClaudeRunner {
	on<K extends keyof ClaudeRunnerEvents>(
		event: K,
		listener: ClaudeRunnerEvents[K],
	): this;
	emit<K extends keyof ClaudeRunnerEvents>(
		event: K,
		...args: Parameters<ClaudeRunnerEvents[K]>
	): boolean;
}
/**
 * Manages Claude SDK sessions and communication
 */
export declare class ClaudeRunner extends EventEmitter {
	private config;
	private abortController;
	private sessionInfo;
	private logStream;
	private readableLogStream;
	private messages;
	private streamingPrompt;
	private cyrusHome;
	constructor(config: ClaudeRunnerConfig);
	/**
	 * Start a new Claude session with string prompt (legacy mode)
	 */
	start(prompt: string): Promise<ClaudeSessionInfo>;
	/**
	 * Start a new Claude session with streaming input
	 */
	startStreaming(initialPrompt?: string): Promise<ClaudeSessionInfo>;
	/**
	 * Add a message to the streaming prompt (only works when in streaming mode)
	 */
	addStreamMessage(content: string): void;
	/**
	 * Complete the streaming prompt (no more messages will be added)
	 */
	completeStream(): void;
	/**
	 * Internal method to start a Claude session with either string or streaming prompt
	 */
	private startWithPrompt;
	/**
	 * Update prompt versions (can be called after constructor)
	 */
	updatePromptVersions(versions: {
		userPromptVersion?: string;
		systemPromptVersion?: string;
	}): void;
	/**
	 * Stop the current Claude session
	 */
	stop(): void;
	/**
	 * Check if session is running
	 */
	isRunning(): boolean;
	/**
	 * Check if session is in streaming mode and still running
	 */
	isStreaming(): boolean;
	/**
	 * Get current session info
	 */
	getSessionInfo(): ClaudeSessionInfo | null;
	/**
	 * Get all messages from current session
	 */
	getMessages(): SDKMessage[];
	/**
	 * Process individual SDK messages and emit appropriate events
	 */
	private processMessage;
	/**
	 * Set up logging to .cyrus directory
	 */
	private setupLogging;
	/**
	 * Write a human-readable log entry for a message
	 */
	private writeReadableLogEntry;
}
//# sourceMappingURL=ClaudeRunner.d.ts.map
