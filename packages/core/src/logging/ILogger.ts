import type { CyrusEvent } from "./events.js";

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	SILENT = 4,
}

export interface LogContext {
	sessionId?: string;
	platform?: string;
	issueIdentifier?: string;
	repository?: string;
}

export interface ILogger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	/**
	 * Emit a structured operational event. Events always reach the OTel
	 * sink regardless of the current log level and are intended for
	 * dashboards/alerting, not human diagnostic prose.
	 */
	event(event: CyrusEvent): void;
	withContext(context: LogContext): ILogger;
	getLevel(): LogLevel;
	setLevel(level: LogLevel): void;
}
