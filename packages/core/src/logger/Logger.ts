/**
 * Log levels in order of severity (lower = more verbose)
 */
export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	SILENT = 4,
}

/**
 * Log domains for categorizing and filtering logs
 * These allow operators to filter logs by area of concern
 */
export type LogDomain =
	| "webhook" // Incoming webhook processing
	| "git" // Git operations (worktree, branch, fetch)
	| "session" // Agent session lifecycle
	| "config" // Configuration loading and changes
	| "router" // Issue routing decisions
	| "runner" // Claude/AI runner operations
	| "transport" // Event transport (Linear API calls)
	| "rpc" // CLI RPC operations
	| "subroutine" // Subroutine execution
	| "prompt" // Prompt assembly and handling
	| "system"; // System-level operations (startup, shutdown)

/**
 * Structured context that can be attached to log messages
 */
export interface LogContext {
	/** Issue identifier (e.g., "DEF-123") */
	issueId?: string;
	/** Session ID for correlation */
	sessionId?: string;
	/** Repository name */
	repository?: string;
	/** Duration in milliseconds for timing operations */
	durationMs?: number;
	/** Additional arbitrary context */
	[key: string]: unknown;
}

/**
 * Configuration options for the logger
 */
export interface LoggerConfig {
	/** Minimum log level to output (defaults to INFO, or from CYRUS_LOG_LEVEL env) */
	level?: LogLevel;
	/** Only show logs from these domains (if empty, show all) */
	enabledDomains?: LogDomain[];
	/** Whether to output timestamps (defaults to true) */
	timestamps?: boolean;
	/** Whether to output structured JSON (defaults to false for human readability) */
	json?: boolean;
}

/**
 * A single log entry with all metadata
 */
interface LogEntry {
	level: LogLevel;
	domain: LogDomain;
	message: string;
	context?: LogContext;
	timestamp: Date;
}

/**
 * Parse log level from string (case-insensitive)
 */
function parseLogLevel(value: string | undefined): LogLevel | undefined {
	if (!value) return undefined;
	const normalized = value.toUpperCase();
	switch (normalized) {
		case "DEBUG":
			return LogLevel.DEBUG;
		case "INFO":
			return LogLevel.INFO;
		case "WARN":
		case "WARNING":
			return LogLevel.WARN;
		case "ERROR":
			return LogLevel.ERROR;
		case "SILENT":
		case "NONE":
			return LogLevel.SILENT;
		default:
			return undefined;
	}
}

/**
 * Parse enabled domains from comma-separated string
 */
function parseEnabledDomains(
	value: string | undefined,
): LogDomain[] | undefined {
	if (!value) return undefined;
	const domains = value.split(",").map((d) => d.trim().toLowerCase());
	// Validate domains
	const validDomains: LogDomain[] = [];
	for (const d of domains) {
		if (isValidDomain(d)) {
			validDomains.push(d);
		}
	}
	return validDomains.length > 0 ? validDomains : undefined;
}

/**
 * Check if a string is a valid log domain
 */
function isValidDomain(domain: string): domain is LogDomain {
	return [
		"webhook",
		"git",
		"session",
		"config",
		"router",
		"runner",
		"transport",
		"rpc",
		"subroutine",
		"prompt",
		"system",
	].includes(domain);
}

/**
 * Get log level name for display
 */
function getLevelName(level: LogLevel): string {
	switch (level) {
		case LogLevel.DEBUG:
			return "DEBUG";
		case LogLevel.INFO:
			return "INFO";
		case LogLevel.WARN:
			return "WARN";
		case LogLevel.ERROR:
			return "ERROR";
		default:
			return "UNKNOWN";
	}
}

/**
 * Get level indicator for human-readable output
 */
function getLevelIndicator(level: LogLevel): string {
	switch (level) {
		case LogLevel.DEBUG:
			return "🔍";
		case LogLevel.INFO:
			return "ℹ️ ";
		case LogLevel.WARN:
			return "⚠️ ";
		case LogLevel.ERROR:
			return "❌";
		default:
			return "  ";
	}
}

/**
 * Centralized, structured logger for the Cyrus system.
 *
 * Features:
 * - Log levels (DEBUG, INFO, WARN, ERROR) with environment-based filtering
 * - Log domains for categorizing logs by subsystem
 * - Structured context for correlation and debugging
 * - Child loggers for domain-specific logging
 * - Human-readable or JSON output
 *
 * Environment variables:
 * - CYRUS_LOG_LEVEL: Set minimum log level (DEBUG, INFO, WARN, ERROR, SILENT)
 * - CYRUS_LOG_DOMAINS: Comma-separated list of domains to show (e.g., "webhook,session,git")
 * - CYRUS_LOG_JSON: Set to "true" for JSON output
 * - CYRUS_LOG_TIMESTAMPS: Set to "false" to disable timestamps
 *
 * Usage:
 * ```typescript
 * import { logger } from 'cyrus-core';
 *
 * // Simple logging
 * logger.info('webhook', 'Received webhook');
 *
 * // With context
 * logger.info('session', 'Session started', { issueId: 'DEF-123', sessionId: 'abc' });
 *
 * // Create child logger for a domain
 * const gitLogger = logger.child('git');
 * gitLogger.info('Creating worktree', { repository: 'my-repo' });
 *
 * // Debug logging (only shown when CYRUS_LOG_LEVEL=DEBUG)
 * logger.debug('router', 'Routing decision', { patterns: [...] });
 * ```
 */
export class Logger {
	private level: LogLevel;
	private enabledDomains: LogDomain[] | undefined;
	private timestamps: boolean;
	private json: boolean;
	private defaultDomain: LogDomain | undefined;
	private defaultContext: LogContext;

	constructor(config: LoggerConfig = {}) {
		// Get config from environment, with explicit config taking precedence
		this.level =
			config.level ??
			parseLogLevel(process.env.CYRUS_LOG_LEVEL) ??
			LogLevel.INFO;
		this.enabledDomains =
			config.enabledDomains ??
			parseEnabledDomains(process.env.CYRUS_LOG_DOMAINS);
		this.timestamps =
			config.timestamps ?? process.env.CYRUS_LOG_TIMESTAMPS !== "false";
		this.json = config.json ?? process.env.CYRUS_LOG_JSON === "true";
		this.defaultContext = {};
	}

	/**
	 * Check if a log entry should be output based on level and domain filters
	 */
	private shouldLog(level: LogLevel, domain: LogDomain): boolean {
		// Check level
		if (level < this.level) {
			return false;
		}
		// Check domain filter
		if (this.enabledDomains && !this.enabledDomains.includes(domain)) {
			return false;
		}
		return true;
	}

	/**
	 * Format and output a log entry
	 */
	private output(entry: LogEntry): void {
		const fullContext = { ...this.defaultContext, ...entry.context };
		const hasContext = Object.keys(fullContext).length > 0;

		if (this.json) {
			// JSON output for machine parsing
			const jsonEntry = {
				timestamp: entry.timestamp.toISOString(),
				level: getLevelName(entry.level),
				domain: entry.domain,
				message: entry.message,
				...(hasContext ? fullContext : {}),
			};
			const output = JSON.stringify(jsonEntry);
			if (entry.level >= LogLevel.ERROR) {
				console.error(output);
			} else if (entry.level >= LogLevel.WARN) {
				console.warn(output);
			} else {
				console.log(output);
			}
		} else {
			// Human-readable output
			const parts: string[] = [];

			if (this.timestamps) {
				// Use compact timestamp format for readability
				const time = entry.timestamp.toISOString().slice(11, 23);
				parts.push(`[${time}]`);
			}

			parts.push(getLevelIndicator(entry.level));
			parts.push(`[${entry.domain}]`);
			parts.push(entry.message);

			// Add context as key=value pairs for non-trivial context
			if (hasContext) {
				const contextParts: string[] = [];
				for (const [key, value] of Object.entries(fullContext)) {
					if (value !== undefined && value !== null) {
						// Format value appropriately
						if (typeof value === "object") {
							contextParts.push(`${key}=${JSON.stringify(value)}`);
						} else {
							contextParts.push(`${key}=${value}`);
						}
					}
				}
				if (contextParts.length > 0) {
					parts.push(`{${contextParts.join(", ")}}`);
				}
			}

			const output = parts.join(" ");
			if (entry.level >= LogLevel.ERROR) {
				console.error(output);
			} else if (entry.level >= LogLevel.WARN) {
				console.warn(output);
			} else {
				console.log(output);
			}
		}
	}

	/**
	 * Log a debug message (lowest priority, most verbose)
	 */
	debug(domain: LogDomain, message: string, context?: LogContext): void;
	debug(message: string, context?: LogContext): void;
	debug(
		domainOrMessage: LogDomain | string,
		messageOrContext?: string | LogContext,
		context?: LogContext,
	): void {
		const { domain, message, ctx } = this.resolveArgs(
			domainOrMessage,
			messageOrContext,
			context,
		);
		if (this.shouldLog(LogLevel.DEBUG, domain)) {
			this.output({
				level: LogLevel.DEBUG,
				domain,
				message,
				context: ctx,
				timestamp: new Date(),
			});
		}
	}

	/**
	 * Log an info message (standard operational logging)
	 */
	info(domain: LogDomain, message: string, context?: LogContext): void;
	info(message: string, context?: LogContext): void;
	info(
		domainOrMessage: LogDomain | string,
		messageOrContext?: string | LogContext,
		context?: LogContext,
	): void {
		const { domain, message, ctx } = this.resolveArgs(
			domainOrMessage,
			messageOrContext,
			context,
		);
		if (this.shouldLog(LogLevel.INFO, domain)) {
			this.output({
				level: LogLevel.INFO,
				domain,
				message,
				context: ctx,
				timestamp: new Date(),
			});
		}
	}

	/**
	 * Log a warning message (potential issues that don't prevent operation)
	 */
	warn(domain: LogDomain, message: string, context?: LogContext): void;
	warn(message: string, context?: LogContext): void;
	warn(
		domainOrMessage: LogDomain | string,
		messageOrContext?: string | LogContext,
		context?: LogContext,
	): void {
		const { domain, message, ctx } = this.resolveArgs(
			domainOrMessage,
			messageOrContext,
			context,
		);
		if (this.shouldLog(LogLevel.WARN, domain)) {
			this.output({
				level: LogLevel.WARN,
				domain,
				message,
				context: ctx,
				timestamp: new Date(),
			});
		}
	}

	/**
	 * Log an error message (failures that need attention)
	 */
	error(domain: LogDomain, message: string, context?: LogContext): void;
	error(message: string, context?: LogContext): void;
	error(
		domainOrMessage: LogDomain | string,
		messageOrContext?: string | LogContext,
		context?: LogContext,
	): void {
		const { domain, message, ctx } = this.resolveArgs(
			domainOrMessage,
			messageOrContext,
			context,
		);
		if (this.shouldLog(LogLevel.ERROR, domain)) {
			this.output({
				level: LogLevel.ERROR,
				domain,
				message,
				context: ctx,
				timestamp: new Date(),
			});
		}
	}

	/**
	 * Resolve overloaded arguments for log methods
	 */
	private resolveArgs(
		domainOrMessage: LogDomain | string,
		messageOrContext?: string | LogContext,
		context?: LogContext,
	): { domain: LogDomain; message: string; ctx: LogContext | undefined } {
		if (isValidDomain(domainOrMessage)) {
			// Called as (domain, message, context?)
			return {
				domain: domainOrMessage,
				message: messageOrContext as string,
				ctx: context,
			};
		}
		// Called as (message, context?) - use default domain
		return {
			domain: this.defaultDomain ?? "system",
			message: domainOrMessage,
			ctx: messageOrContext as LogContext | undefined,
		};
	}

	/**
	 * Create a child logger with a specific domain and/or default context
	 *
	 * @param domain - The domain for all logs from this child logger
	 * @param context - Default context to attach to all logs
	 */
	child(domain: LogDomain, context?: LogContext): Logger {
		const child = new Logger({
			level: this.level,
			enabledDomains: this.enabledDomains,
			timestamps: this.timestamps,
			json: this.json,
		});
		child.defaultDomain = domain;
		child.defaultContext = { ...this.defaultContext, ...context };
		return child;
	}

	/**
	 * Create a child logger with additional context (same domain)
	 */
	withContext(context: LogContext): Logger {
		const child = new Logger({
			level: this.level,
			enabledDomains: this.enabledDomains,
			timestamps: this.timestamps,
			json: this.json,
		});
		child.defaultDomain = this.defaultDomain;
		child.defaultContext = { ...this.defaultContext, ...context };
		return child;
	}

	/**
	 * Get current log level
	 */
	getLevel(): LogLevel {
		return this.level;
	}

	/**
	 * Set log level dynamically
	 */
	setLevel(level: LogLevel): void {
		this.level = level;
	}

	/**
	 * Check if debug logging is enabled
	 */
	isDebugEnabled(): boolean {
		return this.level <= LogLevel.DEBUG;
	}
}

/**
 * Default logger instance for the Cyrus system
 */
export const logger = new Logger();

/**
 * Create a domain-specific logger for a component
 *
 * Usage:
 * ```typescript
 * import { createLogger } from 'cyrus-core';
 *
 * // At module level
 * const log = createLogger('session');
 *
 * // Then use throughout the file
 * log.info('Session started', { issueId: 'DEF-123' });
 * log.debug('Processing message', { messageType: 'text' });
 * log.error('Session failed', { error: err.message });
 * ```
 */
export function createLogger(domain: LogDomain, context?: LogContext): Logger {
	return logger.child(domain, context);
}
