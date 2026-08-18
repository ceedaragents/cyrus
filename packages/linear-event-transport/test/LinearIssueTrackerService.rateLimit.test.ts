import type { LinearClient } from "@linear/sdk";
import { LinearErrorType } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinearIssueTrackerService } from "../src/LinearIssueTrackerService.js";

function rateLimitError(retryAfter?: number): Error {
	const error = new Error(
		"Rate limit exceeded. Only 5000 requests are allowed per 1 hour.",
	) as Error & { type: string; retryAfter?: number; status: number };
	error.type = LinearErrorType.Ratelimited;
	error.status = 429;
	if (retryAfter !== undefined) error.retryAfter = retryAfter;
	return error;
}

function unauthorizedError(): Error {
	const error = new Error("Unauthorized") as Error & { status: number };
	error.status = 401;
	return error;
}

/**
 * Minimal stand-in for the SDK's GraphQL client: just the `request`/`setHeader`
 * surface that LinearIssueTrackerService patches.
 */
function fakeLinearClient(request: ReturnType<typeof vi.fn>) {
	const setHeader = vi.fn();
	const client = { request, setHeader };
	return {
		linearClient: { client } as unknown as LinearClient,
		client,
		setHeader,
	};
}

const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

describe("LinearIssueTrackerService rate-limit handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	/** Runs `promise` to completion, letting the backoff timers fire instantly. */
	async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
		const settled = promise.then(
			(value) => ({ ok: true as const, value }),
			(error) => ({ ok: false as const, error }),
		);
		await vi.runAllTimersAsync();
		const result = await settled;
		if (!result.ok) throw result.error;
		return result.value;
	}

	it("retries a rate-limited request even with no OAuth config", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError(1))
			.mockResolvedValue({ ok: true });
		const { linearClient, client } = fakeLinearClient(request);

		new LinearIssueTrackerService(linearClient, undefined, logger as never);

		const result = await runWithTimers(
			client.request("query agentActivity { id }"),
		);

		expect(result).toEqual({ ok: true });
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("eventually rethrows the rate-limit error so callers still see a failure", async () => {
		const error = rateLimitError(1);
		const request = vi.fn().mockRejectedValue(error);
		const { linearClient, client } = fakeLinearClient(request);

		new LinearIssueTrackerService(linearClient, undefined, logger as never);

		await expect(
			runWithTimers(client.request("query agentActivity { id }")),
		).rejects.toBe(error);
		expect(request).toHaveBeenCalledTimes(4);
	});

	it("does not retry non-rate-limit errors", async () => {
		const error = new Error("boom");
		const request = vi.fn().mockRejectedValue(error);
		const { linearClient, client } = fakeLinearClient(request);

		new LinearIssueTrackerService(linearClient, undefined, logger as never);

		await expect(
			runWithTimers(client.request("query agentActivity { id }")),
		).rejects.toBe(error);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("still refreshes the token on 401 when OAuth config is supplied", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(unauthorizedError())
			.mockResolvedValue({ ok: true });
		const { linearClient, client, setHeader } = fakeLinearClient(request);

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "lin_oauth_new",
				refresh_token: "refresh_new",
				expires_in: 3600,
			}),
		} as unknown as Response);

		new LinearIssueTrackerService(
			linearClient,
			{
				clientId: "client-id",
				clientSecret: "client-secret",
				refreshToken: "refresh-old",
				workspaceId: `workspace-${Math.random()}`,
			},
			logger as never,
		);

		const result = await runWithTimers(
			client.request("query agentActivity { id }"),
		);

		expect(result).toEqual({ ok: true });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(setHeader).toHaveBeenCalledWith(
			"Authorization",
			"Bearer lin_oauth_new",
		);
		expect(request).toHaveBeenCalledTimes(2);

		fetchSpy.mockRestore();
	});

	it("does not attempt a token refresh for a rate-limit error", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError(1))
			.mockResolvedValue({ ok: true });
		const { linearClient, client } = fakeLinearClient(request);
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		new LinearIssueTrackerService(
			linearClient,
			{
				clientId: "client-id",
				clientSecret: "client-secret",
				refreshToken: "refresh-old",
				workspaceId: `workspace-${Math.random()}`,
			},
			logger as never,
		);

		await runWithTimers(client.request("query agentActivity { id }"));

		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
