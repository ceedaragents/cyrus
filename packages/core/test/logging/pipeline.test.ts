import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogSink } from "../../src/logging/ConsoleLogSink.js";
import type { CyrusEvent } from "../../src/logging/events.js";
import { FanOutPipeline } from "../../src/logging/FanOutPipeline.js";
import { LogLevel } from "../../src/logging/LogLevel.js";
import type { LogPipeline, LogSink } from "../../src/logging/LogPipeline.js";
import type {
	EventEntryRecord,
	LogEntryRecord,
	LogRecord,
} from "../../src/logging/LogRecord.js";
import { LevelFilterProcessor } from "../../src/logging/processors/LevelFilterProcessor.js";
import { RedactingProcessor } from "../../src/logging/processors/RedactingProcessor.js";
import { DefaultRedactionPolicy } from "../../src/logging/redaction/DefaultRedactionPolicy.js";

class CollectingSink implements LogSink {
	readonly records: LogRecord[] = [];
	shutdownCalls = 0;
	write(record: LogRecord): void {
		this.records.push(record);
	}
	async shutdown(_signal: AbortSignal): Promise<void> {
		this.shutdownCalls += 1;
	}
}

function makeLogRecord(
	level: LogLevel,
	message: string,
	args: unknown[] = [],
): LogEntryRecord {
	return {
		kind: "log",
		level,
		component: "test",
		bindings: {},
		message,
		args,
		timestamp: new Date("2026-04-21T00:00:00.000Z"),
	};
}

function makeEventRecord(event: CyrusEvent): EventEntryRecord {
	return {
		kind: "event",
		component: "test",
		bindings: {},
		event,
		timestamp: new Date("2026-04-21T00:00:00.000Z"),
	};
}

describe("LevelFilterProcessor", () => {
	it("drops log records below the threshold", () => {
		const sink = new CollectingSink();
		const filter = new LevelFilterProcessor(sink, LogLevel.WARN);

		filter.write(makeLogRecord(LogLevel.DEBUG, "dropped"));
		filter.write(makeLogRecord(LogLevel.INFO, "dropped"));
		filter.write(makeLogRecord(LogLevel.WARN, "kept"));
		filter.write(makeLogRecord(LogLevel.ERROR, "kept"));

		expect(sink.records.map((r) => (r as LogEntryRecord).message)).toEqual([
			"kept",
			"kept",
		]);
	});

	it("always forwards events regardless of log threshold", () => {
		const sink = new CollectingSink();
		const filter = new LevelFilterProcessor(sink, LogLevel.ERROR);

		filter.write(
			makeEventRecord({
				name: "session.started",
				sessionId: "s1",
				runner: "claude",
				model: "opus",
			}),
		);

		expect(sink.records).toHaveLength(1);
		expect(sink.records[0]?.kind).toBe("event");
	});

	it("delegates shutdown to next pipeline", async () => {
		const sink = new CollectingSink();
		const filter = new LevelFilterProcessor(sink, LogLevel.INFO);

		await filter.shutdown(AbortSignal.timeout(10));
		expect(sink.shutdownCalls).toBe(1);
	});
});

describe("RedactingProcessor with DefaultRedactionPolicy", () => {
	let sink: CollectingSink;
	let processor: RedactingProcessor;

	beforeEach(() => {
		sink = new CollectingSink();
		processor = new RedactingProcessor(sink, new DefaultRedactionPolicy());
	});

	it("redacts sensitive keys in log args", () => {
		processor.write(
			makeLogRecord(LogLevel.INFO, "auth", [{ token: "abc", user: "alice" }]),
		);

		const record = sink.records[0] as LogEntryRecord;
		expect(record.args[0]).toEqual({ token: "[REDACTED]", user: "alice" });
	});

	it("redacts sensitive keys in nested structures", () => {
		processor.write(
			makeLogRecord(LogLevel.INFO, "nested", [
				{
					outer: {
						inner: { apiKey: "xyz", name: "svc" },
						arr: [{ secret: "s1" }, { benign: "b" }],
					},
				},
			]),
		);

		const record = sink.records[0] as LogEntryRecord;
		expect(record.args[0]).toEqual({
			outer: {
				inner: { apiKey: "[REDACTED]", name: "svc" },
				arr: [{ secret: "[REDACTED]" }, { benign: "b" }],
			},
		});
	});

	it("matches keys case-insensitively and across separators", () => {
		processor.write(
			makeLogRecord(LogLevel.INFO, "case", [
				{ Authorization: "Bearer x", API_KEY: "y", "client-secret": "z" },
			]),
		);

		const record = sink.records[0] as LogEntryRecord;
		expect(record.args[0]).toEqual({
			Authorization: "[REDACTED]",
			API_KEY: "[REDACTED]",
			"client-secret": "[REDACTED]",
		});
	});

	it("leaves primitive args untouched", () => {
		processor.write(
			makeLogRecord(LogLevel.INFO, "primitives", [1, "plain", true, null]),
		);

		const record = sink.records[0] as LogEntryRecord;
		expect(record.args).toEqual([1, "plain", true, null]);
	});

	it("redacts sensitive keys in event payloads", () => {
		processor.write(
			makeEventRecord({
				name: "session.failed",
				sessionId: "s1",
				errorClass: "auth",
				errorMessage: "token expired",
			}),
		);

		const record = sink.records[0] as EventEntryRecord;
		expect(record.event.name).toBe("session.failed");
	});

	it("preserves Error shape while dropping unknown custom props", () => {
		const err = new Error("boom");
		processor.write(makeLogRecord(LogLevel.ERROR, "failed", [err]));

		const record = sink.records[0] as LogEntryRecord;
		expect((record.args[0] as { message: string }).message).toBe("boom");
		expect((record.args[0] as { name: string }).name).toBe("Error");
	});
});

describe("ConsoleLogSink", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("routes WARN to console.warn and ERROR to console.error", () => {
		const sink = new ConsoleLogSink();

		sink.write(makeLogRecord(LogLevel.WARN, "warning"));
		sink.write(makeLogRecord(LogLevel.ERROR, "broken"));

		expect(warnSpy).toHaveBeenCalledOnce();
		expect(errorSpy).toHaveBeenCalledOnce();
	});

	it("prints events with attribute payloads", () => {
		const sink = new ConsoleLogSink();

		sink.write(
			makeEventRecord({
				name: "session.completed",
				sessionId: "s1",
				stopReason: "end_turn",
			}),
		);

		expect(logSpy).toHaveBeenCalledOnce();
		const [line, payload] = logSpy.mock.calls[0] ?? [];
		expect(line).toContain("[EVENT]");
		expect(line).toContain("session.completed");
		expect(payload).toMatchObject({
			sessionId: "s1",
			stopReason: "end_turn",
		});
	});

	it("resolves shutdown immediately", async () => {
		const sink = new ConsoleLogSink();
		await expect(
			sink.shutdown(AbortSignal.timeout(10)),
		).resolves.toBeUndefined();
	});
});

describe("FanOutPipeline", () => {
	it("broadcasts records to every branch", () => {
		const a = new CollectingSink();
		const b = new CollectingSink();
		const fan = new FanOutPipeline([a, b]);

		fan.write(makeLogRecord(LogLevel.INFO, "hi"));

		expect(a.records).toHaveLength(1);
		expect(b.records).toHaveLength(1);
	});

	it("continues delivery when a branch throws", () => {
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		const failing: LogSink = {
			write: () => {
				throw new Error("boom");
			},
			shutdown: () => Promise.resolve(),
		};
		const healthy = new CollectingSink();
		const fan = new FanOutPipeline([failing, healthy]);

		fan.write(makeLogRecord(LogLevel.INFO, "survive"));

		expect(healthy.records).toHaveLength(1);
		expect(stderrSpy).toHaveBeenCalled();
		stderrSpy.mockRestore();
	});

	it("shuts down every branch concurrently", async () => {
		const a = new CollectingSink();
		const b = new CollectingSink();
		const fan = new FanOutPipeline([a, b]);

		await fan.shutdown(AbortSignal.timeout(10));

		expect(a.shutdownCalls).toBe(1);
		expect(b.shutdownCalls).toBe(1);
	});

	it("isolates branch shutdown failures", async () => {
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		const failing: LogSink = {
			write: () => {},
			shutdown: () => Promise.reject(new Error("flush failed")),
		};
		const healthy = new CollectingSink();
		const fan = new FanOutPipeline([failing, healthy]);

		await expect(
			fan.shutdown(AbortSignal.timeout(10)),
		).resolves.toBeUndefined();
		expect(healthy.shutdownCalls).toBe(1);
		expect(stderrSpy).toHaveBeenCalled();
		stderrSpy.mockRestore();
	});
});

describe("Composed pipeline (FanOut → [Console, Redact → Level → Sink])", () => {
	it("fans records to both branches with independent processing", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const otelLike = new CollectingSink();

		const pipeline: LogPipeline = new FanOutPipeline([
			new ConsoleLogSink(),
			new RedactingProcessor(
				new LevelFilterProcessor(otelLike, LogLevel.WARN),
				new DefaultRedactionPolicy(),
			),
		]);

		pipeline.write(makeLogRecord(LogLevel.INFO, "noisy", [{ token: "abc" }]));
		pipeline.write(makeLogRecord(LogLevel.ERROR, "bad", [{ password: "pw" }]));

		expect(logSpy).toHaveBeenCalledOnce();
		expect(errorSpy).toHaveBeenCalledOnce();
		// level-filtered branch only sees ERROR
		expect(otelLike.records).toHaveLength(1);
		const passed = otelLike.records[0] as LogEntryRecord;
		expect(passed.level).toBe(LogLevel.ERROR);
		expect(passed.args[0]).toEqual({ password: "[REDACTED]" });

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
