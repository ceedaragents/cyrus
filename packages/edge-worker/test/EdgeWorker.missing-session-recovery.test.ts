import { LinearClient } from "@linear/sdk";
import { ClaudeRunner } from "cyrus-claude-runner";
import { LinearEventTransport } from "cyrus-linear-event-transport";
import { createCyrusToolsServer } from "cyrus-mcp-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { createTestCyrusHome } from "./testCyrusHome.js";

// Mock all dependencies
vi.mock("fs/promises");
vi.mock("cyrus-claude-runner");
vi.mock("cyrus-mcp-tools");
vi.mock("cyrus-codex-runner");
vi.mock("cyrus-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});

/**
 * Tests for CYPACK-852: Recover from missing session/repository mapping
 *
 * These tests verify that the EdgeWorker properly recovers when:
 * 1. A prompted webhook arrives but no issue->repository cache mapping exists
 * 2. A stop signal targets a session missing from in-memory managers
 * 3. An unassignment webhook arrives but no cached repository exists
 * 4. An issue update webhook arrives but no cached repository exists
 *
 * Currently, all these scenarios cause silent early returns, leaving the
 * Linear surface appearing stuck/hung with no user feedback.
 */
const testCyrusHome = createTestCyrusHome();

describe("EdgeWorker - Missing Session/Repository Recovery (CYPACK-852)", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockAgentSessionManager: any;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearToken: "test-token",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: ["Read", "Edit"],
		labelPrompts: {},
		teamKeys: ["TEST"],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});

		// Mock createCyrusToolsServer
		vi.mocked(createCyrusToolsServer).mockImplementation(() => {
			return { server: {} } as any;
		});

		// Mock ClaudeRunner
		vi.mocked(ClaudeRunner).mockImplementation(
			() =>
				({
					supportsStreamingInput: true,
					startStreaming: vi
						.fn()
						.mockResolvedValue({ sessionId: "claude-session-123" }),
					stop: vi.fn(),
					isStreaming: vi.fn().mockReturnValue(false),
					isRunning: vi.fn().mockReturnValue(false),
				}) as any,
		);

		// Mock AgentSessionManager with methods for recovery testing
		mockAgentSessionManager = {
			hasAgentRunner: vi.fn().mockReturnValue(false),
			getSession: vi.fn().mockReturnValue(null), // No session found (simulates missing session)
			getSessionsByIssueId: vi.fn().mockReturnValue([]),
			getActiveSessionsByIssueId: vi.fn().mockReturnValue([]),
			createLinearAgentSession: vi.fn().mockReturnValue({
				id: "recovered-session",
				status: "active",
				issueContext: {
					trackerId: "linear",
					issueId: "issue-123",
					issueIdentifier: "TEST-123",
				},
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
			}),
			createResponseActivity: vi.fn().mockResolvedValue(undefined),
			postAnalyzingThought: vi.fn().mockResolvedValue(undefined),
			requestSessionStop: vi.fn(),
			restoreState: vi.fn(),
			on: vi.fn(),
		};

		vi.mocked(AgentSessionManager).mockImplementation(
			() => mockAgentSessionManager,
		);

		// Mock SharedApplicationServer
		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					start: vi.fn().mockResolvedValue(undefined),
					stop: vi.fn().mockResolvedValue(undefined),
					getFastifyInstance: vi.fn().mockReturnValue({ post: vi.fn() }),
					getWebhookUrl: vi
						.fn()
						.mockReturnValue("http://localhost:3456/webhook"),
					registerOAuthCallbackHandler: vi.fn(),
				}) as any,
		);

		vi.mocked(LinearEventTransport).mockImplementation(
			() =>
				({
					register: vi.fn(),
					on: vi.fn(),
					removeAllListeners: vi.fn(),
				}) as any,
		);

		vi.mocked(LinearClient).mockImplementation(
			() =>
				({
					users: {
						me: vi.fn().mockResolvedValue({
							id: "user-123",
							name: "Test User",
						}),
					},
				}) as any,
		);

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: testCyrusHome,
			repositories: [mockRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Set up repositories map
		(edgeWorker as any).repositories.set("test-repo", mockRepository);

		// Set up agent session managers (but WITHOUT cached repository mappings)
		(edgeWorker as any).agentSessionManagers.set(
			"test-repo",
			mockAgentSessionManager,
		);

		// Mock issue tracker
		const mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue(undefined),
			fetchIssue: vi.fn().mockResolvedValue({
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				branchName: "test-123",
				team: { id: "test-workspace", key: "TEST", name: "Test Team" },
			}),
			fetchComment: vi.fn().mockResolvedValue(null),
		};
		(edgeWorker as any).issueTrackers.set("test-repo", mockIssueTracker);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Helper: Create a prompted webhook payload
	// =========================================================================
	function createPromptedWebhook(overrides: any = {}) {
		return {
			type: "AgentSessionEvent",
			action: "prompted",
			createdAt: new Date().toISOString(),
			organizationId: "test-workspace",
			agentSession: {
				id: "agent-session-legacy-123",
				issue: {
					id: "issue-123",
					identifier: "TEST-123",
					title: "Test Issue",
				},
				creator: {
					name: "Test User",
				},
				comment: {
					body: "Please continue working on this",
				},
				...overrides.agentSession,
			},
			agentActivity: {
				content: {
					body: "Please continue working on this",
				},
				sourceCommentId: "comment-123",
				...overrides.agentActivity,
			},
			...overrides,
		};
	}

	// =========================================================================
	// Helper: Create a stop signal webhook payload
	// =========================================================================
	function createStopSignalWebhook(overrides: any = {}) {
		return {
			type: "AgentSessionEvent",
			action: "prompted",
			createdAt: new Date().toISOString(),
			organizationId: "test-workspace",
			agentSession: {
				id: "agent-session-legacy-456",
				issue: {
					id: "issue-123",
					identifier: "TEST-123",
					title: "Test Issue",
				},
				creator: {
					name: "Test User",
				},
				...overrides.agentSession,
			},
			agentActivity: {
				signal: "stop",
				content: {
					body: "stop",
				},
				...overrides.agentActivity,
			},
			...overrides,
		};
	}

	// =========================================================================
	// Helper: Create an unassignment webhook payload
	// =========================================================================
	function createUnassignmentWebhook(overrides: any = {}) {
		return {
			type: "AppUserNotification",
			action: "issueUnassignedFromYou",
			createdAt: new Date().toISOString(),
			organizationId: "test-workspace",
			notification: {
				type: "issueUnassignedFromYou",
				id: "notification-789",
				issue: {
					id: "issue-123",
					identifier: "TEST-123",
					title: "Test Issue",
					teamId: "test-workspace",
					team: { id: "test-workspace", key: "TEST", name: "Test Team" },
				},
				actor: {
					id: "actor-789",
					name: "Test Unassigner",
				},
				...overrides.notification,
			},
			...overrides,
		};
	}

	// =========================================================================
	// Helper: Create an issue update webhook payload
	// =========================================================================
	function createIssueUpdateWebhook(overrides: any = {}) {
		return {
			type: "Issue",
			action: "update",
			createdAt: new Date().toISOString(),
			organizationId: "test-workspace",
			data: {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Updated Title",
				description: "Updated description",
				...overrides.data,
			},
			updatedFrom: {
				title: "Old Title",
				...overrides.updatedFrom,
			},
			...overrides,
		};
	}

	// =========================================================================
	// 1. PROMPTED WEBHOOK — Missing repository cache mapping
	// =========================================================================
	describe("Prompted webhook with missing repository cache", () => {
		it("should attempt fallback repository resolution instead of returning silently", async () => {
			// Arrange: Ensure the issue-to-repository cache is EMPTY
			// (simulates post-restart/migration scenario)
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			const cache = repositoryRouter.getIssueRepositoryCache();
			cache.clear(); // No cached mappings

			const webhook = createPromptedWebhook();

			// Spy on the router's fallback resolution
			const determineRepoSpy = vi.spyOn(
				repositoryRouter,
				"determineRepositoryForWebhook",
			);

			// Act: Dispatch the webhook
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Fallback resolution should have been attempted
			// Currently FAILS because the code returns early at line 3406
			expect(determineRepoSpy).toHaveBeenCalled();
		});

		it("should re-establish the repository cache mapping after fallback resolution", async () => {
			// Arrange: Empty cache
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			const cache = repositoryRouter.getIssueRepositoryCache();
			cache.clear();

			// Mock the fallback to return a valid repository
			vi.spyOn(
				repositoryRouter,
				"determineRepositoryForWebhook",
			).mockResolvedValue({
				type: "selected",
				repository: mockRepository,
				routingMethod: "team-based",
			});

			const webhook = createPromptedWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Cache should now contain the mapping
			// Currently FAILS because fallback is never attempted
			expect(cache.get("issue-123")).toBe("test-repo");
		});

		it("should post a response activity when fallback resolution fails", async () => {
			// Arrange: Empty cache, and fallback returns no match
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			const cache = repositoryRouter.getIssueRepositoryCache();
			cache.clear();

			vi.spyOn(
				repositoryRouter,
				"determineRepositoryForWebhook",
			).mockResolvedValue({
				type: "none",
			});

			const webhook = createPromptedWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should NOT silently return — should post a visible response
			// Currently FAILS because the code returns early with just a log.warn
			// The user should see feedback that their prompt couldn't be processed
			expect(mockAgentSessionManager.createResponseActivity).toHaveBeenCalled();
		});

		it("should re-elicit repository selection when fallback routing is ambiguous", async () => {
			// Arrange: Empty cache and ambiguous fallback routing
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			repositoryRouter.getIssueRepositoryCache().clear();

			const secondRepository: RepositoryConfig = {
				...mockRepository,
				id: "test-repo-2",
				name: "Test Repo 2",
				repositoryPath: "/test/repo-2",
			};

			(edgeWorker as any).repositories.set(
				secondRepository.id,
				secondRepository,
			);

			const determineRepoSpy = vi
				.spyOn(repositoryRouter, "determineRepositoryForWebhook")
				.mockResolvedValue({
					type: "needs_selection",
					workspaceRepos: [mockRepository, secondRepository],
				});
			const elicitSpy = vi
				.spyOn(repositoryRouter, "elicitUserRepositorySelection")
				.mockResolvedValue(undefined);

			const webhook = createPromptedWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [
				mockRepository,
				secondRepository,
			]);

			// Assert: Should keep the session unresolved and ask the user to choose
			expect(determineRepoSpy).toHaveBeenCalled();
			expect(elicitSpy).toHaveBeenCalledWith(webhook, [
				mockRepository,
				secondRepository,
			]);
			expect(
				mockAgentSessionManager.createLinearAgentSession,
			).not.toHaveBeenCalled();
		});
	});

	// =========================================================================
	// 1.5. PROMPTED WEBHOOK — Invalid repository selection response
	// =========================================================================
	describe("Prompted webhook with invalid repository selection response", () => {
		it("should keep the selection pending and post visible feedback instead of silently choosing a repository", async () => {
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			(repositoryRouter as any).pendingSelections.set(
				"agent-session-legacy-123",
				{
					issueId: "issue-123",
					workspaceRepos: [mockRepository],
				},
			);

			const initializeAgentRunnerSpy = vi
				.spyOn(edgeWorker as any, "initializeAgentRunner")
				.mockResolvedValue(undefined);

			const webhook = createPromptedWebhook({
				agentActivity: {
					content: {
						body: "Unknown Repository",
					},
				},
			});

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Invalid responses should stay unresolved and provide feedback
			expect(
				repositoryRouter.hasPendingSelection("agent-session-legacy-123"),
			).toBe(true);
			expect(initializeAgentRunnerSpy).not.toHaveBeenCalled();
			expect(
				(edgeWorker as any).issueTrackers.get("test-repo").createAgentActivity,
			).toHaveBeenCalledWith(
				expect.objectContaining({
					agentSessionId: "agent-session-legacy-123",
					content: {
						type: "error",
						body: expect.stringContaining(
							"couldn't match your repository selection",
						),
					},
				}),
			);
		});

		it("should initialize the selected repository with user-selected association provenance", async () => {
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			(repositoryRouter as any).pendingSelections.set(
				"agent-session-legacy-123",
				{
					issueId: "issue-123",
					workspaceRepos: [mockRepository],
				},
			);

			const initializeAgentRunnerSpy = vi
				.spyOn(edgeWorker as any, "initializeAgentRunner")
				.mockResolvedValue(undefined);

			const webhook = createPromptedWebhook({
				agentActivity: {
					content: {
						body: "Please use repository: Test Repo",
					},
				},
			});

			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			expect(initializeAgentRunnerSpy).toHaveBeenCalledWith(
				expect.objectContaining({ id: "agent-session-legacy-123" }),
				mockRepository,
				undefined,
				"Please continue working on this",
				"user-selected",
			);
			expect(repositoryRouter.getIssueRepositoryCache().get("issue-123")).toBe(
				"test-repo",
			);
		});

		it("should accept natural-language wrapper phrases around a valid repository name", async () => {
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			const secondRepository: RepositoryConfig = {
				...mockRepository,
				id: "test-repo-2",
				name: "Backend Repository",
				repositoryPath: "/test/repo-2",
				githubUrl: "https://github.com/test-org/backend-repository",
			};

			const webhook = createPromptedWebhook();
			await repositoryRouter.elicitUserRepositorySelection(webhook, [
				mockRepository,
				secondRepository,
			]);

			const selectedRepository =
				await repositoryRouter.selectRepositoryFromResponse(
					"agent-session-legacy-123",
					"Please use Backend Repository for this issue.",
				);

			expect(selectedRepository).toBe(secondRepository);
			expect(
				repositoryRouter.hasPendingSelection("agent-session-legacy-123"),
			).toBe(false);
		});
	});

	// =========================================================================
	// 2. STOP SIGNAL — Missing session from in-memory managers
	// =========================================================================
	describe("Stop signal with missing session", () => {
		it("should route stop-signal recovery through the associated repository from the global registry", async () => {
			const secondRepository: RepositoryConfig = {
				...mockRepository,
				id: "test-repo-2",
				name: "Test Repo 2",
				repositoryPath: "/test/repo-2",
			};

			const secondManager = {
				...mockAgentSessionManager,
				createResponseActivity: vi.fn().mockResolvedValue(undefined),
				requestSessionStop: vi.fn(),
			};

			(edgeWorker as any).repositories.set(
				secondRepository.id,
				secondRepository,
			);
			(edgeWorker as any).agentSessionManagers.set(
				secondRepository.id,
				secondManager,
			);
			(edgeWorker as any).issueTrackers.set(secondRepository.id, {
				createAgentActivity: vi.fn().mockResolvedValue(undefined),
				fetchIssue: vi.fn().mockResolvedValue({
					id: "issue-123",
					identifier: "TEST-123",
					title: "Test Issue",
					description: "Test description",
					branchName: "test-123",
					team: {
						id: "test-workspace",
						key: "TEST",
						name: "Test Team",
					},
				}),
				fetchComment: vi.fn().mockResolvedValue(null),
			});

			(edgeWorker as any).globalSessionRegistry.createSession({
				id: "agent-session-legacy-456",
				externalSessionId: "agent-session-legacy-456",
				type: "comment-thread",
				status: "active",
				context: "comment-thread",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueContext: {
					trackerId: "linear",
					issueId: "issue-123",
					issueIdentifier: "TEST-123",
				},
				issueId: "issue-123",
				issue: {
					id: "issue-123",
					identifier: "TEST-123",
					title: "Test Issue",
					branchName: "test-123",
				},
				repositoryAssociations: [
					{
						repositoryId: secondRepository.id,
						associationOrigin: "restored",
						status: "selected",
					},
				],
				workspace: {
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				},
			});

			const webhook = createStopSignalWebhook();

			await (edgeWorker as any).handleWebhook(webhook, [
				mockRepository,
				secondRepository,
			]);

			expect(secondManager.createResponseActivity).toHaveBeenCalledWith(
				"agent-session-legacy-456",
				expect.stringContaining("I've stopped working on Test Issue"),
			);
			expect(
				mockAgentSessionManager.createResponseActivity,
			).not.toHaveBeenCalled();
		});

		it("should post a response activity instead of returning silently", async () => {
			// Arrange: No sessions exist in any manager (simulates post-restart)
			mockAgentSessionManager.getSession.mockReturnValue(null);

			const webhook = createStopSignalWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should post a response activity acknowledging the stop
			// Currently FAILS because handleStopSignal returns early at line 2999
			// with just log.warn("No session found for stop signal")
			expect(mockAgentSessionManager.createResponseActivity).toHaveBeenCalled();
		});

		it("should post a user-visible response when session cannot be found for stop signal", async () => {
			// Arrange: No sessions exist
			mockAgentSessionManager.getSession.mockReturnValue(null);

			const webhook = createStopSignalWebhook();

			// We need to verify that SOME activity is posted back to Linear
			// so the user doesn't see a hanging state.
			// Spy on any method that posts to Linear
			const postCommentSpy = vi
				.spyOn(edgeWorker as any, "postComment")
				.mockResolvedValue(undefined);

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Either createResponseActivity or postComment should be called
			// Currently FAILS — neither is called because of the silent early return
			const anyFeedbackPosted =
				mockAgentSessionManager.createResponseActivity.mock.calls.length > 0 ||
				postCommentSpy.mock.calls.length > 0;

			expect(anyFeedbackPosted).toBe(true);
		});
	});

	describe("Persisted runtime state restoration", () => {
		it("should serialize globally tracked zero-association sessions without requiring repository-owned managers", () => {
			(edgeWorker as any).globalSessionRegistry.createSession({
				id: "unassociated-session",
				externalSessionId: "unassociated-session",
				type: "comment-thread",
				status: "active",
				context: "comment-thread",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueContext: {
					trackerId: "linear",
					issueId: "issue-999",
					issueIdentifier: "TEST-999",
				},
				issueId: "issue-999",
				issue: {
					id: "issue-999",
					identifier: "TEST-999",
					title: "Unassociated Test Issue",
					branchName: "test-999",
				},
				repositoryAssociations: [],
				workspace: {
					path: "/test/workspaces/TEST-999",
					isGitWorktree: false,
				},
			});

			const state = (edgeWorker as any).serializeMappings();

			expect(state.agentSessionsById).toHaveProperty("unassociated-session");
			expect(
				state.agentSessionsById["unassociated-session"].repositoryAssociations,
			).toEqual([]);
		});

		it("should restore zero-association sessions into the global registry without repo buckets", () => {
			const state = {
				agentSessionsById: {
					"unassociated-session": {
						id: "unassociated-session",
						externalSessionId: "unassociated-session",
						type: "comment-thread",
						status: "active",
						context: "comment-thread",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						issueContext: {
							trackerId: "linear",
							issueId: "issue-999",
							issueIdentifier: "TEST-999",
						},
						issueId: "issue-999",
						issue: {
							id: "issue-999",
							identifier: "TEST-999",
							title: "Unassociated Test Issue",
							branchName: "test-999",
						},
						repositoryAssociations: [],
						workspace: {
							path: "/test/workspaces/TEST-999",
							isGitWorktree: false,
						},
					},
				},
				agentSessionEntriesById: {
					"unassociated-session": [
						{
							type: "user",
							content: "hello",
							metadata: { timestamp: Date.now() },
						},
					],
				},
				childToParentAgentSession: {},
				issueRepositoryAssociationsByIssueId: {},
			};

			(edgeWorker as any).restoreMappings(state);

			const restoredSession = (
				edgeWorker as any
			).globalSessionRegistry.getSession("unassociated-session");
			expect(restoredSession).toMatchObject({ id: "unassociated-session" });
			expect(restoredSession?.repositoryAssociations).toEqual([]);
			expect(
				(edgeWorker as any).globalSessionRegistry.getEntries(
					"unassociated-session",
				),
			).toHaveLength(1);
			expect(mockAgentSessionManager.restoreState).toHaveBeenCalledWith({}, {});
		});
	});

	// =========================================================================
	// 3. UNASSIGNMENT — Missing repository cache mapping
	// =========================================================================
	describe("Unassignment webhook with missing repository cache", () => {
		it("should attempt to find and stop sessions across all managers", async () => {
			// Arrange: Empty repository cache but sessions exist in manager
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			const cache = repositoryRouter.getIssueRepositoryCache();
			cache.clear();

			// Simulate an active session for the issue
			const mockSession = {
				id: "agent-session-legacy-789",
				status: "active",
				agentRunner: {
					stop: vi.fn(),
					isRunning: vi.fn().mockReturnValue(true),
				},
			};
			(edgeWorker as any).globalSessionRegistry.createSession({
				id: "agent-session-legacy-789",
				externalSessionId: "agent-session-legacy-789",
				type: "comment-thread",
				status: "active",
				context: "comment-thread",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueContext: {
					trackerId: "linear",
					issueId: "issue-123",
					issueIdentifier: "TEST-123",
				},
				issueId: "issue-123",
				issue: {
					id: "issue-123",
					identifier: "TEST-123",
					title: "Test Issue",
					branchName: "test-123",
				},
				repositoryAssociations: [
					{
						repositoryId: mockRepository.id,
						associationOrigin: "restored",
						status: "selected",
					},
				],
				workspace: {
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				},
			});
			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([
				mockSession,
			]);

			const webhook = createUnassignmentWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should still find and stop sessions even without cached repo
			// Currently FAILS — handleIssueUnassignedWebhook returns early at line 2146
			expect(mockAgentSessionManager.requestSessionStop).toHaveBeenCalled();
		});
	});

	// =========================================================================
	// 4. ISSUE UPDATE — Missing repository cache mapping
	// =========================================================================
	describe("Issue update webhook with missing repository cache", () => {
		it("should attempt fallback repository resolution for active sessions", async () => {
			// Arrange: Empty repository cache
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			const cache = repositoryRouter.getIssueRepositoryCache();
			cache.clear();

			const webhook = createIssueUpdateWebhook();
			(edgeWorker as any).globalSessionRegistry.createSession({
				id: "agent-session-issue-update",
				externalSessionId: "agent-session-issue-update",
				type: "comment-thread",
				status: "active",
				context: "comment-thread",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueContext: {
					trackerId: "linear",
					issueId: "issue-123",
					issueIdentifier: "TEST-123",
				},
				issueId: "issue-123",
				issue: {
					id: "issue-123",
					identifier: "TEST-123",
					title: "Test Issue",
					branchName: "test-123",
				},
				repositoryAssociations: [
					{
						repositoryId: mockRepository.id,
						associationOrigin: "restored",
						status: "selected",
					},
				],
				workspace: {
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				},
			});

			// Spy on the router
			const determineRepoSpy = vi.spyOn(
				repositoryRouter,
				"determineRepositoryForWebhook",
			);

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should attempt fallback resolution
			// The runtime should recover repository context from explicit associations
			// before deciding whether rerouting is necessary.
			const searchedManagers =
				mockAgentSessionManager.getSessionsByIssueId.mock.calls.length > 0 ||
				determineRepoSpy.mock.calls.length > 0;

			expect(searchedManagers).toBe(true);
		});
	});

	// =========================================================================
	// 5. PROMPTED WEBHOOK — Missing session but repository IS cached
	//    (This scenario is already handled in handleNormalPromptedActivity,
	//     but we verify the recovery path works end-to-end)
	// =========================================================================
	describe("Prompted webhook with cached repository but missing session", () => {
		it("should create a replacement session and continue processing", async () => {
			// Arrange: Repository IS cached, but session is NOT found
			const repositoryRouter = (edgeWorker as any).repositoryRouter;
			const cache = repositoryRouter.getIssueRepositoryCache();
			cache.set("issue-123", "test-repo");

			// Session not found initially
			mockAgentSessionManager.getSession.mockReturnValue(null);

			// Mock createLinearAgentSession on EdgeWorker (the full method)
			const createSessionSpy = vi
				.spyOn(edgeWorker as any, "createLinearAgentSession")
				.mockResolvedValue({
					session: {
						id: "agent-session-legacy-123",
						status: "active",
						workspace: {
							path: "/test/workspaces/TEST-123",
							isGitWorktree: false,
						},
						agentRunner: null,
					},
					fullIssue: {
						id: "issue-123",
						identifier: "TEST-123",
						title: "Test Issue",
					},
					workspace: {
						path: "/test/workspaces/TEST-123",
						isGitWorktree: false,
					},
					attachmentsDir: `${testCyrusHome}/TEST-123/attachments`,
				});

			// Also mock the handlePromptWithStreamingCheck to prevent further execution
			vi.spyOn(
				edgeWorker as any,
				"handlePromptWithStreamingCheck",
			).mockResolvedValue(undefined);

			// Mock postInstantPromptedAcknowledgment
			vi.spyOn(
				edgeWorker as any,
				"postInstantPromptedAcknowledgment",
			).mockResolvedValue(undefined);

			const webhook = createPromptedWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: A new session should be created as replacement
			// This scenario is already handled by the existing code in
			// handleNormalPromptedActivity, but this test verifies the full path
			expect(createSessionSpy).toHaveBeenCalledWith(
				"agent-session-legacy-123",
				expect.objectContaining({ id: "issue-123" }),
				mockRepository,
				mockAgentSessionManager,
			);
		});
	});
});
