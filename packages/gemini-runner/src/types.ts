import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
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
	timestamp: string;
}

/**
 * User or assistant message event
 *
 * NOTE: When delta is true, this message should be accumulated with previous delta messages
 * of the same role. The caller (GeminiRunner) is responsible for accumulating delta messages.
 * Each delta message event will create a separate SDK message if not handled by the caller.
 */
export interface GeminiMessageEvent {
	type: "message";
	role: "user" | "assistant";
	content: string;
	timestamp: string;
	delta?: boolean;
}

/**
 * Tool use event (similar to Claude's tool_use)
 *
 * NOTE: tool_id is assigned by Gemini CLI, not generated client-side
 */
export interface GeminiToolUseEvent {
	type: "tool_use";
	tool_name: string;
	tool_id: string;
	parameters: Record<string, unknown>;
	timestamp: string;
}

/**
 * Tool result event
 *
 * NOTE: Uses tool_id (not tool_name) to match the tool_use event
 * Contains either output (success) or error (failure)
 */
export interface GeminiToolResultEvent {
	type: "tool_result";
	tool_id: string;
	status: "success" | "error";
	output?: string;
	error?: {
		code?: string;
		message: string;
		type?: string;
	};
	timestamp: string;
}

/**
 * Error event (non-fatal)
 */
export interface GeminiErrorEvent {
	type: "error";
	message: string;
	code?: number;
	timestamp: string;
}

/**
 * Final result event with stats
 *
 * Real output example:
 * {"type":"result","timestamp":"2025-11-20T20:51:52.121Z","status":"success",
 *  "stats":{"total_tokens":2284560,"input_tokens":2271866,"output_tokens":5267,
 *           "duration_ms":195413,"tool_calls":36}}
 */
export interface GeminiResultEvent {
	type: "result";
	timestamp: string;
	status: "success" | "error";
	stats?: {
		total_tokens?: number;
		input_tokens?: number;
		output_tokens?: number;
		duration_ms?: number;
		tool_calls?: number;
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
	/** Additional directories to include in workspace context (--include-directories flag) */
	includeDirectories?: string[];
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
	streamEvent: (event: GeminiStreamEvent) => void; // Raw event emitting
}
