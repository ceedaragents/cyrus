import { ClaudeMessageFormatter } from "cyrus-claude-runner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import type { IActivitySink } from "../src/sinks/IActivitySink";

describe("AgentSessionManager - Tool Result Callbacks", () => {
	let manager: AgentSessionManager;
	let mockActivitySink: IActivitySink;
	const sessionId = "test-session";

	beforeEach(() => {
		mockActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-123" }),
			createAgentSession: vi.fn().mockResolvedValue("session-123"),
		};

		manager = new AgentSessionManager();

		manager.createCyrusAgentSession(
			sessionId,
			"issue-1",
			{
				id: "issue-1",
				identifier: "TEST-100",
				title: "Test issue",
				description: "",
				branchName: "test-branch",
			},
			{ path: "/tmp/test", isGitWorktree: false },
		);
		manager.setActivitySink(sessionId, mockActivitySink);

		// Add a mock runner with formatter
		const mockRunner = {
			isRunning: () => true,
			getMessages: () => [],
			getFormatter: () => new ClaudeMessageFormatter(),
			getUsage: () => ({ inputTokens: 0, outputTokens: 0, totalCost: 0 }),
		};
		manager.addAgentRunner(sessionId, mockRunner as any);
	});

	it("fires registered callbacks when a tool result is processed", async () => {
		const callback = vi.fn();
		manager.onToolResult(callback);

		// Send assistant message with tool_use
		await manager.handleClaudeMessage(sessionId, {
			type: "assistant",
			message: {
				id: "msg-1",
				type: "message",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "mcp__linear__save_issue",
						input: { title: "New issue", teamId: "team-1" },
					},
				],
				model: "claude-sonnet-4-20250514",
				stop_reason: "tool_use",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		} as any);

		// Send user message with tool_result
		await manager.handleClaudeMessage(sessionId, {
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: JSON.stringify({
							id: "abc123",
							identifier: "TEST-200",
							url: "https://linear.app/test/issue/TEST-200/new-issue",
						}),
					},
				],
			},
		} as any);

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith({
			sessionId,
			toolName: "mcp__linear__save_issue",
			toolInput: { title: "New issue", teamId: "team-1" },
			toolResultContent: expect.stringContaining("TEST-200"),
			isError: false,
		});
	});

	it("fires multiple registered callbacks", async () => {
		const callback1 = vi.fn();
		const callback2 = vi.fn();
		manager.onToolResult(callback1);
		manager.onToolResult(callback2);

		// Send tool_use + tool_result
		await manager.handleClaudeMessage(sessionId, {
			type: "assistant",
			message: {
				id: "msg-1",
				type: "message",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-2",
						name: "Bash",
						input: { command: "ls" },
					},
				],
				model: "claude-sonnet-4-20250514",
				stop_reason: "tool_use",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		} as any);

		await manager.handleClaudeMessage(sessionId, {
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-2",
						content: "file1.ts\nfile2.ts",
					},
				],
			},
		} as any);

		expect(callback1).toHaveBeenCalledTimes(1);
		expect(callback2).toHaveBeenCalledTimes(1);
	});

	it("does not fire callback for error tool results when is_error is true", async () => {
		const callback = vi.fn();
		manager.onToolResult(callback);

		await manager.handleClaudeMessage(sessionId, {
			type: "assistant",
			message: {
				id: "msg-1",
				type: "message",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-3",
						name: "mcp__linear__save_issue",
						input: { title: "New issue" },
					},
				],
				model: "claude-sonnet-4-20250514",
				stop_reason: "tool_use",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		} as any);

		await manager.handleClaudeMessage(sessionId, {
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-3",
						is_error: true,
						content: "Error: failed to create issue",
					},
				],
			},
		} as any);

		// Callback still fires, but with isError: true
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(
			expect.objectContaining({ isError: true }),
		);
	});

	it("continues processing when a callback throws", async () => {
		const badCallback = vi.fn().mockImplementation(() => {
			throw new Error("callback error");
		});
		const goodCallback = vi.fn();
		manager.onToolResult(badCallback);
		manager.onToolResult(goodCallback);

		await manager.handleClaudeMessage(sessionId, {
			type: "assistant",
			message: {
				id: "msg-1",
				type: "message",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-4",
						name: "Bash",
						input: { command: "echo hi" },
					},
				],
				model: "claude-sonnet-4-20250514",
				stop_reason: "tool_use",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		} as any);

		await manager.handleClaudeMessage(sessionId, {
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-4",
						content: "hi",
					},
				],
			},
		} as any);

		// Both callbacks were called even though the first threw
		expect(badCallback).toHaveBeenCalledTimes(1);
		expect(goodCallback).toHaveBeenCalledTimes(1);
	});
});
