import {
	type AnyValueMap,
	logs,
	type Logger as OtelLogger,
} from "@opentelemetry/api-logs";
import type { ILogger, LogContext } from "./ILogger.js";
import { LogLevel } from "./ILogger.js";
import {
	isTelemetryActive,
	severityNumberFor,
	severityTextFor,
} from "./telemetry.js";

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

function parseLevelFromEnv(): LogLevel | undefined {
	const envLevel = process.env.CYRUS_LOG_LEVEL?.toUpperCase();
	switch (envLevel) {
		case "DEBUG":
			return LogLevel.DEBUG;
		case "INFO":
			return LogLevel.INFO;
		case "WARN":
			return LogLevel.WARN;
		case "ERROR":
			return LogLevel.ERROR;
		case "SILENT":
			return LogLevel.SILENT;
		default:
			return undefined;
	}
}

const LEVEL_LABELS: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: "DEBUG",
	[LogLevel.INFO]: "INFO",
	[LogLevel.WARN]: "WARN",
	[LogLevel.ERROR]: "ERROR",
	[LogLevel.SILENT]: "",
};

class Logger implements ILogger {
	private level: LogLevel;
	private component: string;
	private context: LogContext;
	private otelLogger: OtelLogger;

	constructor(options: {
		component: string;
		level?: LogLevel;
		context?: LogContext;
	}) {
		this.component = options.component;
		this.level = options.level ?? parseLevelFromEnv() ?? LogLevel.INFO;
		this.context = options.context ?? {};
		// Safe to resolve eagerly — the API returns a proxy that defers to the
		// currently registered global provider (or a no-op when none is set).
		this.otelLogger = logs.getLogger(this.component);
	}

	private formatPrefix(level: LogLevel): string {
		const timestamp = new Date().toISOString();
		const label = LEVEL_LABELS[level];
		const padded = label.padEnd(5);
		const ctx = formatContext(this.context);
		return `${timestamp} [${padded}] [${this.component}]${ctx}`;
	}

	private emitTelemetry(
		level: LogLevel,
		message: string,
		args: unknown[],
	): void {
		if (!isTelemetryActive()) {
			return;
		}
		const attributes: AnyValueMap = {
			"log.component": this.component,
			...contextToAttributes(this.context),
		};
		if (args.length > 0) {
			attributes["log.args"] = args.map(serializeArg) as AnyValueMap[string];
		}
		this.otelLogger.emit({
			severityNumber: severityNumberFor(level),
			severityText: severityTextFor(level),
			body: message,
			attributes,
		});
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.DEBUG) {
			console.log(`${this.formatPrefix(LogLevel.DEBUG)} ${message}`, ...args);
			this.emitTelemetry(LogLevel.DEBUG, message, args);
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.INFO) {
			console.log(`${this.formatPrefix(LogLevel.INFO)} ${message}`, ...args);
			this.emitTelemetry(LogLevel.INFO, message, args);
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.WARN) {
			console.warn(`${this.formatPrefix(LogLevel.WARN)} ${message}`, ...args);
			this.emitTelemetry(LogLevel.WARN, message, args);
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.ERROR) {
			console.error(`${this.formatPrefix(LogLevel.ERROR)} ${message}`, ...args);
			this.emitTelemetry(LogLevel.ERROR, message, args);
		}
	}

	withContext(context: LogContext): ILogger {
		return new Logger({
			component: this.component,
			level: this.level,
			context: { ...this.context, ...context },
		});
	}

	getLevel(): LogLevel {
		return this.level;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}
}

export function createLogger(options: {
	component: string;
	level?: LogLevel;
	context?: LogContext;
}): ILogger {
	return new Logger(options);
}
