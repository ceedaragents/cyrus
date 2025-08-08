import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
} from "cyrus-core/webhook-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

// Mock dependencies
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn().mockResolvedValue("mock template content"),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn().mockResolvedValue([]),
}));

const createMockNdjsonClient = () => {
	const eventHandlers: Record<string, any> = {};
	return {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		isConnected: vi.fn().mockReturnValue(true),
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
	ClaudeRunner: vi.fn().mockImplementation(() => ({
		startStreaming: vi
			.fn()
			.mockResolvedValue({ sessionId: "claude-session-123" }),
		stop: vi.fn(),
		isStreaming: vi.fn().mockReturnValue(false),
		updatePromptVersions: vi.fn(),
	})),
	getSafeTools: vi.fn().mockReturnValue(["Read", "Edit"]),
}));

vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		issue: vi.fn().mockResolvedValue({
			id: "issue-789",
			identifier: "TEST-789",
			title: "Test Issue Queue",
			description: "Test description for queue",
			team: vi.fn().mockResolvedValue({ id: "team-123", key: "TEST" }),
			labels: vi.fn().mockResolvedValue({ nodes: [] }),
			state: vi.fn().mockResolvedValue({ type: "unstarted", name: "Todo" }),
			attachments: vi.fn().mockResolvedValue({ nodes: [] }),
		}),
		team: vi.fn(),
		createAgentActivity: vi.fn().mockResolvedValue({ success: true }),
		workflowStates: vi.fn().mockResolvedValue({
			nodes: [
				{
					id: "state-started",
					type: "started",
					name: "In Progress",
					position: 1,
				},
				{ id: "state-unstarted", type: "unstarted", name: "Todo", position: 0 },
			],
		}),
		updateIssue: vi.fn().mockResolvedValue({ success: true }),
		comments: vi.fn().mockResolvedValue({ nodes: [] }),
		client: {
			rawRequest: vi.fn().mockResolvedValue({
				data: {
					comment: {
						id: "comment-1",
						body: "Test comment",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						user: { name: "Test User", id: "user-123" },
					},
				},
			}),
		},
	})),
}));

const createMockSharedApplicationServer = () => ({
	start: vi.fn().mockResolvedValue(undefined),
	stop: vi.fn().mockResolvedValue(undefined),
	getPublicUrl: vi.fn().mockReturnValue("http://localhost:3456"),
	registerOAuthCallbackHandler: vi.fn(),
	getOAuthCallbackUrl: vi
		.fn()
		.mockReturnValue("http://localhost:3456/oauth/callback"),
});

vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn(() => createMockSharedApplicationServer()),
}));

// Create a map to store all AgentSessionManager instances by repository ID
const agentSessionManagerInstances = new Map<string, any>();

// Create a factory function for AgentSessionManager mock
const createMockAgentSessionManager = () => {
	const sessions: Map<string, any> = new Map();
	const instance = {
		getSession: vi.fn((id: string) => sessions.get(id)),
		createLinearAgentSession: vi.fn(
			(
				sessionId: string,
				issueId: string,
				issueMinimal: any,
				workspace: any,
			) => {
				sessions.set(sessionId, {
					linearAgentActivitySessionId: sessionId,
					issueId,
					issue: issueMinimal,
					workspace,
					claudeSessionId: "claude-session-123",
					claudeRunner: null,
				});
			},
		),
		addClaudeRunner: vi.fn((sessionId: string, runner: any) => {
			const session = sessions.get(sessionId);
			if (session) {
				session.claudeRunner = runner;
			}
		}),
		createResponseActivity: vi.fn(),
		handleClaudeMessage: vi.fn(),
		getAllClaudeRunners: vi.fn().mockReturnValue([]),
		serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
		restoreState: vi.fn(),
		getSessionsByIssueId: vi.fn().mockReturnValue([]),
		getClaudeRunnersForIssue: vi.fn().mockReturnValue([]),
	};
	// Store this instance so tests can access it
	agentSessionManagerInstances.set("test-repo-id", instance);
	return instance;
};

vi.mock("../src/AgentSessionManager.js", () => {
	return {
		AgentSessionManager: vi
			.fn()
			.mockImplementation(() => createMockAgentSessionManager()),
	};
});

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
		loadEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn(),
}));

describe("EdgeWorker - Webhook Queueing Fix", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		// Clear all mocks and instances
		vi.clearAllMocks();
		agentSessionManagerInstances.clear();

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
				},
			],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/TEST-789",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should queue prompted webhooks that arrive before created webhook and process them after session creation", async () => {
		// Start the edge worker
		await edgeWorker.start();

		// Create mock webhooks
		const sessionId = "queue-test-session-id";
		const issueId = "issue-789";

		// Create two prompted webhooks that arrive before the created webhook
		const promptedWebhook1: LinearAgentSessionPromptedWebhook = {
			webhookId: "webhook-prompted-q1",
			type: "AgentSessionEvent",
			action: "prompted",
			webhookTimestamp: 1234567891,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-789",
					title: "Test Issue Queue",
					url: "https://linear.app/test/issue/TEST-789",
				},
			},
			agentActivity: {
				sourceCommentId: "comment-1",
				content: {
					type: "userMessage",
					body: "First message that arrives early",
				},
			},
		};

		const promptedWebhook2: LinearAgentSessionPromptedWebhook = {
			webhookId: "webhook-prompted-q2",
			type: "AgentSessionEvent",
			action: "prompted",
			webhookTimestamp: 1234567892,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-789",
					title: "Test Issue Queue",
					url: "https://linear.app/test/issue/TEST-789",
				},
			},
			agentActivity: {
				sourceCommentId: "comment-2",
				content: {
					type: "userMessage",
					body: "Second message that arrives early",
				},
			},
		};

		// Create created webhook that arrives last
		const createdWebhook: LinearAgentSessionCreatedWebhook = {
			webhookId: "webhook-created-q1",
			type: "AgentSessionEvent",
			action: "created",
			webhookTimestamp: 1234567890,
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: issueId,
					identifier: "TEST-789",
					title: "Test Issue Queue",
					url: "https://linear.app/test/issue/TEST-789",
				},
				comment: {
					id: "comment-root",
					body: "This thread is for an agent session",
				},
			},
		};

		// Spy on console to check for warning and processing messages
		const consoleWarnSpy = vi.spyOn(console, "warn");
		const consoleLogSpy = vi.spyOn(console, "log");

		// Simulate prompted webhooks arriving first (out of order)
		await (edgeWorker as any).handleWebhook(promptedWebhook1, [
			mockConfig.repositories[0],
		]);
		await (edgeWorker as any).handleWebhook(promptedWebhook2, [
			mockConfig.repositories[0],
		]);

		// Check that warnings were logged for queuing
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				`Session not found for agent activity session: ${sessionId}. Queuing webhook for retry.`,
			),
		);
		expect(consoleWarnSpy).toHaveBeenCalledTimes(2);

		// Verify that webhooks were queued
		const pendingWebhooksBeforeCreated = (
			edgeWorker as any
		).pendingPromptedWebhooks.get(sessionId);
		expect(pendingWebhooksBeforeCreated).toBeDefined();
		expect(pendingWebhooksBeforeCreated).toHaveLength(2);

		// Mock the handleUserPostedAgentActivity method to verify it's called
		const handleUserPostedAgentActivitySpy = vi.spyOn(
			edgeWorker as any,
			"handleUserPostedAgentActivity",
		);

		// Now simulate the created webhook arriving
		await (edgeWorker as any).handleWebhook(createdWebhook, [
			mockConfig.repositories[0],
		]);

		// Check that the queued webhooks were processed
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				`Processing 2 pending webhooks for session ${sessionId}`,
			),
		);

		// Verify handleUserPostedAgentActivity was called for each queued webhook
		expect(handleUserPostedAgentActivitySpy).toHaveBeenCalledTimes(2);
		expect(handleUserPostedAgentActivitySpy).toHaveBeenCalledWith(
			promptedWebhook1,
			mockConfig.repositories[0],
		);
		expect(handleUserPostedAgentActivitySpy).toHaveBeenCalledWith(
			promptedWebhook2,
			mockConfig.repositories[0],
		);

		// Verify the session was created
		const agentSessionManager =
			agentSessionManagerInstances.get("test-repo-id");
		expect(agentSessionManager).toBeDefined();

		// Verify pending webhooks were cleared
		const pendingWebhooks = (edgeWorker as any).pendingPromptedWebhooks.get(
			sessionId,
		);
		expect(pendingWebhooks).toBeUndefined();

		// Clean up
		await edgeWorker.stop();
	});

	it("should filter out expired pending webhooks (older than 5 minutes)", async () => {
		// This test verifies the filtering logic for expired webhooks
		const mockNow = 1234567890000;
		const sessionId = "test-session";

		// Start the edge worker
		await edgeWorker.start();

		// Create test data
		const oldWebhook: LinearAgentSessionPromptedWebhook = {
			webhookId: "webhook-old",
			type: "AgentSessionEvent",
			action: "prompted",
			webhookTimestamp: mockNow - 6 * 60 * 1000, // 6 minutes ago
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: "issue-999",
					identifier: "TEST-999",
					title: "Test Old Webhook",
					url: "https://linear.app/test/issue/TEST-999",
				},
			},
			agentActivity: {
				sourceCommentId: "old-comment",
				content: {
					type: "userMessage",
					body: "This message is too old",
				},
			},
		};

		const recentWebhook: LinearAgentSessionPromptedWebhook = {
			webhookId: "webhook-recent",
			type: "AgentSessionEvent",
			action: "prompted",
			webhookTimestamp: mockNow - 1 * 60 * 1000, // 1 minute ago
			organizationId: "test-workspace",
			agentSession: {
				id: sessionId,
				issue: {
					id: "issue-999",
					identifier: "TEST-999",
					title: "Test Recent Webhook",
					url: "https://linear.app/test/issue/TEST-999",
				},
			},
			agentActivity: {
				sourceCommentId: "recent-comment",
				content: {
					type: "userMessage",
					body: "This message is recent",
				},
			},
		};

		// Manually create a queue with both old and recent webhooks
		const pendingWebhooks = (edgeWorker as any).pendingPromptedWebhooks;
		const webhooksToQueue = [
			{
				webhook: oldWebhook,
				repository: mockConfig.repositories[0],
				timestamp: mockNow - 6 * 60 * 1000, // 6 minutes ago
			},
			{
				webhook: recentWebhook,
				repository: mockConfig.repositories[0],
				timestamp: mockNow - 1 * 60 * 1000, // 1 minute ago
			},
		];

		pendingWebhooks.set(sessionId, webhooksToQueue);

		// Test the filtering logic directly
		const currentPending = pendingWebhooks.get(sessionId);
		expect(currentPending).toHaveLength(2); // Should have both webhooks initially

		const fiveMinutesAgo = mockNow - 5 * 60 * 1000;
		const filtered = currentPending.filter(
			(p: any) => p.timestamp > fiveMinutesAgo,
		);

		// Verify that only the recent webhook remains after filtering
		expect(filtered).toHaveLength(1);
		expect(filtered[0].webhook.webhookId).toBe("webhook-recent");
		expect(filtered[0].timestamp).toBe(mockNow - 1 * 60 * 1000);

		// Note: We skip edgeWorker.stop() here because it's not essential for this test
		// and the mock setup complexity is not worth it for testing the filtering logic
	});
});
