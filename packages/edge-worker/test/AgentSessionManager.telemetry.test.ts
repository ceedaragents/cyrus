import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import type { IActivitySink } from "../src/sinks/IActivitySink";
import { TelemetryReporter } from "../src/TelemetryReporter";

describe("AgentSessionManager telemetry integration", () => {
	let manager: AgentSessionManager;
	let mockActivitySink: IActivitySink;
	let reportErrorSpy: ReturnType<typeof vi.fn>;
	let mockProcedureAnalyzer: any;
	const sessionId = "test-session-telemetry";
	const issueId = "issue-telemetry";

	beforeEach(() => {
		mockActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-1" }),
			createAgentSession: vi.fn().mockResolvedValue("session-1"),
		};

		mockProcedureAnalyzer = {
			getNextSubroutine: vi.fn().mockReturnValue(null),
			getCurrentSubroutine: vi.fn().mockReturnValue(null),
			advanceToNextSubroutine: vi.fn(),
			getLastSubroutineResult: vi.fn().mockReturnValue(null),
		};

		manager = new AgentSessionManager(
			undefined,
			undefined,
			mockProcedureAnalyzer,
		);

		// Create a mock telemetry reporter with spied reportError
		const reporter = new TelemetryReporter({
			callbackToken: "token",
			callbackUrl: "https://host/callback",
			teamId: "team-1",
		});
		reportErrorSpy = vi
			.spyOn(reporter, "reportError")
			.mockResolvedValue(undefined);
		manager.setTelemetryReporter(reporter);

		manager.createLinearAgentSession(
			sessionId,
			issueId,
			{
				id: issueId,
				identifier: "TEST-TEL",
				title: "Telemetry Test Issue",
				description: "test",
				branchName: "test-telemetry",
			},
			{
				path: "/tmp/workspace",
				isGitWorktree: false,
			},
		);
		manager.setActivitySink(sessionId, mockActivitySink);
	});

	const makeResultMessage = (overrides: Record<string, any> = {}) => ({
		type: "result" as const,
		subtype: "error" as string,
		duration_ms: 60000,
		duration_api_ms: 55000,
		is_error: true,
		num_turns: 10,
		result: "",
		stop_reason: null,
		total_cost_usd: 0.5,
		usage: {
			input_tokens: 100,
			output_tokens: 50,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		},
		...overrides,
	});

	it("reports error telemetry when session completes with error", async () => {
		await manager.completeSession(
			sessionId,
			makeResultMessage({ subtype: "error", is_error: true }),
		);

		expect(reportErrorSpy).toHaveBeenCalledOnce();
		const errorEvent = reportErrorSpy.mock.calls[0]![0];
		expect(errorEvent.error_type).toBe("crash");
		expect(errorEvent.session_id).toBe(sessionId);
		expect(errorEvent.issue_id).toBe(issueId);
		expect(errorEvent.issue_identifier).toBe("TEST-TEL");
		expect(errorEvent.duration_seconds).toBeTypeOf("number");
	});

	it("classifies error_max_turns as max_turns", async () => {
		await manager.completeSession(
			sessionId,
			makeResultMessage({ subtype: "error_max_turns" }),
		);

		expect(reportErrorSpy).toHaveBeenCalledOnce();
		expect(reportErrorSpy.mock.calls[0]![0].error_type).toBe("max_turns");
	});

	it("classifies rate_limit errors", async () => {
		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error",
				errors: ["rate_limit: too many requests"],
			}),
		);

		expect(reportErrorSpy).toHaveBeenCalledOnce();
		expect(reportErrorSpy.mock.calls[0]![0].error_type).toBe("rate_limit");
	});

	it("classifies billing errors", async () => {
		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error",
				errors: ["billing error: insufficient_credits"],
			}),
		);

		expect(reportErrorSpy).toHaveBeenCalledOnce();
		expect(reportErrorSpy.mock.calls[0]![0].error_type).toBe("billing");
	});

	it("classifies timeout errors as stall", async () => {
		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error",
				result: "Session timed out waiting for response",
			}),
		);

		expect(reportErrorSpy).toHaveBeenCalledOnce();
		expect(reportErrorSpy.mock.calls[0]![0].error_type).toBe("stall");
	});

	it("does not report telemetry for successful sessions", async () => {
		await manager.completeSession(sessionId, {
			type: "result",
			subtype: "success",
			duration_ms: 1000,
			duration_api_ms: 900,
			is_error: false,
			num_turns: 5,
			result: "Task completed successfully",
			stop_reason: null,
			total_cost_usd: 0.1,
			usage: {
				input_tokens: 50,
				output_tokens: 30,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation: null,
			},
		});

		expect(reportErrorSpy).not.toHaveBeenCalled();
	});

	it("does not block session completion if telemetry fails", async () => {
		reportErrorSpy.mockRejectedValue(new Error("Telemetry failed"));

		// Should not throw
		await expect(
			manager.completeSession(
				sessionId,
				makeResultMessage({ subtype: "error" }),
			),
		).resolves.toBeUndefined();
	});

	it("extracts error message from errors array", async () => {
		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error",
				errors: ["First error", "Second error"],
			}),
		);

		expect(reportErrorSpy).toHaveBeenCalledOnce();
		expect(reportErrorSpy.mock.calls[0]![0].error_message).toBe(
			"First error; Second error",
		);
	});

	it("extracts error message from result text when no errors array", async () => {
		await manager.completeSession(
			sessionId,
			makeResultMessage({
				subtype: "error",
				result: "Something went wrong in the session",
			}),
		);

		expect(reportErrorSpy).toHaveBeenCalledOnce();
		expect(reportErrorSpy.mock.calls[0]![0].error_message).toBe(
			"Something went wrong in the session",
		);
	});
});
