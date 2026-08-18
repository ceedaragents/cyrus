/**
 * Bounded retry with backoff for Linear API rate limiting (HTTP 429).
 *
 * Linear allows a fixed number of requests per hour per token. When that budget
 * is spent the API rejects further requests with a `Ratelimited` error, and the
 * SDK parses the response's `Retry-After` header into
 * `RatelimitedLinearError.retryAfter` (seconds). Nothing read that value, so a
 * single 429 propagated straight to the caller — which, for most Linear calls in
 * Cyrus, means a logged error and a `null` return. In-flight agent sessions
 * silently lost activity posts, issue reads, and in the worst case the initial
 * prompt.
 *
 * A 429 is a *pre-execution* rejection: the API declines the request before
 * applying it, so no mutation is partially applied and retrying cannot
 * double-post. Only rate-limit errors are retried here; everything else
 * propagates untouched.
 *
 * Waiting is bounded deliberately. A hung session is worse than a failed one, so
 * if the wait Linear asks for exceeds `maxDelayMs`, or the cumulative wait would
 * exceed `maxTotalDelayMs`, the error is rethrown immediately rather than parked.
 *
 * @module rateLimitRetry
 */

import { LinearErrorType } from "@linear/sdk";
import type { ILogger } from "cyrus-core";

/** Total attempts, including the first one. */
const DEFAULT_MAX_ATTEMPTS = 4;
/** Base delay for exponential backoff when Linear sends no `Retry-After`. */
const DEFAULT_BASE_DELAY_MS = 1_000;
/** Longest single wait. A longer `Retry-After` than this fails fast instead. */
const DEFAULT_MAX_DELAY_MS = 30_000;
/** Longest cumulative wait across all attempts for one request. */
const DEFAULT_MAX_TOTAL_DELAY_MS = 60_000;
/** Upper bound on the random jitter added to a `Retry-After` derived delay. */
const RETRY_AFTER_JITTER_MS = 1_000;

export interface LinearRateLimitRetryOptions {
	/** Total attempts including the first. Default 4 (i.e. up to 3 retries). */
	maxAttempts?: number;
	/** Base delay for exponential backoff when no `Retry-After` is present. */
	baseDelayMs?: number;
	/** Longest single wait; a larger required wait rethrows instead. */
	maxDelayMs?: number;
	/** Longest cumulative wait for one request before giving up. */
	maxTotalDelayMs?: number;
	/** Label used in log lines, e.g. the GraphQL operation name. */
	operationName?: string;
	logger?: ILogger;
	/** Injectable for tests. */
	random?: () => number;
	/** Injectable for tests. */
	sleep?: (ms: number) => Promise<void>;
}

/**
 * True when the error is Linear's rate-limit rejection.
 *
 * Matches on the SDK's parsed `type` and on HTTP 429, because Linear also
 * reports rate limiting through GraphQL `errors` on an HTTP 200 response.
 */
export function isLinearRateLimitError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const candidate = error as {
		type?: unknown;
		status?: unknown;
		response?: { status?: unknown };
		errors?: Array<{ type?: unknown }>;
	};

	if (candidate.type === LinearErrorType.Ratelimited) return true;
	if (candidate.status === 429 || candidate.response?.status === 429)
		return true;

	return Boolean(
		candidate.errors?.some(
			(graphqlError) => graphqlError?.type === LinearErrorType.Ratelimited,
		),
	);
}

/**
 * The wait Linear asked for, in milliseconds, if it sent one.
 *
 * `RatelimitedLinearError.retryAfter` is in seconds. Values that are absent,
 * non-finite or negative are treated as "not specified".
 */
export function getLinearRetryAfterMs(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const { retryAfter } = error as { retryAfter?: unknown };
	if (typeof retryAfter !== "number") return undefined;
	if (!Number.isFinite(retryAfter) || retryAfter < 0) return undefined;
	return Math.round(retryAfter * 1_000);
}

/**
 * How long to wait before the next attempt, or `undefined` to stop retrying.
 *
 * Honours `Retry-After` when Linear sends one — as a floor, since waiting less
 * than asked just burns another request — with a little jitter on top so
 * concurrent callers do not resume in lockstep. Without `Retry-After` it falls
 * back to exponential backoff with equal jitter.
 *
 * Returns `undefined` when the required wait exceeds `maxDelayMs`, so the caller
 * fails visibly rather than parking a session for minutes.
 *
 * @param attempt - 1-based number of the attempt that just failed
 */
export function computeLinearRateLimitDelayMs(
	attempt: number,
	error: unknown,
	options: LinearRateLimitRetryOptions = {},
): number | undefined {
	const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const random = options.random ?? Math.random;

	const retryAfterMs = getLinearRetryAfterMs(error);
	if (retryAfterMs !== undefined) {
		// Linear told us how long to wait; anything shorter is wasted.
		if (retryAfterMs > maxDelayMs) return undefined;
		return retryAfterMs + Math.floor(random() * RETRY_AFTER_JITTER_MS);
	}

	const exponentialMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
	// Equal jitter: half fixed, half random, so retries spread out.
	return Math.floor(exponentialMs / 2 + random() * (exponentialMs / 2));
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `operation`, retrying it while Linear reports rate limiting.
 *
 * Non-rate-limit errors, and rate-limit errors that exhaust the attempt or wait
 * budget, are rethrown unchanged so existing error handling still sees them.
 */
export async function withLinearRateLimitRetry<T>(
	operation: () => Promise<T>,
	options: LinearRateLimitRetryOptions = {},
): Promise<T> {
	const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
	const maxTotalDelayMs = options.maxTotalDelayMs ?? DEFAULT_MAX_TOTAL_DELAY_MS;
	const sleep = options.sleep ?? defaultSleep;
	const label = options.operationName ?? "Linear request";

	let totalDelayMs = 0;

	for (let attempt = 1; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (!isLinearRateLimitError(error)) throw error;

			if (attempt >= maxAttempts) {
				options.logger?.error(
					`${label} rate-limited by Linear and out of retries after ${attempt} attempts`,
				);
				throw error;
			}

			const delayMs = computeLinearRateLimitDelayMs(attempt, error, options);
			if (delayMs === undefined) {
				options.logger?.error(
					`${label} rate-limited by Linear; Retry-After exceeds the retry budget, failing fast`,
				);
				throw error;
			}

			if (totalDelayMs + delayMs > maxTotalDelayMs) {
				options.logger?.error(
					`${label} rate-limited by Linear; cumulative backoff would exceed ${maxTotalDelayMs}ms, failing fast`,
				);
				throw error;
			}

			totalDelayMs += delayMs;
			options.logger?.warn(
				`${label} rate-limited by Linear; retrying in ${delayMs}ms (attempt ${attempt} of ${maxAttempts})`,
			);
			await sleep(delayMs);
		}
	}
}

/**
 * Best-effort operation name from a GraphQL document, for log lines.
 *
 * Falls back to a generic label rather than logging a whole query body — these
 * lines are emitted on the failure path, where a multi-kilobyte document in the
 * log is worse than no name at all.
 */
export function describeGraphQLOperation(document: string): string {
	const match = /\b(?:query|mutation)\s+(\w+)/.exec(document);
	return match ? `Linear ${match[1]}` : "Linear request";
}
