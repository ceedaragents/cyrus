import { LinearClient } from "@linear/sdk";
import type { SDKResultMessage } from "cyrus-claude-runner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		createAgentActivity: vi.fn(),
	})),
	LinearDocument: {
		AgentSessionType: {
			CommentThread: "comment_thread",
		},
		AgentSessionStatus: {
			Active: "active",
			Complete: "complete",
			Error: "error",
		},
	},
}));

describe("AgentSessionManager - result handling", () => {
	const sessionId = "session-456";
	const issueId = "ISSUE-456";

	let manager: AgentSessionManager;
	let mockLinearClient: any;
	let createAgentActivitySpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		mockLinearClient = new LinearClient({ apiKey: "test" });
		createAgentActivitySpy = vi.spyOn(mockLinearClient, "createAgentActivity");
		createAgentActivitySpy.mockResolvedValue({
			success: true,
			agentActivity: Promise.resolve({ id: "activity-xyz" }),
		});

		manager = new AgentSessionManager(mockLinearClient);

		manager.createLinearAgentSession(
			sessionId,
			issueId,
			{
				id: issueId,
				identifier: "ISSUE-456",
				title: "Handle result mapping",
				description: "Investigate result processing",
				branchName: "feature/result-mapping",
			},
			{
				path: "/tmp/workspace",
				isGitWorktree: false,
			},
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("posts inline ❌ thought for non-terminal result errors", async () => {
		const resultMessage: SDKResultMessage = {
			type: "result",
			subtype: "error_during_execution",
			session_id: "claude-session-error",
			duration_ms: 1200,
			duration_api_ms: 800,
			num_turns: 2,
			total_cost_usd: 0.05,
			usage: {
				input_tokens: 120,
				output_tokens: 40,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
			permission_denials: [],
			// Intentionally omit is_error to simulate missing field
		} as any;
		(resultMessage as any).error = { message: "Tool execution failed" };

		await manager.completeSession(sessionId, resultMessage);

		const call = createAgentActivitySpy.mock.calls[0];
		expect(call).toBeDefined();
		const { content } = call[0];
		expect(content.type).toBe("thought");
		expect(content.body).toMatch(/^❌/);
		expect(content.body).toContain("Tool execution failed");
	});

	it("posts error card for terminal result failures", async () => {
		const resultMessage: SDKResultMessage = {
			type: "result",
			subtype: "error_max_turns",
			session_id: "claude-session-max-turns",
			duration_ms: 1500,
			duration_api_ms: 900,
			num_turns: 5,
			total_cost_usd: 0.08,
			usage: {
				input_tokens: 200,
				output_tokens: 60,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
			permission_denials: [],
			// Simulate missing is_error flag
		} as any;
		(resultMessage as any).error = "Reached max turns";

		await manager.completeSession(sessionId, resultMessage);

		const call = createAgentActivitySpy.mock.calls[0];
		expect(call).toBeDefined();
		const { content } = call[0];
		expect(content.type).toBe("error");
		expect(content.body).toContain("max");
	});

	it("treats missing subtype as terminal error", async () => {
		const resultMessage = {
			type: "result",
			session_id: "claude-session-missing-subtype",
			duration_ms: 1700,
			duration_api_ms: 950,
			num_turns: 3,
			total_cost_usd: 0.06,
			usage: {
				input_tokens: 140,
				output_tokens: 55,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
			permission_denials: [],
		} as any as SDKResultMessage;
		(resultMessage as any).error = "Runner exited unexpectedly";

		await manager.completeSession(sessionId, resultMessage);

		const call = createAgentActivitySpy.mock.calls[0];
		expect(call).toBeDefined();
		const { content } = call[0];
		expect(content.type).toBe("error");
		expect(content.body).toContain("Runner exited unexpectedly");
	});

	it("posts response for successful results", async () => {
		const resultMessage: SDKResultMessage = {
			type: "result",
			subtype: "success",
			session_id: "claude-session-success",
			duration_ms: 800,
			duration_api_ms: 500,
			is_error: false,
			num_turns: 1,
			result: "All tasks completed successfully.",
			total_cost_usd: 0.02,
			usage: {
				input_tokens: 90,
				output_tokens: 35,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
			permission_denials: [],
		};

		await manager.completeSession(sessionId, resultMessage);

		const call = createAgentActivitySpy.mock.calls[0];
		expect(call).toBeDefined();
		const { content } = call[0];
		expect(content.type).toBe("response");
		expect(content.body).toBe("All tasks completed successfully.");
	});
});
