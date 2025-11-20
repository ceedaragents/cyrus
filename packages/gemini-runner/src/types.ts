import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	SDKMessage,
	SDKUserMessage,
} from "cyrus-core";

/**
 * Gemini CLI streaming event types based on --output-format stream-json
 * Reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
 */
export type GeminiStreamEvent =
	| GeminiInitEvent
	| GeminiMessageEvent
	| GeminiToolUseEvent
	| GeminiToolResultEvent
	| GeminiErrorEvent
	| GeminiResultEvent;

/**
 * Session initialization event
 */
export interface GeminiInitEvent {
	type: "init";
	session_id: string;
	model: string;
}

/**
 * User or assistant message event
 */
export interface GeminiMessageEvent {
	type: "message";
	role: "user" | "assistant";
	content: string;
}

/**
 * Tool use event (similar to Claude's tool_use)
 */
export interface GeminiToolUseEvent {
	type: "tool_use";
	tool_name: string;
	parameters: Record<string, unknown>;
}

/**
 * Tool result event
 */
export interface GeminiToolResultEvent {
	type: "tool_result";
	tool_name: string;
	result: unknown;
}

/**
 * Error event (non-fatal)
 */
export interface GeminiErrorEvent {
	type: "error";
	message: string;
	code?: number;
}

/**
 * Final result event with stats
 */
export interface GeminiResultEvent {
	type: "result";
	response: string;
	stats?: {
		model?: string;
		tokens?: {
			input?: number;
			output?: number;
			total?: number;
		};
		tools?: Record<string, number>;
		files_modified?: string[];
	};
	error?: {
		type: string;
		message: string;
		code?: number;
	};
}

/**
 * Configuration for GeminiRunner
 * Extends the base AgentRunnerConfig with Gemini-specific options
 */
export interface GeminiRunnerConfig extends AgentRunnerConfig {
	/** Path to gemini CLI binary (defaults to 'gemini' in PATH) */
	geminiPath?: string;
	/** Whether to auto-approve all actions (--yolo flag) */
	autoApprove?: boolean;
	/** Approval mode for tool use */
	approvalMode?: "auto_edit" | "auto" | "manual";
	/** Enable debug output */
	debug?: boolean;
}

/**
 * Session information for Gemini runner
 */
export interface GeminiSessionInfo extends AgentSessionInfo {
	/** Gemini-specific session ID */
	sessionId: string | null;
}

/**
 * Event emitter interface for GeminiRunner
 */
export interface GeminiRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	streamEvent: (event: GeminiStreamEvent) => void;
}

// Re-export types from core for convenience
export type {
	AgentRunnerConfig,
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	SDKMessage,
	SDKUserMessage,
};
