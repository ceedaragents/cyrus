import { AgentActivitySignal } from "@linear/sdk";
import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	LinearWebhook,
	RepositoryConfig,
} from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	RepositoryRouter,
	type RepositoryRouterDeps,
} from "../src/RepositoryRouter.js";

describe("RepositoryRouter", () => {
	let router: RepositoryRouter;
	let mockDeps: RepositoryRouterDeps;
	let mockLinearClient: any;

	const createMockRepository = (overrides: Partial<RepositoryConfig> = {}) => {
		return {
			id: overrides.id || "repo-1",
			name: overrides.name || "Test Repo",
			repositoryPath: "/path/to/repo",
			baseBranch: "main",
			linearWorkspaceId: overrides.linearWorkspaceId || "workspace-1",
			linearToken: "token",
			workspaceBaseDir: "/workspace",
			isActive: true,
			teamKeys: overrides.teamKeys,
			routingLabels: overrides.routingLabels,
			projectKeys: overrides.projectKeys,
			githubUrl: overrides.githubUrl,
			...overrides,
		} as RepositoryConfig;
	};

	const createMockWebhook = (
		type: "created" | "prompted" | "assigned",
		overrides: any = {},
	): LinearWebhook => {
		if (type === "created") {
			return {
				action: "AgentSession.created",
				organizationId: overrides.organizationId || "workspace-1",
				agentSession: {
					id: overrides.agentSessionId || "session-1",
					issue: {
						id: overrides.issueId || "issue-1",
						identifier: overrides.issueIdentifier || "TEST-1",
						team: {
							key: overrides.teamKey || "TEST",
						},
					},
					comment: overrides.comment || null,
				},
				guidance: overrides.guidance || [],
				...overrides,
			} as LinearAgentSessionCreatedWebhook;
		}

		if (type === "prompted") {
			return {
				action: "AgentSession.prompted",
				organizationId: overrides.organizationId || "workspace-1",
				agentSession: {
					id: overrides.agentSessionId || "session-1",
					issue: {
						id: overrides.issueId || "issue-1",
						identifier: overrides.issueIdentifier || "TEST-1",
						team: {
							key: overrides.teamKey || "TEST",
						},
					},
				},
				agentActivity: {
					content: {
						body: overrides.userMessage || "User message",
					},
				},
				...overrides,
			} as LinearAgentSessionPromptedWebhook;
		}

		// Default to assigned webhook
		return {
			action: "Issue.assigned",
			organizationId: overrides.organizationId || "workspace-1",
			notification: {
				issue: {
					id: overrides.issueId || "issue-1",
					identifier: overrides.issueIdentifier || "TEST-1",
					team: {
						key: overrides.teamKey || "TEST",
					},
				},
			},
			...overrides,
		} as LinearWebhook;
	};

	beforeEach(() => {
		mockLinearClient = {
			createAgentActivity: vi.fn().mockResolvedValue({}),
			issue: vi.fn().mockResolvedValue({
				id: "issue-1",
				identifier: "TEST-1",
				project: null,
			}),
		};

		mockDeps = {
			fetchIssueLabels: vi.fn().mockResolvedValue([]),
			hasActiveSession: vi.fn().mockReturnValue(false),
			getLinearClient: vi.fn().mockReturnValue(mockLinearClient),
		};

		router = new RepositoryRouter(mockDeps);
	});

	describe("getCachedRepository", () => {
		it("should return cached repository when available", () => {
			const repo = createMockRepository();
			const reposMap = new Map([[repo.id, repo]]);

			// Manually set cache
			router.getIssueRepositoryCache().set("issue-1", repo.id);

			const result = router.getCachedRepository("issue-1", reposMap);

			expect(result).toBe(repo);
		});

		it("should remove invalid cache entries and return null", () => {
			const repo = createMockRepository();
			const reposMap = new Map([[repo.id, repo]]);

			// Set cache to non-existent repository
			router.getIssueRepositoryCache().set("issue-1", "non-existent-repo");

			const result = router.getCachedRepository("issue-1", reposMap);

			expect(result).toBeNull();
			expect(router.getIssueRepositoryCache().has("issue-1")).toBe(false);
		});

		it("should return null when no cache entry exists", () => {
			const repo = createMockRepository();
			const reposMap = new Map([[repo.id, repo]]);

			const result = router.getCachedRepository("issue-1", reposMap);

			expect(result).toBeNull();
		});
	});

	describe("determineRepositoryForWebhook", () => {
		it("should return selected repository after successful routing", async () => {
			const repo = createMockRepository();

			const webhook = createMockWebhook("created", { issueId: "issue-1" });
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository).toBe(repo);
			}
		});

		it("should return needs_selection when multiple repos don't match", async () => {
			const repo1 = createMockRepository({
				id: "repo-1",
				name: "Repo 1",
				teamKeys: ["TEAM1"],
			});
			const repo2 = createMockRepository({
				id: "repo-2",
				name: "Repo 2",
				teamKeys: ["TEAM2"],
			});

			// Webhook with team that doesn't match either repo
			const webhook = createMockWebhook("created", {
				teamKey: "OTHER",
				issueIdentifier: "OTHER-1",
			});

			const result = await router.determineRepositoryForWebhook(webhook, [
				repo1,
				repo2,
			]);

			expect(result.type).toBe("needs_selection");
			if (result.type === "needs_selection") {
				expect(result.workspaceRepos).toHaveLength(2);
			}
		});

		it("should return none when no repositories configured", async () => {
			const webhook = createMockWebhook("created", {
				organizationId: "non-existent-workspace",
			});

			const result = await router.determineRepositoryForWebhook(webhook, []);

			expect(result.type).toBe("none");
		});
	});

	describe("determineRepositoryForWebhook - Priority 0: Active Sessions", () => {
		it("should return repository with active session (highest priority)", async () => {
			const repo = createMockRepository({ id: "repo-1", teamKeys: ["TEAM1"] });

			// Mock active session in repo
			mockDeps.hasActiveSession = vi
				.fn()
				.mockImplementation((_issueId, repoId) => repoId === "repo-1");

			const webhook = createMockWebhook("created", {
				issueId: "issue-1",
				teamKey: "TEAM1",
			});

			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe("repo-1");
			}
		});
	});

	describe("determineRepositoryForWebhook - Priority 1: Label Routing", () => {
		it("should route by label when routing labels configured", async () => {
			const repo = createMockRepository({
				id: "repo-1",
				routingLabels: ["frontend"],
			});

			mockDeps.fetchIssueLabels = vi.fn().mockResolvedValue(["frontend"]);

			const webhook = createMockWebhook("created", { issueId: "issue-1" });
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe("repo-1");
			}
		});

		it("should continue to next priority if label fetch fails", async () => {
			const repo = createMockRepository({
				routingLabels: ["backend"],
				teamKeys: ["TEST"],
			});

			mockDeps.fetchIssueLabels = vi
				.fn()
				.mockRejectedValue(new Error("Failed to fetch labels"));

			const webhook = createMockWebhook("created", { teamKey: "TEST" });
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe(repo.id);
			}
		});
	});

	describe("determineRepositoryForWebhook - Priority 2: Project Routing", () => {
		it("should route by project when project keys configured", async () => {
			const repo = createMockRepository({
				id: "repo-1",
				projectKeys: ["Project B"],
			});

			// Mock Linear client to return issue with Project B
			mockLinearClient.issue = vi.fn().mockResolvedValue({
				id: "issue-1",
				identifier: "TEST-1",
				project: {
					name: "Project B",
				},
			});

			const webhook = createMockWebhook("created", { issueId: "issue-1" });
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe("repo-1");
			}
		});
	});

	describe("determineRepositoryForWebhook - Priority 3: Team Routing", () => {
		it("should route by team key", async () => {
			const repo = createMockRepository({ id: "repo-1", teamKeys: ["TEAM2"] });

			const webhook = createMockWebhook("created", { teamKey: "TEAM2" });
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe("repo-1");
			}
		});

		it("should route by team prefix from issue identifier", async () => {
			const repo = createMockRepository({ teamKeys: ["ABC"] });

			const webhook = createMockWebhook("created", {
				teamKey: undefined,
				issueIdentifier: "ABC-123",
			});
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe(repo.id);
			}
		});
	});

	describe("determineRepositoryForWebhook - Priority 4: Catch-all", () => {
		it("should route to catch-all repository (no routing config)", async () => {
			const repo1 = createMockRepository({
				id: "repo-1",
				teamKeys: ["TEAM1"],
			});
			const repo2 = createMockRepository({
				id: "repo-2",
				teamKeys: undefined,
				routingLabels: undefined,
				projectKeys: undefined,
			});

			const webhook = createMockWebhook("created", {
				teamKey: "OTHER",
				issueIdentifier: "OTHER-1",
			});
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo1,
				repo2,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe("repo-2");
			}
		});
	});

	describe("determineRepositoryForWebhook - Needs Selection", () => {
		it("should return needs_selection when multiple repos exist with no match", async () => {
			const repo1 = createMockRepository({
				id: "repo-1",
				teamKeys: ["TEAM1"],
			});
			const repo2 = createMockRepository({
				id: "repo-2",
				teamKeys: ["TEAM2"],
			});

			const webhook = createMockWebhook("created", {
				teamKey: "OTHER",
				issueIdentifier: "OTHER-1",
			});
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo1,
				repo2,
			]);

			expect(result.type).toBe("needs_selection");
			if (result.type === "needs_selection") {
				expect(result.workspaceRepos).toHaveLength(2);
			}
		});

		it("should return none when no repositories match workspace", async () => {
			const repo = createMockRepository({ linearWorkspaceId: "workspace-1" });

			const webhook = createMockWebhook("created", {
				organizationId: "workspace-2",
			});
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("none");
		});

		it("should fallback to first repo when single repo exists", async () => {
			const repo = createMockRepository({ teamKeys: ["TEAM1"] });

			const webhook = createMockWebhook("created", {
				teamKey: "OTHER",
				issueIdentifier: "OTHER-1",
			});
			const result = await router.determineRepositoryForWebhook(webhook, [
				repo,
			]);

			expect(result.type).toBe("selected");
			if (result.type === "selected") {
				expect(result.repository.id).toBe(repo.id);
			}
		});
	});

	describe("elicitUserRepositorySelection", () => {
		it("should post elicitation activity with repository options", async () => {
			const repo1 = createMockRepository({
				id: "repo-1",
				name: "Repo 1",
				githubUrl: "https://github.com/org/repo1",
			});
			const repo2 = createMockRepository({
				id: "repo-2",
				name: "Repo 2",
				githubUrl: "https://github.com/org/repo2",
			});

			const webhook = createMockWebhook("created");

			await router.elicitUserRepositorySelection(webhook, [repo1, repo2]);

			expect(mockLinearClient.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: "session-1",
				content: {
					type: "elicitation",
					body: "Which repository should I work in for this issue?",
				},
				signal: AgentActivitySignal.Select,
				signalMetadata: {
					options: [
						{ value: "https://github.com/org/repo1" },
						{ value: "https://github.com/org/repo2" },
					],
				},
			});
		});

		it("should use repository name when githubUrl not available", async () => {
			const repo = createMockRepository({
				name: "Repo 1",
				githubUrl: undefined,
			});

			const webhook = createMockWebhook("created");

			await router.elicitUserRepositorySelection(webhook, [repo]);

			expect(mockLinearClient.createAgentActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					signalMetadata: {
						options: [{ value: "Repo 1" }],
					},
				}),
			);
		});

		it("should handle elicitation error by posting error activity", async () => {
			const repo = createMockRepository();
			const webhook = createMockWebhook("created");

			mockLinearClient.createAgentActivity = vi
				.fn()
				.mockRejectedValueOnce(new Error("API error"))
				.mockResolvedValueOnce({}); // Second call succeeds (error activity)

			await router.elicitUserRepositorySelection(webhook, [repo]);

			expect(mockLinearClient.createAgentActivity).toHaveBeenCalledTimes(2);
			expect(mockLinearClient.createAgentActivity).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					content: {
						type: "error",
						body: expect.stringContaining(
							"Failed to display repository selection",
						),
					},
				}),
			);
		});

		it("should handle both elicitation and error posting failures gracefully", async () => {
			const repo = createMockRepository();
			const webhook = createMockWebhook("created");

			mockLinearClient.createAgentActivity = vi
				.fn()
				.mockRejectedValue(new Error("API error"));

			// Should not throw
			await expect(
				router.elicitUserRepositorySelection(webhook, [repo]),
			).resolves.not.toThrow();
		});
	});

	describe("selectRepositoryFromResponse", () => {
		it("should find repository by GitHub URL", async () => {
			const repo1 = createMockRepository({
				id: "repo-1",
				name: "Repo 1",
				githubUrl: "https://github.com/org/repo1",
			});
			const repo2 = createMockRepository({
				id: "repo-2",
				name: "Repo 2",
				githubUrl: "https://github.com/org/repo2",
			});

			const webhook = createMockWebhook("created");
			const _reposMap = new Map([
				[repo1.id, repo1],
				[repo2.id, repo2],
			]);

			// Simulate pending selection
			await router.elicitUserRepositorySelection(webhook, [repo1, repo2]);

			const result = await router.selectRepositoryFromResponse(
				"session-1",
				"https://github.com/org/repo2",
			);

			expect(result).toBe(repo2);
			// Note: Caching is now handled by EdgeWorker.handleRepositorySelectionResponse
			// This method only returns the selected repository
		});

		it("should find repository by name when GitHub URL not used", async () => {
			const repo = createMockRepository({
				name: "Repo 1",
				githubUrl: undefined,
			});

			const webhook = createMockWebhook("created");
			const _reposMap = new Map([[repo.id, repo]]);

			await router.elicitUserRepositorySelection(webhook, [repo]);

			const result = await router.selectRepositoryFromResponse(
				"session-1",
				"Repo 1",
			);

			expect(result).toBe(repo);
		});

		it("should fallback to first repository when selection not found", async () => {
			const repo1 = createMockRepository({ id: "repo-1", name: "Repo 1" });
			const repo2 = createMockRepository({ id: "repo-2", name: "Repo 2" });

			const webhook = createMockWebhook("created");
			const _reposMap = new Map([
				[repo1.id, repo1],
				[repo2.id, repo2],
			]);

			await router.elicitUserRepositorySelection(webhook, [repo1, repo2]);

			const result = await router.selectRepositoryFromResponse(
				"session-1",
				"Non-existent Repo",
			);

			expect(result).toBe(repo1);
		});

		it("should return null when no pending selection exists", async () => {
			const _reposMap = new Map();

			const result = await router.selectRepositoryFromResponse(
				"non-existent-session",
				"Repo 1",
			);

			expect(result).toBeNull();
		});
	});

	describe("cache persistence", () => {
		it("should restore cache from serialization", () => {
			const cache = new Map<string, string>([
				["issue-1", "repo-1"],
				["issue-2", "repo-2"],
			]);

			router.restoreIssueRepositoryCache(cache);

			expect(router.getIssueRepositoryCache()).toEqual(cache);
		});

		it("should allow exporting cache for serialization", () => {
			const cache = router.getIssueRepositoryCache();
			cache.set("issue-1", "repo-1");
			cache.set("issue-2", "repo-2");

			const exported = router.getIssueRepositoryCache();

			expect(exported.size).toBe(2);
			expect(exported.get("issue-1")).toBe("repo-1");
			expect(exported.get("issue-2")).toBe("repo-2");
		});
	});

	describe("selection response handling", () => {
		it("should handle selection response via selectRepositoryFromResponse", async () => {
			const repo1 = createMockRepository({ id: "repo-1", name: "Repo 1" });
			const repo2 = createMockRepository({ id: "repo-2", name: "Repo 2" });

			// Setup pending selection
			const createdWebhook = createMockWebhook("created");
			await router.elicitUserRepositorySelection(createdWebhook, [
				repo1,
				repo2,
			]);

			// Verify pending selection exists
			const agentSessionId = createdWebhook.agentSession.id;
			expect(router.hasPendingSelection(agentSessionId)).toBe(true);

			// Simulate user selection response
			const result = await router.selectRepositoryFromResponse(
				agentSessionId,
				"Repo 2",
			);

			expect(result).toBe(repo2);
			expect(router.hasPendingSelection(agentSessionId)).toBe(false);
		});

		it("should return null for prompted webhook with pending selection (selection handled separately)", async () => {
			const repo1 = createMockRepository({
				id: "repo-1",
				name: "Repo 1",
				githubUrl: "https://github.com/org/repo1",
			});
			const repo2 = createMockRepository({
				id: "repo-2",
				name: "Repo 2",
				githubUrl: "https://github.com/org/repo2",
			});
			const repos = [repo1, repo2];
			const reposMap = new Map([
				[repo1.id, repo1],
				[repo2.id, repo2],
			]);

			// Setup pending selection
			const createdWebhook = createMockWebhook("created");
			await router.elicitUserRepositorySelection(createdWebhook, repos);

			// Verify pending selection exists
			const agentSessionId = createdWebhook.agentSession.id;
			expect(router.hasPendingSelection(agentSessionId)).toBe(true);

			// Simulate prompted webhook with user selection
			const promptedWebhook = createMockWebhook("prompted", {
				agentSessionId,
				userMessage: "https://github.com/org/repo2",
			});

			// getCachedRepository should NOT handle selection - it only returns cached repos
			// Since there's no cache yet, it should return null
			const issueId = promptedWebhook.agentSession.issue.id;
			const result = router.getCachedRepository(issueId, reposMap);

			// Should return null since no repository is cached yet
			expect(result).toBe(null);
			// Pending selection should still exist (not removed by getCachedRepository)
			expect(router.hasPendingSelection(agentSessionId)).toBe(true);

			// Now test the actual selection handling via selectRepositoryFromResponse
			const selectedRepo = await router.selectRepositoryFromResponse(
				agentSessionId,
				"https://github.com/org/repo2",
			);

			// Should return the selected repository
			expect(selectedRepo).toBe(repo2);
			// Should have removed the pending selection
			expect(router.hasPendingSelection(agentSessionId)).toBe(false);

			// Note: Caching is now handled by EdgeWorker.handleRepositorySelectionResponse
			// getCachedRepository should return null since caching hasn't happened in RepositoryRouter
			const cachedResult = router.getCachedRepository(issueId, reposMap);
			expect(cachedResult).toBe(null);
		});
	});
});
