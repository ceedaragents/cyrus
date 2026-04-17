import { type LogContext, LogLevel } from "./ILogger.js";
import type { EventRecord, LogRecord, LogSink } from "./LogSink.js";

const LEVEL_LABELS: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: "DEBUG",
	[LogLevel.INFO]: "INFO",
	[LogLevel.WARN]: "WARN",
	[LogLevel.ERROR]: "ERROR",
	[LogLevel.SILENT]: "",
};

function formatContext(context: LogContext): string {
	const parts: string[] = [];
	if (context.sessionId) {
		parts.push(`session=${context.sessionId.slice(0, 8)}`);
	}
	if (context.platform) {
		parts.push(`platform=${context.platform}`);
	}
	if (context.issueIdentifier) {
		parts.push(`issue=${context.issueIdentifier}`);
	}
	if (context.repository) {
		parts.push(`repo=${context.repository}`);
	}
	return parts.length > 0 ? ` {${parts.join(", ")}}` : "";
}

function formatPrefix(record: LogRecord): string {
	const timestamp = record.timestamp.toISOString();
	const label = LEVEL_LABELS[record.level];
	const padded = label.padEnd(5);
	const ctx = formatContext(record.context);
	return `${timestamp} [${padded}] [${record.component}]${ctx}`;
}

export class ConsoleLogSink implements LogSink {
	emit(record: LogRecord): void {
		const line = `${formatPrefix(record)} ${record.message}`;
		switch (record.level) {
			case LogLevel.WARN:
				console.warn(line, ...record.args);
				return;
			case LogLevel.ERROR:
				console.error(line, ...record.args);
				return;
			default:
				console.log(line, ...record.args);
		}
	}

	emitEvent(record: EventRecord): void {
		const timestamp = record.timestamp.toISOString();
		const ctx = formatContext(record.context);
		const { name, ...attrs } = record.event;
		const prefix = `${timestamp} [EVENT] [${record.component}]${ctx} ${name}`;
		if (Object.keys(attrs).length > 0) {
			console.log(prefix, attrs);
		} else {
			console.log(prefix);
		}
	}
}
