import { LinearClient } from "@linear/sdk";
import type { EdgeWorkerConfig } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

// Mock modules
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn().mockImplementation(() => ({
		start: vi.fn(),
		registerLinearEventTransport: vi.fn(),
		registerConfigUpdater: vi.fn(),
		registerOAuthCallback: vi.fn(),
	})),
}));

// Mock fs/promises for file operations
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn().mockResolvedValue(
		JSON.stringify({
			repositories: [
				{
					id: "repo-1",
					linearWorkspaceId: "workspace-123",
					linearToken: "old_token",
					linearRefreshToken: "old_refresh_token",
				},
				{
					id: "repo-2",
					linearWorkspaceId: "workspace-123",
					linearToken: "old_token",
					linearRefreshToken: "old_refresh_token",
				},
			],
		}),
	),
	writeFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined),
	readdir: vi.fn().mockResolvedValue([]),
	rename: vi.fn().mockResolvedValue(undefined),
}));

// Mock global fetch
global.fetch = vi.fn();

describe("EdgeWorker LinearClient Wrapper", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockLinearClient: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Setup mock config
		mockConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo-1",
					repositoryPath: "/test/repo1",
					workspaceBaseDir: "/test/workspaces",
					baseBranch: "main",
					linearWorkspaceId: "workspace-123",
					linearWorkspaceName: "Test Workspace",
					linearToken: "test_token",
					linearRefreshToken: "refresh_token",
				},
			],
			cyrusHome: "/test/.cyrus",
			serverPort: 3456,
			serverHost: "localhost",
		};

		// Mock environment variables
		process.env.LINEAR_CLIENT_ID = "test_client_id";
		process.env.LINEAR_CLIENT_SECRET = "test_client_secret";

		// Create mock LinearClient with methods
		mockLinearClient = {
			issue: vi.fn(),
			viewer: Promise.resolve({
				organization: Promise.resolve({
					id: "workspace-123",
					name: "Test Workspace",
				}),
			}),
			createAgentActivity: vi.fn(),
		};

		// Mock LinearClient constructor
		vi.mocked(LinearClient).mockImplementation(() => mockLinearClient);
	});

	describe("Auto-retry on 401 errors", () => {
		it("should pass through successful API calls", async () => {
			mockLinearClient.issue.mockResolvedValueOnce({
				id: "issue-123",
				title: "Test Issue",
			});

			edgeWorker = new EdgeWorker(mockConfig);
			const issueTrackers = (edgeWorker as any).issueTrackers;
			const issueTracker = issueTrackers.get("repo-1");

			const result = await issueTracker?.fetchIssue("issue-123");

			expect(result).toBeDefined();
			expect(mockLinearClient.issue).toHaveBeenCalledTimes(1);
		});

		it("should pass through non-401 errors without retry", async () => {
			const error = new Error("Network error");
			(error as any).status = 500;
			mockLinearClient.issue.mockRejectedValueOnce(error);

			edgeWorker = new EdgeWorker(mockConfig);
			const issueTrackers = (edgeWorker as any).issueTrackers;
			const issueTracker = issueTrackers.get("repo-1");

			await expect(issueTracker?.fetchIssue("issue-123")).rejects.toThrow(
				"Network error",
			);

			// Should only be called once (no retry for non-401)
			expect(mockLinearClient.issue).toHaveBeenCalledTimes(1);
		});

		it("should not retry if token refresh fails", async () => {
			// Setup config without refresh token
			mockConfig.repositories[0].linearRefreshToken = undefined;
			edgeWorker = new EdgeWorker(mockConfig);
			edgeWorker.setConfigPath("/test/.cyrus/config.json");

			// Verify that refreshLinearToken fails without refresh token
			const result = await edgeWorker.refreshLinearToken("repo-1");
			expect(result.success).toBe(false);
		});

		it("should handle token refresh network errors gracefully", async () => {
			edgeWorker = new EdgeWorker(mockConfig);
			edgeWorker.setConfigPath("/test/.cyrus/config.json");

			// Mock token refresh network error
			vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

			// Call refreshLinearToken directly
			const result = await edgeWorker.refreshLinearToken("repo-1");

			expect(result.success).toBe(false);
			expect(fetch).toHaveBeenCalledWith(
				"https://api.linear.app/oauth/token",
				expect.objectContaining({
					method: "POST",
				}),
			);
		});
	});

	describe("Token refresh promise coalescing", () => {
		it("should coalesce concurrent token refresh requests into a single HTTP call", async () => {
			edgeWorker = new EdgeWorker(mockConfig);
			edgeWorker.setConfigPath("/test/.cyrus/config.json");

			// Mock successful token refresh with a delay to ensure concurrency
			vi.mocked(fetch).mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								ok: true,
								json: () =>
									Promise.resolve({
										access_token: "new_access_token",
										refresh_token: "new_refresh_token",
										expires_in: 86400,
									}),
							} as Response);
						}, 100); // 100ms delay to simulate network latency
					}),
			);

			// Fire 3 concurrent refresh requests for the same repository
			const promise1 = edgeWorker.refreshLinearToken("repo-1");
			const promise2 = edgeWorker.refreshLinearToken("repo-1");
			const promise3 = edgeWorker.refreshLinearToken("repo-1");

			// Wait for all to complete
			const [result1, result2, result3] = await Promise.all([
				promise1,
				promise2,
				promise3,
			]);

			// All should succeed
			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);
			expect(result3.success).toBe(true);

			// All should have the same new token
			expect(result1.newToken).toBe("new_access_token");
			expect(result2.newToken).toBe("new_access_token");
			expect(result3.newToken).toBe("new_access_token");

			// Only ONE HTTP request should have been made
			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("should coalesce requests from different repos with the same workspace", async () => {
			// Add a second repository with the same workspace ID
			mockConfig.repositories.push({
				id: "repo-2",
				name: "test-repo-2",
				repositoryPath: "/test/repo2",
				workspaceBaseDir: "/test/workspaces",
				baseBranch: "main",
				linearWorkspaceId: "workspace-123", // Same workspace
				linearWorkspaceName: "Test Workspace",
				linearToken: "test_token",
				linearRefreshToken: "refresh_token_2",
			});

			edgeWorker = new EdgeWorker(mockConfig);
			edgeWorker.setConfigPath("/test/.cyrus/config.json");

			// Mock successful token refresh with a delay
			vi.mocked(fetch).mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								ok: true,
								json: () =>
									Promise.resolve({
										access_token: "new_access_token",
										refresh_token: "new_refresh_token",
										expires_in: 86400,
									}),
							} as Response);
						}, 100);
					}),
			);

			// Fire concurrent refresh requests from different repos (same workspace)
			const promise1 = edgeWorker.refreshLinearToken("repo-1");
			const promise2 = edgeWorker.refreshLinearToken("repo-2");

			const [result1, result2] = await Promise.all([promise1, promise2]);

			// Both should succeed with the same token
			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);
			expect(result1.newToken).toBe("new_access_token");
			expect(result2.newToken).toBe("new_access_token");

			// Only ONE HTTP request should have been made
			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("should NOT coalesce requests from different workspaces", async () => {
			// Add a second repository with a DIFFERENT workspace ID
			mockConfig.repositories.push({
				id: "repo-2",
				name: "test-repo-2",
				repositoryPath: "/test/repo2",
				workspaceBaseDir: "/test/workspaces",
				baseBranch: "main",
				linearWorkspaceId: "workspace-456", // Different workspace
				linearWorkspaceName: "Other Workspace",
				linearToken: "test_token_2",
				linearRefreshToken: "refresh_token_2",
			});

			edgeWorker = new EdgeWorker(mockConfig);
			edgeWorker.setConfigPath("/test/.cyrus/config.json");

			// Mock successful token refresh
			vi.mocked(fetch).mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								ok: true,
								json: () =>
									Promise.resolve({
										access_token: "new_access_token",
										refresh_token: "new_refresh_token",
										expires_in: 86400,
									}),
							} as Response);
						}, 50);
					}),
			);

			// Fire concurrent refresh requests from different workspaces
			const promise1 = edgeWorker.refreshLinearToken("repo-1");
			const promise2 = edgeWorker.refreshLinearToken("repo-2");

			const [result1, result2] = await Promise.all([promise1, promise2]);

			// Both should succeed
			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);

			// TWO HTTP requests should have been made (one per workspace)
			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it("should allow a new refresh after the previous one completes", async () => {
			edgeWorker = new EdgeWorker(mockConfig);
			edgeWorker.setConfigPath("/test/.cyrus/config.json");

			let callCount = 0;
			vi.mocked(fetch).mockImplementation(() => {
				callCount++;
				const currentCall = callCount;
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							access_token: `new_access_token_${currentCall}`,
							refresh_token: `new_refresh_token_${currentCall}`,
							expires_in: 86400,
						}),
				} as Response);
			});

			// First refresh
			const result1 = await edgeWorker.refreshLinearToken("repo-1");
			expect(result1.success).toBe(true);
			expect(result1.newToken).toBe("new_access_token_1");

			// Second refresh (after first completes)
			const result2 = await edgeWorker.refreshLinearToken("repo-1");
			expect(result2.success).toBe(true);
			expect(result2.newToken).toBe("new_access_token_2");

			// Two separate HTTP requests (sequential, not coalesced)
			expect(fetch).toHaveBeenCalledTimes(2);
		});
	});
});
