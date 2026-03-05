import type { SDKAssistantMessage, SDKUserMessage } from "cyrus-claude-runner";
import { ClaudeMessageFormatter } from "cyrus-claude-runner";
import type { IAgentRunner } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import type { IActivitySink } from "../src/sinks/IActivitySink";

/**
 * Helper to create a mock IAgentRunner with a ClaudeMessageFormatter
 */
function createMockRunner(): IAgentRunner {
	const formatter = new ClaudeMessageFormatter();
	return {
		getFormatter: () => formatter,
		supportsStreamingInput: false,
	} as unknown as IAgentRunner;
}

/**
 * Helper to create an SDK assistant message with multiple parallel tool_use blocks
 */
function createParallelAssistantMessage(
	tools: Array<{ id: string; name: string; input: any }>,
	sessionId = "claude-session-1",
): SDKAssistantMessage {
	return {
		type: "assistant",
		session_id: sessionId,
		message: {
			role: "assistant",
			content: tools.map((t) => ({
				type: "tool_use" as const,
				id: t.id,
				name: t.name,
				input: t.input,
			})),
		},
	} as SDKAssistantMessage;
}

/**
 * Helper to create an SDK user message with multiple parallel tool_result blocks
 */
function createParallelUserMessage(
	results: Array<{
		toolUseId: string;
		content: string;
		isError?: boolean;
	}>,
	sessionId = "claude-session-1",
): SDKUserMessage {
	return {
		type: "user",
		session_id: sessionId,
		message: {
			role: "user",
			content: results.map((r) => ({
				type: "tool_result" as const,
				tool_use_id: r.toolUseId,
				content: r.content,
				is_error: r.isError || false,
			})),
		},
	} as SDKUserMessage;
}

/**
 * Helper to create a single-tool assistant message
 */
function createSingleAssistantMessage(
	id: string,
	name: string,
	input: any,
	sessionId = "claude-session-1",
): SDKAssistantMessage {
	return createParallelAssistantMessage([{ id, name, input }], sessionId);
}

/**
 * Helper to create a single-tool user result message
 */
function createSingleUserMessage(
	toolUseId: string,
	content: string,
	isError = false,
	sessionId = "claude-session-1",
): SDKUserMessage {
	return createParallelUserMessage(
		[{ toolUseId, content, isError }],
		sessionId,
	);
}

describe("AgentSessionManager - Parallel Tool Activities", () => {
	let manager: AgentSessionManager;
	let mockActivitySink: IActivitySink;
	let postActivitySpy: ReturnType<typeof vi.fn>;
	const sessionId = "test-session-parallel";
	const issueId = "issue-parallel";

	beforeEach(() => {
		mockActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-123" }),
			createAgentSession: vi.fn().mockResolvedValue("session-123"),
		};

		postActivitySpy = vi.spyOn(mockActivitySink, "postActivity");
		manager = new AgentSessionManager(mockActivitySink);

		// Create a test session with a mock runner that has a formatter
		manager.createLinearAgentSession(
			sessionId,
			issueId,
			{
				id: issueId,
				identifier: "TEST-PAR",
				title: "Parallel tools test",
				description: "",
				branchName: "test-branch",
			},
			{
				path: "/test/workspace",
				isGitWorktree: false,
			},
		);
		manager.addAgentRunner(sessionId, createMockRunner());
	});

	describe("parallel tool_use detection in single message", () => {
		it("should post unified ephemeral for multiple tool_use blocks in one message", async () => {
			// Send an assistant message with 3 parallel Glob tool calls
			const assistantMsg = createParallelAssistantMessage([
				{
					id: "tool-1",
					name: "Glob",
					input: { pattern: "**/*.ts", path: "/src" },
				},
				{
					id: "tool-2",
					name: "Glob",
					input: { pattern: "**/*.js", path: "/lib" },
				},
				{
					id: "tool-3",
					name: "Grep",
					input: { pattern: "TODO", path: "/src" },
				},
			]);

			await manager.handleClaudeMessage(sessionId, assistantMsg);

			// Should have posted a unified ephemeral thought (not 3 individual activities)
			// The first tool posts normally (ephemeral), then the second triggers the group
			const calls = postActivitySpy.mock.calls;

			// Find the parallel group activity (a thought with "Running N" in the body)
			const groupActivity = calls.find(
				(call: any[]) =>
					call[1]?.type === "thought" &&
					typeof call[1]?.body === "string" &&
					call[1].body.includes("Running 3"),
			);
			expect(groupActivity).toBeDefined();
			expect(groupActivity![2]).toEqual({ ephemeral: true });
		});

		it("should include all tool names in the parallel group activity", async () => {
			const assistantMsg = createParallelAssistantMessage([
				{
					id: "tool-1",
					name: "Read",
					input: { file_path: "/src/index.ts" },
				},
				{
					id: "tool-2",
					name: "Grep",
					input: { pattern: "import", path: "/src" },
				},
			]);

			await manager.handleClaudeMessage(sessionId, assistantMsg);

			const calls = postActivitySpy.mock.calls;
			const groupActivity = calls.find(
				(call: any[]) =>
					call[1]?.type === "thought" &&
					typeof call[1]?.body === "string" &&
					call[1].body.includes("Running 2"),
			);
			expect(groupActivity).toBeDefined();

			const body = groupActivity![1].body;
			expect(body).toContain("Read");
			expect(body).toContain("Grep");
			expect(body).toContain("⏳"); // pending status
		});
	});

	describe("parallel tool_result handling", () => {
		it("should suppress individual result activities for parallel tools", async () => {
			// Send parallel tool calls
			const assistantMsg = createParallelAssistantMessage([
				{
					id: "tool-1",
					name: "Glob",
					input: { pattern: "**/*.ts" },
				},
				{
					id: "tool-2",
					name: "Glob",
					input: { pattern: "**/*.js" },
				},
			]);
			await manager.handleClaudeMessage(sessionId, assistantMsg);
			postActivitySpy.mockClear();

			// Send results for both tools
			const userMsg = createParallelUserMessage([
				{
					toolUseId: "tool-1",
					content: "file1.ts\nfile2.ts",
				},
				{
					toolUseId: "tool-2",
					content: "file1.js\nfile2.js",
				},
			]);
			await manager.handleClaudeMessage(sessionId, userMsg);

			// Should NOT have posted individual action activities for each result
			const actionCalls = postActivitySpy.mock.calls.filter(
				(call: any[]) => call[1]?.type === "action",
			);
			expect(actionCalls).toHaveLength(0);
		});

		it("should post updated ephemeral when partial results arrive", async () => {
			// Send 3 parallel tool calls
			const assistantMsg = createParallelAssistantMessage([
				{
					id: "tool-1",
					name: "Glob",
					input: { pattern: "**/*.ts" },
				},
				{
					id: "tool-2",
					name: "Glob",
					input: { pattern: "**/*.js" },
				},
				{
					id: "tool-3",
					name: "Grep",
					input: { pattern: "import" },
				},
			]);
			await manager.handleClaudeMessage(sessionId, assistantMsg);
			postActivitySpy.mockClear();

			// Send result for first tool only
			const partialResult = createParallelUserMessage([
				{ toolUseId: "tool-1", content: "file1.ts" },
			]);
			await manager.handleClaudeMessage(sessionId, partialResult);

			// Should have posted an updated ephemeral showing 1/3 complete
			const calls = postActivitySpy.mock.calls;
			const groupUpdate = calls.find(
				(call: any[]) =>
					call[1]?.type === "thought" &&
					typeof call[1]?.body === "string" &&
					call[1].body.includes("1/3 complete"),
			);
			expect(groupUpdate).toBeDefined();
			expect(groupUpdate![2]).toEqual({ ephemeral: true });
		});
	});

	describe("single tool handling (no grouping)", () => {
		it("should handle single tool calls normally without grouping", async () => {
			// Send a single tool call
			const assistantMsg = createSingleAssistantMessage("tool-1", "Read", {
				file_path: "/src/index.ts",
			});
			await manager.handleClaudeMessage(sessionId, assistantMsg);

			// Should post a normal ephemeral action (not a group thought)
			const calls = postActivitySpy.mock.calls;
			const actionCall = calls.find(
				(call: any[]) => call[1]?.type === "action",
			);
			expect(actionCall).toBeDefined();
			expect(actionCall![1]?.action).toBe("Read");

			postActivitySpy.mockClear();

			// Send result
			const userMsg = createSingleUserMessage("tool-1", "file content here");
			await manager.handleClaudeMessage(sessionId, userMsg);

			// Should post a normal action with result
			const resultCalls = postActivitySpy.mock.calls;
			const resultAction = resultCalls.find(
				(call: any[]) =>
					call[1]?.type === "action" && typeof call[1]?.result === "string",
			);
			expect(resultAction).toBeDefined();
		});
	});

	describe("formatter - formatParallelToolGroup", () => {
		const formatter = new ClaudeMessageFormatter();

		it("should format parallel tools with tree structure", () => {
			const result = formatter.formatParallelToolGroup([
				{
					name: "Glob",
					input: { pattern: "**/*.ts" },
					status: "pending",
				},
				{
					name: "Grep",
					input: { pattern: "TODO", path: "/src" },
					status: "pending",
				},
			]);

			expect(result).toContain("Running 2 parallel tools");
			expect(result).toContain("0/2 complete");
			expect(result).toContain("├─");
			expect(result).toContain("└─");
			expect(result).toContain("⏳");
			expect(result).toContain("Glob");
			expect(result).toContain("Grep");
		});

		it("should show completed status icons", () => {
			const result = formatter.formatParallelToolGroup([
				{
					name: "Glob",
					input: { pattern: "**/*.ts" },
					status: "completed",
				},
				{
					name: "Grep",
					input: { pattern: "TODO" },
					status: "pending",
				},
			]);

			expect(result).toContain("1/2 complete");
			expect(result).toContain("✅");
			expect(result).toContain("⏳");
		});

		it("should show error icon for failed tools", () => {
			const result = formatter.formatParallelToolGroup([
				{
					name: "Bash",
					input: { command: "npm test" },
					status: "completed",
					isError: true,
				},
				{
					name: "Read",
					input: { file_path: "/test.ts" },
					status: "completed",
				},
			]);

			expect(result).toContain("2/2 complete");
			expect(result).toContain("❌");
			expect(result).toContain("✅");
		});

		it("should use tool name for header when all tools are same type", () => {
			const result = formatter.formatParallelToolGroup([
				{
					name: "Glob",
					input: { pattern: "**/*.ts" },
					status: "pending",
				},
				{
					name: "Glob",
					input: { pattern: "**/*.js" },
					status: "pending",
				},
				{
					name: "Glob",
					input: { pattern: "**/*.py" },
					status: "pending",
				},
			]);

			expect(result).toContain("Running 3 Glob calls");
		});

		it("should use 'parallel tools' for header when mixed tool types", () => {
			const result = formatter.formatParallelToolGroup([
				{
					name: "Glob",
					input: { pattern: "**/*.ts" },
					status: "pending",
				},
				{
					name: "Grep",
					input: { pattern: "TODO" },
					status: "pending",
				},
			]);

			expect(result).toContain("Running 2 parallel tools");
		});

		it("should truncate long parameters", () => {
			const result = formatter.formatParallelToolGroup([
				{
					name: "Grep",
					input: {
						pattern:
							"a very long pattern that should be truncated because it exceeds the maximum length allowed for display",
					},
					status: "pending",
				},
			]);

			expect(result).toContain("…");
		});
	});
});
