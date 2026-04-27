import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ErrorReporter,
	ErrorReporterContext,
	ErrorReporterLogAttributes,
	ErrorReporterLogLevel,
	ErrorReporterSeverity,
} from "../../src/error-reporting/ErrorReporter.js";
import {
	resetGlobalErrorReporter,
	setGlobalErrorReporter,
	setGlobalErrorTags,
} from "../../src/error-reporting/globalReporter.js";
import { createLogger, LogLevel } from "../../src/logging/index.js";

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
	logs: Array<{
		level: ErrorReporterLogLevel;
		message: string;
		attributes?: ErrorReporterLogAttributes;
	}> = [];
	log(
		level: ErrorReporterLogLevel,
		message: string,
		attributes?: ErrorReporterLogAttributes,
	): void {
		this.logs.push({ level, message, attributes });
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

	it("does not capture debug/info/warn as Issues, only as structured Logs", () => {
		// At DEBUG level, debug/info/warn are forwarded to the structured log
		// stream but never produce Sentry Issues.
		const log = createLogger({
			component: "EdgeWorker",
			level: LogLevel.DEBUG,
		});
		log.debug("d", new Error("d"));
		log.info("i", new Error("i"));
		log.warn("w", new Error("w"));
		expect(reporter.exceptions).toHaveLength(0);
		expect(reporter.messages).toHaveLength(0);
		expect(reporter.logs.map((l) => l.level)).toEqual([
			"debug",
			"info",
			"warn",
		]);
	});

	it("forwards every log level to reporter.log with team_id and component attributes", () => {
		setGlobalErrorTags({ team_id: "team-42" });
		const log = createLogger({
			component: "EdgeWorker",
			level: LogLevel.DEBUG,
			context: { sessionId: "s-1", issueIdentifier: "CYPACK-7" },
		});
		log.debug("d");
		log.info("i");
		log.warn("w");
		log.error("e");

		expect(reporter.logs.map((l) => l.level)).toEqual([
			"debug",
			"info",
			"warn",
			"error",
		]);
		for (const entry of reporter.logs) {
			expect(entry.attributes).toMatchObject({
				team_id: "team-42",
				component: "EdgeWorker",
				sessionId: "s-1",
				issueIdentifier: "CYPACK-7",
			});
		}
	});

	it("gates Sentry Logs forwarding on the configured log level", () => {
		// At default INFO level, debug calls are dropped from both console and Sentry Logs.
		const log = createLogger({ component: "EdgeWorker", level: LogLevel.INFO });
		log.debug("dropped");
		log.info("kept");
		expect(reporter.logs.map((l) => l.message)).toEqual(["kept"]);

		// At WARN level, info is also dropped.
		const warnLog = createLogger({ component: "X", level: LogLevel.WARN });
		warnLog.info("dropped-too");
		warnLog.warn("kept-warn");
		expect(
			reporter.logs.filter((l) => l.attributes?.component === "X"),
		).toHaveLength(1);
	});

	it("error always captures as a Sentry Issue regardless of CYRUS_LOG_LEVEL=SILENT", () => {
		const log = createLogger({ component: "Critical", level: LogLevel.SILENT });
		log.error("boom", new Error("x"));
		// Issue capture happens — the level only controls verbosity / log volume.
		expect(reporter.exceptions).toHaveLength(1);
		// Structured log forwarding is gated by level, so silent level drops it.
		expect(reporter.logs).toHaveLength(0);
	});

	it("summarises Error trailing args into a primitive attribute", () => {
		const log = createLogger({ component: "Transport" });
		log.error("Failed", new Error("boom"));
		const errLog = reporter.logs.find((l) => l.level === "error");
		expect(errLog?.attributes?.args).toContain("Error: boom");
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

	it("sets a stable fingerprint that templatizes IDs and paths", () => {
		const log = createLogger({ component: "EdgeWorker" });
		log.error("Failed for issue CYPACK-42 at /Users/x/work/foo.ts");
		log.error("Failed for issue CYPACK-99 at /Users/y/work/bar.ts");

		// Both messages should collapse to the same fingerprint group.
		const fp0 = reporter.messages[0]?.context?.fingerprint;
		const fp1 = reporter.messages[1]?.context?.fingerprint;
		expect(fp0).toBeDefined();
		expect(fp0).toEqual(fp1);
		expect(fp0?.[0]).toBe("logger");
		expect(fp0?.[1]).toBe("EdgeWorker");
		expect(fp0?.[2]).toContain("<id>");
		expect(fp0?.[2]).toContain("<path>");
	});

	it("attaches a fingerprint when forwarding an Error", () => {
		const log = createLogger({ component: "ClaudeRunner" });
		log.error(
			"Session failed for c5c1fc00-1234-1234-1234-c5c1fc00aaaa",
			new Error("x"),
		);
		const fp = reporter.exceptions[0]?.context?.fingerprint;
		expect(fp?.[2]).toContain("<uuid>");
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
