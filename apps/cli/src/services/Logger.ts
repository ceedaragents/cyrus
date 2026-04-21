import {
	type CyrusEvent,
	createLogger,
	type ILogger,
	type LogContext,
	type LogLevel,
	type LogPipeline,
} from "cyrus-core";

// Re-export LogLevel from cyrus-core so existing consumers don't break
export { LogLevel } from "cyrus-core";

/**
 * Logger configuration options
 */
export interface LoggerOptions {
	/** Minimum log level to output */
	level?: LogLevel;
	/** Prefix to add to all log messages (used as component name) */
	prefix?: string;
	/** Whether to include timestamps */
	timestamps?: boolean;
	/**
	 * Root pipeline to write records into. Usually injected once at
	 * application boot; child loggers inherit it automatically.
	 */
	pipeline?: LogPipeline;
}

/**
 * CLI-specific logger that wraps the core ILogger.
 *
 * Provides CLI-presentation features (emoji formatting, raw output,
 * dividers, child loggers) on top of the standard core logging interface.
 *
 * Implements ILogger so it can be passed to packages that expect the core interface.
 */
export class Logger implements ILogger {
	private coreLogger: ILogger;
	private prefix: string;
	private timestamps: boolean;
	private pipeline: LogPipeline | undefined;

	constructor(options: LoggerOptions = {}) {
		this.prefix = options.prefix ?? "";
		this.timestamps = options.timestamps ?? false;
		this.pipeline = options.pipeline;
		this.coreLogger = createLogger({
			component: this.prefix || "CLI",
			level: options.level,
			...(this.pipeline ? { pipeline: this.pipeline } : {}),
		});
	}

	/**
	 * Debug log (lowest priority)
	 */
	debug(message: string, ...args: any[]): void {
		this.coreLogger.debug(message, ...args);
	}

	/**
	 * Info log (normal priority)
	 */
	info(message: string, ...args: any[]): void {
		this.coreLogger.info(message, ...args);
	}

	/**
	 * Success log - maps to info level with check mark prefix
	 */
	success(message: string, ...args: any[]): void {
		this.coreLogger.info(message, ...args);
	}

	/**
	 * Warning log
	 */
	warn(message: string, ...args: any[]): void {
		this.coreLogger.warn(message, ...args);
	}

	/**
	 * Error log (highest priority)
	 */
	error(message: string, ...args: any[]): void {
		this.coreLogger.error(message, ...args);
	}

	/**
	 * Raw output without formatting (always outputs regardless of level)
	 */
	raw(message: string, ...args: any[]): void {
		console.log(message, ...args);
	}

	/**
	 * Create a child logger with a prefix
	 */
	child(prefix: string): Logger {
		return new Logger({
			level: this.coreLogger.getLevel(),
			prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
			timestamps: this.timestamps,
			...(this.pipeline ? { pipeline: this.pipeline } : {}),
		});
	}

	/**
	 * Emit a structured operational event.
	 */
	event(event: CyrusEvent): void {
		this.coreLogger.event(event);
	}

	/**
	 * Run `fn` with the given bindings attached to every record emitted
	 * from within its async scope. Delegates to the core logger.
	 */
	runWithContext<T>(bindings: LogContext, fn: () => T): T {
		return this.coreLogger.runWithContext(bindings, fn);
	}

	/**
	 * Print a divider line
	 */
	divider(length = 70): void {
		this.raw("\u2500".repeat(length));
	}

	/**
	 * Create a new logger with additional context.
	 * Delegates to the core logger's withContext.
	 */
	withContext(context: LogContext): ILogger {
		return this.coreLogger.withContext(context);
	}

	/**
	 * Set log level dynamically
	 */
	setLevel(level: LogLevel): void {
		this.coreLogger.setLevel(level);
	}

	/**
	 * Get current log level
	 */
	getLevel(): LogLevel {
		return this.coreLogger.getLevel();
	}
}

/**
 * Default logger instance
 */
export const logger = new Logger();
