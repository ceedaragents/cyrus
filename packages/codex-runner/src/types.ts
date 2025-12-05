/**
 * Type definitions for Codex Runner
 *
 * Event types are derived from Zod schemas in schemas.ts for runtime validation.
 * Configuration and session types remain as interfaces.
 */

import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	McpServerConfig,
	SDKMessage,
} from "cyrus-core";

/**
 * Codex CLI MCP server configuration (TOML format)
 *
 * Codex supports two transport types:
 * - stdio: Spawns a subprocess and communicates via stdin/stdout (command-based)
 * - streamable_http: Uses HTTP streaming for communication (url-based)
 *
 * Reference: Codex config.toml MCP server format from specification
 */
export interface CodexMcpServerConfig {
	/** Transport type: "stdio" or "streamable_http" */
	transport: "stdio" | "streamable_http";

	// Transport: stdio (command-based)
	/** The command to execute to start the MCP server (stdio transport) */
	command?: string;
	/** Arguments to pass to the command (stdio transport) */
	args?: string[];
	/** The working directory in which to start the server (stdio transport) */
	cwd?: string;

	// Transport: streamable_http (HTTP streaming)
	/** HTTP streaming endpoint URL (streamable_http transport) */
	url?: string;
	/** Environment variable name containing bearer token (streamable_http transport) */
	bearer_env_var?: string;
	/** Custom HTTP headers when using streamable_http */
	headers?: Record<string, string>;

	// Common options
	/** Environment variables for the server process */
	env?: Record<string, string>;
	/** Startup timeout in seconds (default: 10s) */
	startup_timeout?: { secs: number };
	/** Tool execution timeout in seconds (default: 60s) */
	tool_timeout?: { secs: number };
	/** List of tool names to enable from this MCP server (whitelist) */
	enabled_tools?: string[];
	/** List of tool names to disable from this MCP server (blacklist) */
	disabled_tools?: string[];
	/** Whether this server is enabled (default: true) */
	enabled?: boolean;
}

// Re-export McpServerConfig from cyrus-core for convenience
export type { McpServerConfig };

// Re-export event types from schemas (derived from Zod schemas)
export type {
	// Item types
	AgentMessageItem,
	CommandExecutionItem,
	ErrorItem,
	FileChangeItem,
	ItemCompletedEvent,
	ItemStartedEvent,
	ItemUpdatedEvent,
	McpToolCallItem,
	ReasoningItem,
	ThreadErrorEvent,
	// Combined event type
	ThreadEvent,
	ThreadItem,
	ThreadStartedEvent,
	TodoListItem,
	TurnCompletedEvent,
	TurnFailedEvent,
	TurnStartedEvent,
	WebSearchItem,
} from "./schemas.js";

// Re-export schemas for runtime validation
export {
	// Item schemas
	AgentMessageItemSchema,
	CommandExecutionItemSchema,
	ErrorItemSchema,
	FileChangeItemSchema,
	ItemCompletedEventSchema,
	ItemStartedEventSchema,
	ItemUpdatedEventSchema,
	// Type guards
	isAgentMessageItem,
	isCommandExecutionItem,
	isErrorItem,
	isFileChangeItem,
	isItemCompletedEvent,
	isItemStartedEvent,
	isItemUpdatedEvent,
	isMcpToolCallItem,
	isReasoningItem,
	isThreadErrorEvent,
	isThreadStartedEvent,
	isTodoListItem,
	isTurnCompletedEvent,
	isTurnFailedEvent,
	isTurnStartedEvent,
	isWebSearchItem,
	McpToolCallItemSchema,
	// Parsing utilities
	parseCodexEvent,
	ReasoningItemSchema,
	safeParseCodexEvent,
	// Event schemas
	ThreadErrorEventSchema,
	ThreadItemSchema,
	ThreadStartedEventSchema,
	TodoListItemSchema,
	TurnCompletedEventSchema,
	TurnFailedEventSchema,
	TurnStartedEventSchema,
	WebSearchItemSchema,
} from "./schemas.js";

/**
 * Configuration for CodexRunner
 * Extends the base AgentRunnerConfig with Codex-specific options
 */
export interface CodexRunnerConfig extends AgentRunnerConfig {
	/** Path to codex CLI binary (defaults to 'codex' in PATH) */
	codexPath?: string;
	/** Additional directories to include in workspace context */
	includeDirectories?: string[];
	/** Enable single-turn mode */
	singleTurn?: boolean;
}

/**
 * Session information for Codex runner
 */
export interface CodexSessionInfo extends AgentSessionInfo {
	/** Codex-specific session ID (thread ID) */
	sessionId: string | null;
}

/**
 * Event emitter interface for CodexRunner
 */
export interface CodexRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	event: (event: import("./schemas.js").ThreadEvent) => void;
}
