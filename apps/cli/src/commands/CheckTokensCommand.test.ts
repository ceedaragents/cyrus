import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkLinearToken,
	TOKEN_CHECK_TIMEOUT_MS,
} from "./CheckTokensCommand.js";

describe("checkLinearToken", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.useRealTimers();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("returns valid when Linear responds without errors", async () => {
		globalThis.fetch = vi.fn(async () => ({
			json: async () => ({ data: { viewer: { id: "u1" } } }),
		})) as unknown as typeof fetch;

		const result = await checkLinearToken("lin_oauth_good");
		expect(result).toEqual({ status: "valid" });
	});

	it("returns invalid when Linear rejects the token", async () => {
		globalThis.fetch = vi.fn(async () => ({
			json: async () => ({
				errors: [{ message: "Authentication required, not authenticated" }],
			}),
		})) as unknown as typeof fetch;

		const result = await checkLinearToken("lin_oauth_bad");
		expect(result).toEqual({
			status: "invalid",
			error: "Authentication required, not authenticated",
		});
	});

	it("returns unknown (not invalid) on a network-level failure", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;

		const result = await checkLinearToken("lin_oauth_whatever");
		// A network failure must NOT be reported as an invalid/dead token —
		// that false signal is what made the uptime monitor cry wolf.
		expect(result.status).toBe("unknown");
		expect(result).not.toHaveProperty("status", "invalid");
	});

	it("returns unknown on timeout instead of hanging forever", async () => {
		// Simulate an endpoint that never responds: fetch rejects with an
		// AbortError once the AbortController fires. This asserts the command
		// resolves (does not hang) and classifies the timeout as unknown.
		globalThis.fetch = vi.fn((_url: unknown, init: unknown) => {
			const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
			return new Promise((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					const err = new Error("The operation was aborted");
					err.name = "AbortError";
					reject(err);
				});
			});
		}) as unknown as typeof fetch;

		vi.useFakeTimers();
		const promise = checkLinearToken("lin_oauth_slow");
		// Advance past the internal timeout so the AbortController fires.
		await vi.advanceTimersByTimeAsync(TOKEN_CHECK_TIMEOUT_MS + 1);
		const result = await promise;

		expect(result.status).toBe("unknown");
		if (result.status === "unknown") {
			expect(result.error).toContain("Timed out");
		}
	});
});
