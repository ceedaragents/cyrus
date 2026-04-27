import { getGlobalErrorReporter } from "../error-reporting/globalReporter.js";
import type { ILogger, LogContext } from "./ILogger.js";
import { LogLevel } from "./ILogger.js";

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

	constructor(options: {
		component: string;
		level?: LogLevel;
		context?: LogContext;
	}) {
		this.component = options.component;
		this.level = options.level ?? parseLevelFromEnv() ?? LogLevel.INFO;
		this.context = options.context ?? {};
	}

	private formatPrefix(level: LogLevel): string {
		const timestamp = new Date().toISOString();
		const label = LEVEL_LABELS[level];
		const padded = label.padEnd(5);
		const ctx = formatContext(this.context);
		return `${timestamp} [${padded}] [${this.component}]${ctx}`;
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.DEBUG) {
			console.log(`${this.formatPrefix(LogLevel.DEBUG)} ${message}`, ...args);
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.INFO) {
			console.log(`${this.formatPrefix(LogLevel.INFO)} ${message}`, ...args);
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.WARN) {
			console.warn(`${this.formatPrefix(LogLevel.WARN)} ${message}`, ...args);
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.level <= LogLevel.ERROR) {
			console.error(`${this.formatPrefix(LogLevel.ERROR)} ${message}`, ...args);
		}

		// Forward to the process-wide error reporter so ad-hoc `logger.error(msg, err)`
		// calls scattered across the codebase (claude-runner, edge-worker, transports,
		// persistence, etc.) automatically surface in Sentry without requiring the
		// reporter to be threaded through every constructor.
		this.forwardToErrorReporter(message, args);
	}

	private forwardToErrorReporter(message: string, args: unknown[]): void {
		const reporter = getGlobalErrorReporter();
		if (!reporter.isEnabled) return;

		const error = extractError(args);
		const contextTags: Record<string, string> = { component: this.component };
		if (this.context.sessionId) contextTags.sessionId = this.context.sessionId;
		if (this.context.platform) contextTags.platform = this.context.platform;
		if (this.context.issueIdentifier) {
			contextTags.issueIdentifier = this.context.issueIdentifier;
		}
		if (this.context.repository)
			contextTags.repository = this.context.repository;

		const extra: Record<string, unknown> = { message };
		if (args.length > 0) extra.args = args;

		if (error) {
			reporter.captureException(error, { tags: contextTags, extra });
		} else {
			// No Error object found — capture the message at "error" severity so
			// otherwise-invisible failure paths still produce a Sentry event.
			reporter.captureMessage(message, "error", {
				tags: contextTags,
				extra,
			});
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

/**
 * Find the first {@link Error} in the trailing args of a `logger.error(...)`
 * call. Also follows `error.cause` chains (used by transports that wrap an
 * underlying failure) and unwraps objects that look like `{ error: Error }`.
 */
function extractError(args: unknown[]): Error | undefined {
	for (const arg of args) {
		if (arg instanceof Error) return arg;
		if (
			arg &&
			typeof arg === "object" &&
			"error" in arg &&
			(arg as { error: unknown }).error instanceof Error
		) {
			return (arg as { error: Error }).error;
		}
	}
	return undefined;
}
