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
 * Codex CLI MCP server configuration for config.toml
 *
 * Codex CLI supports two transport types:
 * - stdio: Spawns a subprocess and communicates via stdin/stdout (command-based)
 * - http: Uses Streamable HTTP for communication (url-based with optional bearer token)
 *
 * Reference: https://github.com/openai/codex/blob/main/docs/config.md
 */
export interface CodexMcpServerConfig {
	// Transport: stdio (command-based)
	/** Transport type - either "stdio" or "http" */
	transport?: "stdio";
	/** The command to execute to start the MCP server (stdio transport) */
	command?: string;
	/** Arguments to pass to the command (stdio transport) */
	args?: string[];
	/** Environment variables for the server process */
	env?: Record<string, string>;
	/** List of environment variable names to pass through */
	env_vars?: string[];
	/** The working directory in which to start the server (stdio transport) */
	cwd?: string;
	/** Startup timeout in seconds (default: 10) */
	startup_timeout_sec?: number;
	/** Tool execution timeout in seconds (default: 60) */
	tool_timeout_sec?: number;
	/** Whether this MCP server is enabled (default: true) */
	enabled?: boolean;
	/** List of enabled tool names (whitelist) */
	enabled_tools?: string[];
	/** List of disabled tool names (blacklist) */
	disabled_tools?: string[];
}

/**
 * Codex CLI HTTP MCP server configuration
 */
export interface CodexHttpMcpServerConfig {
	/** URL for the HTTP MCP server */
	url?: string;
	/** Environment variable name containing bearer token */
	bearer_token_env_var?: string;
	/** Custom HTTP headers */
	http_headers?: Record<string, string>;
	/** Environment variable names for HTTP headers */
	env_http_headers?: Record<string, string>;
	/** Whether this MCP server is enabled (default: true) */
	enabled?: boolean;
	/** List of enabled tool names (whitelist) */
	enabled_tools?: string[];
	/** List of disabled tool names (blacklist) */
	disabled_tools?: string[];
}

// Re-export McpServerConfig from cyrus-core for convenience
export type { McpServerConfig };

// Re-export event types from schemas (derived from Zod schemas)
export type {
	// Thread item types
	AgentMessageItem,
	CommandExecutionItem,
	CommandExecutionStatus,
	ErrorItem,
	FileChangeItem,
	FileUpdateChange,
	// Formatter input type
	FormatterToolInput,
	ItemCompletedEvent,
	ItemStartedEvent,
	ItemUpdatedEvent,
	McpContentBlock,
	McpToolCallError,
	McpToolCallItem,
	McpToolCallResult,
	McpToolCallStatus,
	PatchApplyStatus,
	PatchChangeKind,
	ReasoningItem,
	ThreadError,
	ThreadErrorEvent,
	// Thread event types
	ThreadEvent,
	ThreadItem,
	ThreadStartedEvent,
	TodoItem,
	TodoListItem,
	TurnCompletedEvent,
	TurnFailedEvent,
	TurnStartedEvent,
	Usage,
	WebSearchItem,
} from "./schemas.js";

// Re-export schemas for runtime validation
export {
	// Thread item schemas
	AgentMessageItemSchema,
	CommandExecutionItemSchema,
	CommandExecutionStatusSchema,
	ErrorItemSchema,
	// Parsing utilities
	extractThreadId,
	FileChangeItemSchema,
	FileUpdateChangeSchema,
	ItemCompletedEventSchema,
	ItemStartedEventSchema,
	ItemUpdatedEventSchema,
	// Type guards for thread events
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
	McpContentBlockSchema,
	McpToolCallErrorSchema,
	McpToolCallItemSchema,
	McpToolCallResultSchema,
	McpToolCallStatusSchema,
	PatchApplyStatusSchema,
	PatchChangeKindSchema,
	parseCodexEvent,
	ReasoningItemSchema,
	safeParseCodexEvent,
	ThreadErrorEventSchema,
	ThreadErrorSchema,
	// Thread event schemas
	ThreadEventSchema,
	ThreadItemSchema,
	ThreadStartedEventSchema,
	TodoItemSchema,
	TodoListItemSchema,
	TurnCompletedEventSchema,
	TurnFailedEventSchema,
	TurnStartedEventSchema,
	UsageSchema,
	WebSearchItemSchema,
} from "./schemas.js";

/**
 * Configuration for CodexRunner
 * Extends the base AgentRunnerConfig with Codex-specific options
 *
 * MCP Configuration:
 * - mcpConfig: Inline MCP server configurations (inherited from AgentRunnerConfig)
 * - mcpConfigPath: Path(s) to MCP configuration file(s) (inherited from AgentRunnerConfig)
 *
 * @example
 * ```typescript
 * const config: CodexRunnerConfig = {
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'gpt-5.1-codex-max',
 *   mcpConfig: {
 *     linear: {
 *       command: 'npx',
 *       args: ['-y', '@anthropic-ai/linear-mcp-server'],
 *       env: { LINEAR_API_TOKEN: 'token' }
 *     }
 *   },
 * };
 * ```
 */
export interface CodexRunnerConfig extends AgentRunnerConfig {
	/** Path to codex CLI binary (defaults to 'codex' in PATH) */
	codexPath?: string;
	/** Sandbox mode: 'read-only', 'workspace-write', or 'danger-full-access' */
	sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
	/** Model reasoning effort: 'minimal', 'low', 'medium', 'high', or 'xhigh' */
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	/** Model reasoning summary style: 'auto', 'concise', 'detailed', or 'none' */
	reasoningSummary?: "auto" | "concise" | "detailed" | "none";
	/** Enable debug output */
	debug?: boolean;
	/** Skip git repository check */
	skipGitRepoCheck?: boolean;
	/** Approval policy: 'untrusted', 'on-failure', 'on-request', or 'never' */
	approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
}

/**
 * Session information for Codex runner
 */
export interface CodexSessionInfo extends AgentSessionInfo {
	/** Codex thread ID */
	threadId: string | null;
}

/**
 * Event emitter interface for CodexRunner
 */
export interface CodexRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	threadEvent: (event: import("./schemas.js").ThreadEvent) => void;
}
