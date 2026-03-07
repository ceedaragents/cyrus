import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	LinearIssueTrackerService,
	type LinearOAuthConfig,
} from "../src/LinearIssueTrackerService.js";

/**
 * Tests for the OAuth token refresh mechanism in LinearIssueTrackerService.
 *
 * The service patches LinearClient's underlying GraphQL client.request() to
 * intercept 401 errors and automatically refresh the OAuth token before retrying.
 */
describe("LinearIssueTrackerService token refresh", () => {
	let mockRequest: ReturnType<typeof vi.fn>;
	let mockSetHeader: ReturnType<typeof vi.fn>;
	let mockLinearClient: any;
	let oauthConfig: LinearOAuthConfig;

	function make401Error() {
		const err: any = new Error("Authentication required");
		err.response = { status: 401 };
		return err;
	}

	function make500Error() {
		const err: any = new Error("Internal server error");
		err.response = { status: 500 };
		return err;
	}

	beforeEach(() => {
		vi.clearAllMocks();

		mockRequest = vi.fn();
		mockSetHeader = vi.fn();

		mockLinearClient = {
			client: {
				request: mockRequest,
				setHeader: mockSetHeader,
			},
			issue: vi.fn(),
		};

		oauthConfig = {
			clientId: "test-client-id",
			clientSecret: "test-client-secret",
			refreshToken: "test-refresh-token",
			workspaceId: "workspace-123",
			onTokenRefresh: vi.fn(),
		};

		// Mock global fetch for token refresh calls
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					access_token: "new_access_token",
					refresh_token: "new_refresh_token",
				}),
		});
	});

	it("should pass through successful requests without refresh", async () => {
		mockRequest.mockResolvedValueOnce({ data: "ok" });

		new LinearIssueTrackerService(mockLinearClient, oauthConfig);

		const result = await mockLinearClient.client.request(
			"query { viewer { id } }",
		);
		expect(result).toEqual({ data: "ok" });
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("should refresh token on 401 and retry", async () => {
		mockRequest
			.mockRejectedValueOnce(make401Error()) // original request fails
			.mockResolvedValueOnce({ data: "ok" }); // retry succeeds

		new LinearIssueTrackerService(mockLinearClient, oauthConfig);

		const result = await mockLinearClient.client.request(
			"query { viewer { id } }",
		);
		expect(result).toEqual({ data: "ok" });
		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(mockSetHeader).toHaveBeenCalledWith(
			"Authorization",
			"Bearer new_access_token",
		);
	});

	it("should not retry non-401 errors", async () => {
		mockRequest.mockRejectedValueOnce(make500Error());

		new LinearIssueTrackerService(mockLinearClient, oauthConfig);

		await expect(
			mockLinearClient.client.request("query { viewer { id } }"),
		).rejects.toThrow("Internal server error");
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("should coalesce concurrent 401 refresh attempts", async () => {
		mockRequest
			.mockRejectedValueOnce(make401Error())
			.mockRejectedValueOnce(make401Error())
			.mockResolvedValueOnce({ data: "a" })
			.mockResolvedValueOnce({ data: "b" });

		new LinearIssueTrackerService(mockLinearClient, oauthConfig);

		const [resultA, resultB] = await Promise.all([
			mockLinearClient.client.request("query A"),
			mockLinearClient.client.request("query B"),
		]);

		expect(resultA).toEqual({ data: "a" });
		expect(resultB).toEqual({ data: "b" });
		// Only one refresh call despite two concurrent 401s
		expect(global.fetch).toHaveBeenCalledTimes(1);
	});

	it("should refresh again after previous refresh token expires", async () => {
		// This test covers the bug where refreshPromise was never cleared after
		// success, causing subsequent token expirations (e.g. 24h later) to reuse
		// the stale resolved promise instead of triggering a fresh refresh.

		// First request: 401 → refresh → retry succeeds
		mockRequest
			.mockRejectedValueOnce(make401Error())
			.mockResolvedValueOnce({ data: "first" });

		new LinearIssueTrackerService(mockLinearClient, oauthConfig);

		const result1 = await mockLinearClient.client.request("query first");
		expect(result1).toEqual({ data: "first" });
		expect(global.fetch).toHaveBeenCalledTimes(1);

		// Simulate token expiring again (e.g. 24h later)
		// Return a NEW access token from the second refresh
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					access_token: "second_new_access_token",
					refresh_token: "second_new_refresh_token",
				}),
		});

		// Second request: 401 → should trigger a FRESH refresh, not reuse stale promise
		mockRequest
			.mockRejectedValueOnce(make401Error())
			.mockResolvedValueOnce({ data: "second" });

		const result2 = await mockLinearClient.client.request("query second");
		expect(result2).toEqual({ data: "second" });

		// A second refresh call should have been made
		expect(global.fetch).toHaveBeenCalledTimes(2);
		// The new token should be set
		expect(mockSetHeader).toHaveBeenLastCalledWith(
			"Authorization",
			"Bearer second_new_access_token",
		);
	});

	it("should retry fresh refresh after a failed refresh attempt", async () => {
		// First request: 401 → refresh fails
		mockRequest.mockRejectedValueOnce(make401Error());
		(global.fetch as any)
			.mockReset()
			.mockResolvedValueOnce({ ok: false, status: 400 });

		new LinearIssueTrackerService(mockLinearClient, oauthConfig);

		await expect(
			mockLinearClient.client.request("query first"),
		).rejects.toThrow("Authentication required");

		// Second request: 401 → should attempt a fresh refresh (not reuse failed promise)
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					access_token: "recovered_token",
					refresh_token: "recovered_refresh",
				}),
		});
		mockRequest
			.mockRejectedValueOnce(make401Error())
			.mockResolvedValueOnce({ data: "recovered" });

		const result = await mockLinearClient.client.request("query second");
		expect(result).toEqual({ data: "recovered" });
		expect(mockSetHeader).toHaveBeenLastCalledWith(
			"Authorization",
			"Bearer recovered_token",
		);
	});

	it("should not patch client when oauthConfig is not provided", () => {
		const originalRequest = mockLinearClient.client.request;

		new LinearIssueTrackerService(mockLinearClient);

		// request should not have been replaced
		expect(mockLinearClient.client.request).toBe(originalRequest);
	});
});
