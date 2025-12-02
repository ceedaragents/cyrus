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
 */
export interface CodexAgentMessageItem {
	type: "agent-message";
	content: string;
}

/**
 * Reasoning item - captures the agent's internal reasoning summary
 */
export interface CodexReasoningItem {
	type: "reasoning";
	content: string;
}

/**
 * Command execution item - tracks shell command execution
 */
export interface CodexCommandExecutionItem {
	type: "command-execution";
	status: "running" | "completed" | "failed";
	command: string;
	output: string;
	exitCode?: number;
}

/**
 * File change item - documents patch operations
 */
export interface CodexFileChangeItem {
	type: "file-change";
	status: "completed" | "failed";
	patches: Array<{
		file: string;
		patch: string;
	}>;
}

/**
 * MCP tool call item - represents Model Context Protocol tool invocations
 */
export interface CodexMcpToolCallItem {
	type: "mcp-tool-call";
	serverName: string;
	toolName: string;
	arguments: Record<string, unknown>;
	result?: string;
	error?: string;
}

/**
 * Web search item - captures search queries
 */
export interface CodexWebSearchItem {
	type: "web-search";
	query: string;
}

/**
 * Todo list item - maintains a running to-do list
 */
export interface CodexTodoListItem {
	type: "todo-list";
	todos: Array<{
		id: string;
		description: string;
		completed: boolean;
	}>;
}

/**
 * Error item - represents non-fatal errors surfaced as items
 */
export interface CodexErrorItem {
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
	return item.type === "agent-message";
}

/**
 * Type guard for CodexCommandExecutionItem
 */
export function isCodexCommandExecutionItem(
	item: CodexThreadItem,
): item is CodexCommandExecutionItem {
	return item.type === "command-execution";
}

/**
 * Type guard for CodexFileChangeItem
 */
export function isCodexFileChangeItem(
	item: CodexThreadItem,
): item is CodexFileChangeItem {
	return item.type === "file-change";
}

/**
 * Type guard for CodexMcpToolCallItem
 */
export function isCodexMcpToolCallItem(
	item: CodexThreadItem,
): item is CodexMcpToolCallItem {
	return item.type === "mcp-tool-call";
}

/**
 * Type guard for CodexTodoListItem
 */
export function isCodexTodoListItem(
	item: CodexThreadItem,
): item is CodexTodoListItem {
	return item.type === "todo-list";
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
	return item.type === "web-search";
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
