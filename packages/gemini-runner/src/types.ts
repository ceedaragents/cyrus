/**
 * Type definitions for Gemini Runner
 *
 * Event types are derived from Zod schemas in schemas.ts for runtime validation.
 * Configuration and session types remain as interfaces.
 */

import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

// Re-export event types from schemas (derived from Zod schemas)
export type {
	GeminiErrorEvent,
	GeminiInitEvent,
	GeminiMessageEvent,
	GeminiResultEvent,
	GeminiStreamEvent,
	// Tool parameter types
	GeminiToolParameters,
	GeminiToolResultEvent,
	GeminiToolUseEvent,
	ListDirectoryParameters,
	// Tool result types
	ListDirectoryToolResult,
	ListDirectoryToolUseEvent,
	ReadFileParameters,
	ReadFileToolResult,
	ReadFileToolUseEvent,
	ReplaceParameters,
	ReplaceToolResult,
	ReplaceToolUseEvent,
	RunShellCommandParameters,
	RunShellCommandToolResult,
	RunShellCommandToolUseEvent,
	SearchFileContentParameters,
	SearchFileContentToolResult,
	SearchFileContentToolUseEvent,
	TodoItem,
	UnknownToolUseEvent,
	WriteFileParameters,
	WriteFileToolResult,
	WriteFileToolUseEvent,
	WriteTodosParameters,
	WriteTodosToolResult,
	WriteTodosToolUseEvent,
} from "./schemas.js";

// Re-export schemas for runtime validation
export {
	// Parsing utilities
	extractToolNameFromId,
	// Event schemas
	GeminiErrorEventSchema,
	GeminiInitEventSchema,
	GeminiMessageEventSchema,
	GeminiResultEventSchema,
	GeminiStreamEventSchema,
	// Tool parameter schemas
	GeminiToolParametersSchema,
	GeminiToolResultEventSchema,
	GeminiToolUseEventSchema,
	// Event type guards
	isGeminiErrorEvent,
	isGeminiInitEvent,
	isGeminiMessageEvent,
	isGeminiResultEvent,
	isGeminiToolResultEvent,
	isGeminiToolUseEvent,
	// Tool use type guards
	isListDirectoryTool,
	// Tool result type guards
	isListDirectoryToolResult,
	isReadFileTool,
	isReadFileToolResult,
	isReplaceTool,
	isReplaceToolResult,
	isRunShellCommandTool,
	isRunShellCommandToolResult,
	isSearchFileContentTool,
	isSearchFileContentToolResult,
	isWriteFileTool,
	isWriteFileToolResult,
	isWriteTodosTool,
	isWriteTodosToolResult,
	ListDirectoryParametersSchema,
	// Tool result schemas
	ListDirectoryToolResultSchema,
	ListDirectoryToolUseEventSchema,
	parseAsListDirectoryTool,
	parseAsReadFileTool,
	parseAsReplaceTool,
	parseAsRunShellCommandTool,
	parseAsSearchFileContentTool,
	parseAsWriteFileTool,
	parseAsWriteTodosTool,
	parseGeminiStreamEvent,
	ReadFileParametersSchema,
	ReadFileToolResultSchema,
	ReadFileToolUseEventSchema,
	ReplaceParametersSchema,
	ReplaceToolResultSchema,
	ReplaceToolUseEventSchema,
	RunShellCommandParametersSchema,
	RunShellCommandToolResultSchema,
	RunShellCommandToolUseEventSchema,
	SearchFileContentParametersSchema,
	SearchFileContentToolResultSchema,
	SearchFileContentToolUseEventSchema,
	safeParseGeminiStreamEvent,
	TodoItemSchema,
	UnknownToolUseEventSchema,
	WriteFileParametersSchema,
	WriteFileToolResultSchema,
	WriteFileToolUseEventSchema,
	WriteTodosParametersSchema,
	WriteTodosToolResultSchema,
	WriteTodosToolUseEventSchema,
} from "./schemas.js";

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
	/** Enable single-turn mode (sets maxSessionTurns=1 in settings.json) */
	singleTurn?: boolean;
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
	streamEvent: (event: import("./schemas.js").GeminiStreamEvent) => void;
}
