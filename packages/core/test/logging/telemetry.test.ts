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

		it("emits a log record per info call with body and severity", () => {
			const logger = createLogger({
				component: "TestComp",
				level: LogLevel.DEBUG,
			});
			logger.info("hello world");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.body).toBe("hello world");
			expect(records[0]!.severityNumber).toBe(SeverityNumber.INFO);
			expect(records[0]!.severityText).toBe("INFO");
			expect(records[0]!.attributes["log.component"]).toBe("TestComp");
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
			logger.info("context", { requestId: "req-1", count: 3 });

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
				level: LogLevel.WARN,
			});
			logger.debug("filtered");
			logger.info("also filtered");
			logger.warn("kept");

			const records = exporter.getFinishedLogRecords();
			expect(records).toHaveLength(1);
			expect(records[0]!.body).toBe("kept");
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
			logger.info("last breath");

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
});
