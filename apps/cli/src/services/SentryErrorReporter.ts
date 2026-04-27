import * as Sentry from "@sentry/node";
import type {
	ErrorReporter,
	ErrorReporterContext,
	ErrorReporterSeverity,
} from "cyrus-core";

export interface SentryErrorReporterOptions {
	dsn: string;
	release?: string;
	environment?: string;
	/**
	 * Tags applied to every event emitted by this reporter (e.g. `team_id` from
	 * `CYRUS_TEAM_ID`). See https://docs.sentry.io/platform-redirect/?next=/enriching-events/tags
	 */
	tags?: Record<string, string>;
	/**
	 * Sample rate for error events. Sentry's default is 1.0 (send everything).
	 * Lower this if a high-volume error path needs sampling.
	 */
	sampleRate?: number;
	/**
	 * If true, prints debug logs from the SDK itself. Wired to CYRUS_LOG_LEVEL=DEBUG.
	 */
	debug?: boolean;
	/**
	 * Hook invoked before an event is sent. Returning null drops the event.
	 * Useful for redacting sensitive payloads in tests.
	 */
	beforeSend?: Parameters<typeof Sentry.init>[0] extends infer T
		? T extends { beforeSend?: infer F }
			? F
			: never
		: never;
}

/**
 * Sentry-backed {@link ErrorReporter}.
 *
 * Single Responsibility: this class only knows how to translate Cyrus-shaped
 * events into the Sentry SDK. It owns no application logic.
 *
 * The constructor initialises the Sentry SDK; therefore at most one instance
 * should be created per process. Use {@link createErrorReporter} as the entry
 * point — it enforces that contract along with the opt-out semantics.
 */
export class SentryErrorReporter implements ErrorReporter {
	readonly isEnabled = true;

	constructor(options: SentryErrorReporterOptions) {
		Sentry.init({
			dsn: options.dsn,
			release: options.release,
			environment: options.environment ?? "production",
			sampleRate: options.sampleRate ?? 1.0,
			debug: options.debug ?? false,
			// Performance monitoring is intentionally disabled — we only ship
			// error tracking. Flip this on later if we need transaction data.
			tracesSampleRate: 0,
			beforeSend: options.beforeSend,
			// Apply caller-provided tags (e.g. team_id) to every event so they
			// don't have to be re-set at each capture site.
			initialScope: options.tags ? { tags: options.tags } : undefined,
		});
	}

	captureException(error: unknown, context?: ErrorReporterContext): void {
		Sentry.withScope((scope) => {
			applyContext(scope, context);
			Sentry.captureException(error);
		});
	}

	captureMessage(
		message: string,
		severity: ErrorReporterSeverity = "info",
		context?: ErrorReporterContext,
	): void {
		Sentry.withScope((scope) => {
			applyContext(scope, context);
			Sentry.captureMessage(message, severity);
		});
	}

	async flush(timeoutMs = 2000): Promise<boolean> {
		return Sentry.flush(timeoutMs);
	}
}

function applyContext(
	scope: Sentry.Scope,
	context: ErrorReporterContext | undefined,
): void {
	if (!context) return;
	if (context.tags) {
		for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
	}
	if (context.extra) {
		for (const [k, v] of Object.entries(context.extra)) scope.setExtra(k, v);
	}
	if (context.user) scope.setUser(context.user);
}
