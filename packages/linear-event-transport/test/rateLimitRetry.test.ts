import { LinearErrorType } from "@linear/sdk";
import { describe, expect, it, vi } from "vitest";
import {
	computeLinearRateLimitDelayMs,
	describeGraphQLOperation,
	getLinearRetryAfterMs,
	isLinearRateLimitError,
	withLinearRateLimitRetry,
} from "../src/rateLimitRetry.js";

/** Shaped like the Linear SDK's RatelimitedLinearError. */
function rateLimitError(retryAfter?: number): Error {
	const error = new Error(
		"Rate limit exceeded. Only 5000 requests are allowed per 1 hour.",
	) as Error & { type: string; retryAfter?: number; status: number };
	error.type = LinearErrorType.Ratelimited;
	error.status = 429;
	if (retryAfter !== undefined) error.retryAfter = retryAfter;
	return error;
}

/** Collects sleeps instead of performing them, so tests stay instant. */
function fakeSleep() {
	const slept: number[] = [];
	return {
		slept,
		sleep: async (ms: number) => {
			slept.push(ms);
		},
	};
}

describe("isLinearRateLimitError", () => {
	it("recognises the SDK's parsed Ratelimited type", () => {
		expect(isLinearRateLimitError(rateLimitError())).toBe(true);
	});

	it("recognises a bare HTTP 429", () => {
		expect(isLinearRateLimitError({ status: 429 })).toBe(true);
		expect(isLinearRateLimitError({ response: { status: 429 } })).toBe(true);
	});

	it("recognises rate limiting reported through GraphQL errors on HTTP 200", () => {
		expect(
			isLinearRateLimitError({
				errors: [{ type: LinearErrorType.Ratelimited }],
			}),
		).toBe(true);
	});

	it("does not treat other failures as rate limiting", () => {
		expect(isLinearRateLimitError(new Error("boom"))).toBe(false);
		expect(isLinearRateLimitError({ status: 401 })).toBe(false);
		expect(
			isLinearRateLimitError({ type: LinearErrorType.AuthenticationError }),
		).toBe(false);
		expect(isLinearRateLimitError(undefined)).toBe(false);
		expect(isLinearRateLimitError("Ratelimited")).toBe(false);
	});
});

describe("getLinearRetryAfterMs", () => {
	it("converts retryAfter seconds to milliseconds", () => {
		expect(getLinearRetryAfterMs(rateLimitError(2))).toBe(2_000);
		expect(getLinearRetryAfterMs(rateLimitError(0))).toBe(0);
	});

	it("ignores absent or nonsensical values", () => {
		expect(getLinearRetryAfterMs(rateLimitError())).toBeUndefined();
		expect(getLinearRetryAfterMs(rateLimitError(-1))).toBeUndefined();
		expect(
			getLinearRetryAfterMs(rateLimitError(Number.POSITIVE_INFINITY)),
		).toBeUndefined();
	});
});

describe("computeLinearRateLimitDelayMs", () => {
	it("honours Retry-After as a floor and adds jitter", () => {
		const delay = computeLinearRateLimitDelayMs(1, rateLimitError(3), {
			random: () => 0.5,
		});

		expect(delay).toBe(3_000 + 500);
	});

	it("refuses to retry when Retry-After exceeds the single-wait cap", () => {
		const delay = computeLinearRateLimitDelayMs(1, rateLimitError(3_600), {
			maxDelayMs: 30_000,
		});

		expect(delay).toBeUndefined();
	});

	it("backs off exponentially with jitter when Retry-After is absent", () => {
		const options = { baseDelayMs: 1_000, random: () => 1 };

		expect(computeLinearRateLimitDelayMs(1, rateLimitError(), options)).toBe(
			1_000,
		);
		expect(computeLinearRateLimitDelayMs(2, rateLimitError(), options)).toBe(
			2_000,
		);
		expect(computeLinearRateLimitDelayMs(3, rateLimitError(), options)).toBe(
			4_000,
		);
	});

	it("keeps exponential jitter within half the computed delay", () => {
		const low = computeLinearRateLimitDelayMs(3, rateLimitError(), {
			baseDelayMs: 1_000,
			random: () => 0,
		});

		expect(low).toBe(2_000);
	});

	it("caps exponential backoff at maxDelayMs", () => {
		const delay = computeLinearRateLimitDelayMs(10, rateLimitError(), {
			baseDelayMs: 1_000,
			maxDelayMs: 5_000,
			random: () => 1,
		});

		expect(delay).toBe(5_000);
	});
});

describe("withLinearRateLimitRetry", () => {
	it("returns the result without sleeping when the call succeeds", async () => {
		const { slept, sleep } = fakeSleep();
		const operation = vi.fn().mockResolvedValue("ok");

		await expect(withLinearRateLimitRetry(operation, { sleep })).resolves.toBe(
			"ok",
		);
		expect(operation).toHaveBeenCalledTimes(1);
		expect(slept).toEqual([]);
	});

	it("retries a rate-limited call and returns the eventual success", async () => {
		const { slept, sleep } = fakeSleep();
		const operation = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError(2))
			.mockResolvedValue("ok");

		await expect(
			withLinearRateLimitRetry(operation, { sleep, random: () => 0 }),
		).resolves.toBe("ok");
		expect(operation).toHaveBeenCalledTimes(2);
		expect(slept).toEqual([2_000]);
	});

	it("gives up after maxAttempts and rethrows the original error", async () => {
		const { slept, sleep } = fakeSleep();
		const error = rateLimitError(1);
		const operation = vi.fn().mockRejectedValue(error);

		await expect(
			withLinearRateLimitRetry(operation, {
				sleep,
				random: () => 0,
				maxAttempts: 3,
			}),
		).rejects.toBe(error);
		expect(operation).toHaveBeenCalledTimes(3);
		expect(slept).toEqual([1_000, 1_000]);
	});

	it("does not retry non-rate-limit errors", async () => {
		const { slept, sleep } = fakeSleep();
		const error = new Error("boom");
		const operation = vi.fn().mockRejectedValue(error);

		await expect(withLinearRateLimitRetry(operation, { sleep })).rejects.toBe(
			error,
		);
		expect(operation).toHaveBeenCalledTimes(1);
		expect(slept).toEqual([]);
	});

	it("fails fast rather than parking a session for a long Retry-After", async () => {
		const { slept, sleep } = fakeSleep();
		const error = rateLimitError(3_600);
		const operation = vi.fn().mockRejectedValue(error);

		await expect(
			withLinearRateLimitRetry(operation, { sleep, maxDelayMs: 30_000 }),
		).rejects.toBe(error);
		expect(operation).toHaveBeenCalledTimes(1);
		expect(slept).toEqual([]);
	});

	it("stops once the cumulative wait budget would be exceeded", async () => {
		const { slept, sleep } = fakeSleep();
		const error = rateLimitError(20);
		const operation = vi.fn().mockRejectedValue(error);

		await expect(
			withLinearRateLimitRetry(operation, {
				sleep,
				random: () => 0,
				maxAttempts: 10,
				maxDelayMs: 30_000,
				maxTotalDelayMs: 30_000,
			}),
		).rejects.toBe(error);
		// 20s fits the 30s budget; a second 20s does not.
		expect(slept).toEqual([20_000]);
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it("logs each retry and the final give-up", async () => {
		const { sleep } = fakeSleep();
		const logger = { warn: vi.fn(), error: vi.fn() };
		const operation = vi.fn().mockRejectedValue(rateLimitError(1));

		await expect(
			withLinearRateLimitRetry(operation, {
				sleep,
				random: () => 0,
				maxAttempts: 2,
				operationName: "Linear agentActivity",
				logger: logger as never,
			}),
		).rejects.toThrow("Rate limit exceeded");

		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn.mock.calls[0][0]).toContain("Linear agentActivity");
		expect(logger.error).toHaveBeenCalledTimes(1);
		expect(logger.error.mock.calls[0][0]).toContain("out of retries");
	});
});

describe("describeGraphQLOperation", () => {
	it("names the operation for the log line", () => {
		expect(
			describeGraphQLOperation(
				"query agentActivity($id: String!) { agentActivity(id: $id) { id } }",
			),
		).toBe("Linear agentActivity");
		expect(
			describeGraphQLOperation("mutation agentActivityCreate { ok }"),
		).toBe("Linear agentActivityCreate");
	});

	it("falls back rather than logging an unnamed document body", () => {
		expect(describeGraphQLOperation("{ viewer { id } }")).toBe(
			"Linear request",
		);
	});
});
