/**
 * Zod Schemas for Codex CLI JSONL Events
 *
 * These schemas provide runtime validation for the OpenAI Codex CLI's JSONL output format.
 * TypeScript types are derived from these schemas using z.infer<> for type safety.
 *
 * The Codex CLI outputs events in JSONL format documenting thread lifecycle, turn processing,
 * and item execution. This module provides comprehensive schemas for all event and item types.
 *
 * Event Types:
 * - thread.started - Thread initialization with thread_id
 * - turn.started - Turn processing begins
 * - turn.completed - Turn processing completes with usage stats
 * - turn.failed - Turn processing failed with error
 * - item.started - Item execution begins
 * - item.updated - Item execution progress update
 * - item.completed - Item execution completes
 * - error - Thread-level error
 *
 * Item Types:
 * - agent_message - Final response text from agent
 * - reasoning - Agent reasoning/thinking summaries
 * - command_execution - Shell command execution
 * - file_change - File modification operations
 * - mcp_tool_call - MCP tool invocations
 * - web_search - Web search operations
 * - todo_list - Todo tracking items
 * - error - Item-level errors
 */

import { z } from "zod";

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * Usage statistics for token consumption
 *
 * Example:
 * ```json
 * {"input_tokens":6651,"cached_input_tokens":6144,"output_tokens":39}
 * ```
 */
export const UsageSchema = z.object({
	input_tokens: z.number().int().nonnegative(),
	cached_input_tokens: z.number().int().nonnegative().optional(),
	output_tokens: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

/**
 * Item status enum - tracks execution state
 */
export const ItemStatusSchema = z.enum(["in_progress", "completed", "failed"]);

export type ItemStatus = z.infer<typeof ItemStatusSchema>;

// ============================================================================
// Thread Item Schemas
// ============================================================================

/**
 * Base item schema with common fields
 */
const BaseItemSchema = z.object({
	id: z.string(),
	type: z.string(),
});

/**
 * Agent message item - final response text
 *
 * Example:
 * ```json
 * {"id":"item_2","type":"agent_message","text":"README.md\n\ndone"}
 * ```
 */
export const AgentMessageItemSchema = BaseItemSchema.extend({
	type: z.literal("agent_message"),
	text: z.string(),
});

export type AgentMessageItem = z.infer<typeof AgentMessageItemSchema>;

/**
 * Reasoning item - agent thinking/reasoning summary
 *
 * Example:
 * ```json
 * {"id":"item_0","type":"reasoning","text":"**Listing files**"}
 * ```
 */
export const ReasoningItemSchema = BaseItemSchema.extend({
	type: z.literal("reasoning"),
	text: z.string(),
});

export type ReasoningItem = z.infer<typeof ReasoningItemSchema>;

/**
 * Command execution item - shell command with output and status
 *
 * Example:
 * ```json
 * {"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"README.md\n","exit_code":0,"status":"completed"}
 * ```
 */
export const CommandExecutionItemSchema = BaseItemSchema.extend({
	type: z.literal("command_execution"),
	command: z.string(),
	aggregated_output: z.string(),
	exit_code: z.number().int().nullable(),
	status: ItemStatusSchema,
});

export type CommandExecutionItem = z.infer<typeof CommandExecutionItemSchema>;

/**
 * File change item - file modification operation
 *
 * Example:
 * ```json
 * {"id":"item_3","type":"file_change","file_path":"src/index.ts","change_type":"create","content":"export const hello = 'world';","status":"completed"}
 * ```
 */
export const FileChangeItemSchema = BaseItemSchema.extend({
	type: z.literal("file_change"),
	file_path: z.string(),
	change_type: z.enum(["create", "update", "delete"]),
	content: z.string().optional(),
	status: ItemStatusSchema,
});

export type FileChangeItem = z.infer<typeof FileChangeItemSchema>;

/**
 * MCP tool call item - Model Context Protocol tool invocation
 *
 * Example:
 * ```json
 * {"id":"item_4","type":"mcp_tool_call","tool_name":"linear_create_issue","parameters":{"title":"Test"},"result":{"success":true},"status":"completed"}
 * ```
 */
export const McpToolCallItemSchema = BaseItemSchema.extend({
	type: z.literal("mcp_tool_call"),
	tool_name: z.string(),
	parameters: z.record(z.unknown()),
	result: z.unknown().optional(),
	status: ItemStatusSchema,
});

export type McpToolCallItem = z.infer<typeof McpToolCallItemSchema>;

/**
 * Web search item - web search operation
 *
 * Example:
 * ```json
 * {"id":"item_5","type":"web_search","query":"TypeScript best practices","results":[{"title":"...","url":"..."}],"status":"completed"}
 * ```
 */
export const WebSearchItemSchema = BaseItemSchema.extend({
	type: z.literal("web_search"),
	query: z.string(),
	results: z.array(z.record(z.unknown())).optional(),
	status: ItemStatusSchema,
});

export type WebSearchItem = z.infer<typeof WebSearchItemSchema>;

/**
 * Todo list item - todo tracking
 *
 * Example:
 * ```json
 * {"id":"item_6","type":"todo_list","todos":[{"description":"Implement feature","status":"pending"}],"status":"completed"}
 * ```
 */
export const TodoItemSchema = z.object({
	description: z.string(),
	status: z.enum(["pending", "in_progress", "completed"]),
});

export const TodoListItemSchema = BaseItemSchema.extend({
	type: z.literal("todo_list"),
	todos: z.array(TodoItemSchema),
	status: ItemStatusSchema,
});

export type TodoItem = z.infer<typeof TodoItemSchema>;
export type TodoListItem = z.infer<typeof TodoListItemSchema>;

/**
 * Error item - item-level error
 *
 * Example:
 * ```json
 * {"id":"item_7","type":"error","message":"Command failed with exit code 1"}
 * ```
 */
export const ErrorItemSchema = BaseItemSchema.extend({
	type: z.literal("error"),
	message: z.string(),
});

export type ErrorItem = z.infer<typeof ErrorItemSchema>;

/**
 * Union type for all thread items
 */
export const ThreadItemSchema = z.discriminatedUnion("type", [
	AgentMessageItemSchema,
	ReasoningItemSchema,
	CommandExecutionItemSchema,
	FileChangeItemSchema,
	McpToolCallItemSchema,
	WebSearchItemSchema,
	TodoListItemSchema,
	ErrorItemSchema,
]);

export type ThreadItem = z.infer<typeof ThreadItemSchema>;

// ============================================================================
// Thread Event Schemas
// ============================================================================

/**
 * Thread started event - emitted when thread begins
 *
 * Example:
 * ```json
 * {"type":"thread.started","thread_id":"019ae047-d040-7891-8d68-5dd42b18474e"}
 * ```
 */
export const ThreadStartedEventSchema = z.object({
	type: z.literal("thread.started"),
	thread_id: z.string(),
});

export type ThreadStartedEvent = z.infer<typeof ThreadStartedEventSchema>;

/**
 * Turn started event - emitted when turn processing begins
 *
 * Example:
 * ```json
 * {"type":"turn.started"}
 * ```
 */
export const TurnStartedEventSchema = z.object({
	type: z.literal("turn.started"),
});

export type TurnStartedEvent = z.infer<typeof TurnStartedEventSchema>;

/**
 * Turn completed event - emitted when turn processing completes with usage stats
 *
 * Example:
 * ```json
 * {"type":"turn.completed","usage":{"input_tokens":6651,"cached_input_tokens":6144,"output_tokens":39}}
 * ```
 */
export const TurnCompletedEventSchema = z.object({
	type: z.literal("turn.completed"),
	usage: UsageSchema,
});

export type TurnCompletedEvent = z.infer<typeof TurnCompletedEventSchema>;

/**
 * Turn failed event - emitted when turn processing fails
 *
 * Example:
 * ```json
 * {"type":"turn.failed","error":{"message":"Rate limit exceeded"}}
 * ```
 */
export const TurnFailedEventSchema = z.object({
	type: z.literal("turn.failed"),
	error: z.object({
		message: z.string(),
	}),
});

export type TurnFailedEvent = z.infer<typeof TurnFailedEventSchema>;

/**
 * Item started event - emitted when item execution begins
 *
 * Example:
 * ```json
 * {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}
 * ```
 */
export const ItemStartedEventSchema = z.object({
	type: z.literal("item.started"),
	item: ThreadItemSchema,
});

export type ItemStartedEvent = z.infer<typeof ItemStartedEventSchema>;

/**
 * Item updated event - emitted when item execution progresses
 *
 * Example:
 * ```json
 * {"type":"item.updated","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"README.md","exit_code":null,"status":"in_progress"}}
 * ```
 */
export const ItemUpdatedEventSchema = z.object({
	type: z.literal("item.updated"),
	item: ThreadItemSchema,
});

export type ItemUpdatedEvent = z.infer<typeof ItemUpdatedEventSchema>;

/**
 * Item completed event - emitted when item execution completes
 *
 * Example:
 * ```json
 * {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"README.md\n","exit_code":0,"status":"completed"}}
 * ```
 */
export const ItemCompletedEventSchema = z.object({
	type: z.literal("item.completed"),
	item: ThreadItemSchema,
});

export type ItemCompletedEvent = z.infer<typeof ItemCompletedEventSchema>;

/**
 * Thread error event - emitted when a thread-level error occurs
 *
 * Example:
 * ```json
 * {"type":"error","message":"Thread execution failed"}
 * ```
 */
export const ThreadErrorEventSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});

export type ThreadErrorEvent = z.infer<typeof ThreadErrorEventSchema>;

/**
 * Union type for all thread events
 */
export const ThreadEventSchema = z.discriminatedUnion("type", [
	ThreadStartedEventSchema,
	TurnStartedEventSchema,
	TurnCompletedEventSchema,
	TurnFailedEventSchema,
	ItemStartedEventSchema,
	ItemUpdatedEventSchema,
	ItemCompletedEventSchema,
	ThreadErrorEventSchema,
]);

export type ThreadEvent = z.infer<typeof ThreadEventSchema>;

// ============================================================================
// Parsing Utilities
// ============================================================================

/**
 * Safely parse a Codex JSONL event with runtime validation
 *
 * @param data - Unknown data to parse (typically from JSON.parse of JSONL line)
 * @returns Zod safe parse result with parsed event or error details
 *
 * @example
 * ```typescript
 * const result = safeParseCodexEvent(JSON.parse(line));
 * if (result.success) {
 *   console.log('Event type:', result.data.type);
 * } else {
 *   console.error('Validation failed:', result.error);
 * }
 * ```
 */
export function safeParseCodexEvent(data: unknown) {
	return ThreadEventSchema.safeParse(data);
}

/**
 * Parse a Codex JSONL event, throwing on validation failure
 *
 * @param data - Unknown data to parse
 * @returns Parsed and validated ThreadEvent
 * @throws ZodError if validation fails
 */
export function parseCodexEvent(data: unknown): ThreadEvent {
	return ThreadEventSchema.parse(data);
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for thread.started events
 */
export function isThreadStartedEvent(
	event: ThreadEvent,
): event is ThreadStartedEvent {
	return event.type === "thread.started";
}

/**
 * Type guard for turn.started events
 */
export function isTurnStartedEvent(
	event: ThreadEvent,
): event is TurnStartedEvent {
	return event.type === "turn.started";
}

/**
 * Type guard for turn.completed events
 */
export function isTurnCompletedEvent(
	event: ThreadEvent,
): event is TurnCompletedEvent {
	return event.type === "turn.completed";
}

/**
 * Type guard for turn.failed events
 */
export function isTurnFailedEvent(
	event: ThreadEvent,
): event is TurnFailedEvent {
	return event.type === "turn.failed";
}

/**
 * Type guard for item.started events
 */
export function isItemStartedEvent(
	event: ThreadEvent,
): event is ItemStartedEvent {
	return event.type === "item.started";
}

/**
 * Type guard for item.updated events
 */
export function isItemUpdatedEvent(
	event: ThreadEvent,
): event is ItemUpdatedEvent {
	return event.type === "item.updated";
}

/**
 * Type guard for item.completed events
 */
export function isItemCompletedEvent(
	event: ThreadEvent,
): event is ItemCompletedEvent {
	return event.type === "item.completed";
}

/**
 * Type guard for error events
 */
export function isThreadErrorEvent(
	event: ThreadEvent,
): event is ThreadErrorEvent {
	return event.type === "error";
}

// ============================================================================
// Item Type Guards
// ============================================================================

/**
 * Type guard for agent_message items
 */
export function isAgentMessageItem(item: ThreadItem): item is AgentMessageItem {
	return item.type === "agent_message";
}

/**
 * Type guard for reasoning items
 */
export function isReasoningItem(item: ThreadItem): item is ReasoningItem {
	return item.type === "reasoning";
}

/**
 * Type guard for command_execution items
 */
export function isCommandExecutionItem(
	item: ThreadItem,
): item is CommandExecutionItem {
	return item.type === "command_execution";
}

/**
 * Type guard for file_change items
 */
export function isFileChangeItem(item: ThreadItem): item is FileChangeItem {
	return item.type === "file_change";
}

/**
 * Type guard for mcp_tool_call items
 */
export function isMcpToolCallItem(item: ThreadItem): item is McpToolCallItem {
	return item.type === "mcp_tool_call";
}

/**
 * Type guard for web_search items
 */
export function isWebSearchItem(item: ThreadItem): item is WebSearchItem {
	return item.type === "web_search";
}

/**
 * Type guard for todo_list items
 */
export function isTodoListItem(item: ThreadItem): item is TodoListItem {
	return item.type === "todo_list";
}

/**
 * Type guard for error items
 */
export function isErrorItem(item: ThreadItem): item is ErrorItem {
	return item.type === "error";
}
