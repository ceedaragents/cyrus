import { LogLevel } from "./LogLevel.js";
import type { LogSink } from "./LogPipeline.js";
import type { LogBindings, LogEntryRecord, LogRecord } from "./LogRecord.js";

function formatBindings(bindings: LogBindings): string {
	const parts: string[] = [];
	if (bindings.sessionId) {
		parts.push(`session=${bindings.sessionId.slice(0, 8)}`);
	}
	if (bindings.platform) {
		parts.push(`platform=${bindings.platform}`);
	}
	if (bindings.issueIdentifier) {
		parts.push(`issue=${bindings.issueIdentifier}`);
	}
	if (bindings.repository) {
		parts.push(`repo=${bindings.repository}`);
	}
	for (const [key, value] of Object.entries(bindings)) {
		if (value === undefined) continue;
		if (
			key === "sessionId" ||
			key === "platform" ||
			key === "issueIdentifier" ||
			key === "repository"
		) {
			continue;
		}
		parts.push(`${key}=${value}`);
	}
	return parts.length > 0 ? ` {${parts.join(", ")}}` : "";
}

function levelLabel(level: LogLevel): string {
	return level === LogLevel.SILENT ? "" : level.name;
}

function formatPrefix(record: LogEntryRecord): string {
	const timestamp = record.timestamp.toISOString();
	const label = levelLabel(record.level).padEnd(5);
	const ctx = formatBindings(record.bindings);
	return `${timestamp} [${label}] [${record.component}]${ctx}`;
}

/**
 * Human-readable transport that writes records to the Node.js console
 * streams. Pure transport: no redaction, no level filtering. Compose with
 * `LevelFilterProcessor` / `RedactingProcessor` upstream when those behaviors
 * are desired.
 */
export class ConsoleLogSink implements LogSink {
	write(record: LogRecord): void {
		if (record.kind === "log") {
			this.writeLog(record);
			return;
		}
		this.writeEvent(record.component, record.bindings, record);
	}

	shutdown(_signal: AbortSignal): Promise<void> {
		return Promise.resolve();
	}

	private writeLog(record: LogEntryRecord): void {
		const line = `${formatPrefix(record)} ${record.message}`;
		if (record.level === LogLevel.ERROR) {
			console.error(line, ...record.args);
			return;
		}
		if (record.level === LogLevel.WARN) {
			console.warn(line, ...record.args);
			return;
		}
		console.log(line, ...record.args);
	}

	private writeEvent(
		component: string,
		bindings: LogBindings,
		record: Extract<LogRecord, { kind: "event" }>,
	): void {
		const timestamp = record.timestamp.toISOString();
		const ctx = formatBindings(bindings);
		const { name, ...attrs } = record.event;
		const prefix = `${timestamp} [EVENT] [${component}]${ctx} ${name}`;
		if (Object.keys(attrs).length > 0) {
			console.log(prefix, attrs);
		} else {
			console.log(prefix);
		}
	}
}
