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
});
