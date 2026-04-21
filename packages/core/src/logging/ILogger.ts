import type { CyrusEvent } from "./events.js";
import type { LogLevel } from "./LogLevel.js";
import type { LogBindings } from "./LogRecord.js";

export type LogContext = LogBindings;

export interface ILogger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	/**
	 * Emit a structured operational event. Events flow through the full
	 * sink chain regardless of the local logger level — they are signals
	 * for dashboards and alerting, not diagnostic prose.
	 */
	event(event: CyrusEvent): void;
	/**
	 * Return a logger that merges the given bindings into the current
	 * binding set. Does not mutate the parent.
	 */
	withContext(bindings: LogBindings): ILogger;
	/**
	 * Return a child logger with a new component name. Inherits bindings,
	 * level, and the underlying pipeline from the parent.
	 */
	child(component: string): ILogger;
	/**
	 * Run `fn` with the given bindings attached to every record emitted
	 * from within its async scope (via `AsyncLocalStorage`). Bindings are
	 * additive — outer scopes contribute their own bindings, the innermost
	 * wins on key collisions.
	 */
	runWithContext<T>(bindings: LogBindings, fn: () => T): T;
	getLevel(): LogLevel;
	setLevel(level: LogLevel): void;
}
