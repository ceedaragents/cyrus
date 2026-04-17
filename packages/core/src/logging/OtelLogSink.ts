import {
	type AnyValueMap,
	logs,
	type Logger as OtelLogger,
} from "@opentelemetry/api-logs";
import type { LogContext } from "./ILogger.js";
import type { LogRecord, LogSink } from "./LogSink.js";
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
}
