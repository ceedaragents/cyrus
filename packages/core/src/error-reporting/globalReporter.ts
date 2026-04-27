import type { ErrorReporter } from "./ErrorReporter.js";
import { NoopErrorReporter } from "./NoopErrorReporter.js";

let globalReporter: ErrorReporter = new NoopErrorReporter();

/**
 * Install the process-wide {@link ErrorReporter}.
 *
 * The CLI bootstrap should call this exactly once, immediately after
 * constructing its real reporter, so that loggers and library code that
 * observe errors via {@link getGlobalErrorReporter} can forward them without
 * needing the reporter passed through every constructor.
 *
 * Returns the previously-installed reporter so tests can restore state.
 */
export function setGlobalErrorReporter(reporter: ErrorReporter): ErrorReporter {
	const previous = globalReporter;
	globalReporter = reporter;
	return previous;
}

/**
 * Read the process-wide {@link ErrorReporter}. Defaults to a {@link
 * NoopErrorReporter} when bootstrap has not installed one (libraries imported
 * without the CLI, tests, etc.) so call sites never need to null-check.
 */
export function getGlobalErrorReporter(): ErrorReporter {
	return globalReporter;
}

/**
 * Restore the default no-op reporter. Intended for tests.
 */
export function resetGlobalErrorReporter(): void {
	globalReporter = new NoopErrorReporter();
}
