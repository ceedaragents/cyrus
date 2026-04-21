import type { LogLevel } from "../LogLevel.js";
import type { LogPipeline, LogProcessor } from "../LogPipeline.js";
import type { LogRecord } from "../LogRecord.js";

/**
 * Drops log records below the configured threshold before forwarding.
 *
 * Events pass through unchanged — they are operational signals that are not
 * filtered by severity. If a deployment needs to silence certain events, wrap
 * the pipeline with a dedicated event filter rather than repurposing this
 * level filter.
 */
export class LevelFilterProcessor implements LogProcessor {
	constructor(
		readonly next: LogPipeline,
		private readonly threshold: LogLevel,
	) {}

	write(record: LogRecord): void {
		if (record.kind === "log" && record.level.compare(this.threshold) < 0) {
			return;
		}
		this.next.write(record);
	}

	shutdown(signal: AbortSignal): Promise<void> {
		return this.next.shutdown(signal);
	}
}
