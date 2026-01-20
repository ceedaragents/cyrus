import { LinearClient } from "@linear/sdk";
import { ClaudeRunner, createCyrusToolsServer } from "cyrus-claude-runner";
import { LinearEventTransport } from "cyrus-linear-event-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock all dependencies
vi.mock("fs/promises");
vi.mock("cyrus-claude-runner");
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

describe("EdgeWorker - Stop Signal Propagation", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockAgentSessionManager: any;
	let mockParentClaudeRunner: any;
	let mockChildClaudeRunner: any;

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
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});

		// Mock createCyrusToolsServer
		vi.mocked(createCyrusToolsServer).mockImplementation(
			() =>
				({
					type: "sdk" as const,
					name: "cyrus-tools",
					instance: {},
				}) as any,
		);

		// Mock parent ClaudeRunner
		mockParentClaudeRunner = {
			supportsStreamingInput: true,
			startStreaming: vi
				.fn()
				.mockResolvedValue({ sessionId: "parent-claude-session" }),
			stop: vi.fn(),
			isStreaming: vi.fn().mockReturnValue(true),
		};

		// Mock child ClaudeRunner - this is the key one for testing stop propagation
		mockChildClaudeRunner = {
			supportsStreamingInput: true,
			startStreaming: vi
				.fn()
				.mockResolvedValue({ sessionId: "child-claude-session" }),
			stop: vi.fn(),
			isStreaming: vi.fn().mockReturnValue(true),
		};

		vi.mocked(ClaudeRunner).mockImplementation(() => mockParentClaudeRunner);

		// Mock agent session manager that handles both parent and child sessions
		mockAgentSessionManager = {
			hasAgentRunner: vi.fn().mockReturnValue(true),
			getSession: vi.fn().mockImplementation((sessionId: string) => {
				if (sessionId === "parent-session-123") {
					return {
						issueId: "PARENT-123",
						claudeSessionId: "parent-claude-session",
						workspace: { path: "/test/workspaces/PARENT-123" },
						agentRunner: mockParentClaudeRunner,
					};
				}
				if (sessionId === "child-session-456") {
					return {
						issueId: "CHILD-456",
						claudeSessionId: "child-claude-session",
						workspace: { path: "/test/workspaces/CHILD-456" },
						agentRunner: mockChildClaudeRunner,
					};
				}
				return null;
			}),
			getAgentRunner: vi.fn().mockImplementation((sessionId: string) => {
				if (sessionId === "parent-session-123") return mockParentClaudeRunner;
				if (sessionId === "child-session-456") return mockChildClaudeRunner;
				return null;
			}),
			createResponseActivity: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
		};

		vi.mocked(AgentSessionManager).mockImplementation(
			() => mockAgentSessionManager,
		);

		// Mock other dependencies
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
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [mockRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/PARENT-123",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Setup parent-child mapping (child-session-456 is a child of parent-session-123)
		(edgeWorker as any).childToParentAgentSession.set(
			"child-session-456",
			"parent-session-123",
		);

		// Setup repository managers
		(edgeWorker as any).agentSessionManagers.set(
			"test-repo",
			mockAgentSessionManager,
		);
		(edgeWorker as any).repositories.set("test-repo", mockRepository);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Stop Signal to Parent Session", () => {
		it("should stop the parent session runner when stop signal is received", async () => {
			// Arrange - Create a stop signal webhook for the parent session
			const stopWebhook = createStopSignalWebhook(
				"parent-session-123",
				"PARENT-123",
			);

			// Act
			await (edgeWorker as any).handleStopSignal(stopWebhook);

			// Assert - Parent runner should be stopped
			expect(mockParentClaudeRunner.stop).toHaveBeenCalledOnce();

			// Assert - Confirmation message should be posted
			expect(
				mockAgentSessionManager.createResponseActivity,
			).toHaveBeenCalledWith(
				"parent-session-123",
				expect.stringContaining("stopped working"),
			);
		});

		it("should also stop child session runners when parent receives stop signal", async () => {
			// Arrange - Create a stop signal webhook for the parent session
			const stopWebhook = createStopSignalWebhook(
				"parent-session-123",
				"PARENT-123",
			);

			// Act
			await (edgeWorker as any).handleStopSignal(stopWebhook);

			// Assert - Parent runner should be stopped
			expect(mockParentClaudeRunner.stop).toHaveBeenCalledOnce();

			// Assert - Child runner should ALSO be stopped
			// BUG: This currently fails because handleStopSignal does not propagate to children
			expect(mockChildClaudeRunner.stop).toHaveBeenCalledOnce();
		});

		it("should stop all child sessions when parent with multiple children receives stop signal", async () => {
			// Arrange - Create a second child session
			const mockChildClaudeRunner2 = {
				supportsStreamingInput: true,
				stop: vi.fn(),
				isStreaming: vi.fn().mockReturnValue(true),
			};

			// Add second child session mapping
			(edgeWorker as any).childToParentAgentSession.set(
				"child-session-789",
				"parent-session-123",
			);

			// Update manager to return both child sessions
			mockAgentSessionManager.getSession.mockImplementation(
				(sessionId: string) => {
					if (sessionId === "parent-session-123") {
						return {
							issueId: "PARENT-123",
							agentRunner: mockParentClaudeRunner,
						};
					}
					if (sessionId === "child-session-456") {
						return {
							issueId: "CHILD-456",
							agentRunner: mockChildClaudeRunner,
						};
					}
					if (sessionId === "child-session-789") {
						return {
							issueId: "CHILD-789",
							agentRunner: mockChildClaudeRunner2,
						};
					}
					return null;
				},
			);

			// Create stop signal for parent
			const stopWebhook = createStopSignalWebhook(
				"parent-session-123",
				"PARENT-123",
			);

			// Act
			await (edgeWorker as any).handleStopSignal(stopWebhook);

			// Assert - Parent runner should be stopped
			expect(mockParentClaudeRunner.stop).toHaveBeenCalledOnce();

			// Assert - BOTH child runners should be stopped
			// BUG: This currently fails because handleStopSignal does not propagate to children
			expect(mockChildClaudeRunner.stop).toHaveBeenCalledOnce();
			expect(mockChildClaudeRunner2.stop).toHaveBeenCalledOnce();
		});
	});

	describe("Stop Signal to Child Session Directly", () => {
		it("should stop only the child session when stop signal is sent directly to child", async () => {
			// Arrange - Create a stop signal webhook for the child session directly
			const stopWebhook = createStopSignalWebhook(
				"child-session-456",
				"CHILD-456",
			);

			// Act
			await (edgeWorker as any).handleStopSignal(stopWebhook);

			// Assert - Child runner should be stopped
			expect(mockChildClaudeRunner.stop).toHaveBeenCalledOnce();

			// Assert - Parent runner should NOT be stopped (stop doesn't propagate upward)
			expect(mockParentClaudeRunner.stop).not.toHaveBeenCalled();
		});
	});

	describe("Nested Child Sessions (Grandchildren)", () => {
		it("should stop all descendants when grandparent receives stop signal", async () => {
			// Arrange - Create a grandchild session (child-session-456 has its own child)
			const mockGrandchildRunner = {
				supportsStreamingInput: true,
				stop: vi.fn(),
				isStreaming: vi.fn().mockReturnValue(true),
			};

			// Map: grandchild -> child -> parent
			(edgeWorker as any).childToParentAgentSession.set(
				"grandchild-session-999",
				"child-session-456",
			);

			// Update manager to return grandchild session (fix: use explicit return, not recursive call)
			mockAgentSessionManager.getSession.mockImplementation(
				(sessionId: string) => {
					if (sessionId === "parent-session-123") {
						return {
							issueId: "PARENT-123",
							claudeSessionId: "parent-claude-session",
							workspace: { path: "/test/workspaces/PARENT-123" },
							agentRunner: mockParentClaudeRunner,
						};
					}
					if (sessionId === "child-session-456") {
						return {
							issueId: "CHILD-456",
							claudeSessionId: "child-claude-session",
							workspace: { path: "/test/workspaces/CHILD-456" },
							agentRunner: mockChildClaudeRunner,
						};
					}
					if (sessionId === "grandchild-session-999") {
						return {
							issueId: "GRANDCHILD-999",
							agentRunner: mockGrandchildRunner,
						};
					}
					return null;
				},
			);

			// Create stop signal for parent (grandparent of grandchild-session-999)
			const stopWebhook = createStopSignalWebhook(
				"parent-session-123",
				"PARENT-123",
			);

			// Act
			await (edgeWorker as any).handleStopSignal(stopWebhook);

			// Assert - All runners in the hierarchy should be stopped
			expect(mockParentClaudeRunner.stop).toHaveBeenCalledOnce();
			// BUG: These currently fail - stop signal doesn't propagate to descendants
			expect(mockChildClaudeRunner.stop).toHaveBeenCalledOnce();
			expect(mockGrandchildRunner.stop).toHaveBeenCalledOnce();
		});
	});
});

/**
 * Helper function to create a stop signal webhook for testing
 */
function createStopSignalWebhook(sessionId: string, issueIdentifier: string) {
	return {
		type: "AgentSessionEvent",
		action: "prompted",
		organizationId: "test-workspace",
		oauthClientId: "test-oauth-client",
		appUserId: "test-app-user",
		createdAt: new Date(),
		agentSession: {
			id: sessionId,
			appUserId: "test-app-user",
			organizationId: "test-workspace",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			status: "active",
			type: "issue",
			issue: {
				id: `issue-${issueIdentifier}`,
				identifier: issueIdentifier,
				title: `Test Issue ${issueIdentifier}`,
				url: `https://linear.app/test/${issueIdentifier}`,
				teamId: "team-123",
				team: { id: "team-123", key: "TEST", name: "Test Team" },
			},
			creator: {
				id: "user-123",
				name: "Test User",
			},
		},
		agentActivity: {
			id: `activity-stop-${Date.now()}`,
			agentSessionId: sessionId,
			content: { type: "prompt", body: "Stop session" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			signal: "stop",
		},
		guidance: [],
	} as any;
}
