import type { Issue as LinearIssue } from "@linear/sdk";
import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	LinearIssueAssignedWebhook,
} from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MockProxy, mockDeep } from "vitest-mock-extended";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

describe("EdgeWorker - Repository Routing", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		// Mock configuration with multiple repositories including project-based routing
		mockConfig = {
			proxyUrl: "https://test-proxy.com",
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [
				{
					id: "ceedar",
					name: "Ceedar",
					repositoryPath: "/repos/ceedar",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "linear-token-1",
					linearWorkspaceId: "workspace-1",
					linearWorkspaceName: "Ceedar Agents",
					teamKeys: ["CEE"],
					isActive: true,
				},
				{
					id: "bookkeeping",
					name: "Bookkeeping",
					repositoryPath: "/repos/bookkeeping",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "linear-token-2",
					linearWorkspaceId: "workspace-2",
					linearWorkspaceName: "Bookkeeping Team",
					teamKeys: ["BK"],
					isActive: true,
				},
				{
					id: "mobile",
					name: "Mobile App",
					repositoryPath: "/repos/mobile",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "linear-token-1",
					linearWorkspaceId: "workspace-1",
					linearWorkspaceName: "Ceedar Agents",
					projectKeys: ["Mobile App", "iOS App"],
					isActive: true,
				},
				{
					id: "web",
					name: "Web Platform",
					repositoryPath: "/repos/web",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "linear-token-1",
					linearWorkspaceId: "workspace-1",
					linearWorkspaceName: "Ceedar Agents",
					projectKeys: ["Web Platform", "Frontend"],
					isActive: true,
				},
			],
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	describe("AgentSession webhook routing", () => {
		it("should route AgentSessionCreated webhook to correct repository based on team key", async () => {
			const ceeWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
				mockDeep<LinearAgentSessionCreatedWebhook>();
			ceeWebhook.type = "AgentSessionEvent";
			ceeWebhook.action = "created";
			ceeWebhook.organizationId = "workspace-1";
			ceeWebhook.agentSession.id = "session-123";
			ceeWebhook.agentSession.issue.id = "issue-123";
			ceeWebhook.agentSession.issue.identifier = "CEE-42";
			ceeWebhook.agentSession.issue.title = "Test Issue";
			ceeWebhook.agentSession.issue.team.key = "CEE";

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				ceeWebhook,
				mockConfig.repositories,
			);

			// Verify the correct repository was returned
			expect(result).toBeTruthy();
			expect(result?.id).toBe("ceedar");
		});

		it("should route AgentSessionPrompted webhook to correct repository based on team key", async () => {
			const bkWebhook: MockProxy<LinearAgentSessionPromptedWebhook> =
				mockDeep<LinearAgentSessionPromptedWebhook>();
			bkWebhook.type = "AgentSessionEvent";
			bkWebhook.action = "prompted";
			bkWebhook.organizationId = "workspace-2";
			bkWebhook.agentSession.id = "session-456";
			bkWebhook.agentSession.issue.id = "issue-456";
			bkWebhook.agentSession.issue.identifier = "BK-123";
			bkWebhook.agentSession.issue.title = "Bookkeeping Issue";
			bkWebhook.agentSession.issue.team.key = "BK";

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				bkWebhook,
				mockConfig.repositories,
			);

			// Verify the correct repository was returned
			expect(result).toBeTruthy();
			expect(result?.id).toBe("bookkeeping");
		});

		it("should fallback to issue identifier parsing when team key is not available", async () => {
			const webhookWithoutTeamKey: MockProxy<LinearAgentSessionCreatedWebhook> =
				mockDeep<LinearAgentSessionCreatedWebhook>();
			webhookWithoutTeamKey.type = "AgentSessionEvent";
			webhookWithoutTeamKey.action = "created";
			webhookWithoutTeamKey.organizationId = "workspace-1";
			webhookWithoutTeamKey.agentSession.id = "session-789";
			webhookWithoutTeamKey.agentSession.issue.id = "issue-789";
			webhookWithoutTeamKey.agentSession.issue.identifier = "CEE-999";
			webhookWithoutTeamKey.agentSession.issue.title =
				"Test Issue Without Team";
			// Note: no team key provided - should use identifier parsing

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				webhookWithoutTeamKey,
				mockConfig.repositories,
			);

			// Verify the correct repository was returned based on identifier parsing
			expect(result).toBeTruthy();
			expect(result?.id).toBe("ceedar");
		});

		it("should return null when no matching repository is found", async () => {
			const unmatchedWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
				mockDeep<LinearAgentSessionCreatedWebhook>();
			unmatchedWebhook.type = "AgentSessionEvent";
			unmatchedWebhook.action = "created";
			unmatchedWebhook.organizationId = "workspace-unknown";
			unmatchedWebhook.agentSession.id = "session-unknown";
			unmatchedWebhook.agentSession.issue.id = "issue-unknown";
			unmatchedWebhook.agentSession.issue.identifier = "UNKNOWN-123";
			unmatchedWebhook.agentSession.issue.title = "Unknown Issue";
			unmatchedWebhook.agentSession.issue.team.key = "UNKNOWN";

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				unmatchedWebhook,
				mockConfig.repositories,
			);

			// Should return null for unmatched webhooks
			expect(result).toBeNull();
		});

		it("should route AgentSession webhook to correct repository based on project name", async () => {
			// Mock fetchFullIssueDetails to return project information
			const mockFetchFullIssueDetails = vi.spyOn(
				edgeWorker,
				"fetchFullIssueDetails",
			);
			const mockIssue: MockProxy<LinearIssue> = mockDeep<LinearIssue>();
			mockIssue.id = "issue-mobile-123";
			Object.defineProperty(mockIssue, "project", {
				get: () => Promise.resolve({ name: "Mobile App" }),
				configurable: true,
			});
			mockFetchFullIssueDetails.mockResolvedValue(mockIssue);

			const agentSessionWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
				mockDeep<LinearAgentSessionCreatedWebhook>();
			agentSessionWebhook.type = "AgentSessionEvent";
			agentSessionWebhook.action = "created";
			agentSessionWebhook.organizationId = "workspace-1";
			agentSessionWebhook.agentSession.id = "session-123";
			agentSessionWebhook.agentSession.issue.id = "issue-mobile-123";
			agentSessionWebhook.agentSession.issue.identifier = "PROJ-42";
			agentSessionWebhook.agentSession.issue.title = "Mobile Issue";
			agentSessionWebhook.agentSession.issue.team.key = "PROJ"; // Doesn't match any repo, should fallback to project routing

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				agentSessionWebhook,
				mockConfig.repositories,
			);

			// Verify the correct repository was returned based on project name
			expect(result).toBeTruthy();
			expect(result?.id).toBe("mobile");
			expect(mockFetchFullIssueDetails).toHaveBeenCalledWith(
				"issue-mobile-123",
				"mobile",
			);
		});

		it("should route AgentSession webhook to web repository based on project name", async () => {
			// Mock fetchFullIssueDetails to return different project information
			const mockFetchFullIssueDetails = vi.spyOn(
				edgeWorker,
				"fetchFullIssueDetails",
			);
			const mockIssue: MockProxy<LinearIssue> = mockDeep<LinearIssue>();
			mockIssue.id = "issue-web-456";
			Object.defineProperty(mockIssue, "project", {
				get: () => Promise.resolve({ name: "Web Platform" }),
				configurable: true,
			});
			mockFetchFullIssueDetails.mockResolvedValue(mockIssue);

			const agentSessionWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
				mockDeep<LinearAgentSessionCreatedWebhook>();
			agentSessionWebhook.type = "AgentSessionEvent";
			agentSessionWebhook.action = "created";
			agentSessionWebhook.organizationId = "workspace-1";
			agentSessionWebhook.agentSession.id = "session-456";
			agentSessionWebhook.agentSession.issue.id = "issue-web-456";
			agentSessionWebhook.agentSession.issue.identifier = "PROJ-456";
			agentSessionWebhook.agentSession.issue.title = "Web Platform Issue";
			agentSessionWebhook.agentSession.issue.team.key = "PROJ"; // Doesn't match any repo, should fallback to project routing

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				agentSessionWebhook,
				mockConfig.repositories,
			);

			// Verify the correct repository was returned based on project name
			expect(result).toBeTruthy();
			expect(result?.id).toBe("web");
			expect(mockFetchFullIssueDetails).toHaveBeenCalledWith(
				"issue-web-456",
				"web",
			);
		});

		it("should prefer project-based routing over team-based routing for AgentSession webhooks", async () => {
			// Setup mock that would return project info, and project routing should win
			const mockFetchFullIssueDetails = vi.spyOn(
				edgeWorker,
				"fetchFullIssueDetails",
			);
			const mockIssue: MockProxy<LinearIssue> = mockDeep<LinearIssue>();
			mockIssue.id = "issue-hybrid-789";
			Object.defineProperty(mockIssue, "project", {
				get: () => Promise.resolve({ name: "Web Platform" }),
				configurable: true,
			});
			mockFetchFullIssueDetails.mockResolvedValue(mockIssue);

			const agentSessionWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
				mockDeep<LinearAgentSessionCreatedWebhook>();
			agentSessionWebhook.type = "AgentSessionEvent";
			agentSessionWebhook.action = "created";
			agentSessionWebhook.organizationId = "workspace-1";
			agentSessionWebhook.agentSession.id = "session-789";
			agentSessionWebhook.agentSession.issue.id = "issue-hybrid-789";
			agentSessionWebhook.agentSession.issue.identifier = "CEE-789";
			agentSessionWebhook.agentSession.issue.title = "Hybrid Issue";
			agentSessionWebhook.agentSession.issue.team.key = "CEE"; // Would match ceedar repo via team routing, but project routing should win

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				agentSessionWebhook,
				mockConfig.repositories,
			);

			// Verify project-based routing won over team-based routing
			expect(result).toBeTruthy();
			expect(result?.id).toBe("web");
			// fetchFullIssueDetails should have been called for project routing
			expect(mockFetchFullIssueDetails).toHaveBeenCalledWith(
				"issue-hybrid-789",
				"web",
			);
		});

		it("should handle project routing failures gracefully for AgentSession webhooks", async () => {
			// Mock fetchFullIssueDetails to throw an error
			const mockFetchFullIssueDetails = vi.spyOn(
				edgeWorker,
				"fetchFullIssueDetails",
			);
			mockFetchFullIssueDetails.mockRejectedValue(new Error("API Error"));

			const agentSessionWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
				mockDeep<LinearAgentSessionCreatedWebhook>();
			agentSessionWebhook.type = "AgentSessionEvent";
			agentSessionWebhook.action = "created";
			agentSessionWebhook.organizationId = "workspace-1";
			agentSessionWebhook.agentSession.id = "session-error";
			agentSessionWebhook.agentSession.issue.id = "issue-error-123";
			agentSessionWebhook.agentSession.issue.identifier = "PROJ-123";
			agentSessionWebhook.agentSession.issue.title = "Error Issue";
			agentSessionWebhook.agentSession.issue.team.key = "PROJ"; // No team key match, will try project routing but fail

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				agentSessionWebhook,
				mockConfig.repositories,
			);

			// Should fall back to workspace-based routing
			expect(result).toBeTruthy();
			expect(result?.linearWorkspaceId).toBe("workspace-1");
			expect(mockFetchFullIssueDetails).toHaveBeenCalledWith(
				"issue-error-123",
				"mobile",
			);
		});
	});

	describe("Traditional webhook routing", () => {
		it("should route traditional webhooks based on team key", async () => {
			const traditionalWebhook: MockProxy<LinearIssueAssignedWebhook> =
				mockDeep<LinearIssueAssignedWebhook>();
			Object.assign(traditionalWebhook, {
				type: "AppUserNotification",
				action: "issueAssignedToYou",
				organizationId: "workspace-1",
				notification: {
					issue: {
						id: "issue-traditional",
						identifier: "CEE-888",
						title: "Traditional Issue",
						team: {
							id: "team-1",
							key: "CEE",
							name: "Ceedar Team",
						},
					},
				},
			});

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				traditionalWebhook,
				mockConfig.repositories,
			);

			// Verify the correct repository was returned
			expect(result).toBeTruthy();
			expect(result?.id).toBe("ceedar");
		});

		it("should fallback to workspace matching when no team keys match", async () => {
			const configWithCatchAll = {
				...mockConfig,
				repositories: [
					...mockConfig.repositories,
					{
						id: "catch-all",
						name: "Catch All",
						repositoryPath: "/repos/catch-all",
						baseBranch: "main",
						workspaceBaseDir: "/tmp/workspaces",
						linearToken: "linear-token-3",
						linearWorkspaceId: "workspace-1",
						linearWorkspaceName: "Catch All Workspace",
						// No teamKeys defined
						isActive: true,
					},
				],
			};

			const webhookWithoutMatchingTeam: MockProxy<LinearIssueAssignedWebhook> =
				mockDeep<LinearIssueAssignedWebhook>();
			Object.assign(webhookWithoutMatchingTeam, {
				type: "AppUserNotification",
				action: "issueAssignedToYou",
				organizationId: "workspace-1",
				notification: {
					issue: {
						id: "issue-nomatch",
						identifier: "NOMATCH-123",
						title: "No Matching Team",
						team: {
							id: "team-nomatch",
							key: "NOMATCH",
							name: "No Match Team",
						},
					},
				},
			});

			// Call the public method directly to test routing logic
			const result = await edgeWorker.findRepositoryForWebhook(
				webhookWithoutMatchingTeam,
				configWithCatchAll.repositories,
			);

			// Should route to catch-all repository that has no teamKeys
			expect(result).toBeTruthy();
			expect(result?.id).toBe("catch-all");
		});
	});
});
