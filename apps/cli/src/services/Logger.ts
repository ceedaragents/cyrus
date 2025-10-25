/**
 * Log levels in order of severity
 */
export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	SUCCESS = 2,
	WARN = 3,
	ERROR = 4,
	SILENT = 5,
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
	/** Minimum log level to output */
	level?: LogLevel;
	/** Prefix to add to all log messages */
	prefix?: string;
	/** Whether to include timestamps */
	timestamps?: boolean;
}

/**
 * Simple, zero-dependency logger service with structured logging
 */
export class Logger {
	private level: LogLevel;
	private prefix: string;
	private timestamps: boolean;

	constructor(options: LoggerOptions = {}) {
		this.level = options.level ?? this.getLogLevelFromEnv();
		this.prefix = options.prefix ?? "";
		this.timestamps = options.timestamps ?? false;
	}

	/**
	 * Get log level from environment variable
	 */
	private getLogLevelFromEnv(): LogLevel {
		const envLevel = process.env.CYRUS_LOG_LEVEL?.toUpperCase();
		switch (envLevel) {
			case "DEBUG":
				return LogLevel.DEBUG;
			case "INFO":
				return LogLevel.INFO;
			case "SUCCESS":
				return LogLevel.SUCCESS;
			case "WARN":
				return LogLevel.WARN;
			case "ERROR":
				return LogLevel.ERROR;
			case "SILENT":
				return LogLevel.SILENT;
			default:
				return LogLevel.INFO;
		}
	}

	/**
	 * Format a log message with optional prefix and timestamp
	 */
	private format(message: string): string {
		let formatted = message;

		if (this.prefix) {
			formatted = `[${this.prefix}] ${formatted}`;
		}

		if (this.timestamps) {
			const timestamp = new Date().toISOString();
			formatted = `${timestamp} ${formatted}`;
		}

		return formatted;
	}

	/**
	 * Check if a log level should be output
	 */
	private shouldLog(level: LogLevel): boolean {
		return level >= this.level;
	}

	/**
	 * Debug log (lowest priority)
	 */
	debug(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.DEBUG)) {
			console.log(this.format(`🔍 ${message}`), ...args);
		}
	}

	/**
	 * Info log (normal priority)
	 */
	info(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.log(this.format(message), ...args);
		}
	}

	/**
	 * Success log (positive outcome)
	 */
	success(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.SUCCESS)) {
			console.log(this.format(`✅ ${message}`), ...args);
		}
	}

	/**
	 * Warning log
	 */
	warn(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.WARN)) {
			console.warn(this.format(`⚠️  ${message}`), ...args);
		}
	}

	/**
	 * Error log (highest priority)
	 */
	error(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error(this.format(`❌ ${message}`), ...args);
		}
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
			level: this.level,
			prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
			timestamps: this.timestamps,
		});
	}

	/**
	 * Print a divider line
	 */
	divider(length = 70): void {
		this.raw("─".repeat(length));
	}

	/**
	 * Set log level dynamically
	 */
	setLevel(level: LogLevel): void {
		this.level = level;
	}

	/**
	 * Get current log level
	 */
	getLevel(): LogLevel {
		return this.level;
	}
}

/**
 * Default logger instance
 */
export const logger = new Logger();
