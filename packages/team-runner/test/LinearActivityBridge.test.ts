import type { SDKMessage } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinearActivityBridge } from "../src/LinearActivityBridge.js";

function makeAssistantMessage(
	content: Array<
		| { type: "text"; text: string }
		| { type: "tool_use"; name: string; input: any }
	>,
): SDKMessage {
	return {
		type: "assistant",
		message: { content },
	} as SDKMessage;
}

function makeResultMessage(): SDKMessage {
	return { type: "result" } as SDKMessage;
}

describe("LinearActivityBridge", () => {
	let postActivity: ReturnType<typeof vi.fn>;
	let bridge: LinearActivityBridge;

	beforeEach(() => {
		postActivity = vi.fn().mockResolvedValue(undefined);
		bridge = new LinearActivityBridge({ postActivity });
		// Reset Date.now so rate limiting does not interfere across tests
		vi.restoreAllMocks();
	});

	describe("team progress messages", () => {
		it("should detect messages containing team keywords", async () => {
			const msg = makeAssistantMessage([
				{ type: "text", text: "Spawning a new teammate for this task." },
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
			expect(postActivity).toHaveBeenCalledWith({
				type: "thought",
				body: "Spawning a new teammate for this task.",
				ephemeral: true,
			});
		});

		it("should detect keyword 'completed'", async () => {
			const msg = makeAssistantMessage([
				{ type: "text", text: "The coding task has been completed." },
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({ type: "thought" }),
			);
		});

		it("should detect keyword 'assigned'", async () => {
			const msg = makeAssistantMessage([
				{ type: "text", text: "I assigned the task to the worker." },
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
		});

		it("should detect keyword 'blocked'", async () => {
			const msg = makeAssistantMessage([
				{ type: "text", text: "This task is blocked by task-2." },
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
		});

		it("should detect keyword 'shutting down'", async () => {
			const msg = makeAssistantMessage([
				{ type: "text", text: "All done. Shutting down the team." },
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
		});

		it("should detect keywords case-insensitively", async () => {
			const msg = makeAssistantMessage([
				{ type: "text", text: "TEAMMATE was ASSIGNED to the TASK." },
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
		});

		it("should ignore messages without team keywords", async () => {
			const msg = makeAssistantMessage([
				{
					type: "text",
					text: "I am reading the file contents now.",
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).not.toHaveBeenCalled();
		});

		it("should ignore whitespace-only text blocks", async () => {
			const msg = makeAssistantMessage([{ type: "text", text: "   \n\t  " }]);

			await bridge.onMessage(msg);

			expect(postActivity).not.toHaveBeenCalled();
		});

		it("should truncate long progress messages to 500 characters", async () => {
			const longText = `Spawning teammate: ${"x".repeat(600)}`;
			const msg = makeAssistantMessage([{ type: "text", text: longText }]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
			const body = postActivity.mock.calls[0][0].body;
			expect(body.length).toBe(500);
			expect(body.endsWith("...")).toBe(true);
		});

		it("should not truncate messages at exactly 500 characters", async () => {
			const text = `Spawning teammate: ${"x".repeat(481)}`; // 19 + 481 = 500
			const msg = makeAssistantMessage([{ type: "text", text }]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
			const body = postActivity.mock.calls[0][0].body;
			expect(body.length).toBe(500);
			expect(body).toBe(text);
		});
	});

	describe("team tool uses", () => {
		it("should detect TaskCreate and format with subject", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "TaskCreate",
					input: { subject: "Implement auth module" },
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith({
				type: "action",
				body: "Created task: Implement auth module",
				ephemeral: true,
			});
		});

		it("should handle TaskCreate with missing subject", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "TaskCreate",
					input: {},
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "Created task: unknown",
				}),
			);
		});

		it("should detect TaskUpdate and format with taskId and status", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "TaskUpdate",
					input: { taskId: "task-3", status: "completed" },
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "Task task-3 -> completed",
				}),
			);
		});

		it("should handle TaskUpdate with missing status", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "TaskUpdate",
					input: { taskId: "task-7" },
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "Task task-7 -> updated",
				}),
			);
		});

		it("should detect SendMessage and format with recipient and summary", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "SendMessage",
					input: {
						recipient: "coder-1",
						summary: "Please fix the tests",
					},
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "Message to coder-1: Please fix the tests",
				}),
			);
		});

		it("should truncate long SendMessage summaries to 100 characters", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "SendMessage",
					input: {
						recipient: "worker",
						summary: "a".repeat(200),
					},
				},
			]);

			await bridge.onMessage(msg);

			const body = postActivity.mock.calls[0][0].body;
			// "Message to worker: " + 100 chars of "a"
			expect(body).toBe(`Message to worker: ${"a".repeat(100)}`);
		});

		it("should detect Task tool and format with name", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "Task",
					input: { name: "code-reviewer" },
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "Spawned teammate: code-reviewer",
				}),
			);
		});

		it("should fallback to description for Task tool when name is missing", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "Task",
					input: { description: "Run the linter" },
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "Spawned teammate: Run the linter",
				}),
			);
		});

		it("should detect TaskList tool and use tool name as body", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "TaskList",
					input: {},
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "TaskList",
				}),
			);
		});

		it("should detect TeamCreate tool and use tool name as body", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "TeamCreate",
					input: {},
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					body: "TeamCreate",
				}),
			);
		});

		it("should ignore non-team tool uses", async () => {
			const msg = makeAssistantMessage([
				{
					type: "tool_use",
					name: "Read",
					input: { file_path: "/some/file.ts" },
				},
			]);

			await bridge.onMessage(msg);

			expect(postActivity).not.toHaveBeenCalled();
		});
	});

	describe("result messages", () => {
		it("should post a non-ephemeral response for result messages", async () => {
			const msg = makeResultMessage();

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledWith({
				type: "response",
				body: "Team execution completed.",
				ephemeral: false,
			});
		});
	});

	describe("rate limiting", () => {
		it("should skip messages posted within the rate limit interval", async () => {
			// Freeze time
			let currentTime = 10000;
			vi.spyOn(Date, "now").mockImplementation(() => currentTime);

			const msg1 = makeAssistantMessage([
				{ type: "text", text: "Spawning teammate alpha." },
			]);
			const msg2 = makeAssistantMessage([
				{ type: "text", text: "Assigned task to teammate." },
			]);

			await bridge.onMessage(msg1);
			expect(postActivity).toHaveBeenCalledOnce();

			// Advance time by only 500ms (below the 2000ms threshold)
			currentTime = 10500;
			await bridge.onMessage(msg2);
			expect(postActivity).toHaveBeenCalledOnce(); // Still only one call
		});

		it("should allow messages after the rate limit interval has passed", async () => {
			let currentTime = 10000;
			vi.spyOn(Date, "now").mockImplementation(() => currentTime);

			const msg1 = makeAssistantMessage([
				{ type: "text", text: "Spawning teammate alpha." },
			]);
			const msg2 = makeAssistantMessage([
				{ type: "text", text: "Task completed successfully." },
			]);

			await bridge.onMessage(msg1);
			expect(postActivity).toHaveBeenCalledOnce();

			// Advance time past the 2000ms threshold
			currentTime = 12001;
			await bridge.onMessage(msg2);
			expect(postActivity).toHaveBeenCalledTimes(2);
		});

		it("should allow the very first message when enough time has elapsed", async () => {
			vi.spyOn(Date, "now").mockReturnValue(5000);

			const msg = makeAssistantMessage([
				{ type: "text", text: "Spawning teammate." },
			]);

			await bridge.onMessage(msg);

			expect(postActivity).toHaveBeenCalledOnce();
		});
	});

	describe("non-team messages", () => {
		it("should ignore system messages", async () => {
			const msg = { type: "system" } as SDKMessage;

			await bridge.onMessage(msg);

			expect(postActivity).not.toHaveBeenCalled();
		});

		it("should ignore assistant messages without content", async () => {
			const msg = {
				type: "assistant",
				message: {},
			} as SDKMessage;

			await bridge.onMessage(msg);

			expect(postActivity).not.toHaveBeenCalled();
		});

		it("should ignore assistant messages with empty content array", async () => {
			const msg = makeAssistantMessage([]);

			await bridge.onMessage(msg);

			expect(postActivity).not.toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should not throw when postActivity fails", async () => {
			postActivity.mockRejectedValue(new Error("Network error"));
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const msg = makeResultMessage();

			await expect(bridge.onMessage(msg)).resolves.toBeUndefined();

			expect(consoleSpy).toHaveBeenCalledWith(
				"[LinearActivityBridge] Failed to post activity:",
				expect.any(Error),
			);

			consoleSpy.mockRestore();
		});

		it("should log the original error when postActivity fails", async () => {
			const error = new Error("API rate limit exceeded");
			postActivity.mockRejectedValue(error);
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const msg = makeResultMessage();
			await bridge.onMessage(msg);

			expect(consoleSpy).toHaveBeenCalledWith(
				"[LinearActivityBridge] Failed to post activity:",
				error,
			);

			consoleSpy.mockRestore();
		});
	});

	describe("mixed content blocks", () => {
		it("should process both text and tool_use blocks in a single message", async () => {
			// Use a fresh bridge to avoid rate limiting from previous tests
			const currentTime = 50000;
			vi.spyOn(Date, "now").mockImplementation(() => currentTime);

			const freshPostActivity = vi.fn().mockResolvedValue(undefined);
			const freshBridge = new LinearActivityBridge({
				postActivity: freshPostActivity,
			});

			const msg = makeAssistantMessage([
				{ type: "text", text: "Assigning task to teammate." },
				{
					type: "tool_use",
					name: "TaskCreate",
					input: { subject: "Write tests" },
				},
			]);

			await freshBridge.onMessage(msg);

			// Rate limit check happens once at the start of onMessage,
			// so all blocks within a single message are processed.
			expect(freshPostActivity).toHaveBeenCalledTimes(2);
			expect(freshPostActivity).toHaveBeenNthCalledWith(1, {
				type: "thought",
				body: "Assigning task to teammate.",
				ephemeral: true,
			});
			expect(freshPostActivity).toHaveBeenNthCalledWith(2, {
				type: "action",
				body: "Created task: Write tests",
				ephemeral: true,
			});
		});
	});
});
