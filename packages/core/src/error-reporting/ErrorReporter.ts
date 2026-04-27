/**
 * Severity level for messages reported to the error tracker.
 */
export type ErrorReporterSeverity =
	| "fatal"
	| "error"
	| "warning"
	| "info"
	| "debug";

/**
 * Structured context attached to a reported event.
 *
 * Keys are arbitrary; values must be JSON-serialisable. Implementations
 * should not throw if the context object is unsupported, instead they
 * should drop or coerce the offending field.
 */
export interface ErrorReporterContext {
	tags?: Record<string, string>;
	extra?: Record<string, unknown>;
	user?: { id?: string; email?: string; username?: string };
}

/**
 * Abstraction over error-tracking backends.
 *
 * Cyrus depends only on this interface so that:
 *   - alternative backends (Sentry, Bugsnag, Honeycomb, Noop) can be swapped
 *     without touching call sites,
 *   - the bulk of the codebase compiles without a backend SDK in scope, and
 *   - tests can inject a fake reporter without network or globals.
 */
export interface ErrorReporter {
	/** Report an exception. Safe to call when the backend is disabled. */
	captureException(error: unknown, context?: ErrorReporterContext): void;

	/** Report a message at the given severity (defaults to "info"). */
	captureMessage(
		message: string,
		severity?: ErrorReporterSeverity,
		context?: ErrorReporterContext,
	): void;

	/**
	 * Flush any buffered events. Returns true if all events were sent before
	 * the timeout, false otherwise. Safe to call when disabled (resolves true).
	 */
	flush(timeoutMs?: number): Promise<boolean>;

	/** Whether this reporter is actually transmitting events. */
	readonly isEnabled: boolean;
}
