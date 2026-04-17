import { diag } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
	InMemoryLogRecordExporter,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, LogLevel } from "../../src/logging/index.js";
import {
	initTelemetry,
	isTelemetryActive,
	severityNumberFor,
	severityTextFor,
	shutdownTelemetry,
} from "../../src/logging/telemetry.js";

describe("telemetry", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(async () => {
		await shutdownTelemetry();
		vi.restoreAllMocks();
		delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
		delete process.env.OTEL_SERVICE_NAME;
		delete process.env.OTEL_SDK_DISABLED;
		delete process.env.OTEL_LOG_LEVEL;
	});

	describe("severity mapping", () => {
		it("maps log levels to OTel severity numbers per spec", () => {
			expect(severityNumberFor(LogLevel.DEBUG)).toBe(SeverityNumber.DEBUG);
			expect(severityNumberFor(LogLevel.INFO)).toBe(SeverityNumber.INFO);
			expect(severityNumberFor(LogLevel.WARN)).toBe(SeverityNumber.WARN);
			expect(severityNumberFor(LogLevel.ERROR)).toBe(SeverityNumber.ERROR);
			expect(severityNumberFor(LogLevel.SILENT)).toBe(
				SeverityNumber.UNSPECIFIED,
			);
		});

		it("produces readable severity text", () => {
			expect(severityTextFor(LogLevel.DEBUG)).toBe("DEBUG");
			expect(severityTextFor(LogLevel.INFO)).toBe("INFO");
			expect(severityTextFor(LogLevel.WARN)).toBe("WARN");
			expect(severityTextFor(LogLevel.ERROR)).toBe("ERROR");
		});
	});

	describe("initTelemetry", () => {
		it("does nothing when no endpoint or processor is provided", () => {
			const activated = initTelemetry({});
			expect(activated).toBe(false);
			expect(isTelemetryActive()).toBe(false);
		});

		it("activates when an endpoint is configured", () => {
			const activated = initTelemetry({
				endpoint: "http://localhost:4318/v1/logs",
			});
			expect(activated).toBe(true);
			expect(isTelemetryActive()).toBe(true);
		});

		it("activates from OTEL_EXPORTER_OTLP_ENDPOINT env var", () => {
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
			expect(initTelemetry({})).toBe(true);
			expect(isTelemetryActive()).toBe(true);
		});

		it("honours OTEL_SDK_DISABLED=true even when endpoint is set", () => {
			process.env.OTEL_SDK_DISABLED = "true";
			expect(initTelemetry({ endpoint: "http://localhost:4318/v1/logs" })).toBe(
				false,
			);
			expect(isTelemetryActive()).toBe(false);
		});

		it("respects explicit enabled=false", () => {
			expect(
				initTelemetry({
					enabled: false,
					endpoint: "http://localhost:4318/v1/logs",
				}),
			).toBe(false);
		});

		it("activates with a custom processor even without an endpoint", () => {
			const exporter = new InMemoryLogRecordExporter();
			const processor = new SimpleLogRecordProcessor(exporter);
			expect(initTelemetry({ processor })).toBe(true);
			expect(isTelemetryActive()).toBe(true);
		});
	});

	describe("log record emission", () => {
		let exporter: InMemoryLogRecordExporter;

		beforeEach(() => {
			exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				serviceName: "cyrus-test",
				serviceVersion: "9.9.9",
				processor: new SimpleLogRecordProcessor(exporter),
			});
		});

		it("emits a log record for WARN with body and severity", () => {
			const logger = createLogger({
				component: "TestComp",
				level: LogLevel.DEBUG,
			});
			logger.warn("hello world");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.body).toBe("hello world");
			expect(records[0]!.severityNumber).toBe(SeverityNumber.WARN);
			expect(records[0]!.severityText).toBe("WARN");
			expect(records[0]!.attributes["log.component"]).toBe("TestComp");
		});

		it("does not forward INFO or DEBUG log records to OTel", () => {
			const logger = createLogger({
				component: "TestComp",
				level: LogLevel.DEBUG,
			});
			logger.debug("debug line");
			logger.info("info line");

			expect(exporter.getFinishedLogRecords()).toHaveLength(0);
		});

		it("forwards ERROR log records to OTel", () => {
			const logger = createLogger({
				component: "TestComp",
				level: LogLevel.DEBUG,
			});
			logger.error("boom");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.severityNumber).toBe(SeverityNumber.ERROR);
		});

		it("attaches resource attributes from config", () => {
			const logger = createLogger({
				component: "TestComp",
				level: LogLevel.DEBUG,
			});
			logger.warn("something odd");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			const resource = records[0]!.resource;
			expect(resource.attributes["service.name"]).toBe("cyrus-test");
			expect(resource.attributes["service.version"]).toBe("9.9.9");
			expect(resource.attributes["host.name"]).toBeTypeOf("string");
		});

		it("promotes LogContext into typed attributes", () => {
			const logger = createLogger({
				component: "EdgeWorker",
				level: LogLevel.DEBUG,
				context: {
					sessionId: "sess_abc123",
					platform: "linear",
					issueIdentifier: "CYPACK-1",
					repository: "cyrus",
				},
			});
			logger.error("boom");

			const records = exporter.getFinishedLogRecords();
			const attrs = records[0]!.attributes;
			expect(attrs["session.id"]).toBe("sess_abc123");
			expect(attrs.platform).toBe("linear");
			expect(attrs["issue.identifier"]).toBe("CYPACK-1");
			expect(attrs.repository).toBe("cyrus");
		});

		it("serialises extra args as log.args", () => {
			const logger = createLogger({
				component: "Svc",
				level: LogLevel.DEBUG,
			});
			logger.warn("context", { requestId: "req-1", count: 3 });

			const records = exporter.getFinishedLogRecords();
			const args = records[0]!.attributes["log.args"] as unknown as unknown[];
			expect(args).toEqual([{ requestId: "req-1", count: 3 }]);
		});

		it("serialises Error instances with stack", () => {
			const logger = createLogger({
				component: "Svc",
				level: LogLevel.DEBUG,
			});
			const err = new Error("kaboom");
			logger.error("failed", err);

			const records = exporter.getFinishedLogRecords();
			const args = records[0]!.attributes["log.args"] as unknown as Array<{
				name: string;
				message: string;
				stack: string;
			}>;
			expect(args[0]?.name).toBe("Error");
			expect(args[0]?.message).toBe("kaboom");
			expect(args[0]?.stack).toContain("kaboom");
		});

		it("does not emit when the level filter rejects the message", () => {
			const logger = createLogger({
				component: "Svc",
				level: LogLevel.ERROR,
			});
			logger.debug("filtered");
			logger.info("also filtered");
			logger.warn("still filtered");

			expect(exporter.getFinishedLogRecords()).toHaveLength(0);
		});
	});

	describe("event emission", () => {
		let exporter: InMemoryLogRecordExporter;

		beforeEach(() => {
			exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				serviceName: "cyrus-test",
				processor: new SimpleLogRecordProcessor(exporter),
			});
		});

		it("forwards events to OTel with event.name attribute", () => {
			const logger = createLogger({
				component: "ClaudeRunner",
				level: LogLevel.WARN,
			});
			logger.event({
				name: "session.started",
				sessionId: "sess_1",
				runner: "claude",
				model: "opus",
				repository: "cyrus",
			});

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.body).toBe("session.started");
			expect(records[0]!.severityText).toBe("EVENT");
			expect(records[0]!.attributes["event.name"]).toBe("session.started");
			expect(records[0]!.attributes["event.sessionId"]).toBe("sess_1");
			expect(records[0]!.attributes["event.runner"]).toBe("claude");
			expect(records[0]!.attributes["event.model"]).toBe("opus");
			expect(records[0]!.attributes["event.repository"]).toBe("cyrus");
			expect(records[0]!.attributes["log.component"]).toBe("ClaudeRunner");
		});

		it("emits events even when level is SILENT", () => {
			const logger = createLogger({
				component: "Svc",
				level: LogLevel.SILENT,
			});
			logger.event({
				name: "session.completed",
				sessionId: "sess_1",
				durationMs: 1234,
				stopReason: "success",
			});

			expect(exporter.getFinishedLogRecords()).toHaveLength(1);
		});

		it("skips undefined event fields", () => {
			const logger = createLogger({
				component: "Svc",
				level: LogLevel.DEBUG,
			});
			logger.event({
				name: "session.completed",
				sessionId: "sess_1",
				stopReason: "success",
			});

			const attrs = exporter.getFinishedLogRecords()[0]!.attributes;
			expect(attrs["event.durationMs"]).toBeUndefined();
			expect(attrs["event.inputTokens"]).toBeUndefined();
			expect(attrs["event.sessionId"]).toBe("sess_1");
		});

		it("emits session.resumed distinct from session.started", () => {
			const logger = createLogger({
				component: "ClaudeRunner",
				level: LogLevel.DEBUG,
			});
			logger.event({
				name: "session.resumed",
				sessionId: "sess_new",
				runner: "claude",
				model: "opus",
				resumedFromSessionId: "sess_old",
			});

			const record = exporter.getFinishedLogRecords()[0]!;
			expect(record.attributes["event.name"]).toBe("session.resumed");
			expect(record.attributes["event.resumedFromSessionId"]).toBe("sess_old");
		});

		it("emits session.stopped with reason and duration", () => {
			const logger = createLogger({
				component: "AgentSessionManager",
				level: LogLevel.DEBUG,
			});
			logger.event({
				name: "session.stopped",
				sessionId: "sess_1",
				reason: "user_requested",
				durationMs: 5000,
			});

			const attrs = exporter.getFinishedLogRecords()[0]!.attributes;
			expect(attrs["event.name"]).toBe("session.stopped");
			expect(attrs["event.reason"]).toBe("user_requested");
			expect(attrs["event.durationMs"]).toBe(5000);
		});
	});

	describe("classifyError", () => {
		it("buckets errors into operational classes", async () => {
			const { classifyError } = await import("../../src/logging/events.js");
			expect(classifyError(new Error("429 Too Many Requests"))).toBe(
				"rate_limit",
			);
			expect(classifyError(new Error("401 Unauthorized"))).toBe("auth");
			expect(classifyError(new Error("ECONNRESET reading stream"))).toBe(
				"network",
			);
			expect(classifyError(new Error("socket timeout"))).toBe("timeout");
			const abort = new Error("aborted");
			abort.name = "AbortError";
			expect(classifyError(abort)).toBe("abort");
			expect(classifyError(new Error("kaboom"))).toBe("unknown");
			expect(classifyError("not an error")).toBe("unknown");
		});
	});

	describe("shutdownTelemetry", () => {
		it("flushes records and deactivates the provider", async () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});
			expect(isTelemetryActive()).toBe(true);

			const logger = createLogger({
				component: "Svc",
				level: LogLevel.DEBUG,
			});
			logger.warn("last breath");

			// SimpleLogRecordProcessor is synchronous, so the record is already
			// in the exporter by the time we observe it.
			expect(exporter.getFinishedLogRecords()).toHaveLength(1);

			await shutdownTelemetry();

			expect(isTelemetryActive()).toBe(false);
		});

		it("is a no-op when telemetry was never initialised", async () => {
			await expect(shutdownTelemetry()).resolves.toBeUndefined();
		});
	});

	describe("no-op when inactive", () => {
		it("does not throw when logging with no provider registered", () => {
			const logger = createLogger({
				component: "Svc",
				level: LogLevel.DEBUG,
			});
			expect(() => logger.info("works")).not.toThrow();
		});
	});

	describe("PII redaction", () => {
		let exporter: InMemoryLogRecordExporter;

		beforeEach(() => {
			exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});
		});

		it("redacts sensitive keys in object args", () => {
			const logger = createLogger({ component: "Svc", level: LogLevel.DEBUG });
			logger.error("auth attempt", {
				userId: "u_1",
				token: "super-secret-bearer",
				password: "hunter2",
				apiKey: "sk-live-123",
				authorization: "Bearer xyz",
				clientSecret: "csec_abc",
			});

			const args = exporter.getFinishedLogRecords()[0]!.attributes[
				"log.args"
			] as unknown as Array<Record<string, unknown>>;
			expect(args[0]?.userId).toBe("u_1");
			expect(args[0]?.token).toBe("[REDACTED]");
			expect(args[0]?.password).toBe("[REDACTED]");
			expect(args[0]?.apiKey).toBe("[REDACTED]");
			expect(args[0]?.authorization).toBe("[REDACTED]");
			expect(args[0]?.clientSecret).toBe("[REDACTED]");
		});

		it("redacts nested sensitive keys inside objects and arrays", () => {
			const logger = createLogger({ component: "Svc", level: LogLevel.DEBUG });
			logger.error("request failed", {
				request: {
					headers: [
						{ name: "x-request-id", value: "rid-1" },
						{ name: "authorization", value: "Bearer secret" },
					],
					meta: { linearToken: "lin_api_abc" },
				},
			});

			const args = exporter.getFinishedLogRecords()[0]!.attributes[
				"log.args"
			] as unknown as Array<Record<string, unknown>>;
			const request = args[0]?.request as Record<string, unknown>;
			const meta = request.meta as Record<string, unknown>;
			expect(meta.linearToken).toBe("[REDACTED]");
			const headers = request.headers as Array<Record<string, unknown>>;
			expect(headers[0]?.value).toBe("rid-1");
			expect(headers[1]?.value).toBe("Bearer secret"); // non-sensitive key, value preserved
		});

		it("redacts case-insensitively and across common casings", () => {
			const logger = createLogger({ component: "Svc", level: LogLevel.DEBUG });
			logger.error("mixed casings", {
				ACCESS_TOKEN: "a",
				refresh_token: "b",
				"github.private-key": "c",
				cookie: "d",
				session_cookie: "e",
				API_KEY: "f",
			});

			const args = exporter.getFinishedLogRecords()[0]!.attributes[
				"log.args"
			] as unknown as Array<Record<string, unknown>>;
			expect(args[0]?.ACCESS_TOKEN).toBe("[REDACTED]");
			expect(args[0]?.refresh_token).toBe("[REDACTED]");
			expect(args[0]?.["github.private-key"]).toBe("[REDACTED]");
			expect(args[0]?.cookie).toBe("[REDACTED]");
			expect(args[0]?.session_cookie).toBe("[REDACTED]");
			expect(args[0]?.API_KEY).toBe("[REDACTED]");
		});

		it("does not redact non-sensitive keys that contain sensitive substrings accidentally", () => {
			const logger = createLogger({ component: "Svc", level: LogLevel.DEBUG });
			logger.error("benign", {
				username: "cyrus",
				repositoryName: "cyrus",
				status: "ok",
			});
			const args = exporter.getFinishedLogRecords()[0]!.attributes[
				"log.args"
			] as unknown as Array<Record<string, unknown>>;
			expect(args[0]).toEqual({
				username: "cyrus",
				repositoryName: "cyrus",
				status: "ok",
			});
		});
	});

	describe("minLogLevel", () => {
		it("forwards INFO to OTel when minLogLevel=INFO", () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
				minLogLevel: "INFO",
			});
			const logger = createLogger({ component: "Svc", level: LogLevel.DEBUG });
			logger.info("inspected");
			logger.debug("dropped");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.severityText).toBe("INFO");
		});

		it("accepts enum LogLevel value", () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
				minLogLevel: LogLevel.ERROR,
			});
			const logger = createLogger({ component: "Svc", level: LogLevel.DEBUG });
			logger.warn("dropped");
			logger.error("kept");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.severityText).toBe("ERROR");
		});

		it("defaults to WARN when not provided", () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});
			const logger = createLogger({ component: "Svc", level: LogLevel.DEBUG });
			logger.info("dropped");
			logger.warn("kept");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.severityText).toBe("WARN");
		});
	});

	describe("event level filtering", () => {
		it("silences console events when Logger level > INFO but still emits to OTel", () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});
			const logSpy = vi.spyOn(console, "log");
			logSpy.mockClear();

			const logger = createLogger({
				component: "Svc",
				level: LogLevel.SILENT,
			});
			logger.event({
				name: "session.completed",
				sessionId: "sess_1",
				stopReason: "success",
			});

			// Console emission suppressed
			const silentWrite = logSpy.mock.calls.some((call) =>
				String(call[0]).includes("session.completed"),
			);
			expect(silentWrite).toBe(false);
			// OTel still receives it
			expect(exporter.getFinishedLogRecords()).toHaveLength(1);
		});

		it("emits events to console when Logger level <= INFO", () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});
			const logSpy = vi.spyOn(console, "log");
			logSpy.mockClear();

			const logger = createLogger({
				component: "Svc",
				level: LogLevel.INFO,
			});
			logger.event({
				name: "session.completed",
				sessionId: "sess_1",
				stopReason: "success",
			});

			const consoleWrote = logSpy.mock.calls.some((call) =>
				String(call[0]).includes("session.completed"),
			);
			expect(consoleWrote).toBe(true);
			expect(exporter.getFinishedLogRecords()).toHaveLength(1);
		});
	});

	describe("shutdown timeout", () => {
		it("returns promptly when forceFlush hangs", async () => {
			const hangingProcessor = {
				onEmit: () => {},
				forceFlush: () =>
					new Promise<void>(() => {
						/* never resolves */
					}),
				shutdown: () => Promise.resolve(),
			} as unknown as SimpleLogRecordProcessor;

			initTelemetry({
				enabled: true,
				processor: hangingProcessor,
				shutdownTimeoutMs: 50,
			});

			const start = Date.now();
			await shutdownTelemetry();
			const elapsed = Date.now() - start;
			// Two timeouts (flush + shutdown), each 50ms. Allow generous slack.
			expect(elapsed).toBeLessThan(500);
		});
	});

	describe("diag logger", () => {
		it("routes OTel internal warnings to console.warn with [OTel] prefix", () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});

			const warnSpy = vi.spyOn(console, "warn");
			warnSpy.mockClear();
			diag.warn("simulated exporter failure");

			expect(warnSpy).toHaveBeenCalledWith("[OTel] simulated exporter failure");
		});

		it("silences internal logs after shutdownTelemetry", async () => {
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});
			await shutdownTelemetry();

			const warnSpy = vi.spyOn(console, "warn");
			warnSpy.mockClear();
			diag.warn("should not appear");

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it("honours OTEL_LOG_LEVEL=ERROR to suppress warnings", () => {
			process.env.OTEL_LOG_LEVEL = "ERROR";
			const exporter = new InMemoryLogRecordExporter();
			initTelemetry({
				enabled: true,
				processor: new SimpleLogRecordProcessor(exporter),
			});

			const warnSpy = vi.spyOn(console, "warn");
			const errorSpy = vi.spyOn(console, "error");
			warnSpy.mockClear();
			errorSpy.mockClear();
			diag.warn("warn filtered");
			diag.error("error kept");

			expect(warnSpy).not.toHaveBeenCalled();
			expect(errorSpy).toHaveBeenCalledWith("[OTel] error kept");
		});
	});
});
