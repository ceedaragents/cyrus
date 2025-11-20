import type { SDKMessage, SDKUserMessage } from "cyrus-core";
import type { GeminiMessageEvent, GeminiStreamEvent } from "./types.js";

/**
 * Convert a Gemini stream event to cyrus-core SDKMessage format
 *
 * This adapter maps Gemini CLI's streaming events to the cyrus-core SDKMessage
 * format, allowing GeminiRunner to implement the IAgentRunner interface.
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
				const userMessage: SDKUserMessage = {
					type: "user",
					message: {
						role: "user",
						content: messageEvent.content,
					},
					parent_tool_use_id: null,
					session_id: sessionId || "pending",
				};
				return userMessage;
			} else {
				// Assistant message
				const assistantMessage = {
					type: "assistant",
					message: {
						role: "assistant",
						content: messageEvent.content,
					},
					session_id: sessionId || "pending",
				};
				return assistantMessage as unknown as SDKMessage;
			}
		}

		case "init":
			// Init events don't map directly to messages
			// Session ID is extracted separately
			return null;

		case "tool_use": {
			// Map to Claude's tool_use format
			// Generate unique tool_id based on tool name and timestamp (matches Gemini CLI format)
			const tool_id = `${event.tool_name}_${Date.now()}`;
			const toolUseMessage = {
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: tool_id,
							name: event.tool_name,
							input: event.parameters,
						},
					],
				},
				session_id: sessionId || "pending",
			};
			return toolUseMessage as unknown as SDKMessage;
		}

		case "tool_result": {
			// Map to Claude's tool_result format
			// Generate matching tool_id (should ideally be tracked from tool_use event)
			const tool_use_id = `${event.tool_name}_${Date.now()}`;
			const toolResultMessage = {
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: tool_use_id,
							content: JSON.stringify(event.result),
						},
					],
				},
				parent_tool_use_id: null,
				session_id: sessionId || "pending",
			};
			return toolResultMessage as unknown as SDKMessage;
		}

		case "result":
			// Final result - map to assistant message with the response
			if (event.error) {
				// Error result - log but return null since SDK doesn't have a direct error message type
				console.error(`[GeminiAdapter] Error result: ${event.error.message}`);
				return null;
			} else {
				// Success result with final response
				const resultMessage = {
					type: "assistant",
					message: {
						role: "assistant",
						content: event.response,
					},
					session_id: sessionId || "pending",
				};
				return resultMessage as unknown as SDKMessage;
			}

		case "error":
			// Non-fatal error event
			// Could be logged but doesn't necessarily create a message
			return null;

		default:
			return null;
	}
}

/**
 * Create a Cyrus Core SDK UserMessage from a plain string prompt
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
