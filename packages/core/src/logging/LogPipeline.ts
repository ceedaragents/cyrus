import type { LogRecord } from "./LogRecord.js";

/**
 * A stage in the logging pipeline.
 *
 * Every stage accepts a record and either transforms-and-forwards, drops, or
 * transports it. Sinks are terminal pipelines (no downstream); processors
 * wrap another pipeline. The single `write` method is intentional — adding a
 * new record kind extends the `LogRecord` union, not the interface.
 */
export interface LogPipeline {
	write(record: LogRecord): void;
	/**
	 * Flush buffered state and stop. `signal` carries a deadline (usually via
	 * `AbortSignal.timeout`); pipelines must return promptly when it aborts.
	 */
	shutdown(signal: AbortSignal): Promise<void>;
}

/**
 * Transports — the terminal end of a pipeline that actually delivers records
 * to a destination (console, OTel collector, file, ...). Exposed as a marker
 * extending `LogPipeline` so call sites can type-distinguish a sink from a
 * processor.
 */
export type LogSink = LogPipeline;

/**
 * Processors — pipeline decorators that transform, filter, or enrich records
 * before delegating to `next`. The `next` reference is part of the public
 * shape so tests can introspect and rewire compositions.
 */
export interface LogProcessor extends LogPipeline {
	readonly next: LogPipeline;
}
