import crypto from "node:crypto";
import type {
	SDKAssistantMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import type {
	EventMessagePartUpdated,
	EventMessageUpdated,
	EventPermissionUpdated,
	EventSessionError,
	EventSessionIdle,
	OpenCodeEvent,
} from "./types.js";

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * Generate a UUID string that satisfies the `\`${string}-${string}-${string}-${string}-${string}\`` pattern.
 * Using `as` cast since crypto.randomUUID() always returns a valid UUID.
 */
function newUUID(): `${string}-${string}-${string}-${string}-${string}` {
	return crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
}

/**
 * Build an SDKAssistantMessage carrying a single text block.
 */
export function buildAssistantTextMessage(
	text: string,
	messageId: string = crypto.randomUUID(),
	model: string = "opencode",
): SDKAssistantMessage {
	const contentBlocks = [
		{ type: "text", text },
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		type: "assistant",
		message: {
			id: messageId,
			type: "message",
			role: "assistant",
			content: contentBlocks,
			model,
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation: null,
				inference_geo: null,
				iterations: null,
				server_tool_use: null,
				service_tier: null,
				speed: null,
			},
			container: null,
			context_management: null,
		} as unknown as SDKAssistantMessage["message"],
		parent_tool_use_id: null,
		uuid: newUUID(),
		session_id: "",
	};
}

/**
 * Build an SDKAssistantMessage carrying a tool_use block.
 */
export function buildAssistantToolUseMessage(
	toolUseId: string,
	toolName: string,
	toolInput: Record<string, unknown>,
	messageId: string = crypto.randomUUID(),
	model: string = "opencode",
): SDKAssistantMessage {
	const contentBlocks = [
		{
			type: "tool_use",
			id: toolUseId,
			name: toolName,
			input: toolInput,
		},
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		type: "assistant",
		message: {
			id: messageId,
			type: "message",
			role: "assistant",
			content: contentBlocks,
			model,
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation: null,
				inference_geo: null,
				iterations: null,
				server_tool_use: null,
				service_tier: null,
				speed: null,
			},
			container: null,
			context_management: null,
		} as unknown as SDKAssistantMessage["message"],
		parent_tool_use_id: null,
		uuid: newUUID(),
		session_id: "",
	};
}

/**
 * Build an SDKUserMessage carrying a tool_result block.
 */
export function buildUserToolResultMessage(
	toolUseId: string,
	result: string,
	isError: boolean,
): SDKUserMessage {
	const contentBlocks = [
		{
			type: "tool_result",
			tool_use_id: toolUseId,
			content: result,
			is_error: isError,
		},
	] as unknown as SDKUserMessage["message"]["content"];

	return {
		type: "user",
		message: {
			role: "user",
			content: contentBlocks,
		} as unknown as SDKUserMessage["message"],
		parent_tool_use_id: null,
	};
}

/**
 * Build an SDKResultMessage for a successful session completion.
 * Injects the last assistant text as the result content.
 */
export function buildResultMessage(
	lastAssistantText: string | null,
	inputTokens: number,
	outputTokens: number,
	stopReason: string = "end_turn",
): SDKResultMessage {
	const resultText = lastAssistantText ?? "Session completed";
	const usage = buildUsage(inputTokens, outputTokens);

	return {
		type: "result",
		subtype: "success",
		is_error: false,
		result: resultText,
		stop_reason: stopReason,
		duration_ms: 0,
		duration_api_ms: 0,
		num_turns: 0,
		total_cost_usd: 0,
		usage,
		modelUsage: {},
		permission_denials: [],
		session_id: "",
		uuid: newUUID(),
	} as unknown as SDKResultMessage;
}

/**
 * Build an SDKResultMessage for an errored session.
 */
export function buildErrorResultMessage(
	errorMessage: string,
): SDKResultMessage {
	const usage = buildUsage(0, 0);

	return {
		type: "result",
		subtype: "error_during_execution",
		is_error: true,
		errors: [errorMessage],
		stop_reason: "error",
		duration_ms: 0,
		duration_api_ms: 0,
		num_turns: 0,
		total_cost_usd: 0,
		usage,
		modelUsage: {},
		permission_denials: [],
		session_id: "",
		uuid: newUUID(),
	} as unknown as SDKResultMessage;
}

function buildUsage(
	inputTokens: number,
	outputTokens: number,
): Record<string, unknown> {
	return {
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
		cache_creation: {
			ephemeral_1h_input_tokens: 0,
			ephemeral_5m_input_tokens: 0,
		},
		inference_geo: "unknown",
		iterations: [],
		server_tool_use: {
			web_fetch_requests: 0,
			web_search_requests: 0,
		},
		service_tier: "standard",
		speed: "standard",
	};
}

/**
 * Extract text delta from a message.part.updated event.
 * Returns the delta string only when an explicit streaming delta is present.
 *
 * OpenCode emits message.part.updated in two ways:
 *  - updatePart()      → delta is undefined; fires for ALL part updates including
 *                        user message parts (the prompt/context text).
 *  - updatePartDelta() → delta is a non-empty string; fires only for streaming
 *                        LLM response tokens (assistant text parts).
 *
 * We must only accumulate text when delta is explicitly provided so that
 * user message parts (which always have delta === undefined) are ignored and
 * never leaked into the assistant response that gets posted to Linear.
 *
 * The final "freeze" updatePart() call for an assistant part also has
 * delta === undefined, but by that point the full text has already been
 * accumulated through the preceding delta events, so skipping it is safe.
 */
export function extractTextDelta(
	event: EventMessagePartUpdated,
): string | null {
	const { part } = event.properties;
	if (part.type !== "text") {
		return null;
	}
	const delta = event.properties.delta;
	// Only process events that carry an explicit streaming delta.
	// delta === undefined means this is a full-part updatePart() event
	// (either a user message part or an assistant "freeze" event).
	if (delta === undefined) {
		return null;
	}
	// Return null for empty-string deltas — nothing to accumulate.
	return delta || null;
}

/**
 * Convert an OpenCode ToolPart (from message.part.updated) into paired
 * SDKAssistantMessage (tool_use) + SDKUserMessage (tool_result) messages.
 * Only called when the tool part's state is "completed" or "error".
 */
export function convertToolPartToMessages(
	event: EventMessagePartUpdated,
	model: string = "opencode",
): [SDKAssistantMessage, SDKUserMessage] | null {
	const { part } = event.properties;
	if (part.type !== "tool") {
		return null;
	}

	const state = part.state;
	if (state.status !== "completed" && state.status !== "error") {
		return null;
	}

	const toolUseId = part.callID || part.id;
	const toolName = part.tool;
	const toolInput = state.input as Record<string, unknown>;

	let result: string;
	let isError: boolean;

	if (state.status === "completed") {
		result = state.output || safeStringify(state);
		isError = false;
	} else {
		result = state.error || "Tool execution failed";
		isError = true;
	}

	const assistantMsg = buildAssistantToolUseMessage(
		toolUseId,
		toolName,
		toolInput,
		crypto.randomUUID(),
		model,
	);
	const userMsg = buildUserToolResultMessage(toolUseId, result, isError);

	return [assistantMsg, userMsg];
}

/**
 * Extract error message from an EventSessionError.
 */
export function extractSessionErrorMessage(event: EventSessionError): string {
	const error = event.properties.error;
	if (!error) {
		return "OpenCode session encountered an unknown error";
	}
	if ("data" in error && error.data && typeof error.data === "object") {
		const data = error.data as Record<string, unknown>;
		if (typeof data.message === "string") {
			return data.message;
		}
	}
	return `OpenCode session error: ${safeStringify(error)}`;
}

/**
 * Type guard: checks if an event is EventPermissionUpdated.
 */
export function isPermissionUpdatedEvent(
	event: OpenCodeEvent,
): event is EventPermissionUpdated {
	return event.type === "permission.updated";
}

/**
 * Type guard: checks if an event is EventSessionIdle.
 */
export function isSessionIdleEvent(
	event: OpenCodeEvent,
): event is EventSessionIdle {
	return event.type === "session.idle";
}

/**
 * Type guard: checks if an event is EventSessionError.
 */
export function isSessionErrorEvent(
	event: OpenCodeEvent,
): event is EventSessionError {
	return event.type === "session.error";
}

/**
 * Type guard: checks if an event is EventMessagePartUpdated.
 */
export function isMessagePartUpdatedEvent(
	event: OpenCodeEvent,
): event is EventMessagePartUpdated {
	return event.type === "message.part.updated";
}

/**
 * Type guard: checks if an event is EventMessageUpdated.
 */
export function isMessageUpdatedEvent(
	event: OpenCodeEvent,
): event is EventMessageUpdated {
	return event.type === "message.updated";
}
