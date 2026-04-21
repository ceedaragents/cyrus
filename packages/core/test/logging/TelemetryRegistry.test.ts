import {
	InMemoryLogRecordExporter,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetryConfig } from "../../src/config-schemas.js";
import { LogLevel } from "../../src/logging/LogLevel.js";
import type { LogEntryRecord } from "../../src/logging/LogRecord.js";
import { TelemetryRegistry } from "../../src/logging/TelemetryRegistry.js";

function makeLog(level: LogLevel, message: string): LogEntryRecord {
	return {
		kind: "log",
		level,
		component: "test",
		bindings: { sessionId: "s1" },
		message,
		args: [],
		timestamp: new Date("2026-04-21T00:00:00.000Z"),
	};
}

describe("TelemetryRegistry.fromConfig", () => {
	it("returns undefined when telemetry is disabled", () => {
		const cfg: TelemetryConfig = { enabled: false };
		const registry = TelemetryRegistry.fromConfig(cfg, {}, {});
		expect(registry).toBeUndefined();
	});

	it("returns undefined when neither endpoint nor processor is provided", () => {
		const cfg: TelemetryConfig = {};
		const registry = TelemetryRegistry.fromConfig(cfg, {}, {});
		expect(registry).toBeUndefined();
	});

	it("returns undefined when OTEL_SDK_DISABLED=true even with endpoint", () => {
		const cfg: TelemetryConfig = {
			enabled: true,
			endpoint: "http://localhost:4318/v1/logs",
		};
		const registry = TelemetryRegistry.fromConfig(
			cfg,
			{},
			{ OTEL_SDK_DISABLED: "true" },
		);
		expect(registry).toBeUndefined();
	});

	it("auto-enables when an endpoint is present in env", () => {
		const exporter = new InMemoryLogRecordExporter();
		const cfg: TelemetryConfig = {};
		const registry = TelemetryRegistry.fromConfig(
			cfg,
			{ processor: new SimpleLogRecordProcessor(exporter) },
			{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
		);
		expect(registry).toBeDefined();
		void registry?.shutdown();
	});
});

describe("TelemetryRegistry sink behavior", () => {
	let exporter: InMemoryLogRecordExporter;
	let registry: TelemetryRegistry;

	beforeEach(() => {
		exporter = new InMemoryLogRecordExporter();
		const cfg: TelemetryConfig = {
			enabled: true,
			minLogLevel: "WARN",
			serviceName: "cyrus-test",
		};
		registry = TelemetryRegistry.fromConfig(cfg, {
			processor: new SimpleLogRecordProcessor(exporter),
		}) as TelemetryRegistry;
	});

	afterEach(async () => {
		await registry.shutdown();
	});

	it("drops log records below minLogLevel", () => {
		const sink = registry.getSink("comp");
		sink.write(makeLog(LogLevel.INFO, "dropped"));
		sink.write(makeLog(LogLevel.WARN, "kept"));

		const records = exporter.getFinishedLogRecords();
		expect(records).toHaveLength(1);
		expect(records[0]?.body).toBe("kept");
	});

	it("always exports events regardless of minLogLevel", () => {
		const sink = registry.getSink("comp");
		sink.write({
			kind: "event",
			component: "comp",
			bindings: { sessionId: "s1" },
			event: {
				name: "session.started",
				sessionId: "s1",
				runner: "claude",
				model: "opus",
			},
			timestamp: new Date("2026-04-21T00:00:00.000Z"),
		});

		const records = exporter.getFinishedLogRecords();
		expect(records).toHaveLength(1);
		expect(records[0]?.attributes["event.name"]).toBe("session.started");
	});

	it("maps log records via OtelLogSink with bindings as attributes", () => {
		const sink = registry.getSink("runner");
		sink.write({
			kind: "log",
			level: LogLevel.ERROR,
			component: "runner",
			bindings: { sessionId: "abc", platform: "linear" },
			message: "boom",
			args: [{ code: 42 }],
			timestamp: new Date("2026-04-21T00:00:00.000Z"),
		});

		const records = exporter.getFinishedLogRecords();
		expect(records).toHaveLength(1);
		const rec = records[0];
		expect(rec?.body).toBe("boom");
		expect(rec?.severityText).toBe("ERROR");
		expect(rec?.attributes["session.id"]).toBe("abc");
		expect(rec?.attributes.platform).toBe("linear");
		expect(rec?.attributes["log.component"]).toBe("runner");
	});

	it("exposes write() as a top-level LogPipeline entry", () => {
		registry.write(makeLog(LogLevel.ERROR, "top-level"));
		expect(exporter.getFinishedLogRecords()).toHaveLength(1);
	});
});

describe("TelemetryRegistry shutdown", () => {
	it("races an aborted signal and returns", async () => {
		const exporter = new InMemoryLogRecordExporter();
		const cfg: TelemetryConfig = { enabled: true, shutdownTimeoutMs: 1 };
		const registry = TelemetryRegistry.fromConfig(cfg, {
			processor: new SimpleLogRecordProcessor(exporter),
		}) as TelemetryRegistry;

		// Use an immediately-aborted signal; shutdown must resolve promptly
		const ctrl = new AbortController();
		ctrl.abort();
		await expect(registry.shutdown(ctrl.signal)).resolves.toBeUndefined();
	});

	it("swallows flush errors and proceeds to shutdown", async () => {
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		const badProcessor = {
			export: (
				_records: unknown[],
				cb: (result: { code: number; error?: Error }) => void,
			) => cb({ code: 1, error: new Error("bad") }),
			shutdown: () => Promise.resolve(),
			forceFlush: () => Promise.reject(new Error("cannot flush")),
		} as unknown as ConstructorParameters<typeof SimpleLogRecordProcessor>[0];
		const cfg: TelemetryConfig = { enabled: true, shutdownTimeoutMs: 50 };
		const registry = TelemetryRegistry.fromConfig(cfg, {
			processor: new SimpleLogRecordProcessor(badProcessor),
		}) as TelemetryRegistry;

		await expect(registry.shutdown()).resolves.toBeUndefined();
		stderrSpy.mockRestore();
	});
});
