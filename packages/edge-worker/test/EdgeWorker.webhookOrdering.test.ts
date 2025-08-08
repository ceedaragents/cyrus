import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
} from "cyrus-core/webhook-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

// Mock dependencies
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn(),
}));

const createMockNdjsonClient = () => {
	const eventHandlers: Record<string, any> = {};
	return {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		on: vi.fn((event: string, handler: any) => {
			eventHandlers[event] = handler;
			return undefined;
		}),
		emit: vi.fn(),
		_getHandler: (event: string) => eventHandlers[event],
	};
};

vi.mock("cyrus-ndjson-client", () => ({
	NdjsonClient: vi.fn(() => createMockNdjsonClient()),
}));

vi.mock("cyrus-claude-runner", () => ({
	ClaudeRunner: vi.fn(),
	getSafeTools: vi.fn().mockReturnValue([]),
}));

vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		issue: vi.fn(),
		team: vi.fn(),
		agentActivity: vi.fn(),
	})),
	LinearDocument: {
		AgentSessionType: {
			CommentThread: "commentThread",
		},
		AgentSessionStatus: {
			Active: "active",
			Complete: "complete",
		},
	},
}));

const createMockSharedApplicationServer = () => ({
	start: vi.fn().mockResolvedValue(undefined),
	stop: vi.fn().mockResolvedValue(undefined),
	getPublicUrl: vi.fn().mockReturnValue("http://localhost:3456"),
	registerOAuthCallbackHandler: vi.fn(),
});

vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn(() => createMockSharedApplicationServer()),
}));

vi.mock("cyrus-core", () => ({
	isAgentSessionCreatedWebhook: vi.fn(
		(webhook: any) => webhook.action === "created",
	),
	isAgentSessionPromptedWebhook: vi.fn(
		(webhook: any) => webhook.action === "prompted",
	),
	isIssueAssignedWebhook: vi.fn(() => false),
	isIssueCommentMentionWebhook: vi.fn(() => false),
	isIssueNewCommentWebhook: vi.fn(() => false),
	isIssueUnassignedWebhook: vi.fn(() => false),
	PersistenceManager: vi.fn().mockImplementation(() => ({
		loadPersistedState: vi.fn().mockResolvedValue(undefined),
		savePersistedState: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn(),
}));

describe("EdgeWorker - Webhook Ordering", () => {
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		// Clear all mocks
		vi.clearAllMocks();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Setup config
		mockConfig = {
			proxyUrl: "http://localhost:3000",
			webhookPort: 3456,
			repositories: [
				{
					id: "test-repo-id",
					name: "test-repo",
					repositoryPath: "/test/repo",
					workspaceBaseDir: "/test/workspaces",
					baseBranch: "main",
					linearToken: "linear-test-token",
					linearWorkspaceId: "test-workspace",
					isActive: true,
					allowedTools: ["Read", "Edit"],
					promptTemplatePath: "/test/template.md",
					anthropicApiKey: "test-anthropic-key",
					teamKeys: ["TEST"],
				},
			],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				}),
			},
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should queue AgentSessionPromptedWebhook that arrives before AgentSessionCreatedWebhook", async () => {
		// Create EdgeWorker instance for this test
		const edgeWorker = new EdgeWorker(mockConfig);

		// Mock methods that will be called during webhook processing
		const mockLinearClient = {
			issue: vi.fn().mockResolvedValue({
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				team: { id: "team-123", key: "TEST" },
				labels: vi.fn().mockResolvedValue({ nodes: [] }),
			}),
			team: vi.fn().mockResolvedValue({
				id: "team-123",
				states: vi.fn().mockResolvedValue({
					nodes: [
						{ id: "state-started", type: "started", name: "In Progress" },
						{ id: "state-unstarted", type: "unstarted", name: "Todo" },
					],
				}),
			}),
			agentActivity: vi.fn().mockResolvedValue({
				id: "activity-123",
				type: "thought",
				body: "Acknowledged. Starting work on this issue.",
			}),
		};

		// Replace the Linear client for our test repository
		(edgeWorker as any).linearClients.set("test-repo-id", mockLinearClient);

		// Mock private methods
		vi.spyOn(
			edgeWorker as any,
			"postInstantPromptedAcknowledgment",
		).mockResolvedValue(undefined);
		vi.spyOn(edgeWorker as any, "postInstantAcknowledgment").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "fetchFullIssueDetails").mockResolvedValue({
			id: "issue-123",
			identifier: "TEST-123",
			title: "Test Issue",
			description: "Test description",
		});
		vi.spyOn(edgeWorker as any, "moveIssueToStartedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "downloadIssueAttachments").mockResolvedValue({
			fileCount: 0,
			manifest: null,
		});
		vi.spyOn(edgeWorker as any, "savePersistedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "loadPersistedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "fetchIssueLabels").mockResolvedValue([]);
		vi.spyOn(
			edgeWorker as any,
			"determineSystemPromptFromLabels",
		).mockResolvedValue(null);

		// Start the edge worker
		await edgeWorker.start();

		// Create mock webhooks
		const sessionId = "705eff27-95e7-41c9-a1cf-0c8307b605d6";
		const issueId = "issue-123";

		// Create prompted webhook that would arrive first (out of order)
		const promptedWebhook: LinearAgentSessionPromptedWebhook = {
			webhookId: "webhook-prompted-1",
			type: "AgentSessionEvent",
			action: "prompted",
			webhookTimestamp: 1234567891,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-123",
					title: "Test Issue",
					url: "https://linear.app/test/issue/TEST-123",
					team: {
						id: "team-123",
						key: "TEST",
					},
				},
				comment: {
					id: "comment-123",
					body: "This thread is for an agent session",
				},
			},
			agentActivity: {
				id: "activity-prompted-1",
				type: "userMessage",
				sourceCommentId: "comment-user-1",
				content: {
					type: "userMessage",
					body: "Can you help with this?",
				},
			},
		};

		// Create created webhook that would arrive second
		const createdWebhook: LinearAgentSessionCreatedWebhook = {
			webhookId: "webhook-created-1",
			type: "AgentSessionEvent",
			action: "created",
			webhookTimestamp: 1234567890,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-123",
					title: "Test Issue",
					description: "Test description",
					url: "https://linear.app/test/issue/TEST-123",
					team: {
						id: "team-123",
						key: "TEST",
					},
					labels: [],
					priority: 3,
				},
				comment: {
					id: "comment-123",
					body: "This thread is for an agent session",
				},
				user: {
					id: "user-123",
					email: "test@example.com",
					name: "Test User",
				},
			},
		};

		// Spy on console.warn to check for the queueing message
		const consoleWarnSpy = vi.spyOn(console, "warn");

		// Simulate prompted webhook arriving first (out of order)
		await (edgeWorker as any).handleWebhook(promptedWebhook, [
			mockConfig.repositories[0],
		]);

		// Check that the warning was logged (not error, since we now queue)
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			`Session not found for agent activity session: ${sessionId}. Queuing webhook for retry.`,
		);

		// Now simulate the created webhook arriving late
		await (edgeWorker as any).handleWebhook(createdWebhook, [
			mockConfig.repositories[0],
		]);

		// Get the session manager for the repository
		const agentSessionManager = (edgeWorker as any).agentSessionManagers.get(
			"test-repo-id",
		);
		expect(agentSessionManager).toBeDefined();

		// Verify the session was created after the created webhook
		const session = agentSessionManager.getSession(sessionId);
		expect(session).toBeDefined();
		expect(session?.linearAgentActivitySessionId).toBe(sessionId);
		expect(session?.issueId).toBe(issueId);

		// Clean up
		await edgeWorker.stop();
	});

	it("should handle webhooks correctly when they arrive in the expected order", async () => {
		// Create EdgeWorker instance for this test
		const edgeWorker = new EdgeWorker(mockConfig);

		// Mock methods that will be called during webhook processing
		const mockLinearClient = {
			issue: vi.fn().mockResolvedValue({
				id: "issue-456",
				identifier: "TEST-456",
				title: "Test Issue 2",
				description: "Test description 2",
				team: { id: "team-123", key: "TEST" },
				labels: vi.fn().mockResolvedValue({ nodes: [] }),
			}),
			team: vi.fn().mockResolvedValue({
				id: "team-123",
				states: vi.fn().mockResolvedValue({
					nodes: [
						{ id: "state-started", type: "started", name: "In Progress" },
						{ id: "state-unstarted", type: "unstarted", name: "Todo" },
					],
				}),
			}),
			agentActivity: vi.fn().mockResolvedValue({
				id: "activity-123",
				type: "thought",
				body: "Acknowledged. Starting work on this issue.",
			}),
		};

		// Replace the Linear client for our test repository
		(edgeWorker as any).linearClients.set("test-repo-id", mockLinearClient);

		// Mock private methods
		vi.spyOn(
			edgeWorker as any,
			"postInstantPromptedAcknowledgment",
		).mockResolvedValue(undefined);
		vi.spyOn(edgeWorker as any, "postInstantAcknowledgment").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "fetchFullIssueDetails").mockResolvedValue({
			id: "issue-456",
			identifier: "TEST-456",
			title: "Test Issue 2",
			description: "Test description 2",
		});
		vi.spyOn(edgeWorker as any, "moveIssueToStartedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "downloadIssueAttachments").mockResolvedValue({
			fileCount: 0,
			manifest: null,
		});
		vi.spyOn(edgeWorker as any, "savePersistedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "loadPersistedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "fetchIssueLabels").mockResolvedValue([]);
		vi.spyOn(
			edgeWorker as any,
			"determineSystemPromptFromLabels",
		).mockResolvedValue(null);

		// Update createWorkspace handler for this test
		mockConfig.handlers.createWorkspace = vi.fn().mockResolvedValue({
			path: "/test/workspaces/TEST-456",
			isGitWorktree: false,
		});

		// Start the edge worker
		await edgeWorker.start();

		const sessionId = "correct-order-session-id";
		const issueId = "issue-456";

		// Create webhooks with proper structure
		const createdWebhook: LinearAgentSessionCreatedWebhook = {
			webhookId: "webhook-created-2",
			type: "AgentSessionEvent",
			action: "created",
			webhookTimestamp: 1234567890,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-456",
					title: "Test Issue 2",
					description: "Test description 2",
					url: "https://linear.app/test/issue/TEST-456",
					team: {
						id: "team-123",
						key: "TEST",
					},
					labels: [],
					priority: 3,
				},
				comment: {
					id: "comment-456",
					body: "This thread is for an agent session",
				},
				user: {
					id: "user-123",
					email: "test@example.com",
					name: "Test User",
				},
			},
		};

		const promptedWebhook: LinearAgentSessionPromptedWebhook = {
			webhookId: "webhook-prompted-2",
			type: "AgentSessionEvent",
			action: "prompted",
			webhookTimestamp: 1234567891,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-456",
					title: "Test Issue 2",
					url: "https://linear.app/test/issue/TEST-456",
					team: {
						id: "team-123",
						key: "TEST",
					},
				},
				comment: {
					id: "comment-456",
					body: "This thread is for an agent session",
				},
			},
			agentActivity: {
				id: "activity-prompted-2",
				type: "userMessage",
				sourceCommentId: "comment-user-2",
				content: {
					type: "userMessage",
					body: "Please help with this task",
				},
			},
		};

		// Spy on console.error to ensure no errors
		const consoleErrorSpy = vi.spyOn(console, "error");

		// Simulate correct order: created first, then prompted
		await (edgeWorker as any).handleWebhook(createdWebhook, [
			mockConfig.repositories[0],
		]);
		await (edgeWorker as any).handleWebhook(promptedWebhook, [
			mockConfig.repositories[0],
		]);

		// Verify no errors were logged
		expect(consoleErrorSpy).not.toHaveBeenCalledWith(
			"Unexpected: could not find Cyrus Agent Session for agent activity session:",
			sessionId,
		);

		// Get the session manager
		const agentSessionManager = (edgeWorker as any).agentSessionManagers.get(
			"test-repo-id",
		);

		// Verify the session exists
		const session = agentSessionManager.getSession(sessionId);
		expect(session).toBeDefined();
		expect(session?.linearAgentActivitySessionId).toBe(sessionId);
		expect(session?.issueId).toBe(issueId);

		// Clean up
		await edgeWorker.stop();
	});

	it("should queue and process prompted webhook that arrives before session is created", async () => {
		// This test verifies that a prompted webhook that arrives late can still be processed
		// after the session has been created

		// Create EdgeWorker instance for this test
		const edgeWorker = new EdgeWorker(mockConfig);

		// Mock methods that will be called during webhook processing
		const mockLinearClient = {
			issue: vi.fn().mockResolvedValue({
				id: "issue-789",
				identifier: "TEST-789",
				title: "Test Issue 3",
				description: "Test description 3",
				team: { id: "team-123", key: "TEST" },
				labels: vi.fn().mockResolvedValue({ nodes: [] }),
			}),
			team: vi.fn().mockResolvedValue({
				id: "team-123",
				states: vi.fn().mockResolvedValue({
					nodes: [
						{ id: "state-started", type: "started", name: "In Progress" },
						{ id: "state-unstarted", type: "unstarted", name: "Todo" },
					],
				}),
			}),
			agentActivity: vi.fn().mockResolvedValue({
				id: "activity-123",
				type: "thought",
				body: "Acknowledged. Starting work on this issue.",
			}),
		};

		// Replace the Linear client for our test repository
		(edgeWorker as any).linearClients.set("test-repo-id", mockLinearClient);

		// Mock private methods
		vi.spyOn(
			edgeWorker as any,
			"postInstantPromptedAcknowledgment",
		).mockResolvedValue(undefined);
		vi.spyOn(edgeWorker as any, "postInstantAcknowledgment").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "fetchFullIssueDetails").mockResolvedValue({
			id: "issue-789",
			identifier: "TEST-789",
			title: "Test Issue 3",
			description: "Test description 3",
		});
		vi.spyOn(edgeWorker as any, "moveIssueToStartedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "downloadIssueAttachments").mockResolvedValue({
			fileCount: 0,
			manifest: null,
		});
		vi.spyOn(edgeWorker as any, "savePersistedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "loadPersistedState").mockResolvedValue(
			undefined,
		);
		vi.spyOn(edgeWorker as any, "fetchIssueLabels").mockResolvedValue([]);
		vi.spyOn(
			edgeWorker as any,
			"determineSystemPromptFromLabels",
		).mockResolvedValue(null);

		// Update createWorkspace handler for this test
		mockConfig.handlers.createWorkspace = vi.fn().mockResolvedValue({
			path: "/test/workspaces/TEST-789",
			isGitWorktree: false,
		});

		// Start the edge worker
		await edgeWorker.start();

		const sessionId = "delayed-prompt-session-id";
		const issueId = "issue-789";

		// Create webhooks
		const createdWebhook: LinearAgentSessionCreatedWebhook = {
			webhookId: "webhook-created-3",
			type: "AgentSessionEvent",
			action: "created",
			webhookTimestamp: 1234567890,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-789",
					title: "Test Issue 3",
					description: "Test description 3",
					url: "https://linear.app/test/issue/TEST-789",
					team: {
						id: "team-123",
						key: "TEST",
					},
					labels: [],
					priority: 3,
				},
				comment: {
					id: "comment-789",
					body: "This thread is for an agent session",
				},
				user: {
					id: "user-123",
					email: "test@example.com",
					name: "Test User",
				},
			},
		};

		const promptedWebhook: LinearAgentSessionPromptedWebhook = {
			webhookId: "webhook-prompted-3",
			type: "AgentSessionEvent",
			action: "prompted",
			webhookTimestamp: 1234567895, // 5 seconds later
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-789",
					title: "Test Issue 3",
					url: "https://linear.app/test/issue/TEST-789",
					team: {
						id: "team-123",
						key: "TEST",
					},
				},
				comment: {
					id: "comment-789",
					body: "This thread is for an agent session",
				},
			},
			agentActivity: {
				id: "activity-prompted-3",
				type: "userMessage",
				sourceCommentId: "comment-user-3",
				content: {
					type: "userMessage",
					body: "This is a delayed prompt",
				},
			},
		};

		// Spy on console.warn to check for queueing
		const consoleWarnSpy = vi.spyOn(console, "warn");
		const consoleErrorSpy = vi.spyOn(console, "error");

		// First, simulate the prompted webhook arriving (should be queued)
		await (edgeWorker as any).handleWebhook(promptedWebhook, [
			mockConfig.repositories[0],
		]);

		// Verify the warning was logged (not error, since we now queue)
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			`Session not found for agent activity session: ${sessionId}. Queuing webhook for retry.`,
		);

		// Clear the spy calls
		consoleWarnSpy.mockClear();
		consoleErrorSpy.mockClear();

		// Now create the session
		await (edgeWorker as any).handleWebhook(createdWebhook, [
			mockConfig.repositories[0],
		]);

		// Now send the same prompted webhook again - it should work this time
		await (edgeWorker as any).handleWebhook(promptedWebhook, [
			mockConfig.repositories[0],
		]);

		// Verify no new errors were logged
		expect(consoleErrorSpy).not.toHaveBeenCalledWith(
			`Unexpected: could not find Cyrus Agent Session for agent activity session: ${sessionId}`,
		);

		// Get the session manager
		const agentSessionManager = (edgeWorker as any).agentSessionManagers.get(
			"test-repo-id",
		);

		// Verify the session exists
		const session = agentSessionManager.getSession(sessionId);
		expect(session).toBeDefined();
		expect(session?.linearAgentActivitySessionId).toBe(sessionId);
		expect(session?.issueId).toBe(issueId);

		// Clean up
		await edgeWorker.stop();
	});
});
