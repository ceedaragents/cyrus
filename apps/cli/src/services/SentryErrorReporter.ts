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
	 * Structured context block attached to every event under the `cyrus` key.
	 * Unlike tags, contexts are not indexed for search but support nested
	 * structured data — ideal for grouping related fields (team_id, version,
	 * environment, deployment) under one heading in the Sentry UI.
	 */
	structuredContext?: Record<string, unknown>;
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
			// Append integrations that enrich every event with structured data:
			//   - extraErrorDataIntegration walks Error subclasses and serialises
			//     non-standard own properties as `extra` (so e.g. `err.statusCode`,
			//     `err.requestId`, custom Cyrus error fields surface in Sentry).
			//   - consoleIntegration captures console.* output as breadcrumbs so
			//     events arrive with a structured trail of the last log lines.
			integrations: (defaults) => [
				...defaults,
				Sentry.extraErrorDataIntegration({ depth: 4 }),
				Sentry.consoleIntegration(),
			],
			// Apply caller-provided tags (e.g. team_id) and a structured `cyrus`
			// context to every event. Tags are indexed/searchable; the context is
			// shown as a grouped structured block in the Sentry UI and is the
			// home for fields too noisy or unbounded to be tags.
			initialScope: buildInitialScope(options),
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

function buildInitialScope(
	options: SentryErrorReporterOptions,
): NonNullable<Parameters<typeof Sentry.init>[0]>["initialScope"] {
	const hasTags = options.tags && Object.keys(options.tags).length > 0;
	const hasContext =
		options.structuredContext &&
		Object.keys(options.structuredContext).length > 0;
	if (!hasTags && !hasContext) return undefined;
	return {
		...(hasTags ? { tags: options.tags } : {}),
		...(hasContext ? { contexts: { cyrus: options.structuredContext } } : {}),
	};
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
	if (context.fingerprint && context.fingerprint.length > 0) {
		scope.setFingerprint(context.fingerprint);
	}
}
