/**
 * Test for text delta accumulation in OpenCodeRunner.
 *
 * Bug Report: CYPACK-643
 * The OpenCodeRunner posts each streaming text delta as a separate thought activity,
 * creating fragmented messages like "I", "I'll", "I'll implement..."
 *
 * Root Cause:
 * The `handleMessagePartUpdated` method directly converts each `message.part.updated`
 * SSE event into an SDKAssistantMessage and emits it immediately. The SDK sends
 * cumulative text updates (each update contains the full text so far), but the
 * runner emits each update as a separate message event.
 *
 * Expected Behavior:
 * Text deltas should be accumulated rather than posted individually. The runner
 * should only emit complete text blocks when:
 * - A tool use starts (non-text part received)
 * - A new text part ID is received (different text block)
 * - The session completes
 */

import { EventEmitter } from "node:events";
import type { AgentMessage, SDKAssistantMessage } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ============================================================================
// Test Setup
// ============================================================================

/**
 * Mock TextPart structure from OpenCode SDK.
 * Each update contains the cumulative text, not just the delta.
 */
interface MockTextPart {
	type: "text";
	id: string;
	sessionID: string;
	text: string;
	synthetic?: boolean;
	ignored?: boolean;
}

/**
 * Mock ToolPart structure from OpenCode SDK.
 */
interface MockToolPart {
	type: "tool";
	id: string;
	sessionID: string;
	callID: string;
	name: string;
	state: {
		status: "pending" | "running" | "completed" | "error";
		input?: Record<string, unknown>;
		output?: string;
		error?: string;
	};
}

type MockPart = MockTextPart | MockToolPart;

/**
 * Test implementation that mirrors the FIXED OpenCodeRunner logic.
 * This class implements the text accumulation pattern as it should work.
 */
class FixedOpenCodeRunnerEventHandler extends EventEmitter {
	private sessionId = "test-session-123";

	// Text accumulation state (mirrors the fix in OpenCodeRunner)
	private accumulatingTextPartId: string | null = null;
	private accumulatedText: string = "";

	/**
	 * Handle message.part.updated event with text accumulation.
	 *
	 * For text parts, we accumulate deltas instead of emitting each one
	 * as a separate message. Text is flushed when:
	 * - A different part type is received (e.g., tool use)
	 * - A different text part ID is received
	 * - The session completes
	 */
	async handleMessagePartUpdated(data: { part: MockPart }): Promise<void> {
		const part = data.part;
		if (!part) return;

		// Check if this is for our session
		if (part.sessionID !== this.sessionId) {
			return;
		}

		// Handle text parts with accumulation
		if (part.type === "text") {
			const textPart = part as MockTextPart;
			if (textPart.synthetic || textPart.ignored) {
				return;
			}

			// If this is a new text part, flush the old one first
			if (
				this.accumulatingTextPartId !== null &&
				this.accumulatingTextPartId !== textPart.id
			) {
				this.flushAccumulatedText();
			}

			// Accumulate text (the SDK sends cumulative text, not deltas)
			this.accumulatingTextPartId = textPart.id;
			this.accumulatedText = textPart.text;
			return;
		}

		// For non-text parts, flush any accumulated text first
		if (this.accumulatingTextPartId !== null) {
			this.flushAccumulatedText();
		}

		// Convert non-text part to message and emit
		const message = this.convertPartToMessage(part);
		if (message) {
			this.emit("message", message);
		}
	}

	/**
	 * Flush accumulated text as a single message.
	 */
	flushAccumulatedText(): void {
		if (this.accumulatingTextPartId === null || !this.accumulatedText) {
			return;
		}

		const message = this.createSDKAssistantMessage([
			{ type: "text", text: this.accumulatedText },
		]);

		this.emit("message", message);

		// Reset accumulation state
		this.accumulatingTextPartId = null;
		this.accumulatedText = "";
	}

	/**
	 * Convert a part to an SDK message.
	 */
	private convertPartToMessage(part: MockPart): AgentMessage | null {
		if (part.type === "text") {
			if (part.synthetic || part.ignored) {
				return null;
			}
			return this.createSDKAssistantMessage([
				{ type: "text", text: part.text },
			]);
		} else if (part.type === "tool") {
			// Simplified tool handling for test
			if (part.state.status === "running") {
				return this.createSDKAssistantMessage([
					{
						type: "tool_use",
						id: part.callID,
						name: part.name,
						input: part.state.input || {},
					},
				]);
			}
		}
		return null;
	}

	/**
	 * Create an SDK assistant message.
	 */
	private createSDKAssistantMessage(
		content: Array<{
			type: string;
			text?: string;
			id?: string;
			name?: string;
			input?: unknown;
		}>,
	): SDKAssistantMessage {
		return {
			type: "assistant",
			message: {
				id: `msg_test`,
				type: "message",
				role: "assistant",
				content: content as SDKAssistantMessage["message"]["content"],
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
			uuid: "test-uuid",
			session_id: this.sessionId,
		};
	}
}

// ============================================================================
// Tests
// ============================================================================

describe("OpenCodeRunner Text Accumulation (CYPACK-643)", () => {
	let handler: FixedOpenCodeRunnerEventHandler;
	let emittedMessages: AgentMessage[];

	beforeEach(() => {
		handler = new FixedOpenCodeRunnerEventHandler();
		emittedMessages = [];
		handler.on("message", (msg: AgentMessage) => {
			emittedMessages.push(msg);
		});
	});

	afterEach(() => {
		handler.removeAllListeners();
	});

	describe("Text accumulation behavior", () => {
		it("should accumulate text deltas and emit only on flush", async () => {
			// Simulate SSE events for cumulative text updates (as the SDK sends them)
			// Each event contains the full text so far, not just the delta
			const textParts: MockTextPart[] = [
				{
					type: "text",
					id: "part-1",
					sessionID: "test-session-123",
					text: "I",
				},
				{
					type: "text",
					id: "part-1",
					sessionID: "test-session-123",
					text: "I'",
				},
				{
					type: "text",
					id: "part-1",
					sessionID: "test-session-123",
					text: "I'll",
				},
				{
					type: "text",
					id: "part-1",
					sessionID: "test-session-123",
					text: "I'll implement",
				},
				{
					type: "text",
					id: "part-1",
					sessionID: "test-session-123",
					text: "I'll implement the multiply method.",
				},
			];

			// Process all events
			for (const part of textParts) {
				await handler.handleMessagePartUpdated({ part });
			}

			// No messages should be emitted yet (text is accumulated)
			expect(emittedMessages.length).toBe(0);

			// Now flush the accumulated text
			handler.flushAccumulatedText();

			// Should have exactly 1 message with the complete text
			expect(emittedMessages.length).toBe(1);

			const msg = emittedMessages[0] as SDKAssistantMessage;
			const content = msg.message.content[0] as { type: string; text: string };
			expect(content.text).toBe("I'll implement the multiply method.");
		});

		it("should flush text when a tool use is received", async () => {
			// Simulate: text updates, then a tool use
			const events: Array<{ part: MockPart }> = [
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "Let",
					},
				},
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "Let me",
					},
				},
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "Let me read",
					},
				},
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "Let me read the file.",
					},
				},
				// Tool use should trigger flush of accumulated text
				{
					part: {
						type: "tool",
						id: "tool-1",
						sessionID: "test-session-123",
						callID: "call-1",
						name: "Read",
						state: {
							status: "running",
							input: { file_path: "/path/to/file" },
						},
					},
				},
			];

			// Process all events
			for (const event of events) {
				await handler.handleMessagePartUpdated(event);
			}

			// Should have 2 messages: flushed text + tool use
			expect(emittedMessages.length).toBe(2);

			// First message should be the complete text
			const textMsg = emittedMessages[0] as SDKAssistantMessage;
			const textContent = textMsg.message.content[0] as {
				type: string;
				text: string;
			};
			expect(textContent.type).toBe("text");
			expect(textContent.text).toBe("Let me read the file.");

			// Second message should be the tool use
			const toolMsg = emittedMessages[1] as SDKAssistantMessage;
			const toolContent = toolMsg.message.content[0] as {
				type: string;
				name: string;
			};
			expect(toolContent.type).toBe("tool_use");
			expect(toolContent.name).toBe("Read");
		});

		it("should flush text when a different text part ID is received", async () => {
			// Simulate: text block 1, then text block 2 with different ID
			const events: Array<{ part: MockPart }> = [
				// First text block
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "First",
					},
				},
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "First thought.",
					},
				},
				// Second text block (different ID triggers flush of first)
				{
					part: {
						type: "text",
						id: "part-2",
						sessionID: "test-session-123",
						text: "Second",
					},
				},
				{
					part: {
						type: "text",
						id: "part-2",
						sessionID: "test-session-123",
						text: "Second thought.",
					},
				},
			];

			for (const event of events) {
				await handler.handleMessagePartUpdated(event);
			}

			// First text block should be flushed when part-2 arrived
			expect(emittedMessages.length).toBe(1);

			const firstMsg = emittedMessages[0] as SDKAssistantMessage;
			const firstContent = firstMsg.message.content[0] as {
				type: string;
				text: string;
			};
			expect(firstContent.text).toBe("First thought.");

			// Flush the remaining second block
			handler.flushAccumulatedText();

			expect(emittedMessages.length).toBe(2);

			const secondMsg = emittedMessages[1] as SDKAssistantMessage;
			const secondContent = secondMsg.message.content[0] as {
				type: string;
				text: string;
			};
			expect(secondContent.text).toBe("Second thought.");
		});

		it("should handle multiple text blocks with tools interleaved", async () => {
			// Simulate: text block 1, tool, text block 2
			const events: Array<{ part: MockPart }> = [
				// First text block
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "First",
					},
				},
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "First thought.",
					},
				},
				// Tool use (flushes first text block)
				{
					part: {
						type: "tool",
						id: "tool-1",
						sessionID: "test-session-123",
						callID: "call-1",
						name: "Bash",
						state: { status: "running" },
					},
				},
				// Second text block
				{
					part: {
						type: "text",
						id: "part-2",
						sessionID: "test-session-123",
						text: "Second",
					},
				},
				{
					part: {
						type: "text",
						id: "part-2",
						sessionID: "test-session-123",
						text: "Second thought.",
					},
				},
			];

			for (const event of events) {
				await handler.handleMessagePartUpdated(event);
			}

			// Should have 2 messages: flushed text + tool
			expect(emittedMessages.length).toBe(2);

			// First: text "First thought."
			const firstMsg = emittedMessages[0] as SDKAssistantMessage;
			const firstContent = firstMsg.message.content[0] as {
				type: string;
				text: string;
			};
			expect(firstContent.text).toBe("First thought.");

			// Second: tool use
			const toolMsg = emittedMessages[1] as SDKAssistantMessage;
			const toolContent = toolMsg.message.content[0] as {
				type: string;
				name: string;
			};
			expect(toolContent.type).toBe("tool_use");

			// Flush remaining
			handler.flushAccumulatedText();

			// Now should have 3 messages
			expect(emittedMessages.length).toBe(3);

			const lastMsg = emittedMessages[2] as SDKAssistantMessage;
			const lastContent = lastMsg.message.content[0] as {
				type: string;
				text: string;
			};
			expect(lastContent.text).toBe("Second thought.");
		});

		it("should not emit anything for empty accumulated text", async () => {
			// Just flush without any text
			handler.flushAccumulatedText();

			expect(emittedMessages.length).toBe(0);
		});

		it("should ignore synthetic and ignored text parts", async () => {
			const events: Array<{ part: MockPart }> = [
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text: "Synthetic text",
						synthetic: true,
					},
				},
				{
					part: {
						type: "text",
						id: "part-2",
						sessionID: "test-session-123",
						text: "Ignored text",
						ignored: true,
					},
				},
			];

			for (const event of events) {
				await handler.handleMessagePartUpdated(event);
			}

			// Nothing should be accumulated for synthetic/ignored parts
			handler.flushAccumulatedText();

			expect(emittedMessages.length).toBe(0);
		});

		it("should ignore events from other sessions", async () => {
			const events: Array<{ part: MockPart }> = [
				{
					part: {
						type: "text",
						id: "part-1",
						sessionID: "other-session-456",
						text: "Text from another session",
					},
				},
			];

			for (const event of events) {
				await handler.handleMessagePartUpdated(event);
			}

			handler.flushAccumulatedText();

			expect(emittedMessages.length).toBe(0);
		});
	});

	describe("Regression: No more fragmented messages", () => {
		it("should emit complete thoughts, not fragments (7 deltas -> 1 message)", async () => {
			const textDeltas = [
				"I",
				"I'",
				"I'll",
				"I'll implement",
				"I'll implement the",
				"I'll implement the multiply",
				"I'll implement the multiply method.",
			];

			for (const text of textDeltas) {
				await handler.handleMessagePartUpdated({
					part: {
						type: "text",
						id: "part-1",
						sessionID: "test-session-123",
						text,
					},
				});
			}

			// Before flush: no messages emitted
			expect(emittedMessages.length).toBe(0);

			// After flush: exactly 1 message with complete text
			handler.flushAccumulatedText();

			expect(emittedMessages.length).toBe(1);

			const msg = emittedMessages[0] as SDKAssistantMessage;
			const content = msg.message.content[0] as { type: string; text: string };
			expect(content.text).toBe("I'll implement the multiply method.");
		});
	});
});
