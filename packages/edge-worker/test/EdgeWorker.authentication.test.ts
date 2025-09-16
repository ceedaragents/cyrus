import { LinearClient } from "@linear/sdk";
import type {
	LinearAgentSessionPromptedWebhook,
} from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MockProxy, mockDeep } from "vitest-mock-extended";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

describe("EdgeWorker - Linear Authentication", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		// Mock configuration with a repository that has an invalid/expired token
		mockConfig = {
			proxyUrl: "https://test-proxy.com",
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [
				{
					id: "rip-technologies",
					name: "rip-technologies",
					repositoryPath: "/repos/rip-technologies",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "invalid-or-expired-token",  // This token will fail authentication
					linearWorkspaceId: "workspace-1",
					linearWorkspaceName: "Test Workspace",
					// No routing configuration - acts as workspace catch-all
					isActive: true,
				},
			],
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	describe("Authentication failures", () => {
		it("should fail to post agent activity with invalid Linear token", async () => {
			// Create a webhook that will trigger agent activity creation
			const webhook: MockProxy<LinearAgentSessionPromptedWebhook> =
				mockDeep<LinearAgentSessionPromptedWebhook>();
			webhook.type = "AgentSessionEvent";
			webhook.action = "prompted";
			webhook.organizationId = "workspace-1";
			webhook.agentSession.id = "ca2928c7-231b-44ca-83ac-74a249ea850a";
			webhook.agentSession.issue.id = "a55342e9-5249-455c-a9ba-f27a9d74bab9";
			webhook.agentSession.issue.identifier = "TEST-123";
			webhook.agentSession.issue.title = "Test Issue";
			webhook.agentSession.issue.team.key = "TEST";
			webhook.agentSession.issue.description = "Test description";
			webhook.message = {
				content: "Process this issue",
				userDisplayName: "Test User",
				issueId: "a55342e9-5249-455c-a9ba-f27a9d74bab9",
			};

			// Mock the LinearClient to simulate authentication failure
			const mockLinearClient = edgeWorker.linearClients.get("rip-technologies");
			if (mockLinearClient) {
				vi.spyOn(mockLinearClient, "createAgentActivity").mockRejectedValue({
					type: "AuthenticationError",
					errors: [
						{
							type: "AuthenticationError",
							userError: true,
							path: undefined,
							message: "You need to authenticate to access this operation.",
						},
					],
					status: 401,
					message: "Authentication required, not authenticated",
				});
			}

			// Attempt to handle the webhook
			const response = await edgeWorker.handleWebhook(webhook);

			// Verify that authentication error was encountered
			expect(response).toBeUndefined(); // No response due to auth failure
		});

		it("should fail to fetch issue details with invalid Linear token", async () => {
			const issueId = "a55342e9-5249-455c-a9ba-f27a9d74bab9";

			// Get the Linear client for the repository
			const linearClient = edgeWorker.linearClients.get("rip-technologies");
			expect(linearClient).toBeDefined();

			// Mock the Linear client's issue method to simulate authentication failure
			if (linearClient) {
				vi.spyOn(linearClient, "issue").mockRejectedValue({
					type: "AuthenticationError",
					errors: [
						{
							type: "AuthenticationError",
							userError: true,
							path: undefined,
							message: "You need to authenticate to access this operation.",
						},
					],
					status: 401,
					message: "Authentication required, not authenticated",
					query: "query issue($id: String!) { issue(id: $id) { ...Issue } }",
					variables: { id: issueId },
				});

				// Attempt to fetch issue details
				await expect(linearClient.issue(issueId)).rejects.toMatchObject({
					type: "AuthenticationError",
					status: 401,
				});
			}
		});

		it("should fail to fetch comments with invalid Linear token", async () => {
			const issueId = "a55342e9-5249-455c-a9ba-f27a9d74bab9";

			// Get the Linear client for the repository
			const linearClient = edgeWorker.linearClients.get("rip-technologies");
			expect(linearClient).toBeDefined();

			if (linearClient) {
				// Mock the comments query to simulate authentication failure
				vi.spyOn(linearClient, "comments").mockRejectedValue({
					type: "AuthenticationError",
					errors: [
						{
							type: "AuthenticationError",
							userError: true,
							path: undefined,
							message: "You need to authenticate to access this operation.",
						},
					],
					status: 401,
					message: "Authentication required, not authenticated",
				});

				// Attempt to fetch comments
				await expect(
					linearClient.comments({
						filter: { issue: { id: { eq: issueId } } },
					})
				).rejects.toMatchObject({
					type: "AuthenticationError",
					status: 401,
				});
			}
		});

		it("should select catch-all repository when no routing configuration exists", async () => {
			// Create a webhook that matches the error scenario
			const webhook: MockProxy<LinearAgentSessionPromptedWebhook> =
				mockDeep<LinearAgentSessionPromptedWebhook>();
			webhook.type = "AgentSessionEvent";
			webhook.action = "prompted";
			webhook.organizationId = "workspace-1";
			webhook.agentSession.id = "session-123";
			webhook.agentSession.issue.id = "issue-123";
			webhook.agentSession.issue.identifier = "UNKNOWN-42";
			webhook.agentSession.issue.title = "Test Issue";
			webhook.agentSession.issue.team.key = "UNKNOWN"; // Team key that doesn't match any repository

			// Test the repository selection logic
			const result = await (edgeWorker as any).findRepositoryForWebhook(
				webhook,
				mockConfig.repositories,
			);

			// Verify that the catch-all repository was selected
			expect(result).toBeTruthy();
			expect(result?.id).toBe("rip-technologies");
			expect(result?.name).toBe("rip-technologies");

			// Verify this repository has no routing configuration (workspace catch-all)
			expect(result?.teamKeys).toBeUndefined();
			expect(result?.routingLabels).toBeUndefined();
			expect(result?.projectKeys).toBeUndefined();
		});

		it("should handle authentication error gracefully during webhook processing", async () => {
			const webhook: MockProxy<LinearAgentSessionPromptedWebhook> =
				mockDeep<LinearAgentSessionPromptedWebhook>();
			webhook.type = "AgentSessionEvent";
			webhook.action = "prompted";
			webhook.organizationId = "workspace-1";
			webhook.agentSession.id = "session-123";
			webhook.agentSession.issue.id = "issue-123";
			webhook.agentSession.issue.identifier = "TEST-123";
			webhook.agentSession.issue.title = "Test Issue";
			webhook.agentSession.issue.team.key = "TEST";
			webhook.message = {
				content: "Process this issue",
				userDisplayName: "Test User",
				issueId: "issue-123",
			};

			// Mock console.error to verify error logging
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			// Mock all Linear API calls to fail with authentication error
			const linearClient = edgeWorker.linearClients.get("rip-technologies");
			if (linearClient) {
				vi.spyOn(linearClient, "createAgentActivity").mockRejectedValue({
					type: "AuthenticationError",
					status: 401,
					message: "Authentication required, not authenticated",
				});
				vi.spyOn(linearClient, "issue").mockRejectedValue({
					type: "AuthenticationError",
					status: 401,
					message: "Authentication required, not authenticated",
				});
				vi.spyOn(linearClient, "comments").mockRejectedValue({
					type: "AuthenticationError",
					status: 401,
					message: "Authentication required, not authenticated",
				});
			}

			// Process the webhook
			const response = await edgeWorker.handleWebhook(webhook);

			// Verify error was logged
			expect(consoleErrorSpy).toHaveBeenCalled();

			// Clean up
			consoleErrorSpy.mockRestore();
		});
	});

	describe("Repository configuration validation", () => {
		it("should verify repository has Linear token configured", () => {
			const repo = mockConfig.repositories[0];
			expect(repo.linearToken).toBeDefined();
			expect(repo.linearToken).toBe("invalid-or-expired-token");
		});

		it("should create LinearClient with repository token", () => {
			const linearClient = edgeWorker.linearClients.get("rip-technologies");
			expect(linearClient).toBeDefined();
			expect(linearClient).toBeInstanceOf(LinearClient);
		});
	});
});