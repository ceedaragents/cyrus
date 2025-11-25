/**
 * Zod Schemas for Gemini CLI Stream Events
 *
 * These schemas provide runtime validation for Gemini CLI's stream-json output format.
 * TypeScript types are derived from these schemas using z.infer<> for type safety.
 *
 * Reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
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
