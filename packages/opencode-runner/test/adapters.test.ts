/**
 * Unit tests for OpenCode event adapters.
 *
 * Tests the conversion of OpenCode SSE events to SDKMessage format.
 */

import type {
	AssistantMessage,
	Event,
	EventMessagePartUpdated,
	EventMessageUpdated,
	EventSessionError,
	EventSessionIdle,
	EventSessionStatus,
	TextPart,
	ToolPart,
	ToolStateCompleted,
	ToolStateError,
	ToolStatePending,
	ToolStateRunning,
} from "@opencode-ai/sdk";
import type { SDKAssistantMessage, SDKUserMessage } from "cyrus-core";
import { describe, expect, it } from "vitest";
import {
	createUserMessage,
	errorEventToSDKMessage,
	extractSessionId,
	isMessagePartUpdated,
	isMessageUpdated,
	isSessionError,
	isSessionIdle,
	isSessionStatus,
	isTextPart,
	isToolPart,
	isToolStateCompleted,
	isToolStateError,
	openCodeEventToSDKMessage,
	partEventToSDKMessage,
	synthesizeResultMessage,
	textPartToContentBlock,
	toolPartToToolResultBlock,
	toolPartToToolUseBlock,
} from "../src/adapters.js";

// ============================================================================
// Mock Event Factories
// ============================================================================

function createTextPart(
	text: string,
	options: Partial<TextPart> = {},
): TextPart {
	return {
		id: "part-123",
		sessionID: "session-456",
		messageID: "msg-789",
		type: "text",
		text,
		...options,
	};
}

function createToolPart(
	state: ToolPart["state"],
	options: Partial<Omit<ToolPart, "state">> = {},
): ToolPart {
	return {
		id: "part-tool-123",
		sessionID: "session-456",
		messageID: "msg-789",
		type: "tool",
		callID: "call-abc",
		tool: "bash",
		state,
		...options,
	};
}

function createMessagePartUpdatedEvent(
	part: TextPart | ToolPart,
	delta?: string,
): EventMessagePartUpdated {
	return {
		type: "message.part.updated",
		properties: {
			part,
			delta,
		},
	};
}

function createMessageUpdatedEvent(
	info: AssistantMessage,
): EventMessageUpdated {
	return {
		type: "message.updated",
		properties: {
			info,
		},
	};
}

function createSessionIdleEvent(sessionID: string): EventSessionIdle {
	return {
		type: "session.idle",
		properties: {
			sessionID,
		},
	};
}

function createSessionErrorEvent(
	error?: EventSessionError["properties"]["error"],
	sessionID?: string,
): EventSessionError {
	return {
		type: "session.error",
		properties: {
			sessionID,
			error,
		},
	};
}

function createSessionStatusEvent(
	sessionID: string,
	status: EventSessionStatus["properties"]["status"],
): EventSessionStatus {
	return {
		type: "session.status",
		properties: {
			sessionID,
			status,
		},
	};
}

function createAssistantMessageInfo(
	options: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		id: "msg-123",
		sessionID: "session-456",
		role: "assistant",
		time: {
			created: Date.now(),
		},
		parentID: "parent-123",
		modelID: "claude-3-sonnet",
		providerID: "anthropic",
		mode: "build",
		path: {
			cwd: "/workspace",
			root: "/workspace",
		},
		cost: 0.001,
		tokens: {
			input: 100,
			output: 50,
			reasoning: 0,
			cache: { read: 0, write: 0 },
		},
		...options,
	};
}

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("Event Type Guards", () => {
	describe("isMessagePartUpdated", () => {
		it("returns true for message.part.updated events", () => {
			const event = createMessagePartUpdatedEvent(createTextPart("Hello"));
			expect(isMessagePartUpdated(event)).toBe(true);
		});

		it("returns false for other event types", () => {
			const event = createSessionIdleEvent("session-123");
			expect(isMessagePartUpdated(event)).toBe(false);
		});
	});

	describe("isMessageUpdated", () => {
		it("returns true for message.updated events", () => {
			const event = createMessageUpdatedEvent(createAssistantMessageInfo());
			expect(isMessageUpdated(event)).toBe(true);
		});

		it("returns false for other event types", () => {
			const event = createSessionIdleEvent("session-123");
			expect(isMessageUpdated(event)).toBe(false);
		});
	});

	describe("isSessionIdle", () => {
		it("returns true for session.idle events", () => {
			const event = createSessionIdleEvent("session-123");
			expect(isSessionIdle(event)).toBe(true);
		});

		it("returns false for other event types", () => {
			const event = createMessagePartUpdatedEvent(createTextPart("Hello"));
			expect(isSessionIdle(event)).toBe(false);
		});
	});

	describe("isSessionError", () => {
		it("returns true for session.error events", () => {
			const event = createSessionErrorEvent(undefined, "session-123");
			expect(isSessionError(event)).toBe(true);
		});

		it("returns false for other event types", () => {
			const event = createSessionIdleEvent("session-123");
			expect(isSessionError(event)).toBe(false);
		});
	});

	describe("isSessionStatus", () => {
		it("returns true for session.status events", () => {
			const event = createSessionStatusEvent("session-123", { type: "idle" });
			expect(isSessionStatus(event)).toBe(true);
		});

		it("returns false for other event types", () => {
			const event = createSessionIdleEvent("session-123");
			expect(isSessionStatus(event)).toBe(false);
		});
	});
});

describe("Part Type Guards", () => {
	describe("isTextPart", () => {
		it("returns true for text parts", () => {
			const part = createTextPart("Hello");
			expect(isTextPart(part as any)).toBe(true);
		});

		it("returns false for tool parts", () => {
			const part = createToolPart({ status: "pending", input: {}, raw: "" });
			expect(isTextPart(part as any)).toBe(false);
		});
	});

	describe("isToolPart", () => {
		it("returns true for tool parts", () => {
			const part = createToolPart({ status: "pending", input: {}, raw: "" });
			expect(isToolPart(part as any)).toBe(true);
		});

		it("returns false for text parts", () => {
			const part = createTextPart("Hello");
			expect(isToolPart(part as any)).toBe(false);
		});
	});

	describe("isToolStateCompleted", () => {
		it("returns true for completed state", () => {
			const state: ToolStateCompleted = {
				status: "completed",
				input: { command: "ls" },
				output: "file1.txt\nfile2.txt",
				title: "List files",
				metadata: {},
				time: { start: Date.now() - 1000, end: Date.now() },
			};
			expect(isToolStateCompleted(state)).toBe(true);
		});

		it("returns false for running state", () => {
			const state: ToolStateRunning = {
				status: "running",
				input: { command: "ls" },
				time: { start: Date.now() },
			};
			expect(isToolStateCompleted(state)).toBe(false);
		});
	});

	describe("isToolStateError", () => {
		it("returns true for error state", () => {
			const state: ToolStateError = {
				status: "error",
				input: { command: "bad-command" },
				error: "Command not found",
				time: { start: Date.now() - 1000, end: Date.now() },
			};
			expect(isToolStateError(state)).toBe(true);
		});

		it("returns false for completed state", () => {
			const state: ToolStateCompleted = {
				status: "completed",
				input: { command: "ls" },
				output: "file1.txt",
				title: "List files",
				metadata: {},
				time: { start: Date.now() - 1000, end: Date.now() },
			};
			expect(isToolStateError(state)).toBe(false);
		});
	});
});

// ============================================================================
// Part Conversion Tests
// ============================================================================

describe("Part Conversion Functions", () => {
	describe("textPartToContentBlock", () => {
		it("converts text part to SDK text block", () => {
			const part = createTextPart("Hello, world!");
			const block = textPartToContentBlock(part);

			expect(block).toEqual({
				type: "text",
				text: "Hello, world!",
			});
		});
	});

	describe("toolPartToToolUseBlock", () => {
		it("converts tool part to SDK tool_use block", () => {
			const state: ToolStateRunning = {
				status: "running",
				input: { command: "ls -la" },
				time: { start: Date.now() },
			};
			const part = createToolPart(state, { tool: "bash", callID: "call-xyz" });
			const block = toolPartToToolUseBlock(part);

			expect(block).toEqual({
				type: "tool_use",
				id: "call-xyz",
				name: "bash",
				input: { command: "ls -la" },
			});
		});
	});

	describe("toolPartToToolResultBlock", () => {
		it("converts completed tool part to SDK tool_result block", () => {
			const state: ToolStateCompleted = {
				status: "completed",
				input: { command: "ls" },
				output: "file1.txt\nfile2.txt",
				title: "List files",
				metadata: {},
				time: { start: Date.now() - 1000, end: Date.now() },
			};
			const part = createToolPart(state, { callID: "call-xyz" });
			const block = toolPartToToolResultBlock(part);

			expect(block).toEqual({
				type: "tool_result",
				tool_use_id: "call-xyz",
				content: "file1.txt\nfile2.txt",
				is_error: false,
			});
		});

		it("converts error tool part to SDK tool_result block with error", () => {
			const state: ToolStateError = {
				status: "error",
				input: { command: "bad-command" },
				error: "Command not found",
				time: { start: Date.now() - 1000, end: Date.now() },
			};
			const part = createToolPart(state, { callID: "call-xyz" });
			const block = toolPartToToolResultBlock(part);

			expect(block).toEqual({
				type: "tool_result",
				tool_use_id: "call-xyz",
				content: "Command not found",
				is_error: true,
			});
		});

		it("returns empty result for pending state", () => {
			const state: ToolStatePending = {
				status: "pending",
				input: {},
				raw: '{"command": "ls"}',
			};
			const part = createToolPart(state, { callID: "call-xyz" });
			const block = toolPartToToolResultBlock(part);

			expect(block).toEqual({
				type: "tool_result",
				tool_use_id: "call-xyz",
				content: "",
				is_error: false,
			});
		});
	});
});

// ============================================================================
// Message Conversion Tests
// ============================================================================

describe("partEventToSDKMessage", () => {
	const sessionId = "session-123";

	it("converts text part event to SDKAssistantMessage", () => {
		const part = createTextPart("Hello, world!");
		const event = createMessagePartUpdatedEvent(part);
		const message = partEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		expect(message?.type).toBe("assistant");
		const assistantMsg = message as SDKAssistantMessage;
		expect(assistantMsg.session_id).toBe(sessionId);
		expect(assistantMsg.message.content).toHaveLength(1);
		expect(
			(assistantMsg.message.content[0] as { type: string; text: string }).type,
		).toBe("text");
		expect(
			(assistantMsg.message.content[0] as { type: string; text: string }).text,
		).toBe("Hello, world!");
	});

	it("uses delta text when provided", () => {
		const part = createTextPart("Hello, world!");
		const event = createMessagePartUpdatedEvent(part, "Hello");
		const message = partEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		const assistantMsg = message as SDKAssistantMessage;
		expect(
			(assistantMsg.message.content[0] as { type: string; text: string }).text,
		).toBe("Hello");
	});

	it("converts running tool part to SDKAssistantMessage with tool_use", () => {
		const state: ToolStateRunning = {
			status: "running",
			input: { command: "ls -la" },
			time: { start: Date.now() },
		};
		const part = createToolPart(state);
		const event = createMessagePartUpdatedEvent(part);
		const message = partEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		expect(message?.type).toBe("assistant");
		const assistantMsg = message as SDKAssistantMessage;
		expect(assistantMsg.message.content).toHaveLength(1);
		expect((assistantMsg.message.content[0] as { type: string }).type).toBe(
			"tool_use",
		);
	});

	it("converts completed tool part to SDKUserMessage with tool_result", () => {
		const state: ToolStateCompleted = {
			status: "completed",
			input: { command: "ls" },
			output: "file1.txt",
			title: "List files",
			metadata: {},
			time: { start: Date.now() - 1000, end: Date.now() },
		};
		const part = createToolPart(state);
		const event = createMessagePartUpdatedEvent(part);
		const message = partEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		expect(message?.type).toBe("user");
		const userMsg = message as SDKUserMessage;
		expect(Array.isArray(userMsg.message.content)).toBe(true);
		expect((userMsg.message.content as { type: string }[])[0].type).toBe(
			"tool_result",
		);
	});

	it("converts error tool part to SDKUserMessage with error tool_result", () => {
		const state: ToolStateError = {
			status: "error",
			input: { command: "bad-cmd" },
			error: "Command failed",
			time: { start: Date.now() - 1000, end: Date.now() },
		};
		const part = createToolPart(state);
		const event = createMessagePartUpdatedEvent(part);
		const message = partEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		expect(message?.type).toBe("user");
		const userMsg = message as SDKUserMessage;
		const content = (userMsg.message.content as { is_error: boolean }[])[0];
		expect(content.is_error).toBe(true);
	});

	it("returns null for pending tool part", () => {
		const state: ToolStatePending = {
			status: "pending",
			input: {},
			raw: "",
		};
		const part = createToolPart(state);
		const event = createMessagePartUpdatedEvent(part);
		const message = partEventToSDKMessage(event, sessionId);

		expect(message).toBeNull();
	});

	it("uses 'pending' as session_id when null", () => {
		const part = createTextPart("Hello");
		const event = createMessagePartUpdatedEvent(part);
		const message = partEventToSDKMessage(event, null);

		expect(message).not.toBeNull();
		expect((message as SDKAssistantMessage).session_id).toBe("pending");
	});
});

// ============================================================================
// Result Message Tests
// ============================================================================

describe("synthesizeResultMessage", () => {
	const sessionId = "session-123";

	it("creates success result message", () => {
		const result = synthesizeResultMessage(sessionId);

		expect(result.type).toBe("result");
		expect(result.subtype).toBe("success");
		expect(result.is_error).toBe(false);
		expect(result.session_id).toBe(sessionId);
		expect(result.result).toBe("Session completed successfully");
	});

	it("extracts content from last assistant message", () => {
		const lastAssistantMessage: SDKAssistantMessage = {
			type: "assistant",
			message: {
				id: "msg-123",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Final response text" }] as any,
				model: "opencode",
				stop_reason: null,
				stop_sequence: null,
				usage: {
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation: null,
					server_tool_use: null,
					service_tier: null,
				},
				container: null,
				context_management: null,
			},
			parent_tool_use_id: null,
			uuid: "uuid-123",
			session_id: sessionId,
		};

		const result = synthesizeResultMessage(sessionId, lastAssistantMessage);

		expect(result.result).toBe("Final response text");
	});

	it("includes token metrics from assistant info", () => {
		const assistantInfo = createAssistantMessageInfo({
			tokens: {
				input: 500,
				output: 200,
				reasoning: 100,
				cache: { read: 50, write: 25 },
			},
			cost: 0.005,
		});

		const result = synthesizeResultMessage(sessionId, null, assistantInfo);

		expect(result.usage.input_tokens).toBe(500);
		expect(result.usage.output_tokens).toBe(200);
		expect(result.usage.cache_read_input_tokens).toBe(50);
		expect(result.usage.cache_creation_input_tokens).toBe(25);
		expect(result.total_cost_usd).toBe(0.005);
	});

	it("calculates duration from timing info", () => {
		const startTime = Date.now() - 5000;
		const endTime = Date.now();
		const assistantInfo = createAssistantMessageInfo({
			time: { created: startTime, completed: endTime },
		});

		const result = synthesizeResultMessage(sessionId, null, assistantInfo);

		expect(result.duration_ms).toBe(endTime - startTime);
	});

	it("uses 'pending' as session_id when null", () => {
		const result = synthesizeResultMessage(null);

		expect(result.session_id).toBe("pending");
	});
});

describe("errorEventToSDKMessage", () => {
	const sessionId = "session-123";

	it("creates error result message", () => {
		const event = createSessionErrorEvent(
			{
				name: "UnknownError",
				data: { message: "Something went wrong" },
			},
			sessionId,
		);

		const result = errorEventToSDKMessage(event, sessionId);

		expect(result.type).toBe("result");
		expect(result.subtype).toBe("error_during_execution");
		expect(result.is_error).toBe(true);
		expect(result.errors).toContain("Something went wrong");
	});

	it("includes status code in error message when available", () => {
		const event = createSessionErrorEvent(
			{
				name: "APIError",
				data: {
					message: "Rate limit exceeded",
					statusCode: 429,
					isRetryable: true,
				},
			},
			sessionId,
		);

		const result = errorEventToSDKMessage(event, sessionId);

		expect(result.errors?.[0]).toContain("429");
	});

	it("handles missing error with default message", () => {
		const event = createSessionErrorEvent(undefined, sessionId);

		const result = errorEventToSDKMessage(event, sessionId);

		expect(result.errors).toContain("Unknown error");
	});

	it("uses error name when message is not available", () => {
		const event = createSessionErrorEvent(
			{
				name: "MessageOutputLengthError",
				data: {},
			},
			sessionId,
		);

		const result = errorEventToSDKMessage(event, sessionId);

		expect(result.errors).toContain("MessageOutputLengthError");
	});
});

// ============================================================================
// Main Adapter Function Tests
// ============================================================================

describe("openCodeEventToSDKMessage", () => {
	const sessionId = "session-123";

	it("handles message.part.updated events", () => {
		const part = createTextPart("Hello");
		const event = createMessagePartUpdatedEvent(part);
		const message = openCodeEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		expect(message?.type).toBe("assistant");
	});

	it("handles session.idle events", () => {
		const event = createSessionIdleEvent(sessionId);
		const message = openCodeEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		expect(message?.type).toBe("result");
		expect((message as any).subtype).toBe("success");
	});

	it("handles session.error events", () => {
		const event = createSessionErrorEvent(
			{
				name: "UnknownError",
				data: { message: "Test error" },
			},
			sessionId,
		);
		const message = openCodeEventToSDKMessage(event, sessionId);

		expect(message).not.toBeNull();
		expect(message?.type).toBe("result");
		expect((message as any).is_error).toBe(true);
	});

	it("returns null for unhandled event types", () => {
		const event: Event = {
			type: "file.edited",
			properties: { file: "/path/to/file.ts" },
		} as any;
		const message = openCodeEventToSDKMessage(event, sessionId);

		expect(message).toBeNull();
	});
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("extractSessionId", () => {
	it("extracts session ID from message.part.updated event", () => {
		const part = createTextPart("Hello", { sessionID: "test-session" });
		const event = createMessagePartUpdatedEvent(part);
		const sessionId = extractSessionId(event);

		expect(sessionId).toBe("test-session");
	});

	it("extracts session ID from message.updated event", () => {
		const info = createAssistantMessageInfo({ sessionID: "test-session-2" });
		const event = createMessageUpdatedEvent(info);
		const sessionId = extractSessionId(event);

		expect(sessionId).toBe("test-session-2");
	});

	it("extracts session ID from session.idle event", () => {
		const event = createSessionIdleEvent("test-session-3");
		const sessionId = extractSessionId(event);

		expect(sessionId).toBe("test-session-3");
	});

	it("extracts session ID from session.error event", () => {
		const event = createSessionErrorEvent(undefined, "test-session-4");
		const sessionId = extractSessionId(event);

		expect(sessionId).toBe("test-session-4");
	});

	it("extracts session ID from session.status event", () => {
		const event = createSessionStatusEvent("test-session-5", { type: "busy" });
		const sessionId = extractSessionId(event);

		expect(sessionId).toBe("test-session-5");
	});

	it("returns null for events without session ID", () => {
		const event: Event = {
			type: "file.edited",
			properties: { file: "/path/to/file.ts" },
		} as any;
		const sessionId = extractSessionId(event);

		expect(sessionId).toBeNull();
	});

	it("returns null for session.error with no sessionID", () => {
		const event = createSessionErrorEvent(undefined);
		const sessionId = extractSessionId(event);

		expect(sessionId).toBeNull();
	});
});

describe("createUserMessage", () => {
	it("creates SDK user message with content", () => {
		const message = createUserMessage("Hello, Claude!", "session-123");

		expect(message.type).toBe("user");
		expect(message.message.role).toBe("user");
		expect(message.message.content).toBe("Hello, Claude!");
		expect(message.session_id).toBe("session-123");
		expect(message.parent_tool_use_id).toBeNull();
	});

	it("uses 'pending' for null session ID", () => {
		const message = createUserMessage("Test prompt", null);

		expect(message.session_id).toBe("pending");
	});
});
