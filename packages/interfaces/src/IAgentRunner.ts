/**
 * Abstract interface for any AI/agent tool (Claude, GPT, Cursor, etc.).
 * This interface allows Cyrus to work with different AI agents without
 * being tightly coupled to a specific implementation.
 */
export interface IAgentRunner {
	/** Configuration for this agent runner instance */
	readonly config: AgentRunnerConfig;

	/**
	 * Initialize the agent runner, setting up any necessary resources
	 * or connections.
	 */
	initialize(): Promise<void>;

	/**
	 * Clean up resources and shut down the agent runner.
	 */
	cleanup(): Promise<void>;

	/**
	 * Execute an agent session with the given prompt.
	 *
	 * @param prompt - The prompt to execute
	 * @returns An agent session that can be monitored and controlled
	 */
	execute(prompt: AgentPrompt): Promise<AgentSession>;

	/**
	 * Register a handler to be called when the agent emits a message.
	 *
	 * @param handler - Function to handle agent messages (supports async)
	 */
	onMessage(handler: (message: AgentMessage) => void | Promise<void>): void;

	/**
	 * Register a handler to be called when the agent completes execution.
	 *
	 * @param handler - Function to handle completion (supports async)
	 */
	onComplete(handler: (result: AgentResult) => void | Promise<void>): void;

	/**
	 * Register a handler to be called when an error occurs.
	 *
	 * @param handler - Function to handle errors (supports async)
	 */
	onError(handler: (error: Error) => void | Promise<void>): void;
}

/**
 * Represents a prompt to be executed by an agent.
 */
export interface AgentPrompt {
	/**
	 * The prompt content. Can be a string or an async iterable of messages
	 * for continuing an existing conversation.
	 */
	content: string | AsyncIterable<AgentMessage>;

	/** Additional context for the agent execution */
	context?: {
		/** Working directory for the agent to operate in */
		workingDirectory?: string;

		/** Environment variables to set */
		environment?: Record<string, string>;

		/** Tools/functions available to the agent */
		tools?: ToolConfig[];

		/** System prompt to guide the agent's behavior */
		systemPrompt?: string;

		/** Additional context fields */
		[key: string]: unknown;
	};
}

/**
 * Represents a message in an agent conversation.
 */
export interface AgentMessage {
	/** The role of the message sender */
	role: "system" | "user" | "assistant" | "tool_result";

	/** The content of the message */
	content: AgentMessageContent;

	/** When this message was created */
	timestamp: Date;

	/** Additional metadata about the message */
	metadata?: Record<string, unknown>;
}

/**
 * Union type representing different kinds of message content.
 */
export type AgentMessageContent =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; tool_use_id: string; content: unknown };

/**
 * Represents an active agent session.
 */
export interface AgentSession {
	/** Unique identifier for this session */
	id: string;

	/** Stream of messages from the agent */
	messages: AsyncIterable<AgentMessage>;

	/** Promise that resolves when the session completes */
	result: Promise<AgentResult>;

	/**
	 * Cancel the session before it completes.
	 */
	cancel(): Promise<void>;

	/**
	 * Add a message to a running session (for interactive/streaming mode).
	 *
	 * @param content - The message content to add
	 */
	addMessage(content: string): void;
}

/**
 * Represents the result of a completed agent session.
 */
export interface AgentResult {
	/** ID of the session that produced this result */
	sessionId: string;

	/** Status of the session completion */
	status: "success" | "error" | "cancelled";

	/** All messages from the session */
	messages: AgentMessage[];

	/** Error, if the session failed */
	error?: Error;

	/** Metadata about the session execution */
	metadata: {
		/** Duration of the session in milliseconds */
		duration?: number;

		/** Number of tokens used (if applicable) */
		tokensUsed?: number;

		/** Additional metadata fields */
		[key: string]: unknown;
	};
}

/**
 * Configuration for an agent runner.
 */
export interface AgentRunnerConfig {
	/** Working directory for agent execution */
	workingDirectory: string;

	/** Environment variables to set */
	environment?: Record<string, string>;

	/** Available tools/functions */
	tools?: ToolConfig[];

	/** System prompt to guide agent behavior */
	systemPrompt?: string;

	/** Model identifier to use */
	modelId?: string;

	/** Additional configuration fields */
	[key: string]: unknown;
}

/**
 * Configuration for a tool/function available to the agent.
 */
export interface ToolConfig {
	/** Name of the tool */
	name: string;

	/** Description of what the tool does */
	description: string;

	/** JSON schema for the tool's input parameters */
	inputSchema?: Record<string, unknown>;

	/** Additional tool configuration */
	[key: string]: unknown;
}
