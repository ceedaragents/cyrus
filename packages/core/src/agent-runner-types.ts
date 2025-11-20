import type {
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Agent Runner Interface
 *
 * This interface provides a provider-agnostic abstraction for AI agent runners.
 * It follows the same pattern as IIssueTrackerService, where type aliases point
 * to provider-specific SDK types (currently Claude SDK).
 *
 * The interface is designed to support multiple AI providers (Claude, Gemini, etc.)
 * through adapter implementations, while maintaining a consistent API surface.
 *
 * ## Architecture Pattern
 *
 * This abstraction uses type aliasing to external SDK types rather than creating
 * new types. This approach:
 * - Maintains compatibility with existing Claude SDK code
 * - Allows gradual migration to provider-agnostic code
 * - Enables adapter pattern implementations for other providers
 * - Preserves type safety and IDE autocomplete
 *
 * ## Usage Example
 *
 * ```typescript
 * class ClaudeRunnerAdapter implements IAgentRunner {
 *   async start(prompt: string): Promise<AgentSessionInfo> {
 *     // Implementation using Claude SDK
 *   }
 *
 *   async startStreaming(initialPrompt?: string): Promise<AgentSessionInfo> {
 *     // Implementation using Claude SDK streaming
 *   }
 *
 *   // ... other methods
 * }
 *
 * class GeminiRunnerAdapter implements IAgentRunner {
 *   async start(prompt: string): Promise<AgentSessionInfo> {
 *     // Implementation using Gemini SDK
 *   }
 *
 *   // ... other methods
 * }
 * ```
 *
 * @see {@link AgentRunnerConfig} for configuration options
 * @see {@link AgentSessionInfo} for session information structure
 */
export interface IAgentRunner {
	/**
	 * Start a new agent session with a string prompt (legacy/simple mode)
	 *
	 * This method initiates a complete agent session with a single prompt string.
	 * The session runs until completion or until stopped.
	 *
	 * @param prompt - The initial prompt to send to the agent
	 * @returns Session information including session ID and status
	 *
	 * @example
	 * ```typescript
	 * const runner = new ClaudeRunnerAdapter(config);
	 * const session = await runner.start("Please analyze this codebase");
	 * console.log(`Session started: ${session.sessionId}`);
	 * ```
	 */
	start(prompt: string): Promise<AgentSessionInfo>;

	/**
	 * Start a new agent session with streaming input support
	 *
	 * This method enables adding messages to the session dynamically after it has started.
	 * Use this for interactive sessions where prompts arrive over time (e.g., from webhooks).
	 *
	 * @param initialPrompt - Optional initial prompt to send immediately
	 * @returns Session information including session ID and status
	 *
	 * @example
	 * ```typescript
	 * const runner = new ClaudeRunnerAdapter(config);
	 * const session = await runner.startStreaming("Initial task");
	 *
	 * // Later, add more messages
	 * runner.addStreamMessage("Additional context");
	 * runner.addStreamMessage("Final instruction");
	 * runner.completeStream();
	 * ```
	 */
	startStreaming(initialPrompt?: string): Promise<AgentSessionInfo>;

	/**
	 * Add a message to the streaming prompt
	 *
	 * Only works when the session was started with `startStreaming()`.
	 * Messages are queued and sent to the agent as it processes them.
	 *
	 * @param content - The message content to add to the stream
	 * @throws Error if not in streaming mode or if stream is already completed
	 *
	 * @example
	 * ```typescript
	 * runner.addStreamMessage("New comment from user: Fix the bug in auth.ts");
	 * ```
	 */
	addStreamMessage(content: string): void;

	/**
	 * Complete the streaming prompt (no more messages will be added)
	 *
	 * This signals to the agent that no more messages will be added to the stream.
	 * The agent will complete processing and finish the session.
	 *
	 * @example
	 * ```typescript
	 * runner.addStreamMessage("Final message");
	 * runner.completeStream(); // Agent will finish processing
	 * ```
	 */
	completeStream(): void;

	/**
	 * Stop the current agent session
	 *
	 * Gracefully terminates the running session. Any in-progress operations
	 * will be aborted, and the session will transition to stopped state.
	 *
	 * @example
	 * ```typescript
	 * // User unassigned from issue - stop the agent
	 * if (runner.isRunning()) {
	 *   runner.stop();
	 * }
	 * ```
	 */
	stop(): void;

	/**
	 * Check if the session is currently running
	 *
	 * @returns True if the session is active and processing, false otherwise
	 *
	 * @example
	 * ```typescript
	 * if (runner.isRunning()) {
	 *   console.log("Session still active");
	 * } else {
	 *   console.log("Session completed or not started");
	 * }
	 * ```
	 */
	isRunning(): boolean;

	/**
	 * Get all messages from the current session
	 *
	 * Returns a copy of all messages exchanged in the session, including
	 * user prompts, assistant responses, system messages, and tool results.
	 *
	 * @returns Array of all session messages (copy, not reference)
	 *
	 * @example
	 * ```typescript
	 * const messages = runner.getMessages();
	 * console.log(`Session has ${messages.length} messages`);
	 *
	 * // Analyze assistant responses
	 * const assistantMessages = messages.filter(m => m.type === 'assistant');
	 * ```
	 */
	getMessages(): AgentMessage[];
}

/**
 * Configuration for agent runner
 *
 * This type aliases to the Claude SDK configuration structure. When implementing
 * adapters for other providers (e.g., Gemini), they should map their config to
 * this structure or extend it with provider-specific options.
 *
 * @example
 * ```typescript
 * const config: AgentRunnerConfig = {
 *   workingDirectory: '/path/to/repo',
 *   allowedDirectories: ['/path/to/repo'],
 *   mcpConfig: {
 *     'linear': { command: 'npx', args: ['-y', '@linear/mcp-server'] }
 *   },
 *   cyrusHome: '/home/user/.cyrus'
 * };
 * ```
 */
export interface AgentRunnerConfig {
	/** Working directory for the agent session */
	workingDirectory?: string;
	/** List of allowed tool patterns (e.g., ["Read(**)", "Edit(**)"]) */
	allowedTools?: string[];
	/** List of disallowed tool patterns */
	disallowedTools?: string[];
	/** Directories the agent can read from */
	allowedDirectories?: string[];
	/** Session ID to resume from a previous session */
	resumeSessionId?: string;
	/** Workspace name for logging and organization */
	workspaceName?: string;
	/** Custom system prompt (overrides default) */
	systemPrompt?: string;
	/** Additional text to append to default system prompt */
	appendSystemPrompt?: string;
	/** Path(s) to MCP configuration file(s) */
	mcpConfigPath?: string | string[];
	/** MCP server configurations (inline) */
	mcpConfig?: Record<string, McpServerConfig>;
	/** AI model to use (e.g., "opus", "sonnet", "haiku") */
	model?: string;
	/** Fallback model if primary is unavailable */
	fallbackModel?: string;
	/** Maximum number of turns before completing session */
	maxTurns?: number;
	/** Cyrus home directory (required) */
	cyrusHome: string;
	/** Prompt template version information */
	promptVersions?: {
		userPromptVersion?: string;
		systemPromptVersion?: string;
	};
	/** Event hooks for customizing agent behavior */
	hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
	/** Callback for each message received */
	onMessage?: (message: AgentMessage) => void | Promise<void>;
	/** Callback for errors */
	onError?: (error: Error) => void | Promise<void>;
	/** Callback when session completes */
	onComplete?: (messages: AgentMessage[]) => void | Promise<void>;
}

/**
 * Information about an agent session
 *
 * Tracks the lifecycle and status of an agent session.
 * The sessionId is initially null and gets assigned by the provider
 * when the first message is processed.
 *
 * @example
 * ```typescript
 * const info: AgentSessionInfo = {
 *   sessionId: 'claude-session-abc123',
 *   startedAt: new Date(),
 *   isRunning: true
 * };
 * ```
 */
export interface AgentSessionInfo {
	/** Unique session identifier (null until first message) */
	sessionId: string | null;
	/** When the session started */
	startedAt: Date;
	/** Whether the session is currently active */
	isRunning: boolean;
}

/**
 * Type alias for agent messages
 *
 * Maps to Claude SDK's SDKMessage type, which is a union of:
 * - SDKUserMessage (user inputs)
 * - SDKAssistantMessage (agent responses)
 * - SDKSystemMessage (system prompts)
 * - SDKResultMessage (completion/error results)
 *
 * Other provider adapters should map their message types to this structure.
 */
export type AgentMessage = SDKMessage;

/**
 * Type alias for user messages
 *
 * Maps to Claude SDK's SDKUserMessage type.
 * Used for prompts and user inputs to the agent.
 */
export type AgentUserMessage = SDKUserMessage;

/**
 * Re-export SDK types for convenience
 *
 * These re-exports allow consumers to import all necessary types
 * from a single location (packages/core) without knowing the
 * underlying provider SDK.
 */
export type {
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
