import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Configuration for SimpleAgentRunner
 */
export interface SimpleAgentRunnerConfig<T extends string> {
	/** Valid response options that the agent must choose from */
	validResponses: readonly T[];

	/** System prompt to guide the agent's behavior */
	systemPrompt?: string;

	/** Maximum number of turns before timeout */
	maxTurns?: number;

	/** Timeout in milliseconds for the entire operation */
	timeoutMs?: number;

	/** Model to use (e.g., "sonnet", "haiku") */
	model?: string;

	/** Fallback model if primary is unavailable */
	fallbackModel?: string;

	/** Working directory for agent execution */
	workingDirectory?: string;

	/** Cyrus home directory */
	cyrusHome: string;

	/** Optional callback for progress events */
	onProgress?: (event: AgentProgressEvent) => void;
}

/**
 * Result returned from a successful agent execution
 */
export interface SimpleAgentResult<T extends string> {
	/** The validated response from the agent */
	response: T;

	/** All SDK messages from the session */
	messages: SDKMessage[];

	/** Session ID for debugging/logging */
	sessionId: string | null;

	/** Duration of execution in milliseconds */
	durationMs: number;

	/** Cost in USD (if available) */
	costUSD?: number;
}

/**
 * Progress events emitted during execution
 */
export type AgentProgressEvent =
	| { type: "started"; sessionId: string | null }
	| { type: "thinking"; text: string }
	| { type: "tool-use"; toolName: string; input: unknown }
	| { type: "response-detected"; candidateResponse: string }
	| { type: "validating"; response: string };

/**
 * Options for the query method
 */
export interface SimpleAgentQueryOptions {
	/** Additional context to provide to the agent */
	context?: string;

	/** Allow the agent to use file reading tools */
	allowFileReading?: boolean;

	/** Allowed directories for file operations */
	allowedDirectories?: string[];
}
