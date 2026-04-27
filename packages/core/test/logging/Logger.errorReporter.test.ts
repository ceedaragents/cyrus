import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ErrorReporter,
	ErrorReporterContext,
	ErrorReporterSeverity,
} from "../../src/error-reporting/ErrorReporter.js";
import {
	resetGlobalErrorReporter,
	setGlobalErrorReporter,
	setGlobalErrorTags,
} from "../../src/error-reporting/globalReporter.js";
import { createLogger } from "../../src/logging/index.js";

class FakeReporter implements ErrorReporter {
	readonly isEnabled = true;
	exceptions: Array<{ error: unknown; context?: ErrorReporterContext }> = [];
	messages: Array<{
		message: string;
		severity?: ErrorReporterSeverity;
		context?: ErrorReporterContext;
	}> = [];
	captureException(error: unknown, context?: ErrorReporterContext): void {
		this.exceptions.push({ error, context });
	}
	captureMessage(
		message: string,
		severity?: ErrorReporterSeverity,
		context?: ErrorReporterContext,
	): void {
		this.messages.push({ message, severity, context });
	}
	async flush(): Promise<boolean> {
		return true;
	}
}

describe("Logger error → reporter forwarding", () => {
	let reporter: FakeReporter;

	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		reporter = new FakeReporter();
		setGlobalErrorReporter(reporter);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		resetGlobalErrorReporter();
	});

	it("forwards an Error arg to captureException with component tag", () => {
		const log = createLogger({ component: "EdgeWorker" });
		const err = new Error("boom");
		log.error("Failed to fetch:", err);

		expect(reporter.exceptions).toHaveLength(1);
		expect(reporter.exceptions[0]?.error).toBe(err);
		expect(reporter.exceptions[0]?.context?.tags).toMatchObject({
			component: "EdgeWorker",
		});
		expect(reporter.exceptions[0]?.context?.extra).toMatchObject({
			message: "Failed to fetch:",
		});
	});

	it("captures a message at error severity when no Error arg is present", () => {
		const log = createLogger({ component: "PersistenceManager" });
		log.error("Disk full");

		expect(reporter.exceptions).toHaveLength(0);
		expect(reporter.messages).toHaveLength(1);
		expect(reporter.messages[0]?.severity).toBe("error");
		expect(reporter.messages[0]?.message).toBe("Disk full");
	});

	it("propagates LogContext fields as tags", () => {
		const log = createLogger({
			component: "ClaudeRunner",
			context: {
				sessionId: "session-abc",
				platform: "linear",
				issueIdentifier: "CYPACK-42",
				repository: "cyrus",
			},
		});
		log.error("Session error:", new Error("x"));

		expect(reporter.exceptions[0]?.context?.tags).toMatchObject({
			component: "ClaudeRunner",
			sessionId: "session-abc",
			platform: "linear",
			issueIdentifier: "CYPACK-42",
			repository: "cyrus",
		});
	});

	it("unwraps `{ error: Error }` shapes", () => {
		const log = createLogger({ component: "Transport" });
		const inner = new Error("inner");
		log.error("Webhook failed", { error: inner });

		expect(reporter.exceptions[0]?.error).toBe(inner);
	});

	it("does not forward when reporter is disabled (default Noop)", () => {
		resetGlobalErrorReporter(); // back to default Noop
		const log = createLogger({ component: "EdgeWorker" });
		expect(() => log.error("boom", new Error("x"))).not.toThrow();
		// No assertions on reporter — by definition Noop swallows
	});

	it("does not forward debug/info/warn", () => {
		const log = createLogger({ component: "EdgeWorker" });
		log.debug("d", new Error("d"));
		log.info("i", new Error("i"));
		log.warn("w", new Error("w"));
		expect(reporter.exceptions).toHaveLength(0);
		expect(reporter.messages).toHaveLength(0);
	});

	it("merges process-wide tags (e.g. team_id) into every forwarded event", () => {
		setGlobalErrorTags({ team_id: "team-42" });
		const log = createLogger({ component: "EdgeWorker" });
		log.error("Boom", new Error("x"));
		log.error("Plain message");

		expect(reporter.exceptions[0]?.context?.tags).toMatchObject({
			team_id: "team-42",
			component: "EdgeWorker",
		});
		expect(reporter.messages[0]?.context?.tags).toMatchObject({
			team_id: "team-42",
			component: "EdgeWorker",
		});
	});

	it("per-call context tags override global tags on key collision", () => {
		setGlobalErrorTags({ component: "should-not-win", team_id: "team-42" });
		const log = createLogger({ component: "EdgeWorker" });
		log.error("Boom", new Error("x"));
		expect(reporter.exceptions[0]?.context?.tags).toMatchObject({
			component: "EdgeWorker",
			team_id: "team-42",
		});
	});
});
