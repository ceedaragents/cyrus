import { LinearClient } from "@linear/sdk";
import { ClaudeRunner } from "cyrus-claude-runner";
import { LinearEventTransport } from "cyrus-linear-event-transport";
import { createCyrusToolsServer } from "cyrus-mcp-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { TEST_CYRUS_HOME } from "./test-dirs.js";

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
 * Tests for CYPACK-954: Issue update webhooks triggering multiple runs
 *
 * When an issue title/description is updated, handleIssueContentUpdate()
 * loops through ALL sessions for that issue and resumes each non-running one.
 * If multiple sessions exist (from multiple @ mentions, delegations, etc.),
 * this triggers multiple concurrent runs — which is NOT the desired behavior.
 *
 * The expected behavior is that only ONE session (the most recent active one)
 * should be resumed per issue update.
 */
describe("EdgeWorker - Issue Update Multiple Sessions Bug (CYPACK-954)", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockAgentSessionManager: any;
	let handlePromptSpy: ReturnType<typeof vi.spyOn>;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: ["Read", "Edit"],
		labelPrompts: {},
		teamKeys: ["TEST"],
	};

	// Helper: Create mock sessions for the same issue
	function createMockSession(
		id: string,
		opts: {
			isRunning?: boolean;
			supportsStreaming?: boolean;
			hasRunner?: boolean;
		} = {},
	) {
		const {
			isRunning = false,
			supportsStreaming = true,
			hasRunner = false,
		} = opts;

		return {
			id,
			status: "active",
			issueContext: {
				trackerId: "linear",
				issueId: "issue-123",
				issueIdentifier: "TEST-123",
			},
			workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
			claudeSessionId: `claude-session-for-${id}`,
			agentRunner: hasRunner
				? {
						isRunning: vi.fn().mockReturnValue(isRunning),
						supportsStreamingInput: supportsStreaming,
						addStreamMessage: vi.fn(),
						stop: vi.fn(),
					}
				: null,
			updatedAt: Date.now(),
		};
	}

	// Helper: Create an issue update webhook payload
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

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});

		vi.mocked(createCyrusToolsServer).mockImplementation(() => {
			return { server: {} } as any;
		});

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

		mockAgentSessionManager = {
			hasAgentRunner: vi.fn().mockReturnValue(false),
			getSession: vi.fn().mockReturnValue(null),
			getSessionsByIssueId: vi.fn().mockReturnValue([]),
			getActiveSessionsByIssueId: vi.fn().mockReturnValue([]),
			createLinearAgentSession: vi.fn(),
			createResponseActivity: vi.fn().mockResolvedValue(undefined),
			postAnalyzingThought: vi.fn().mockResolvedValue(undefined),
			requestSessionStop: vi.fn(),
			setActivitySink: vi.fn(),
			addAgentRunner: vi.fn(),
			on: vi.fn(),
		};

		vi.mocked(AgentSessionManager).mockImplementation(
			() => mockAgentSessionManager,
		);

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
			cyrusHome: TEST_CYRUS_HOME,
			repositories: [mockRepository],
			linearWorkspaces: {
				"test-workspace": { linearToken: "test-token" },
			},
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

		// Set up the agent session manager
		(edgeWorker as any).agentSessionManager = mockAgentSessionManager;

		// Mock issue tracker
		const mockIssueTracker = {
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
		(edgeWorker as any).issueTrackers.set("test-workspace", mockIssueTracker);

		// Spy on handlePromptWithStreamingCheck to count resume calls
		handlePromptSpy = vi
			.spyOn(edgeWorker as any, "handlePromptWithStreamingCheck")
			.mockResolvedValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// BUG REPRODUCTION: Multiple sessions get resumed from a single issue update
	// =========================================================================

	describe("Issue update with multiple sessions for same issue", () => {
		it("should only resume ONE session when multiple non-running sessions exist for the same issue", async () => {
			// Arrange: Two sessions for the same issue, both NOT running
			const session1 = createMockSession("session-1");
			const session2 = createMockSession("session-2");

			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([
				session1,
				session2,
			]);

			// Cache the repository for the issue
			const cache = (
				edgeWorker as any
			).repositoryRouter.getIssueRepositoryCache();
			cache.set("issue-123", ["test-repo"]);

			const webhook = createIssueUpdateWebhook();

			// Act: Process the issue update webhook
			await (edgeWorker as any).handleIssueContentUpdate(webhook);

			// Assert: Only ONE session should be resumed, not both
			// BUG: Currently handlePromptWithStreamingCheck is called for EACH
			// non-running session, causing multiple runs
			expect(handlePromptSpy).toHaveBeenCalledTimes(1);
		});

		it("should not resume sessions that are already running (streaming case)", async () => {
			// Arrange: One running session (with streaming), one idle session
			const runningSession = createMockSession("session-running", {
				hasRunner: true,
				isRunning: true,
				supportsStreaming: true,
			});
			const idleSession = createMockSession("session-idle");

			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([
				runningSession,
				idleSession,
			]);

			const cache = (
				edgeWorker as any
			).repositoryRouter.getIssueRepositoryCache();
			cache.set("issue-123", ["test-repo"]);

			const webhook = createIssueUpdateWebhook();

			// Act
			await (edgeWorker as any).handleIssueContentUpdate(webhook);

			// Assert: The running session should get a stream message,
			// and the idle session should NOT be separately resumed.
			// BUG: Currently the idle session ALSO gets resumed via
			// handlePromptWithStreamingCheck, creating a second concurrent run.
			expect(runningSession.agentRunner!.addStreamMessage).toHaveBeenCalled();
			expect(handlePromptSpy).toHaveBeenCalledTimes(0);
		});

		it("should not resume sessions that have no runner and no claude session ID (completed/stale sessions)", async () => {
			// Arrange: Two sessions - one active with a claude session ID, one stale/completed
			const activeSession = createMockSession("session-active");
			const staleSession = {
				...createMockSession("session-stale"),
				claudeSessionId: undefined, // No runner session ID = completed/stale
				status: "complete",
			};

			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([
				activeSession,
				staleSession,
			]);

			const cache = (
				edgeWorker as any
			).repositoryRouter.getIssueRepositoryCache();
			cache.set("issue-123", ["test-repo"]);

			const webhook = createIssueUpdateWebhook();

			// Act
			await (edgeWorker as any).handleIssueContentUpdate(webhook);

			// Assert: Only the active session should be resumed
			// BUG: Currently both sessions get handlePromptWithStreamingCheck called
			expect(handlePromptSpy).toHaveBeenCalledTimes(1);
			expect(handlePromptSpy).toHaveBeenCalledWith(
				activeSession,
				expect.anything(),
				"session-active",
				expect.anything(),
				expect.anything(),
				expect.anything(),
				false,
				expect.anything(),
				"issue content update",
				undefined,
				undefined,
			);
		});

		it("should resume only the most recently updated session when multiple idle sessions exist", async () => {
			// Arrange: Three sessions for the same issue, all idle, with different timestamps
			const oldSession = {
				...createMockSession("session-old"),
				updatedAt: Date.now() - 60000, // 1 minute ago
			};
			const midSession = {
				...createMockSession("session-mid"),
				updatedAt: Date.now() - 30000, // 30 seconds ago
			};
			const recentSession = {
				...createMockSession("session-recent"),
				updatedAt: Date.now(), // most recent
			};

			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([
				oldSession,
				midSession,
				recentSession,
			]);

			const cache = (
				edgeWorker as any
			).repositoryRouter.getIssueRepositoryCache();
			cache.set("issue-123", ["test-repo"]);

			const webhook = createIssueUpdateWebhook();

			// Act
			await (edgeWorker as any).handleIssueContentUpdate(webhook);

			// Assert: Only ONE session (the most recent) should be resumed
			// BUG: Currently ALL three sessions get resumed
			expect(handlePromptSpy).toHaveBeenCalledTimes(1);
			expect(handlePromptSpy).toHaveBeenCalledWith(
				recentSession,
				expect.anything(),
				"session-recent",
				expect.anything(),
				expect.anything(),
				expect.anything(),
				false,
				expect.anything(),
				"issue content update",
				undefined,
				undefined,
			);
		});
	});

	// =========================================================================
	// SINGLE SESSION: Sanity check that single-session case still works
	// =========================================================================

	describe("Issue update with single session", () => {
		it("should resume the single idle session normally", async () => {
			// Arrange: One session for the issue, not running
			const session = createMockSession("session-only");

			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([session]);

			const cache = (
				edgeWorker as any
			).repositoryRouter.getIssueRepositoryCache();
			cache.set("issue-123", ["test-repo"]);

			const webhook = createIssueUpdateWebhook();

			// Act
			await (edgeWorker as any).handleIssueContentUpdate(webhook);

			// Assert: The single session should be resumed exactly once
			expect(handlePromptSpy).toHaveBeenCalledTimes(1);
		});
	});
});
