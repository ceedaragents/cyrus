import type { CyrusEvent } from "./events.js";
import type { LogLevel } from "./LogLevel.js";

/**
 * Contextual bindings attached to every record as it flows through the
 * pipeline. Extend by adding optional fields — all are string-valued to keep
 * attribute mapping trivial across sinks.
 */
export interface LogBindings {
	sessionId?: string;
	platform?: string;
	issueIdentifier?: string;
	repository?: string;
	[extra: string]: string | undefined;
}

export interface LogEntryRecord {
	kind: "log";
	level: LogLevel;
	component: string;
	bindings: LogBindings;
	message: string;
	args: unknown[];
	timestamp: Date;
}

export interface EventEntryRecord {
	kind: "event";
	component: string;
	bindings: LogBindings;
	event: CyrusEvent;
	timestamp: Date;
}

/**
 * Discriminated union of record kinds that flow through the pipeline.
 * Add a new kind (metric, audit, ...) by adding another branch — each stage
 * dispatches on `kind`, so the compiler enforces coverage.
 */
export type LogRecord = LogEntryRecord | EventEntryRecord;
