import { AgentSessionStatus } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import type { IActivitySink } from "../src/sinks/IActivitySink";

describe("AgentSessionManager stop-session behavior", () => {
	let manager: AgentSessionManager;
	let mockActivitySink: IActivitySink;
	let postActivitySpy: any;
	const sessionId = "test-session-stop";
	const issueId = "issue-stop";
	let mockProcedureAnalyzer: any;

	const makeResultMessage = (overrides: Record<string, any> = {}): any => ({
		type: "result",
		subtype: "success",
		duration_ms: 1,
		duration_api_ms: 1,
		is_error: false,
		num_turns: 1,
		result: "Completed work",
		stop_reason: null,
		total_cost_usd: 0,
		usage: {
			input_tokens: 1,
			output_tokens: 1,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		},
		modelUsage: {},
		permission_denials: [],
		uuid: "result-1",
		session_id: "sdk-session",
		...overrides,
	});

	beforeEach(() => {
		mockActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-1" }),
			createAgentSession: vi.fn().mockResolvedValue("session-1"),
		};

		postActivitySpy = vi.spyOn(mockActivitySink, "postActivity");

		mockProcedureAnalyzer = {
			getNextSubroutine: vi.fn().mockReturnValue({ name: "verifications" }),
			getCurrentSubroutine: vi
				.fn()
				.mockReturnValue({ name: "coding-activity" }),
			advanceToNextSubroutine: vi.fn(),
			getLastSubroutineResult: vi
				.fn()
				.mockReturnValue("Recovered previous result"),
		};

		manager = new AgentSessionManager(
			undefined,
			undefined,
			mockProcedureAnalyzer,
		);

		manager.createCyrusAgentSession(
			sessionId,
			issueId,
			{
				id: issueId,
				identifier: "TEST-STOP",
				title: "Stop Session Test",
				description: "test",
				branchName: "test-stop",
			},
			{
				path: "/tmp/workspace",
				isGitWorktree: false,
			},
		);
		manager.setActivitySink(sessionId, mockActivitySink);
	});

	it("skips pipeline when stop is effective (non-success result)", async () => {
		const subroutineCompleteSpy = vi.fn();
		manager.on("subroutineComplete", subroutineCompleteSpy);

		manager.requestSessionStop(sessionId);

		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error_during_execution",
				is_error: true,
				errors: ["aborted by user"],
				result: undefined,
			}),
		);

		expect(subroutineCompleteSpy).not.toHaveBeenCalled();
		expect(
			mockProcedureAnalyzer.advanceToNextSubroutine,
		).not.toHaveBeenCalled();
		expect(manager.getSession(sessionId)?.status).toBe(
			AgentSessionStatus.Error,
		);
	});

	it("continues pipeline when stop arrives too late (session already completed successfully)", async () => {
		// This reproduces the real-world scenario:
		// 1. Claude finishes a subroutine (e.g., coding) and returns success
		// 2. User clicks "stop" in Linear because it appears hung between subroutines
		// 3. The stop flag gets set, but the result is already "success"
		// 4. The pipeline should CONTINUE because the work was completed
		const subroutineCompleteSpy = vi.fn();
		manager.on("subroutineComplete", subroutineCompleteSpy);

		// Simulate that Claude has been initialized (session needs a runner session ID)
		const session = manager.getSession(sessionId)!;
		session.claudeSessionId = "claude-session-123";

		manager.requestSessionStop(sessionId);

		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "success",
				result: "All work completed successfully",
			}),
		);

		// Pipeline should advance — the stop arrived too late
		expect(subroutineCompleteSpy).toHaveBeenCalled();
		expect(mockProcedureAnalyzer.advanceToNextSubroutine).toHaveBeenCalled();
		// Session should be marked Complete, not Error
		expect(manager.getSession(sessionId)?.status).toBe(
			AgentSessionStatus.Complete,
		);
	});

	it("does not recover-and-advance for non max-turn execution errors", async () => {
		const subroutineCompleteSpy = vi.fn();
		manager.on("subroutineComplete", subroutineCompleteSpy);

		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error_during_execution",
				is_error: true,
				errors: ["aborted by user"],
				result: undefined,
			}),
		);

		expect(subroutineCompleteSpy).not.toHaveBeenCalled();
		expect(
			mockProcedureAnalyzer.advanceToNextSubroutine,
		).not.toHaveBeenCalled();
	});

	it("advances pipeline when success result has empty result text", async () => {
		// This is the root cause of the pipeline hang bug:
		// Some subroutines (e.g., changelog-update) complete with subtype=success
		// but result=undefined. Previously the pipeline silently died because the
		// condition was: "result" in resultMessage && resultMessage.result
		const subroutineCompleteSpy = vi.fn();
		manager.on("subroutineComplete", subroutineCompleteSpy);

		const session = manager.getSession(sessionId)!;
		session.claudeSessionId = "claude-session-456";

		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "success",
				result: undefined, // <-- This is the trigger: success with no result text
			}),
		);

		expect(subroutineCompleteSpy).toHaveBeenCalled();
		expect(mockProcedureAnalyzer.advanceToNextSubroutine).toHaveBeenCalled();
		expect(manager.getSession(sessionId)?.status).toBe(
			AgentSessionStatus.Complete,
		);
	});

	it("posts actual error message to Linear for usage limit errors (not generic)", async () => {
		const usageLimitError =
			"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Feb 16th, 2026 8:09 PM.";

		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error_during_execution",
				is_error: true,
				errors: [usageLimitError],
				result: undefined,
			}),
		);

		const postActivityCalls = postActivitySpy.mock.calls;
		const errorActivity = postActivityCalls.find(
			(call: any[]) => call[1]?.type === "error",
		);
		expect(errorActivity).toBeDefined();
		expect(errorActivity![1].body).toBe(usageLimitError);
	});
});
