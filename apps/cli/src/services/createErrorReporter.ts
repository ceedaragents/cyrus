import {
	type ErrorReporter,
	NoopErrorReporter,
	setGlobalErrorTags,
} from "cyrus-core";
import { SentryErrorReporter } from "./SentryErrorReporter.js";

/**
 * Default DSN baked into release builds. Empty until an admin creates the
 * `ceedar/cyrus-cli` Sentry project and pastes the DSN here. Sentry DSNs are
 * safe to publish — they only authorise event ingestion.
 *
 * End users may override this with the `CYRUS_SENTRY_DSN` env var, or disable
 * reporting entirely with `CYRUS_SENTRY_DISABLED=1`.
 */
export const DEFAULT_SENTRY_DSN = "";

export interface CreateErrorReporterParams {
	release?: string;
	/**
	 * Reads default to `process.env`. Injected for tests.
	 */
	env?: NodeJS.ProcessEnv;
}

/**
 * Build the application's {@link ErrorReporter}.
 *
 * Order of resolution:
 *   1. If `CYRUS_SENTRY_DISABLED` is truthy → noop.
 *   2. Else if a DSN is available (env var or compiled default) → Sentry.
 *   3. Else → noop.
 *
 * Initialise this as early as possible during process startup so that
 * exceptions thrown by subsequent imports/bootstrap are captured.
 */
export function createErrorReporter(
	params: CreateErrorReporterParams = {},
): ErrorReporter {
	const env = params.env ?? process.env;

	if (isTruthyEnv(env.CYRUS_SENTRY_DISABLED)) {
		return new NoopErrorReporter();
	}

	const dsn = env.CYRUS_SENTRY_DSN?.trim() || DEFAULT_SENTRY_DSN;
	if (!dsn) {
		return new NoopErrorReporter();
	}

	const tags = buildInitialTags(env);
	// Mirror the same tags into the process-wide registry so Logger.error
	// forwarding (which builds its own per-event tag map) includes them too,
	// not just events emitted directly via the Sentry SDK's initialScope.
	if (tags) setGlobalErrorTags(tags);

	return new SentryErrorReporter({
		dsn,
		release: params.release,
		environment: env.CYRUS_SENTRY_ENVIRONMENT?.trim() || "production",
		debug: (env.CYRUS_LOG_LEVEL ?? "").toUpperCase() === "DEBUG",
		tags,
	});
}

/**
 * Build the global tag set applied to every Sentry event. Currently picks up
 * `CYRUS_TEAM_ID` and exposes it as the `team_id` tag so events can be
 * filtered per Cyrus tenant in Sentry.
 *
 * Add additional process-wide tags here rather than at capture sites — keeps
 * call sites free of cross-cutting concerns.
 */
function buildInitialTags(
	env: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
	const tags: Record<string, string> = {};
	const teamId = env.CYRUS_TEAM_ID?.trim();
	if (teamId) tags.team_id = teamId;
	return Object.keys(tags).length > 0 ? tags : undefined;
}

function isTruthyEnv(value: string | undefined): boolean {
	if (!value) return false;
	const v = value.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}
