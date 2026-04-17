import { ConsoleLogSink } from "./ConsoleLogSink.js";
import type { ILogger, LogContext } from "./ILogger.js";
import { LogLevel } from "./ILogger.js";
import type { LogSink } from "./LogSink.js";
import { OtelLogSink } from "./OtelLogSink.js";

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

interface LoggerOptions {
	component: string;
	level?: LogLevel;
	context?: LogContext;
	sinks?: LogSink[];
}

class Logger implements ILogger {
	private level: LogLevel;
	private readonly component: string;
	private readonly context: LogContext;
	private readonly sinks: LogSink[];

	constructor(options: LoggerOptions) {
		this.component = options.component;
		this.level = options.level ?? parseLevelFromEnv() ?? LogLevel.INFO;
		this.context = options.context ?? {};
		this.sinks = options.sinks ?? [
			new ConsoleLogSink(),
			new OtelLogSink(options.component),
		];
	}

	private dispatch(level: LogLevel, message: string, args: unknown[]): void {
		if (this.level > level) {
			return;
		}
		const record = {
			level,
			component: this.component,
			context: this.context,
			message,
			args,
			timestamp: new Date(),
		};
		for (const sink of this.sinks) {
			sink.emit(record);
		}
	}

	debug(message: string, ...args: unknown[]): void {
		this.dispatch(LogLevel.DEBUG, message, args);
	}

	info(message: string, ...args: unknown[]): void {
		this.dispatch(LogLevel.INFO, message, args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.dispatch(LogLevel.WARN, message, args);
	}

	error(message: string, ...args: unknown[]): void {
		this.dispatch(LogLevel.ERROR, message, args);
	}

	withContext(context: LogContext): ILogger {
		return new Logger({
			component: this.component,
			level: this.level,
			context: { ...this.context, ...context },
			sinks: this.sinks,
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
	sinks?: LogSink[];
}): ILogger {
	return new Logger(options);
}
