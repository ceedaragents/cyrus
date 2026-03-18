import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryReporter } from "../src/TelemetryReporter.js";

describe("TelemetryReporter", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		vi.stubGlobal("fetch", mockFetch);
		mockFetch.mockResolvedValue({ ok: true, status: 200 });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("isConfigured", () => {
		it("returns true when apiKey and hostUrl are set", () => {
			const reporter = new TelemetryReporter({
				apiKey: "test-key",
				hostUrl: "https://api.example.com",
			});
			expect(reporter.isConfigured).toBe(true);
		});

		it("returns false when apiKey is missing", () => {
			const reporter = new TelemetryReporter({
				apiKey: "",
				hostUrl: "https://api.example.com",
			});
			expect(reporter.isConfigured).toBe(false);
		});

		it("returns false when hostUrl is missing", () => {
			const reporter = new TelemetryReporter({
				apiKey: "test-key",
				hostUrl: "",
			});
			expect(reporter.isConfigured).toBe(false);
		});
	});

	describe("reportError", () => {
		it("sends error event to CYHOST telemetry endpoint", async () => {
			const reporter = new TelemetryReporter({
				apiKey: "test-api-key",
				hostUrl: "https://api.example.com",
				teamId: "team-123",
			});

			await reporter.reportError({
				error_type: "crash",
				error_message: "Session crashed",
				issue_id: "issue-1",
				issue_identifier: "TEST-1",
				session_id: "session-1",
				duration_seconds: 120,
			});

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe("https://api.example.com/api/telemetry/callback");
			expect(options.method).toBe("POST");
			expect(options.headers).toEqual({
				"Content-Type": "application/json",
				Authorization: "Bearer test-api-key",
			});

			const body = JSON.parse(options.body);
			expect(body.team_id).toBe("team-123");
			expect(body.event_type).toBe("agent_session_error");
			expect(body.error_type).toBe("crash");
			expect(body.error_message).toBe("Session crashed");
			expect(body.issue_id).toBe("issue-1");
			expect(body.issue_identifier).toBe("TEST-1");
			expect(body.session_id).toBe("session-1");
			expect(body.duration_seconds).toBe(120);
			expect(body.timestamp).toBeDefined();
		});

		it("skips silently when not configured", async () => {
			const reporter = new TelemetryReporter({
				apiKey: "",
				hostUrl: "",
			});

			await reporter.reportError({
				error_type: "max_turns",
				error_message: "Max turns exceeded",
				issue_id: "issue-1",
				issue_identifier: "TEST-1",
				session_id: "session-1",
				duration_seconds: 60,
			});

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("logs warning on non-ok response but does not throw", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			});

			const reporter = new TelemetryReporter({
				apiKey: "test-key",
				hostUrl: "https://api.example.com",
			});

			// Should not throw
			await reporter.reportError({
				error_type: "stall",
				error_message: "Session stalled",
				issue_id: "issue-1",
				issue_identifier: "TEST-1",
				session_id: "session-1",
				duration_seconds: 300,
			});

			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it("catches and logs fetch errors without throwing", async () => {
			mockFetch.mockRejectedValue(new Error("Network error"));

			const reporter = new TelemetryReporter({
				apiKey: "test-key",
				hostUrl: "https://api.example.com",
			});

			// Should not throw
			await reporter.reportError({
				error_type: "crash",
				error_message: "Session crashed",
				issue_id: "issue-1",
				issue_identifier: "TEST-1",
				session_id: "session-1",
				duration_seconds: 10,
			});
		});
	});

	describe("setTeamId", () => {
		it("updates the team ID after construction", async () => {
			const reporter = new TelemetryReporter({
				apiKey: "test-key",
				hostUrl: "https://api.example.com",
			});

			reporter.setTeamId("new-team-id");

			await reporter.reportError({
				error_type: "billing",
				error_message: "Billing error",
				issue_id: "issue-1",
				issue_identifier: "TEST-1",
				session_id: "session-1",
				duration_seconds: 5,
			});

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.team_id).toBe("new-team-id");
		});
	});

	describe("fromEnv", () => {
		it("reads CYRUS_API_KEY and CYRUS_HOST_URL from environment", () => {
			process.env.CYRUS_API_KEY = "env-api-key";
			process.env.CYRUS_HOST_URL = "https://env.example.com";

			const reporter = TelemetryReporter.fromEnv();
			expect(reporter.isConfigured).toBe(true);

			delete process.env.CYRUS_API_KEY;
			delete process.env.CYRUS_HOST_URL;
		});

		it("returns unconfigured reporter when env vars are missing", () => {
			delete process.env.CYRUS_API_KEY;
			delete process.env.CYRUS_HOST_URL;

			const reporter = TelemetryReporter.fromEnv();
			expect(reporter.isConfigured).toBe(false);
		});
	});
});
