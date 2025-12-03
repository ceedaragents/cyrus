/**
 * Type definitions for Codex Runner
 *
 * These types define the configuration and interfaces for the CodexRunner,
 * which uses the OpenAI Codex TypeScript SDK (@openai/codex) for AI agent execution.
 */

import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

/**
 * Codex SDK ThreadOptions type alias
 * These are the options passed to the Codex SDK's startThread() method.
 *
 * Reference: https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts
 */
export interface CodexThreadOptions {
	/** AI model to use (e.g., "o4-mini", "gpt-4.1") */
	model?: string;
	/** Sandbox mode for file system access control */
	sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
	/** Working directory for the session */
	workingDirectory?: string;
	/** Skip git repository validation */
	skipGitRepoCheck?: boolean;
	/** Reasoning effort level */
	modelReasoningEffort?: "minimal" | "low" | "medium" | "high";
	/** Enable network access for the agent */
	networkAccessEnabled?: boolean;
	/** Enable web search capability */
	webSearchEnabled?: boolean;
	/** Approval policy for tool execution */
	approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
	/** Additional directories to include in the workspace */
	additionalDirectories?: string[];
}

/**
 * Configuration for CodexRunner
 * Extends the base AgentRunnerConfig with Codex-specific options
 */
export interface CodexRunnerConfig extends AgentRunnerConfig {
	/** Path to Codex CLI binary (optional, SDK handles resolution) */
	codexPath?: string;
	/** Sandbox mode for file system access */
	sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
	/** Reasoning effort level for the model */
	modelReasoningEffort?: "minimal" | "low" | "medium" | "high";
	/** Enable network access for the agent */
	networkAccessEnabled?: boolean;
	/** Enable web search capability */
	webSearchEnabled?: boolean;
	/** Approval policy for tool execution */
	approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
	/** Skip git repository check */
	skipGitRepoCheck?: boolean;
	/** Enable debug logging */
	debug?: boolean;
}

/**
 * Session information for Codex runner
 */
export interface CodexSessionInfo extends AgentSessionInfo {
	/** Codex thread ID (assigned after first turn) */
	threadId: string | null;
}

/**
 * Event emitter interface for CodexRunner
 */
export interface CodexRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	/** Raw Codex SDK event for debugging */
	threadEvent: (event: CodexThreadEvent) => void;
}

// ============================================================================
// Codex SDK Event Types
// These mirror the types from @openai/codex SDK for type safety
// Reference: https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts
// ============================================================================

/**
 * Token usage information
 */
export interface CodexUsage {
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
}

/**
 * Thread error structure
 */
export interface CodexThreadError {
	message: string;
}

/**
 * Thread started event - signals new thread creation
 */
export interface CodexThreadStartedEvent {
	type: "thread.started";
	thread_id: string;
}

/**
 * Turn started event - marks the beginning of model processing
 */
export interface CodexTurnStartedEvent {
	type: "turn.started";
}

/**
 * Turn completed event - indicates turn completion with token metrics
 */
export interface CodexTurnCompletedEvent {
	type: "turn.completed";
	usage: CodexUsage;
}

/**
 * Turn failed event - represents processing failure
 */
export interface CodexTurnFailedEvent {
	type: "turn.failed";
	usage: CodexUsage;
	error: CodexThreadError;
}

/**
 * Item started event - marks new item addition
 */
export interface CodexItemStartedEvent {
	type: "item.started";
	item: CodexThreadItem;
}

/**
 * Item updated event - indicates item modification
 */
export interface CodexItemUpdatedEvent {
	type: "item.updated";
	item: CodexThreadItem;
}

/**
 * Item completed event - signals item terminal state
 */
export interface CodexItemCompletedEvent {
	type: "item.completed";
	item: CodexThreadItem;
}

/**
 * Thread error event - fatal stream errors
 */
export interface CodexThreadErrorEvent {
	type: "error";
	message: string;
}

/**
 * Union of all Codex thread events
 */
export type CodexThreadEvent =
	| CodexThreadStartedEvent
	| CodexTurnStartedEvent
	| CodexTurnCompletedEvent
	| CodexTurnFailedEvent
	| CodexItemStartedEvent
	| CodexItemUpdatedEvent
	| CodexItemCompletedEvent
	| CodexThreadErrorEvent;

// ============================================================================
// Codex SDK Item Types
// Reference: https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts
// ============================================================================

/**
 * Agent message item - contains the agent's response text
 * Uses underscore naming convention to match SDK
 */
export interface CodexAgentMessageItem {
	id: string;
	type: "agent_message";
	/** Either natural-language text or JSON when structured output is requested */
	text: string;
}

/**
 * Reasoning item - captures the agent's internal reasoning summary
 */
export interface CodexReasoningItem {
	id: string;
	type: "reasoning";
	text: string;
}

/**
 * Command execution status type
 */
export type CodexCommandExecutionStatus =
	| "in_progress"
	| "completed"
	| "failed";

/**
 * Command execution item - tracks shell command execution
 */
export interface CodexCommandExecutionItem {
	id: string;
	type: "command_execution";
	/** The command line executed by the agent */
	command: string;
	/** Aggregated stdout and stderr captured while the command was running */
	aggregated_output: string;
	/** Set when the command exits; omitted while still running */
	exit_code?: number;
	/** Current status of the command execution */
	status: CodexCommandExecutionStatus;
}

/**
 * Indicates the type of the file change
 */
export type CodexPatchChangeKind = "add" | "delete" | "update";

/**
 * A file update change
 */
export interface CodexFileUpdateChange {
	path: string;
	kind: CodexPatchChangeKind;
}

/**
 * File change status type
 */
export type CodexPatchApplyStatus = "completed" | "failed";

/**
 * File change item - documents patch operations
 */
export interface CodexFileChangeItem {
	id: string;
	type: "file_change";
	/** Individual file changes that comprise the patch */
	changes: CodexFileUpdateChange[];
	/** Whether the patch ultimately succeeded or failed */
	status: CodexPatchApplyStatus;
}

/**
 * MCP tool call status type
 */
export type CodexMcpToolCallStatus = "in_progress" | "completed" | "failed";

/**
 * MCP tool call result
 */
export interface CodexMcpToolCallResult {
	content: unknown[];
	structured_content: unknown;
}

/**
 * MCP tool call error
 */
export interface CodexMcpToolCallError {
	message: string;
}

/**
 * MCP tool call item - represents Model Context Protocol tool invocations
 */
export interface CodexMcpToolCallItem {
	id: string;
	type: "mcp_tool_call";
	/** Name of the MCP server handling the request */
	server: string;
	/** The tool invoked on the MCP server */
	tool: string;
	/** Arguments forwarded to the tool invocation */
	arguments: unknown;
	/** Result payload returned by the MCP server for successful calls */
	result?: CodexMcpToolCallResult;
	/** Error message reported for failed calls */
	error?: CodexMcpToolCallError;
	/** Current status of the tool invocation */
	status: CodexMcpToolCallStatus;
}

/**
 * Web search item - captures search queries
 */
export interface CodexWebSearchItem {
	id: string;
	type: "web_search";
	query: string;
}

/**
 * A single todo item in the agent's to-do list
 */
export interface CodexTodoItem {
	text: string;
	completed: boolean;
}

/**
 * Todo list item - maintains a running to-do list
 */
export interface CodexTodoListItem {
	id: string;
	type: "todo_list";
	items: CodexTodoItem[];
}

/**
 * Error item - represents non-fatal errors surfaced as items
 */
export interface CodexErrorItem {
	id: string;
	type: "error";
	message: string;
}

/**
 * Union of all Codex thread item types
 */
export type CodexThreadItem =
	| CodexAgentMessageItem
	| CodexReasoningItem
	| CodexCommandExecutionItem
	| CodexFileChangeItem
	| CodexMcpToolCallItem
	| CodexWebSearchItem
	| CodexTodoListItem
	| CodexErrorItem;

/**
 * Type guard for CodexAgentMessageItem
 */
export function isCodexAgentMessageItem(
	item: CodexThreadItem,
): item is CodexAgentMessageItem {
	return item.type === "agent_message";
}

/**
 * Type guard for CodexCommandExecutionItem
 */
export function isCodexCommandExecutionItem(
	item: CodexThreadItem,
): item is CodexCommandExecutionItem {
	return item.type === "command_execution";
}

/**
 * Type guard for CodexFileChangeItem
 */
export function isCodexFileChangeItem(
	item: CodexThreadItem,
): item is CodexFileChangeItem {
	return item.type === "file_change";
}

/**
 * Type guard for CodexMcpToolCallItem
 */
export function isCodexMcpToolCallItem(
	item: CodexThreadItem,
): item is CodexMcpToolCallItem {
	return item.type === "mcp_tool_call";
}

/**
 * Type guard for CodexTodoListItem
 */
export function isCodexTodoListItem(
	item: CodexThreadItem,
): item is CodexTodoListItem {
	return item.type === "todo_list";
}

/**
 * Type guard for CodexReasoningItem
 */
export function isCodexReasoningItem(
	item: CodexThreadItem,
): item is CodexReasoningItem {
	return item.type === "reasoning";
}

/**
 * Type guard for CodexWebSearchItem
 */
export function isCodexWebSearchItem(
	item: CodexThreadItem,
): item is CodexWebSearchItem {
	return item.type === "web_search";
}

/**
 * Type guard for CodexErrorItem
 */
export function isCodexErrorItem(
	item: CodexThreadItem,
): item is CodexErrorItem {
	return item.type === "error";
}

/**
 * Formatter tool input type (matches Gemini pattern)
 */
export type FormatterToolInput = Record<string, unknown> | string;
