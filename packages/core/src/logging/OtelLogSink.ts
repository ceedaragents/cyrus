import {
	type AnyValueMap,
	type LoggerProvider,
	SeverityNumber,
} from "@opentelemetry/api-logs";
import type { LogSink } from "./LogPipeline.js";
import type {
	EventEntryRecord,
	LogBindings,
	LogEntryRecord,
	LogRecord,
} from "./LogRecord.js";

function bindingsToAttributes(bindings: LogBindings): Record<string, string> {
	const attrs: Record<string, string> = {};
	if (bindings.sessionId) attrs["session.id"] = bindings.sessionId;
	if (bindings.platform) attrs.platform = bindings.platform;
	if (bindings.issueIdentifier)
		attrs["issue.identifier"] = bindings.issueIdentifier;
	if (bindings.repository) attrs.repository = bindings.repository;
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
		attrs[key] = value;
	}
	return attrs;
}

function argAsAttribute(arg: unknown): AnyValueMap[string] {
	if (arg === null || arg === undefined) {
		return String(arg);
	}
	if (
		typeof arg === "string" ||
		typeof arg === "number" ||
		typeof arg === "boolean"
	) {
		return arg;
	}
	if (arg instanceof Error) {
		return {
			name: arg.name,
			message: arg.message,
			stack: arg.stack,
		} as AnyValueMap[string];
	}
	try {
		return JSON.parse(JSON.stringify(arg)) as AnyValueMap[string];
	} catch {
		return String(arg);
	}
}

/**
 * Transport that forwards records to an OpenTelemetry `LoggerProvider`.
 *
 * Pure transport: does not redact, does not level-filter. Records are
 * expected to have already passed through any upstream processors. The
 * provider is injected (rather than read from the OTel global singleton) so
 * multiple providers can coexist in-process and tests can use a scoped
 * provider without touching global state.
 */
export class OtelLogSink implements LogSink {
	constructor(
		private readonly provider: LoggerProvider,
		private readonly component: string,
	) {}

	write(record: LogRecord): void {
		const otelLogger = this.provider.getLogger(this.component);
		if (record.kind === "log") {
			this.writeLog(otelLogger, record);
			return;
		}
		this.writeEvent(otelLogger, record);
	}

	/**
	 * The sink itself holds no buffer; flushing and teardown belong to the
	 * provider, which the `TelemetryRegistry` owns. The sink respects the
	 * `AbortSignal` by returning immediately — callers waiting on this promise
	 * will see the registry's flush complete under the same deadline.
	 */
	shutdown(_signal: AbortSignal): Promise<void> {
		return Promise.resolve();
	}

	private writeLog(
		otelLogger: ReturnType<LoggerProvider["getLogger"]>,
		record: LogEntryRecord,
	): void {
		const attributes: AnyValueMap = {
			"log.component": record.component,
			...bindingsToAttributes(record.bindings),
		};
		if (record.args.length > 0) {
			attributes["log.args"] = record.args.map(
				argAsAttribute,
			) as AnyValueMap[string];
		}
		otelLogger.emit({
			severityNumber: record.level.toOtelSeverity(),
			severityText: record.level.toOtelSeverityText(),
			body: record.message,
			attributes,
			timestamp: record.timestamp,
		});
	}

	private writeEvent(
		otelLogger: ReturnType<LoggerProvider["getLogger"]>,
		record: EventEntryRecord,
	): void {
		const { name, ...payload } = record.event;
		const attributes: AnyValueMap = {
			"log.component": record.component,
			"event.name": name,
			...bindingsToAttributes(record.bindings),
		};
		for (const [key, value] of Object.entries(payload)) {
			if (value === undefined) continue;
			attributes[`event.${key}`] = argAsAttribute(value);
		}
		otelLogger.emit({
			severityNumber: SeverityNumber.INFO,
			severityText: "EVENT",
			body: name,
			attributes,
			timestamp: record.timestamp,
		});
	}
}
