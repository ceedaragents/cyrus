import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryReporter } from "../src/TelemetryReporter";

describe("TelemetryReporter", () => {
	const callbackContext = {
		callbackToken: "test-token-abc123",
		callbackUrl: "https://cyhost.example.com/api/telemetry/callback",
		teamId: "team-uuid-123",
	};

	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
		});
		vi.stubGlobal("fetch", fetchSpy);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("posts error event to CYHOST callback URL with correct auth", async () => {
		const reporter = new TelemetryReporter(callbackContext);

		await reporter.reportError({
			error_type: "crash",
			error_message: "Uncaught exception in session",
			issue_id: "issue-123",
			issue_identifier: "CYPACK-100",
			session_id: "session-abc",
			duration_seconds: 120,
		});

		expect(fetchSpy).toHaveBeenCalledOnce();
		const [url, options] = fetchSpy.mock.calls[0]!;
		expect(url).toBe("https://cyhost.example.com/api/telemetry/callback");
		expect(options.method).toBe("POST");
		expect(options.headers["Content-Type"]).toBe("application/json");
		expect(options.headers.Authorization).toBe("Bearer test-token-abc123");

		const body = JSON.parse(options.body);
		expect(body.team_id).toBe("team-uuid-123");
		expect(body.event_type).toBe("agent_session_error");
		expect(body.error_type).toBe("crash");
		expect(body.error_message).toBe("Uncaught exception in session");
		expect(body.issue_id).toBe("issue-123");
		expect(body.issue_identifier).toBe("CYPACK-100");
		expect(body.session_id).toBe("session-abc");
		expect(body.duration_seconds).toBe(120);
		expect(body.timestamp).toBeDefined();
	});

	it("skips silently when no callback context is provided", async () => {
		const reporter = new TelemetryReporter(null);

		await reporter.reportError({
			error_type: "crash",
			error_message: "some error",
			session_id: "session-1",
		});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("does not throw when fetch fails", async () => {
		fetchSpy.mockRejectedValue(new Error("Network error"));
		const reporter = new TelemetryReporter(callbackContext);

		// Should not throw
		await expect(
			reporter.reportError({
				error_type: "rate_limit",
				error_message: "rate limited",
				session_id: "session-2",
			}),
		).resolves.toBeUndefined();
	});

	it("does not throw when fetch returns non-OK status", async () => {
		fetchSpy.mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
		});
		const reporter = new TelemetryReporter(callbackContext);

		await expect(
			reporter.reportError({
				error_type: "billing",
				error_message: "insufficient credits",
				session_id: "session-3",
			}),
		).resolves.toBeUndefined();
	});

	it("allows setting callback context after construction", async () => {
		const reporter = new TelemetryReporter(null);

		// Initially skips
		await reporter.reportError({
			error_type: "crash",
			error_message: "error",
			session_id: "s1",
		});
		expect(fetchSpy).not.toHaveBeenCalled();

		// After setting context, sends
		reporter.setCallbackContext(callbackContext);
		await reporter.reportError({
			error_type: "stall",
			error_message: "timeout",
			session_id: "s2",
		});
		expect(fetchSpy).toHaveBeenCalledOnce();

		const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
		expect(body.error_type).toBe("stall");
	});

	it("includes ISO8601 timestamp in payload", async () => {
		const reporter = new TelemetryReporter(callbackContext);

		await reporter.reportError({
			error_type: "max_turns",
			error_message: "exceeded max turns",
			session_id: "s3",
		});

		const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
		// Should be a valid ISO8601 date
		expect(() => new Date(body.timestamp)).not.toThrow();
		expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
	});
});
