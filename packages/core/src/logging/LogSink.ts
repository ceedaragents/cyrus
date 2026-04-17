import type { CyrusEvent } from "./events.js";
import type { LogContext, LogLevel } from "./ILogger.js";

export interface LogRecord {
	level: LogLevel;
	component: string;
	context: LogContext;
	message: string;
	args: unknown[];
	timestamp: Date;
}

export interface EventRecord {
	event: CyrusEvent;
	component: string;
	context: LogContext;
	timestamp: Date;
}

export interface LogSink {
	emit(record: LogRecord): void;
	emitEvent(record: EventRecord): void;
}
