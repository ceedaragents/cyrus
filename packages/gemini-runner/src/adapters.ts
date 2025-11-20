import type { SDKMessage, SDKUserMessage } from "cyrus-core";
import type { GeminiMessageEvent, GeminiStreamEvent } from "./types.js";

/**
 * Convert a Gemini stream event to Claude SDK message format
 *
 * This adapter maps Gemini CLI's streaming events to the Claude SDK's SDKMessage
 * format, allowing GeminiRunner to implement the IAgentRunner interface.
 *
 * NOTE: This adapter is stateless and creates a separate SDK message for each event.
 * For delta messages (message events with delta: true), the caller (GeminiRunner)
 * should accumulate multiple delta events into a single message before emitting.
 *
 * @param event - Gemini CLI stream event
 * @param sessionId - Current session ID (may be null initially)
 * @returns SDKMessage or null if event type doesn't map to a message
 */
export function geminiEventToSDKMessage(
	event: GeminiStreamEvent,
	sessionId: string | null,
): SDKMessage | null {
	switch (event.type) {
		case "message": {
			const messageEvent = event as GeminiMessageEvent;
			if (messageEvent.role === "user") {
				return {
					type: "user",
					message: {
						role: "user",
						content: messageEvent.content,
					},
					parent_tool_use_id: null,
					session_id: sessionId || "pending",
				} satisfies SDKUserMessage;
			} else {
				// Assistant message
				return {
					type: "assistant",
					message: {
						role: "assistant",
						content: messageEvent.content,
					},
					session_id: sessionId || "pending",
				} as unknown as SDKMessage;
			}
		}

		case "init":
			// Init events don't map directly to messages
			// Session ID is extracted separately
			return null;

		case "tool_use":
			// Map to Claude's tool_use format
			// NOTE: Use tool_id from Gemini CLI, not generated client-side
			return {
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: event.tool_id, // Use tool_id from Gemini CLI
							name: event.tool_name,
							input: event.parameters,
						},
					],
				},
				session_id: sessionId || "pending",
			} as unknown as SDKMessage;

		case "tool_result": {
			// Map to Claude's tool_result format
			// NOTE: Use tool_id from Gemini (matches tool_use event)
			// Handle both success (output) and error cases
			let content: string;
			let isError = false;

			if (event.status === "error" && event.error) {
				// Format error message
				content = `Error: ${event.error.message}`;
				if (event.error.code) {
					content += ` (code: ${event.error.code})`;
				}
				if (event.error.type) {
					content += ` [${event.error.type}]`;
				}
				isError = true;
			} else if (event.output !== undefined) {
				// Success case with output
				content = event.output;
			} else {
				// Fallback for empty success
				content = "Success";
			}

			return {
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: event.tool_id, // Use tool_id from Gemini CLI
							content: content,
							is_error: isError,
						},
					],
				},
				parent_tool_use_id: null,
				session_id: sessionId || "pending",
			} as unknown as SDKMessage;
		}

		case "result":
			// Final result event - contains stats but no message content
			// Real output: {"type":"result","timestamp":"...","status":"success","stats":{...}}
			if (event.status === "error" && event.error) {
				// Error result - log but return null since SDK doesn't have a direct error message type
				console.error(`[GeminiAdapter] Error result: ${event.error.message}`);
			}
			// Result events don't map to SDK messages, just track stats
			return null;

		case "error":
			// Non-fatal error event
			// Could be logged but doesn't necessarily create a message
			return null;

		default:
			return null;
	}
}

/**
 * Create a Claude SDK user message from a plain string prompt
 *
 * Helper function to create properly formatted SDKUserMessage objects
 * for the Gemini CLI input.
 *
 * @param content - The prompt text
 * @param sessionId - Current session ID (may be null for initial message)
 * @returns Formatted SDKUserMessage
 */
export function createUserMessage(
	content: string,
	sessionId: string | null,
): SDKUserMessage {
	return {
		type: "user",
		message: {
			role: "user",
			content: content,
		},
		parent_tool_use_id: null,
		session_id: sessionId || "pending",
	};
}

/**
 * Extract session ID from Gemini init event
 *
 * @param event - Gemini stream event
 * @returns Session ID if event is init type, null otherwise
 */
export function extractSessionId(event: GeminiStreamEvent): string | null {
	if (event.type === "init") {
		return event.session_id;
	}
	return null;
}
