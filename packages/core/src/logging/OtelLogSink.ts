import {
	type AnyValueMap,
	logs,
	type Logger as OtelLogger,
	SeverityNumber,
} from "@opentelemetry/api-logs";
import { type LogContext, LogLevel } from "./ILogger.js";
import type { EventRecord, LogRecord, LogSink } from "./LogSink.js";
import {
	isTelemetryActive,
	severityNumberFor,
	severityTextFor,
} from "./telemetry.js";

function contextToAttributes(context: LogContext): Record<string, string> {
	const attrs: Record<string, string> = {};
	if (context.sessionId) {
		attrs["session.id"] = context.sessionId;
	}
	if (context.platform) {
		attrs.platform = context.platform;
	}
	if (context.issueIdentifier) {
		attrs["issue.identifier"] = context.issueIdentifier;
	}
	if (context.repository) {
		attrs.repository = context.repository;
	}
	return attrs;
}

function serializeArg(arg: unknown): unknown {
	if (arg === null || arg === undefined) {
		return arg;
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
		};
	}
	try {
		return JSON.parse(JSON.stringify(arg));
	} catch {
		return String(arg);
	}
}

export class OtelLogSink implements LogSink {
	private readonly otelLogger: OtelLogger;

	constructor(component: string) {
		// Safe to resolve eagerly — the API returns a proxy that defers to the
		// currently registered global provider (or a no-op when none is set).
		this.otelLogger = logs.getLogger(component);
	}

	emit(record: LogRecord): void {
		if (!isTelemetryActive()) {
			return;
		}
		// Production filter: only WARN+ reaches the OTel sink. INFO/DEBUG
		// stay on stdout so operators still see them locally while keeping
		// the OTel log volume bounded to genuinely actionable signals.
		if (record.level < LogLevel.WARN) {
			return;
		}
		const attributes: AnyValueMap = {
			"log.component": record.component,
			...contextToAttributes(record.context),
		};
		if (record.args.length > 0) {
			attributes["log.args"] = record.args.map(
				serializeArg,
			) as AnyValueMap[string];
		}
		this.otelLogger.emit({
			severityNumber: severityNumberFor(record.level),
			severityText: severityTextFor(record.level),
			body: record.message,
			attributes,
		});
	}

	emitEvent(record: EventRecord): void {
		if (!isTelemetryActive()) {
			return;
		}
		const { name, ...payload } = record.event;
		const attributes: AnyValueMap = {
			"log.component": record.component,
			"event.name": name,
			...contextToAttributes(record.context),
		};
		for (const [key, value] of Object.entries(payload)) {
			if (value === undefined) {
				continue;
			}
			attributes[`event.${key}`] = serializeArg(value) as AnyValueMap[string];
		}
		this.otelLogger.emit({
			severityNumber: SeverityNumber.INFO,
			severityText: "EVENT",
			body: name,
			attributes,
		});
	}
}
