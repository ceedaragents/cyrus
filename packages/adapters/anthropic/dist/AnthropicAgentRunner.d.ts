/**
 * AnthropicAgentRunner - Adapter that wraps ClaudeRunner behind the IAgentRunner interface.
 *
 * This adapter allows the Cyrus core to interact with Anthropic's Claude through
 * a generic interface, enabling future AI tool swapping while keeping core logic unchanged.
 */
import type {
	AgentMessage,
	AgentPrompt,
	AgentResult,
	AgentRunnerConfig,
	AgentSession,
	IAgentRunner,
} from "cyrus-interfaces";
/**
 * Adapter that wraps ClaudeRunner to implement IAgentRunner interface
 */
export declare class AnthropicAgentRunner implements IAgentRunner {
	readonly config: AgentRunnerConfig;
	private claudeRunner;
	private messageHandlers;
	private completeHandlers;
	private errorHandlers;
	private initialized;
	private boundMessageHandler?;
	private boundErrorHandler?;
	private boundCompleteHandler?;
	constructor(config: AgentRunnerConfig);
	/**
	 * Setup event handlers to bridge ClaudeRunner events to IAgentRunner handlers
	 */
	private setupEventHandlers;
	/**
	 * Emit message to all registered handlers (supports async)
	 */
	private emitMessage;
	/**
	 * Emit complete event to all registered handlers (supports async)
	 */
	private emitComplete;
	/**
	 * Emit error to all registered handlers (supports async)
	 */
	private emitError;
	/**
	 * Initialize the agent runner
	 */
	initialize(): Promise<void>;
	/**
	 * Clean up resources
	 */
	cleanup(): Promise<void>;
	/**
	 * Execute an agent session with the given prompt
	 */
	execute(prompt: AgentPrompt): Promise<AgentSession>;
	/**
	 * Start a streaming session with AsyncIterable input
	 */
	private startStreamingSession;
	/**
	 * Create an AgentSession wrapper around the ClaudeRunner session
	 */
	private createSession;
	/**
	 * Register a handler for agent messages
	 */
	onMessage(handler: (message: AgentMessage) => void | Promise<void>): void;
	/**
	 * Register a handler for session completion
	 */
	onComplete(handler: (result: AgentResult) => void | Promise<void>): void;
	/**
	 * Register a handler for errors
	 */
	onError(handler: (error: Error) => void | Promise<void>): void;
	/**
	 * Check if a session is currently running
	 */
	isRunning(): boolean;
	/**
	 * Get current session information
	 */
	getSessionInfo(): import("cyrus-claude-runner").ClaudeSessionInfo | null;
}
//# sourceMappingURL=AnthropicAgentRunner.d.ts.map
