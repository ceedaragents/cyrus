/**
 * Zod Schemas for Gemini CLI Stream Events
 *
 * These schemas provide runtime validation for Gemini CLI's stream-json output format.
 * TypeScript types are derived from these schemas using z.infer<> for type safety.
 *
 * Note: The official `@google/gemini-cli-core` package (v0.17.1) exports TypeScript
 * interfaces for these event types. However, we use custom Zod schemas because:
 * 1. Runtime validation - official types are TypeScript-only, no runtime checks
 * 2. Detailed tool typing - official uses `Record<string, unknown>` for tool params
 * 3. Type guards and parsers - utility functions for narrowing event/tool types
 * 4. Tool result typing - result schemas typed by tool_id prefix
 *
 * Our schemas are structurally compatible with the official types.
 *
 * Official type definitions (pinned to v0.17.0):
 * @see https://github.com/google-gemini/gemini-cli/blob/v0.17.0/packages/core/src/output/types.ts
 * @see https://www.npmjs.com/package/@google/gemini-cli-core/v/0.17.0
 *
 * Documentation:
 * @see https://github.com/google-gemini/gemini-cli/blob/v0.17.0/docs/cli/headless.md
 */

import { z } from "zod";

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * ISO 8601 timestamp string (e.g., "2025-11-25T03:27:51.000Z")
 */
const TimestampSchema = z.string().datetime({ offset: true });

// ============================================================================
// Init Event Schema
// ============================================================================

/**
 * Session initialization event
 *
 * Example:
 * ```json
 * {"type":"init","timestamp":"2025-11-25T03:27:51.000Z","session_id":"c25acda3-b51f-41f9-9bc5-954c70c17bf4","model":"auto"}
 * ```
 */
export const GeminiInitEventSchema = z.object({
	type: z.literal("init"),
	timestamp: TimestampSchema,
	session_id: z.string().uuid(),
	model: z.string(),
});

// ============================================================================
// Message Event Schema
// ============================================================================

/**
 * User or assistant message event
 *
 * When delta is true, this message should be accumulated with previous delta messages
 * of the same role. The caller (GeminiRunner) is responsible for accumulating delta messages.
 *
 * Examples:
 * ```json
 * {"type":"message","timestamp":"2025-11-25T03:27:51.001Z","role":"user","content":"What is 2 + 2?"}
 * {"type":"message","timestamp":"2025-11-25T03:28:05.256Z","role":"assistant","content":"2 + 2 = 4.","delta":true}
 * ```
 */
export const GeminiMessageEventSchema = z.object({
	type: z.literal("message"),
	timestamp: TimestampSchema,
	role: z.enum(["user", "assistant"]),
	content: z.string(),
	delta: z.boolean().optional(),
});

// ============================================================================
// Tool Parameter Schemas
// ============================================================================

/**
 * Parameters for the read_file tool
 *
 * Example:
 * ```json
 * {"file_path":"package.json"}
 * {"file_path":"app/mcts.py"}
 * ```
 */
export const ReadFileParametersSchema = z.object({
	file_path: z.string(),
});

/**
 * Parameters for the write_file tool
 *
 * Example:
 * ```json
 * {"file_path":"tests/test_snake.py","content":"import unittest\n..."}
 * ```
 */
export const WriteFileParametersSchema = z.object({
	file_path: z.string(),
	content: z.string(),
});

/**
 * Parameters for the list_directory tool
 *
 * Example:
 * ```json
 * {"dir_path":"."}
 * {"dir_path":"./src"}
 * ```
 */
export const ListDirectoryParametersSchema = z.object({
	dir_path: z.string(),
});

/**
 * Parameters for the search_file_content tool
 *
 * Example:
 * ```json
 * {"pattern":"(TODO|FIXME)"}
 * {"pattern":"function.*export"}
 * ```
 */
export const SearchFileContentParametersSchema = z.object({
	pattern: z.string(),
});

/**
 * Parameters for the run_shell_command tool
 *
 * Example:
 * ```json
 * {"command":"/usr/bin/python3 -m pytest tests/"}
 * {"command":"git status"}
 * {"command":"flake8 --version"}
 * ```
 */
export const RunShellCommandParametersSchema = z.object({
	command: z.string(),
});

/**
 * Todo item for the write_todos tool
 */
export const TodoItemSchema = z.object({
	description: z.string(),
	status: z.enum(["pending", "in_progress", "completed"]).optional(),
});

/**
 * Parameters for the write_todos tool
 *
 * Example:
 * ```json
 * {"todos":[{"description":"Explore codebase to identify bugs","status":"in_progress"},{"description":"Fix coordinate system","status":"pending"}]}
 * ```
 */
export const WriteTodosParametersSchema = z.object({
	todos: z.array(TodoItemSchema),
});

/**
 * Parameters for the replace tool (AI-powered code editing)
 *
 * Can use either instruction-based or literal string replacement:
 * - instruction: Natural language description of the change
 * - old_string/new_string: Literal string replacement
 *
 * Examples:
 * Instruction-based:
 * ```json
 * {"instruction":"Modify get_other_snake_heads to return a list instead of dict","file_path":"app/mcts.py"}
 * {"instruction":"Clean up comments in is_terminal.","file_path":"app/mcts.py"}
 * ```
 *
 * Literal replacement:
 * ```json
 * {"file_path":"app/mcts.py","old_string":"    # Simulate other snakes' moves\\n    othe","new_string":"    # Track enemy positions\\n    enemy"}
 * ```
 */
export const ReplaceParametersSchema = z.object({
	instruction: z.string().optional(),
	file_path: z.string().optional(),
	old_string: z.string().optional(),
	new_string: z.string().optional(),
});

/**
 * Union of all known tool parameter schemas
 */
export const GeminiToolParametersSchema = z.union([
	ReadFileParametersSchema,
	WriteFileParametersSchema,
	ListDirectoryParametersSchema,
	SearchFileContentParametersSchema,
	RunShellCommandParametersSchema,
	WriteTodosParametersSchema,
	ReplaceParametersSchema,
]);

// Type exports for tool parameters
export type ReadFileParameters = z.infer<typeof ReadFileParametersSchema>;
export type WriteFileParameters = z.infer<typeof WriteFileParametersSchema>;
export type ListDirectoryParameters = z.infer<
	typeof ListDirectoryParametersSchema
>;
export type SearchFileContentParameters = z.infer<
	typeof SearchFileContentParametersSchema
>;
export type RunShellCommandParameters = z.infer<
	typeof RunShellCommandParametersSchema
>;
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type WriteTodosParameters = z.infer<typeof WriteTodosParametersSchema>;
export type ReplaceParameters = z.infer<typeof ReplaceParametersSchema>;
export type GeminiToolParameters = z.infer<typeof GeminiToolParametersSchema>;

/**
 * Type for tool input parameters used by GeminiMessageFormatter
 *
 * This is a permissive type that allows accessing any property while still
 * being more explicit than `any`. It represents the union of:
 * - Known Gemini CLI tool parameters (read_file, write_file, etc.)
 * - Unknown tool parameters from MCP or future tools
 *
 * We use Record<string, unknown> instead of a discriminated union because:
 * 1. The formatter uses switch on toolName (string), not on input structure
 * 2. Properties are accessed dynamically based on the tool type
 * 3. TypeScript can't narrow Record types based on external string values
 *
 * Known properties that may exist (based on Gemini tools):
 * - file_path: string (read_file, write_file, replace)
 * - content: string (write_file)
 * - dir_path: string (list_directory)
 * - pattern: string (search_file_content)
 * - command: string (run_shell_command)
 * - description: string (run_shell_command, todos)
 * - todos: Array<{description, status}> (write_todos)
 * - instruction: string (replace)
 * - old_string: string (replace)
 * - new_string: string (replace)
 */
export type FormatterToolInput = Record<string, unknown>;

// ============================================================================
// Typed Tool Use Event Schemas (for specific tools)
// ============================================================================

/**
 * Base schema for tool use events with timestamp and tool_id
 */
const ToolUseBaseSchema = z.object({
	type: z.literal("tool_use"),
	timestamp: TimestampSchema,
	tool_id: z.string(),
});

/**
 * Typed read_file tool use event
 */
export const ReadFileToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.literal("read_file"),
	parameters: ReadFileParametersSchema,
});

/**
 * Typed write_file tool use event
 */
export const WriteFileToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.literal("write_file"),
	parameters: WriteFileParametersSchema,
});

/**
 * Typed list_directory tool use event
 */
export const ListDirectoryToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.literal("list_directory"),
	parameters: ListDirectoryParametersSchema,
});

/**
 * Typed search_file_content tool use event
 */
export const SearchFileContentToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.literal("search_file_content"),
	parameters: SearchFileContentParametersSchema,
});

/**
 * Typed run_shell_command tool use event
 */
export const RunShellCommandToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.literal("run_shell_command"),
	parameters: RunShellCommandParametersSchema,
});

/**
 * Typed write_todos tool use event
 */
export const WriteTodosToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.literal("write_todos"),
	parameters: WriteTodosParametersSchema,
});

/**
 * Typed replace tool use event
 */
export const ReplaceToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.literal("replace"),
	parameters: ReplaceParametersSchema,
});

/**
 * Unknown tool use event (for tools not explicitly typed)
 */
export const UnknownToolUseEventSchema = ToolUseBaseSchema.extend({
	tool_name: z.string(),
	parameters: z.record(z.unknown()),
});

// Type exports for typed tool use events
export type ReadFileToolUseEvent = z.infer<typeof ReadFileToolUseEventSchema>;
export type WriteFileToolUseEvent = z.infer<typeof WriteFileToolUseEventSchema>;
export type ListDirectoryToolUseEvent = z.infer<
	typeof ListDirectoryToolUseEventSchema
>;
export type SearchFileContentToolUseEvent = z.infer<
	typeof SearchFileContentToolUseEventSchema
>;
export type RunShellCommandToolUseEvent = z.infer<
	typeof RunShellCommandToolUseEventSchema
>;
export type WriteTodosToolUseEvent = z.infer<
	typeof WriteTodosToolUseEventSchema
>;
export type ReplaceToolUseEvent = z.infer<typeof ReplaceToolUseEventSchema>;
export type UnknownToolUseEvent = z.infer<typeof UnknownToolUseEventSchema>;

// ============================================================================
// Tool Use Event Schema
// ============================================================================

/**
 * Tool use event - represents a tool invocation by the model
 *
 * The tool_id is assigned by Gemini CLI and follows the format:
 * `{tool_name}-{timestamp_ms}-{random_hex}`
 *
 * Example:
 * ```json
 * {"type":"tool_use","timestamp":"2025-11-25T03:27:54.691Z","tool_name":"list_directory","tool_id":"list_directory-1764041274691-eabd3cbcdee66","parameters":{"dir_path":"."}}
 * {"type":"tool_use","timestamp":"2025-11-25T03:27:54.691Z","tool_name":"read_file","tool_id":"read_file-1764041274691-e1084c2fd73dc","parameters":{"file_path":"test.ts"}}
 * ```
 */
export const GeminiToolUseEventSchema = z.object({
	type: z.literal("tool_use"),
	timestamp: TimestampSchema,
	tool_name: z.string(),
	tool_id: z.string(),
	parameters: z.record(z.unknown()),
});

// ============================================================================
// Tool Result Event Schema
// ============================================================================

/**
 * Error information in tool result
 */
const ToolResultErrorSchema = z.object({
	type: z.string().optional(),
	message: z.string(),
	code: z.string().optional(),
});

/**
 * Tool result event - the result of a tool execution
 *
 * Uses tool_id (not tool_name) to match the corresponding tool_use event.
 * Contains either output (success) or error (failure).
 *
 * Examples:
 * Success:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-25T03:27:54.724Z","tool_id":"list_directory-1764041274691-eabd3cbcdee66","status":"success","output":"Listed 2 item(s)."}
 * ```
 *
 * Error:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-25T03:28:13.200Z","tool_id":"read_file-1764041293170-fd5f6da4bd4a1","status":"error","output":"File path must be within...","error":{"type":"invalid_tool_params","message":"File path must be within..."}}
 * ```
 */
export const GeminiToolResultEventSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string(),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

// ============================================================================
// Typed Tool Result Schemas
// ============================================================================

/**
 * Tool result output types based on the originating tool
 *
 * These describe the expected output format for each tool type.
 * The tool_id prefix indicates which tool generated the result.
 */

/**
 * read_file tool result - returns empty string on success (file content is in context)
 *
 * Example:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T20:12:40.148Z","tool_id":"read_file-1764015160012-767cb93e436f3","status":"success","output":""}
 * ```
 */
export const ReadFileToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string().startsWith("read_file-"),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

/**
 * write_file tool result - returns empty output on success
 *
 * Example:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T20:13:55.193Z","tool_id":"write_file-1764015234674-0581b9629931a","status":"success"}
 * ```
 */
export const WriteFileToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string().startsWith("write_file-"),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

/**
 * list_directory tool result - returns summary of items found
 *
 * Example:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T20:12:53.273Z","tool_id":"list_directory-1764015173255-396a90dd79fa6","status":"success","output":"Listed 4 item(s). (1 ignored)"}
 * ```
 */
export const ListDirectoryToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string().startsWith("list_directory-"),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

/**
 * search_file_content tool result - returns match info or "No matches found"
 *
 * Example:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T20:12:40.196Z","tool_id":"search_file_content-1764015160072-c1e0f530591f6","status":"success","output":"No matches found"}
 * ```
 */
export const SearchFileContentToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string().startsWith("search_file_content-"),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

/**
 * run_shell_command tool result - returns command output
 *
 * Examples:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T20:13:15.060Z","tool_id":"run_shell_command-1764015194969-e79bcda1d6e9","status":"success","output":"/usr/bin/python3: No module named pytest"}
 * {"type":"tool_result","timestamp":"2025-11-24T20:19:49.805Z","tool_id":"run_shell_command-1764015589776-b029531d6e71e","status":"success","output":"node"}
 * ```
 */
export const RunShellCommandToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string().startsWith("run_shell_command-"),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

/**
 * write_todos tool result - returns empty output on success, or error if invalid
 *
 * Examples:
 * Success:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T19:29:56.539Z","tool_id":"write_todos-1764012596037-37082c9903ce7","status":"success"}
 * ```
 *
 * Error (multiple in_progress):
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T19:37:13.465Z","tool_id":"write_todos-1764013031965-70bbdf7c35856","status":"error","output":"Invalid parameters: Only one task can be \"in_progress\" at a time."}
 * ```
 */
export const WriteTodosToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string().startsWith("write_todos-"),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

/**
 * replace tool result - returns empty output on success
 *
 * Example:
 * ```json
 * {"type":"tool_result","timestamp":"2025-11-24T19:31:12.165Z","tool_id":"replace-1764012672140-c56f46960e14a","status":"success"}
 * ```
 */
export const ReplaceToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: TimestampSchema,
	tool_id: z.string().startsWith("replace-"),
	status: z.enum(["success", "error"]),
	output: z.string().optional(),
	error: ToolResultErrorSchema.optional(),
});

// Type exports for tool results
export type ReadFileToolResult = z.infer<typeof ReadFileToolResultSchema>;
export type WriteFileToolResult = z.infer<typeof WriteFileToolResultSchema>;
export type ListDirectoryToolResult = z.infer<
	typeof ListDirectoryToolResultSchema
>;
export type SearchFileContentToolResult = z.infer<
	typeof SearchFileContentToolResultSchema
>;
export type RunShellCommandToolResult = z.infer<
	typeof RunShellCommandToolResultSchema
>;
export type WriteTodosToolResult = z.infer<typeof WriteTodosToolResultSchema>;
export type ReplaceToolResult = z.infer<typeof ReplaceToolResultSchema>;

/**
 * Type guards for tool results based on tool_id prefix
 */
export function isReadFileToolResult(
	event: GeminiToolResultEvent,
): event is ReadFileToolResult {
	return event.tool_id.startsWith("read_file-");
}

export function isWriteFileToolResult(
	event: GeminiToolResultEvent,
): event is WriteFileToolResult {
	return event.tool_id.startsWith("write_file-");
}

export function isListDirectoryToolResult(
	event: GeminiToolResultEvent,
): event is ListDirectoryToolResult {
	return event.tool_id.startsWith("list_directory-");
}

export function isSearchFileContentToolResult(
	event: GeminiToolResultEvent,
): event is SearchFileContentToolResult {
	return event.tool_id.startsWith("search_file_content-");
}

export function isRunShellCommandToolResult(
	event: GeminiToolResultEvent,
): event is RunShellCommandToolResult {
	return event.tool_id.startsWith("run_shell_command-");
}

export function isWriteTodosToolResult(
	event: GeminiToolResultEvent,
): event is WriteTodosToolResult {
	return event.tool_id.startsWith("write_todos-");
}

export function isReplaceToolResult(
	event: GeminiToolResultEvent,
): event is ReplaceToolResult {
	return event.tool_id.startsWith("replace-");
}

/**
 * Extract tool name from tool_id
 *
 * Tool IDs follow the format: `{tool_name}-{timestamp_ms}-{random_hex}`
 *
 * @param toolId - The tool_id from a tool_use or tool_result event
 * @returns The tool name, or null if format is invalid
 */
export function extractToolNameFromId(toolId: string): string | null {
	// Tool ID format: {tool_name}-{timestamp_ms}-{random_hex}
	// Split on hyphen and rejoin all but last two parts
	const parts = toolId.split("-");
	if (parts.length < 3) {
		return null;
	}
	// Remove the timestamp and random hex (last 2 parts)
	return parts.slice(0, -2).join("-");
}

// ============================================================================
// Error Event Schema
// ============================================================================

/**
 * Non-fatal error event
 *
 * Example:
 * ```json
 * {"type":"error","timestamp":"2025-11-25T03:28:00.000Z","message":"Rate limit exceeded","code":429}
 * ```
 */
export const GeminiErrorEventSchema = z.object({
	type: z.literal("error"),
	timestamp: TimestampSchema,
	message: z.string(),
	code: z.number().optional(),
});

// ============================================================================
// Result Event Schema
// ============================================================================

/**
 * Statistics from the Gemini session
 */
const ResultStatsSchema = z.object({
	total_tokens: z.number().optional(),
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	duration_ms: z.number().optional(),
	tool_calls: z.number().optional(),
});

/**
 * Error information in result event
 */
const ResultErrorSchema = z.object({
	type: z.string(),
	message: z.string(),
	code: z.number().optional(),
});

/**
 * Final result event with session statistics
 *
 * Examples:
 * Success:
 * ```json
 * {"type":"result","timestamp":"2025-11-25T03:28:05.262Z","status":"success","stats":{"total_tokens":8064,"input_tokens":7854,"output_tokens":58,"duration_ms":2534,"tool_calls":0}}
 * ```
 *
 * Error:
 * ```json
 * {"type":"result","timestamp":"2025-11-25T03:27:54.727Z","status":"error","error":{"type":"FatalTurnLimitedError","message":"Reached max session turns..."},"stats":{"total_tokens":8255,"input_tokens":7862,"output_tokens":90,"duration_ms":0,"tool_calls":2}}
 * ```
 */
export const GeminiResultEventSchema = z.object({
	type: z.literal("result"),
	timestamp: TimestampSchema,
	status: z.enum(["success", "error"]),
	stats: ResultStatsSchema.optional(),
	error: ResultErrorSchema.optional(),
});

// ============================================================================
// Union Schema for All Events
// ============================================================================

/**
 * Discriminated union of all Gemini stream events
 *
 * Uses the 'type' field as the discriminator for type narrowing.
 */
export const GeminiStreamEventSchema = z.discriminatedUnion("type", [
	GeminiInitEventSchema,
	GeminiMessageEventSchema,
	GeminiToolUseEventSchema,
	GeminiToolResultEventSchema,
	GeminiErrorEventSchema,
	GeminiResultEventSchema,
]);

// ============================================================================
// Type Exports (derived from Zod schemas)
// ============================================================================

export type GeminiInitEvent = z.infer<typeof GeminiInitEventSchema>;
export type GeminiMessageEvent = z.infer<typeof GeminiMessageEventSchema>;
export type GeminiToolUseEvent = z.infer<typeof GeminiToolUseEventSchema>;
export type GeminiToolResultEvent = z.infer<typeof GeminiToolResultEventSchema>;
export type GeminiErrorEvent = z.infer<typeof GeminiErrorEventSchema>;
export type GeminiResultEvent = z.infer<typeof GeminiResultEventSchema>;
export type GeminiStreamEvent = z.infer<typeof GeminiStreamEventSchema>;

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Parse and validate a Gemini stream event from a JSON string
 *
 * @param jsonString - Raw JSON string from Gemini CLI stdout
 * @returns Validated and typed GeminiStreamEvent
 * @throws ZodError if validation fails
 */
export function parseGeminiStreamEvent(jsonString: string): GeminiStreamEvent {
	const parsed = JSON.parse(jsonString);
	return GeminiStreamEventSchema.parse(parsed);
}

/**
 * Safely parse a Gemini stream event, returning null on failure
 *
 * @param jsonString - Raw JSON string from Gemini CLI stdout
 * @returns Validated GeminiStreamEvent or null if parsing/validation fails
 */
export function safeParseGeminiStreamEvent(
	jsonString: string,
): GeminiStreamEvent | null {
	try {
		const parsed = JSON.parse(jsonString);
		const result = GeminiStreamEventSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

/**
 * Type guard for checking if an event is a specific type
 */
export function isGeminiInitEvent(
	event: GeminiStreamEvent,
): event is GeminiInitEvent {
	return event.type === "init";
}

export function isGeminiMessageEvent(
	event: GeminiStreamEvent,
): event is GeminiMessageEvent {
	return event.type === "message";
}

export function isGeminiToolUseEvent(
	event: GeminiStreamEvent,
): event is GeminiToolUseEvent {
	return event.type === "tool_use";
}

export function isGeminiToolResultEvent(
	event: GeminiStreamEvent,
): event is GeminiToolResultEvent {
	return event.type === "tool_result";
}

export function isGeminiErrorEvent(
	event: GeminiStreamEvent,
): event is GeminiErrorEvent {
	return event.type === "error";
}

export function isGeminiResultEvent(
	event: GeminiStreamEvent,
): event is GeminiResultEvent {
	return event.type === "result";
}

// ============================================================================
// Typed Tool Use Parsing Utilities
// ============================================================================

/**
 * Parse a tool use event as a specific typed tool
 *
 * @param event - A GeminiToolUseEvent to parse
 * @returns The typed tool use event, or null if the tool name doesn't match or validation fails
 */
export function parseAsReadFileTool(
	event: GeminiToolUseEvent,
): ReadFileToolUseEvent | null {
	const result = ReadFileToolUseEventSchema.safeParse(event);
	return result.success ? result.data : null;
}

export function parseAsWriteFileTool(
	event: GeminiToolUseEvent,
): WriteFileToolUseEvent | null {
	const result = WriteFileToolUseEventSchema.safeParse(event);
	return result.success ? result.data : null;
}

export function parseAsListDirectoryTool(
	event: GeminiToolUseEvent,
): ListDirectoryToolUseEvent | null {
	const result = ListDirectoryToolUseEventSchema.safeParse(event);
	return result.success ? result.data : null;
}

export function parseAsSearchFileContentTool(
	event: GeminiToolUseEvent,
): SearchFileContentToolUseEvent | null {
	const result = SearchFileContentToolUseEventSchema.safeParse(event);
	return result.success ? result.data : null;
}

export function parseAsRunShellCommandTool(
	event: GeminiToolUseEvent,
): RunShellCommandToolUseEvent | null {
	const result = RunShellCommandToolUseEventSchema.safeParse(event);
	return result.success ? result.data : null;
}

export function parseAsWriteTodosTool(
	event: GeminiToolUseEvent,
): WriteTodosToolUseEvent | null {
	const result = WriteTodosToolUseEventSchema.safeParse(event);
	return result.success ? result.data : null;
}

export function parseAsReplaceTool(
	event: GeminiToolUseEvent,
): ReplaceToolUseEvent | null {
	const result = ReplaceToolUseEventSchema.safeParse(event);
	return result.success ? result.data : null;
}

/**
 * Type guard for specific tool types based on tool_name
 */
export function isReadFileTool(
	event: GeminiToolUseEvent,
): event is ReadFileToolUseEvent {
	return (
		event.tool_name === "read_file" &&
		ReadFileParametersSchema.safeParse(event.parameters).success
	);
}

export function isWriteFileTool(
	event: GeminiToolUseEvent,
): event is WriteFileToolUseEvent {
	return (
		event.tool_name === "write_file" &&
		WriteFileParametersSchema.safeParse(event.parameters).success
	);
}

export function isListDirectoryTool(
	event: GeminiToolUseEvent,
): event is ListDirectoryToolUseEvent {
	return (
		event.tool_name === "list_directory" &&
		ListDirectoryParametersSchema.safeParse(event.parameters).success
	);
}

export function isSearchFileContentTool(
	event: GeminiToolUseEvent,
): event is SearchFileContentToolUseEvent {
	return (
		event.tool_name === "search_file_content" &&
		SearchFileContentParametersSchema.safeParse(event.parameters).success
	);
}

export function isRunShellCommandTool(
	event: GeminiToolUseEvent,
): event is RunShellCommandToolUseEvent {
	return (
		event.tool_name === "run_shell_command" &&
		RunShellCommandParametersSchema.safeParse(event.parameters).success
	);
}

export function isWriteTodosTool(
	event: GeminiToolUseEvent,
): event is WriteTodosToolUseEvent {
	return (
		event.tool_name === "write_todos" &&
		WriteTodosParametersSchema.safeParse(event.parameters).success
	);
}

export function isReplaceTool(
	event: GeminiToolUseEvent,
): event is ReplaceToolUseEvent {
	return (
		event.tool_name === "replace" &&
		ReplaceParametersSchema.safeParse(event.parameters).success
	);
}
