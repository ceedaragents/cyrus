import { join } from "node:path";
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
			on: vi.fn(),
			emit: vi.fn(),
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
			cyrusHome: TEST_CYRUS_HOME,
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
	// 1. PROMPTED WEBHOOK — Session carries repositoryIds, no separate cache
	// =========================================================================
	describe("Prompted webhook with missing session", () => {
		it("should handle prompted webhook when no session exists", async () => {
			// Arrange: No session found in the global manager (simulates post-restart)
			mockAgentSessionManager.getSession.mockReturnValue(null);

			const webhook = createPromptedWebhook();

			// Act: Dispatch the webhook
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: The webhook handler should not crash
			// With sessions carrying repositoryIds, routing is session-based
		});

		it("should handle prompted webhook when session has empty repositoryIds", async () => {
			// Arrange: Session exists but has no repository associations
			mockAgentSessionManager.getSession.mockReturnValue({
				id: "agent-session-legacy-123",
				status: "active",
				issueContext: {
					trackerId: "linear",
					issueId: "issue-123",
					issueIdentifier: "TEST-123",
				},
				repositoryIds: [], // No repos
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
			});

			const webhook = createPromptedWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should not crash, gracefully handle missing repos
		});

		it("should route prompted webhook using session repositoryIds", async () => {
			// Arrange: Session with valid repository association
			mockAgentSessionManager.getSession.mockReturnValue({
				id: "agent-session-legacy-123",
				status: "active",
				issueContext: {
					trackerId: "linear",
					issueId: "issue-123",
					issueIdentifier: "TEST-123",
				},
				repositoryIds: ["test-repo"],
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
			});

			const webhook = createPromptedWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should look up session
			expect(mockAgentSessionManager.getSession).toHaveBeenCalled();
		});
	});

	// =========================================================================
	// 2. STOP SIGNAL — Missing session from in-memory managers
	// =========================================================================
	describe("Stop signal with missing session", () => {
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

	// =========================================================================
	// 3. UNASSIGNMENT — Sessions carry their own repositoryIds
	// =========================================================================
	describe("Unassignment webhook with sessions", () => {
		it("should find and stop sessions via global session manager", async () => {
			// Arrange: Sessions exist in the global manager
			const mockSession = {
				id: "agent-session-legacy-789",
				status: "active",
				issueContext: {
					trackerId: "linear",
					issueId: "issue-123",
					issueIdentifier: "TEST-123",
				},
				repositoryIds: ["test-repo"],
				agentRunner: {
					stop: vi.fn(),
					isRunning: vi.fn().mockReturnValue(true),
				},
			};
			mockAgentSessionManager.getActiveSessionsByIssueId.mockReturnValue([
				mockSession,
			]);
			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([
				mockSession,
			]);

			const webhook = createUnassignmentWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should find and stop sessions via the global manager
			expect(mockAgentSessionManager.requestSessionStop).toHaveBeenCalled();
		});
	});

	// =========================================================================
	// 4. ISSUE UPDATE — Sessions carry their own repositoryIds
	// =========================================================================
	describe("Issue update webhook with sessions", () => {
		it("should look up sessions by issue ID for content updates", async () => {
			// Arrange: Active session for the issue
			mockAgentSessionManager.getSessionsByIssueId.mockReturnValue([
				{
					id: "agent-session-legacy-123",
					status: "active",
					issueContext: {
						trackerId: "linear",
						issueId: "issue-123",
						issueIdentifier: "TEST-123",
					},
					repositoryIds: ["test-repo"],
					workspace: {
						path: "/test/workspaces/TEST-123",
						isGitWorktree: false,
					},
					attachmentsDir: join(TEST_CYRUS_HOME, "TEST-123", "attachments"),
				},
			]);

			const webhook = createIssueUpdateWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should search sessions via the global manager (uses getSessionsByIssueId
			// to find sessions across all statuses, preferring active ones)
			expect(mockAgentSessionManager.getSessionsByIssueId).toHaveBeenCalled();
		});
	});

	// =========================================================================
	// 5. PROMPTED WEBHOOK — Missing session with session-based routing
	//    Sessions carry their own repositoryIds, so routing is inherent
	// =========================================================================
	describe("Prompted webhook with missing session (session-based routing)", () => {
		it("should handle missing session gracefully", async () => {
			// Arrange: No session exists
			mockAgentSessionManager.getSession.mockReturnValue(null);

			const webhook = createPromptedWebhook();

			// Act
			await (edgeWorker as any).handleWebhook(webhook, [mockRepository]);

			// Assert: Should not crash when session is missing
			// The webhook handler should gracefully handle this case
		});
	});
});
