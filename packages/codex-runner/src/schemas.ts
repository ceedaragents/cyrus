/**
 * Zod Schemas for OpenAI Codex CLI JSONL Events
 *
 * These schemas provide runtime validation for Codex CLI's JSON output format
 * when running with the `--json` flag. TypeScript types are derived from these
 * schemas using z.infer<> for type safety.
 *
 * Codex CLI Event Types (via `codex exec --json`):
 * - thread.started: Session initialization
 * - turn.started: Model begins processing
 * - turn.completed: Model finishes with usage stats
 * - turn.failed: Processing failure
 * - item.started/updated/completed: Thread item lifecycle
 * - error: Unrecoverable stream error
 *
 * Thread Item Types:
 * - agent_message: Final text response
 * - reasoning: Reasoning summaries
 * - command_execution: Shell command execution
 * - file_change: File modifications
 * - mcp_tool_call: MCP tool invocations
 * - web_search: Web search queries
 * - todo_list: Task tracking
 * - error: Error items
 *
 * Reference:
 * @see https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts
 * @see https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts
 */

import { z } from "zod";

// ============================================================================
// Thread Item Schemas
// ============================================================================

/**
 * Status for command execution items
 */
export const CommandExecutionStatusSchema = z.enum([
	"in_progress",
	"completed",
	"failed",
	"declined",
]);

/**
 * Command execution item - represents shell command execution
 *
 * Example:
 * ```json
 * {
 *   "id": "cmd_123",
 *   "type": "command_execution",
 *   "command": "npm test",
 *   "aggregated_output": "All tests passed",
 *   "exit_code": 0,
 *   "status": "completed"
 * }
 * ```
 */
export const CommandExecutionItemSchema = z.object({
	id: z.string(),
	type: z.literal("command_execution"),
	command: z.string(),
	aggregated_output: z.string(),
	exit_code: z.number().optional(),
	status: CommandExecutionStatusSchema,
});

/**
 * Status for file change items
 */
export const PatchApplyStatusSchema = z.enum(["completed", "failed"]);

/**
 * Kind of file change
 */
export const PatchChangeKindSchema = z.enum(["add", "delete", "update"]);

/**
 * Individual file update change
 */
export const FileUpdateChangeSchema = z.object({
	path: z.string(),
	kind: PatchChangeKindSchema,
});

/**
 * File change item - represents file modifications
 *
 * Example:
 * ```json
 * {
 *   "id": "file_123",
 *   "type": "file_change",
 *   "changes": [{"path": "src/index.ts", "kind": "update"}],
 *   "status": "completed"
 * }
 * ```
 */
export const FileChangeItemSchema = z.object({
	id: z.string(),
	type: z.literal("file_change"),
	changes: z.array(FileUpdateChangeSchema),
	status: PatchApplyStatusSchema,
});

/**
 * Status for MCP tool call items
 */
export const McpToolCallStatusSchema = z.enum([
	"in_progress",
	"completed",
	"failed",
]);

/**
 * MCP content block in tool call results
 */
export const McpContentBlockSchema = z.object({
	type: z.string(),
	text: z.string().optional(),
	data: z.unknown().optional(),
	mimeType: z.string().optional(),
});

/**
 * MCP tool call result structure
 */
export const McpToolCallResultSchema = z.object({
	content: z.array(McpContentBlockSchema).optional(),
	structured_content: z.unknown().optional(),
});

/**
 * MCP tool call error structure
 */
export const McpToolCallErrorSchema = z.object({
	message: z.string(),
});

/**
 * MCP tool call item - represents MCP tool invocations
 *
 * Example:
 * ```json
 * {
 *   "id": "mcp_123",
 *   "type": "mcp_tool_call",
 *   "server": "linear",
 *   "tool": "list_issues",
 *   "arguments": {"query": "assigned to me"},
 *   "result": {"content": [...]},
 *   "status": "completed"
 * }
 * ```
 */
export const McpToolCallItemSchema = z.object({
	id: z.string(),
	type: z.literal("mcp_tool_call"),
	server: z.string(),
	tool: z.string(),
	arguments: z.unknown(),
	result: McpToolCallResultSchema.optional(),
	error: McpToolCallErrorSchema.optional(),
	status: McpToolCallStatusSchema,
});

/**
 * Agent message item - final text response from the model
 *
 * Example:
 * ```json
 * {
 *   "id": "msg_123",
 *   "type": "agent_message",
 *   "text": "I've completed the task successfully."
 * }
 * ```
 */
export const AgentMessageItemSchema = z.object({
	id: z.string(),
	type: z.literal("agent_message"),
	text: z.string(),
});

/**
 * Reasoning item - reasoning summaries from the model
 *
 * Example:
 * ```json
 * {
 *   "id": "reason_123",
 *   "type": "reasoning",
 *   "text": "I need to first understand the codebase structure..."
 * }
 * ```
 */
export const ReasoningItemSchema = z.object({
	id: z.string(),
	type: z.literal("reasoning"),
	text: z.string(),
});

/**
 * Web search item - represents web search queries
 *
 * Example:
 * ```json
 * {
 *   "id": "search_123",
 *   "type": "web_search",
 *   "query": "TypeScript best practices"
 * }
 * ```
 */
export const WebSearchItemSchema = z.object({
	id: z.string(),
	type: z.literal("web_search"),
	query: z.string(),
});

/**
 * Todo item within a todo list
 */
export const TodoItemSchema = z.object({
	text: z.string(),
	completed: z.boolean(),
});

/**
 * Todo list item - represents task tracking
 *
 * Example:
 * ```json
 * {
 *   "id": "todo_123",
 *   "type": "todo_list",
 *   "items": [
 *     {"text": "Implement feature", "completed": true},
 *     {"text": "Write tests", "completed": false}
 *   ]
 * }
 * ```
 */
export const TodoListItemSchema = z.object({
	id: z.string(),
	type: z.literal("todo_list"),
	items: z.array(TodoItemSchema),
});

/**
 * Error item - represents error conditions
 *
 * Example:
 * ```json
 * {
 *   "id": "err_123",
 *   "type": "error",
 *   "message": "Failed to execute command"
 * }
 * ```
 */
export const ErrorItemSchema = z.object({
	id: z.string(),
	type: z.literal("error"),
	message: z.string(),
});

/**
 * Union of all thread item types
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

// ============================================================================
// Thread Event Schemas
// ============================================================================

/**
 * Usage statistics from a turn
 */
export const UsageSchema = z.object({
	input_tokens: z.number(),
	cached_input_tokens: z.number().optional(),
	output_tokens: z.number(),
});

/**
 * Thread error structure
 */
export const ThreadErrorSchema = z.object({
	message: z.string(),
});

/**
 * Thread started event - signals beginning of a new thread
 *
 * Example:
 * ```json
 * {"type": "thread.started", "thread_id": "thread_abc123"}
 * ```
 */
export const ThreadStartedEventSchema = z.object({
	type: z.literal("thread.started"),
	thread_id: z.string(),
});

/**
 * Turn started event - model begins processing
 *
 * Example:
 * ```json
 * {"type": "turn.started"}
 * ```
 */
export const TurnStartedEventSchema = z.object({
	type: z.literal("turn.started"),
});

/**
 * Turn completed event - model finishes with usage stats
 *
 * Example:
 * ```json
 * {"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 50}}
 * ```
 */
export const TurnCompletedEventSchema = z.object({
	type: z.literal("turn.completed"),
	usage: UsageSchema,
});

/**
 * Turn failed event - processing failure
 *
 * Example:
 * ```json
 * {"type": "turn.failed", "error": {"message": "Rate limit exceeded"}}
 * ```
 */
export const TurnFailedEventSchema = z.object({
	type: z.literal("turn.failed"),
	error: ThreadErrorSchema,
});

/**
 * Item started event - a new thread item begins
 *
 * Example:
 * ```json
 * {"type": "item.started", "item": {...}}
 * ```
 */
export const ItemStartedEventSchema = z.object({
	type: z.literal("item.started"),
	item: ThreadItemSchema,
});

/**
 * Item updated event - an existing item receives updates
 *
 * Example:
 * ```json
 * {"type": "item.updated", "item": {...}}
 * ```
 */
export const ItemUpdatedEventSchema = z.object({
	type: z.literal("item.updated"),
	item: ThreadItemSchema,
});

/**
 * Item completed event - item reaches terminal state
 *
 * Example:
 * ```json
 * {"type": "item.completed", "item": {...}}
 * ```
 */
export const ItemCompletedEventSchema = z.object({
	type: z.literal("item.completed"),
	item: ThreadItemSchema,
});

/**
 * Thread error event - unrecoverable error in the event stream
 *
 * Example:
 * ```json
 * {"type": "error", "message": "Connection lost"}
 * ```
 */
export const ThreadErrorEventSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});

/**
 * Union of all thread event types
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

// ============================================================================
// Type Exports (derived from Zod schemas)
// ============================================================================

// Thread item types
export type CommandExecutionStatus = z.infer<
	typeof CommandExecutionStatusSchema
>;
export type CommandExecutionItem = z.infer<typeof CommandExecutionItemSchema>;
export type PatchApplyStatus = z.infer<typeof PatchApplyStatusSchema>;
export type PatchChangeKind = z.infer<typeof PatchChangeKindSchema>;
export type FileUpdateChange = z.infer<typeof FileUpdateChangeSchema>;
export type FileChangeItem = z.infer<typeof FileChangeItemSchema>;
export type McpToolCallStatus = z.infer<typeof McpToolCallStatusSchema>;
export type McpContentBlock = z.infer<typeof McpContentBlockSchema>;
export type McpToolCallResult = z.infer<typeof McpToolCallResultSchema>;
export type McpToolCallError = z.infer<typeof McpToolCallErrorSchema>;
export type McpToolCallItem = z.infer<typeof McpToolCallItemSchema>;
export type AgentMessageItem = z.infer<typeof AgentMessageItemSchema>;
export type ReasoningItem = z.infer<typeof ReasoningItemSchema>;
export type WebSearchItem = z.infer<typeof WebSearchItemSchema>;
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type TodoListItem = z.infer<typeof TodoListItemSchema>;
export type ErrorItem = z.infer<typeof ErrorItemSchema>;
export type ThreadItem = z.infer<typeof ThreadItemSchema>;

// Thread event types
export type Usage = z.infer<typeof UsageSchema>;
export type ThreadError = z.infer<typeof ThreadErrorSchema>;
export type ThreadStartedEvent = z.infer<typeof ThreadStartedEventSchema>;
export type TurnStartedEvent = z.infer<typeof TurnStartedEventSchema>;
export type TurnCompletedEvent = z.infer<typeof TurnCompletedEventSchema>;
export type TurnFailedEvent = z.infer<typeof TurnFailedEventSchema>;
export type ItemStartedEvent = z.infer<typeof ItemStartedEventSchema>;
export type ItemUpdatedEvent = z.infer<typeof ItemUpdatedEventSchema>;
export type ItemCompletedEvent = z.infer<typeof ItemCompletedEventSchema>;
export type ThreadErrorEvent = z.infer<typeof ThreadErrorEventSchema>;
export type ThreadEvent = z.infer<typeof ThreadEventSchema>;

/**
 * Type for tool input parameters used by CodexMessageFormatter
 *
 * This is a permissive type that allows accessing any property while still
 * being more explicit than `any`. It represents tool arguments from MCP calls
 * and command execution parameters.
 */
export type FormatterToolInput = Record<string, unknown>;

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Parse and validate a Codex thread event from a JSON string
 *
 * @param jsonString - Raw JSON string from Codex CLI stdout
 * @returns Validated and typed ThreadEvent
 * @throws ZodError if validation fails
 */
export function parseCodexEvent(jsonString: string): ThreadEvent {
	const parsed = JSON.parse(jsonString);
	return ThreadEventSchema.parse(parsed);
}

/**
 * Safely parse a Codex thread event, returning null on failure
 *
 * @param jsonString - Raw JSON string from Codex CLI stdout
 * @returns Validated ThreadEvent or null if parsing/validation fails
 */
export function safeParseCodexEvent(jsonString: string): ThreadEvent | null {
	try {
		const parsed = JSON.parse(jsonString);
		const result = ThreadEventSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guards for thread events
 */
export function isThreadStartedEvent(
	event: ThreadEvent,
): event is ThreadStartedEvent {
	return event.type === "thread.started";
}

export function isTurnStartedEvent(
	event: ThreadEvent,
): event is TurnStartedEvent {
	return event.type === "turn.started";
}

export function isTurnCompletedEvent(
	event: ThreadEvent,
): event is TurnCompletedEvent {
	return event.type === "turn.completed";
}

export function isTurnFailedEvent(
	event: ThreadEvent,
): event is TurnFailedEvent {
	return event.type === "turn.failed";
}

export function isItemStartedEvent(
	event: ThreadEvent,
): event is ItemStartedEvent {
	return event.type === "item.started";
}

export function isItemUpdatedEvent(
	event: ThreadEvent,
): event is ItemUpdatedEvent {
	return event.type === "item.updated";
}

export function isItemCompletedEvent(
	event: ThreadEvent,
): event is ItemCompletedEvent {
	return event.type === "item.completed";
}

export function isThreadErrorEvent(
	event: ThreadEvent,
): event is ThreadErrorEvent {
	return event.type === "error";
}

/**
 * Type guards for thread items
 */
export function isAgentMessageItem(item: ThreadItem): item is AgentMessageItem {
	return item.type === "agent_message";
}

export function isReasoningItem(item: ThreadItem): item is ReasoningItem {
	return item.type === "reasoning";
}

export function isCommandExecutionItem(
	item: ThreadItem,
): item is CommandExecutionItem {
	return item.type === "command_execution";
}

export function isFileChangeItem(item: ThreadItem): item is FileChangeItem {
	return item.type === "file_change";
}

export function isMcpToolCallItem(item: ThreadItem): item is McpToolCallItem {
	return item.type === "mcp_tool_call";
}

export function isWebSearchItem(item: ThreadItem): item is WebSearchItem {
	return item.type === "web_search";
}

export function isTodoListItem(item: ThreadItem): item is TodoListItem {
	return item.type === "todo_list";
}

export function isErrorItem(item: ThreadItem): item is ErrorItem {
	return item.type === "error";
}

/**
 * Extract thread ID from a thread.started event
 *
 * @param event - Thread event
 * @returns Thread ID if event is thread.started, null otherwise
 */
export function extractThreadId(event: ThreadEvent): string | null {
	if (isThreadStartedEvent(event)) {
		return event.thread_id;
	}
	return null;
}
