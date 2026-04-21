import { AsyncLocalStorage } from "node:async_hooks";
import { ConsoleLogSink } from "./ConsoleLogSink.js";
import type { CyrusEvent } from "./events.js";
import type { ILogger } from "./ILogger.js";
import { LogLevel } from "./LogLevel.js";
import type { LogPipeline } from "./LogPipeline.js";
import type { LogBindings, LogRecord } from "./LogRecord.js";
import { LevelFilterProcessor } from "./processors/LevelFilterProcessor.js";

function parseLevelFromEnv(env: NodeJS.ProcessEnv): LogLevel | undefined {
	return LogLevel.parse(env.CYRUS_LOG_LEVEL);
}

/**
 * Shared AsyncLocalStorage for binding propagation. All loggers in a
 * process observe the same stack — scope is determined by the enclosing
 * `runWithContext` call, not the individual logger instance.
 */
const contextStorage = new AsyncLocalStorage<LogBindings>();

/**
 * Process-wide default pipeline used by `createLogger` when no explicit
 * pipeline is passed. Application bootstrap may override this before any
 * loggers are created (typically once, during telemetry initialization).
 */
let defaultPipeline: LogPipeline | undefined;

/**
 * Swap the process-wide default pipeline. Subsequent `createLogger` calls
 * that omit an explicit `pipeline` option pick up the new default. Pass
 * `undefined` to reset back to the per-logger ConsoleLogSink default.
 */
export function setDefaultLogPipeline(pipeline: LogPipeline | undefined): void {
	defaultPipeline = pipeline;
}

export interface LoggerOptions {
	component: string;
	/**
	 * Initial severity threshold for the local logger. Applied before the
	 * record is handed to the pipeline; sinks may apply additional filters
	 * downstream (e.g. a tighter filter on the OTel branch).
	 */
	level?: LogLevel;
	/**
	 * Static bindings baked into every record emitted from this logger.
	 * Merged with bindings from any enclosing `runWithContext` scope at
	 * emit time.
	 */
	bindings?: LogBindings;
	/**
	 * Destination for records after level-filtering. Defaults to a
	 * `ConsoleLogSink` — to add telemetry, supply a `FanOutPipeline` that
	 * fans out to both the console and a `TelemetryRegistry`.
	 */
	pipeline?: LogPipeline;
}

class Logger implements ILogger {
	private level: LogLevel;
	private readonly component: string;
	private readonly bindings: LogBindings;
	private readonly pipeline: LogPipeline;

	constructor(options: LoggerOptions) {
		this.component = options.component;
		this.level =
			options.level ?? parseLevelFromEnv(process.env) ?? LogLevel.INFO;
		this.bindings = options.bindings ?? {};
		this.pipeline = options.pipeline ?? defaultPipeline ?? new ConsoleLogSink();
	}

	debug(message: string, ...args: unknown[]): void {
		this.emitLog(LogLevel.DEBUG, message, args);
	}

	info(message: string, ...args: unknown[]): void {
		this.emitLog(LogLevel.INFO, message, args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.emitLog(LogLevel.WARN, message, args);
	}

	error(message: string, ...args: unknown[]): void {
		this.emitLog(LogLevel.ERROR, message, args);
	}

	event(event: CyrusEvent): void {
		const record: LogRecord = {
			kind: "event",
			component: this.component,
			bindings: this.currentBindings(),
			event,
			timestamp: new Date(),
		};
		this.pipeline.write(record);
	}

	withContext(bindings: LogBindings): ILogger {
		return new Logger({
			component: this.component,
			level: this.level,
			bindings: mergeBindings(this.bindings, bindings),
			pipeline: this.pipeline,
		});
	}

	child(component: string): ILogger {
		return new Logger({
			component,
			level: this.level,
			bindings: this.bindings,
			pipeline: this.pipeline,
		});
	}

	runWithContext<T>(bindings: LogBindings, fn: () => T): T {
		const outer = contextStorage.getStore() ?? {};
		return contextStorage.run(mergeBindings(outer, bindings), fn);
	}

	getLevel(): LogLevel {
		return this.level;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	private emitLog(level: LogLevel, message: string, args: unknown[]): void {
		if (level.compare(this.level) < 0) return;
		const record: LogRecord = {
			kind: "log",
			level,
			component: this.component,
			bindings: this.currentBindings(),
			message,
			args,
			timestamp: new Date(),
		};
		this.pipeline.write(record);
	}

	private currentBindings(): LogBindings {
		const scoped = contextStorage.getStore();
		if (!scoped) return this.bindings;
		return mergeBindings(this.bindings, scoped);
	}
}

function mergeBindings(a: LogBindings, b: LogBindings): LogBindings {
	const out: LogBindings = { ...a };
	for (const [key, value] of Object.entries(b)) {
		if (value !== undefined) {
			out[key] = value;
		}
	}
	return out;
}

/**
 * Construct a root-level logger. Most call sites will use this — the root
 * pipeline is injected once at app boot, subsequent loggers are derived
 * via `.child()` or `.withContext()`.
 */
export function createLogger(options: LoggerOptions): ILogger {
	return new Logger(options);
}

/**
 * Build a pipeline that wraps `inner` with a severity filter. Convenience
 * for common wiring where a single level filter is desired.
 */
export function withLevelFilter(
	inner: LogPipeline,
	threshold: LogLevel,
): LogPipeline {
	return new LevelFilterProcessor(inner, threshold);
}

export { contextStorage as __loggerContextStorage };
