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

/**
 * Keys whose values are scrubbed before export.
 * Matches common secret-carrying field names regardless of case or
 * surrounding punctuation (camelCase, snake_case, dotted paths all covered).
 */
const SENSITIVE_KEY_PATTERN =
	/token|secret|password|bearer|credential|apikey|api[._-]?key|authorization|auth[._-]?header|cookie|session[._-]?cookie|private[._-]?key|client[._-]?secret/i;

const REDACTED_PLACEHOLDER = "[REDACTED]";
const MAX_REDACTION_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Recursively redact any value whose key matches {@link SENSITIVE_KEY_PATTERN}.
 * Walks plain objects and arrays only; other object shapes (Map, Set, class
 * instances) are serialised as-is because `JSON.stringify` already flattens them.
 *
 * Depth-limited to guard against pathological cyclic-but-serialisable graphs
 * that slip past JSON.stringify's cycle detection via `toJSON` tricks.
 */
function redactSensitive(value: unknown, depth = 0): unknown {
	if (depth > MAX_REDACTION_DEPTH) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactSensitive(item, depth + 1));
	}
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value)) {
			if (SENSITIVE_KEY_PATTERN.test(key)) {
				out[key] = REDACTED_PLACEHOLDER;
			} else {
				out[key] = redactSensitive(v, depth + 1);
			}
		}
		return out;
	}
	return value;
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
	let plain: unknown;
	try {
		plain = JSON.parse(JSON.stringify(arg));
	} catch {
		return String(arg);
	}
	return redactSensitive(plain);
}

export interface OtelLogSinkOptions {
	/**
	 * Minimum level forwarded to OTel. Log records below this threshold are
	 * dropped at the sink. Defaults to WARN to keep export volume bounded;
	 * operators who need INFO-level correlation can lower it.
	 */
	minLogLevel?: LogLevel;
}

export class OtelLogSink implements LogSink {
	readonly alwaysEmitEvents = true;
	private readonly otelLogger: OtelLogger;
	private readonly minLogLevel: LogLevel;

	constructor(component: string, options: OtelLogSinkOptions = {}) {
		// Safe to resolve eagerly — the API returns a proxy that defers to the
		// currently registered global provider (or a no-op when none is set).
		this.otelLogger = logs.getLogger(component);
		this.minLogLevel = options.minLogLevel ?? LogLevel.WARN;
	}

	emit(record: LogRecord): void {
		if (!isTelemetryActive()) {
			return;
		}
		if (record.level < this.minLogLevel) {
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
