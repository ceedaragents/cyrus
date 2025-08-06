import { readFile } from "node:fs/promises";
import { LinearClient } from "@linear/sdk";
import { ClaudeRunner } from "cyrus-claude-runner";
import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	SDKMessage,
} from "cyrus-core";
import {
	isAgentSessionCreatedWebhook,
	isAgentSessionPromptedWebhook,
} from "cyrus-core";
import { NdjsonClient } from "cyrus-ndjson-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn().mockResolvedValue([]),
}));

// Mock dependencies
vi.mock("cyrus-ndjson-client");
vi.mock("cyrus-claude-runner");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		isAgentSessionCreatedWebhook: vi.fn(),
		isAgentSessionPromptedWebhook: vi.fn(),
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});
vi.mock("file-type");

describe("EdgeWorker - Thread Reply with Last Message Marker", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockLinearClient: any;
	let mockClaudeRunner: any;
	let mockAgentSessionManager: any;
	let capturedClaudeRunnerConfig: any = null;
	let capturedMessages: SDKMessage[] = [];

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
		capturedMessages = [];

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Mock LinearClient
		mockLinearClient = {
			issue: vi.fn().mockResolvedValue({
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { name: "Todo" },
				team: { id: "team-123" },
				labels: vi.fn().mockResolvedValue({
					nodes: [],
				}),
			}),
			workflowStates: vi.fn().mockResolvedValue({
				nodes: [
					{ id: "state-1", name: "Todo", type: "unstarted", position: 0 },
					{ id: "state-2", name: "In Progress", type: "started", position: 1 },
				],
			}),
			updateIssue: vi.fn().mockResolvedValue({ success: true }),
			createAgentActivity: vi.fn().mockResolvedValue({ success: true }),
			comments: vi.fn().mockResolvedValue({ nodes: [] }),
			client: {
				rawRequest: vi.fn().mockResolvedValue({
					data: {
						comment: {
							id: "comment-123",
							body: "Please help me with this task",
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							user: { name: "Test User", id: "user-123" },
						},
					},
				}),
			},
		};
		vi.mocked(LinearClient).mockImplementation(() => mockLinearClient);

		// Mock ClaudeRunner to capture config and simulate streaming
		mockClaudeRunner = {
			startStreaming: vi
				.fn()
				.mockResolvedValue({ sessionId: "claude-session-123" }),
			stop: vi.fn(),
			isStreaming: vi.fn().mockReturnValue(false),
			addStreamMessage: vi.fn(),
			updatePromptVersions: vi.fn(),
		};
		vi.mocked(ClaudeRunner).mockImplementation((config: any) => {
			capturedClaudeRunnerConfig = config;
			return mockClaudeRunner;
		});

		// Mock AgentSessionManager to capture handleClaudeMessage calls
		mockAgentSessionManager = {
			createLinearAgentSession: vi.fn(),
			getSession: vi.fn().mockReturnValue({
				claudeSessionId: "claude-session-123",
				workspace: { path: "/test/workspaces/TEST-123" },
				claudeRunner: mockClaudeRunner,
			}),
			addClaudeRunner: vi.fn(),
			getAllClaudeRunners: vi.fn().mockReturnValue([]),
			serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
			restoreState: vi.fn(),
			handleClaudeMessage: vi.fn().mockImplementation(async (sessionId, message) => {
				capturedMessages.push(message);
			}),
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
					registerOAuthCallbackHandler: vi.fn(),
				}) as any,
		);

		// Mock NdjsonClient
		vi.mocked(NdjsonClient).mockImplementation(
			() =>
				({
					connect: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn(),
					on: vi.fn(),
					isConnected: vi.fn().mockReturnValue(true),
				}) as any,
		);

		// Mock type guards
		vi.mocked(isAgentSessionCreatedWebhook).mockReturnValue(false);
		vi.mocked(isAgentSessionPromptedWebhook).mockReturnValue(false);

		// Mock readFile for prompts
		vi.mocked(readFile).mockImplementation(async (path: any) => {
			// Return default prompt template
			return `<version-tag value="default-v1.0.0" />
# Default Template

Repository: {{repository_name}}
Issue: {{issue_identifier}}`;
		});

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			repositories: [mockRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Thread Reply Scenarios", () => {
		it("should append last message marker when creating initial session", async () => {
			// Arrange
			const createdWebhook: LinearAgentSessionCreatedWebhook = {
				type: "Issue",
				action: "agentSessionCreated",
				organizationId: "test-workspace",
				agentSession: {
					id: "agent-session-123",
					issue: {
						id: "issue-123",
						identifier: "TEST-123",
						team: { key: "TEST" },
					},
				},
			};

			vi.mocked(isAgentSessionCreatedWebhook).mockReturnValue(true);

			// Act
			const handleAgentSessionCreatedWebhook = (
				edgeWorker as any
			).handleAgentSessionCreatedWebhook.bind(edgeWorker);
			await handleAgentSessionCreatedWebhook(createdWebhook, mockRepository);

			// Assert
			expect(vi.mocked(ClaudeRunner)).toHaveBeenCalled();
			expect(capturedClaudeRunnerConfig).toBeDefined();
			expect(capturedClaudeRunnerConfig.appendSystemPrompt).toContain(
				"___LAST_MESSAGE_MARKER___",
			);
			expect(capturedClaudeRunnerConfig.appendSystemPrompt).toContain(
				"When providing your final summary response, include the special marker ___LAST_MESSAGE_MARKER___",
			);
		});

		it("should append last message marker when resuming session with thread reply", async () => {
			// Reset mocks
			vi.mocked(isAgentSessionCreatedWebhook).mockReturnValue(false);
			vi.mocked(isAgentSessionPromptedWebhook).mockReturnValue(true);
			capturedClaudeRunnerConfig = null;

			// Arrange
			const promptedWebhook: LinearAgentSessionPromptedWebhook = {
				type: "Issue",
				action: "agentSessionPrompted",
				organizationId: "test-workspace",
				agentSession: {
					id: "agent-session-123",
					issue: {
						id: "issue-123",
						identifier: "TEST-123",
						team: { key: "TEST" },
					},
				},
				agentActivity: {
					sourceCommentId: "comment-123",
					content: {
						type: "user",
						body: "Please help me with this follow-up task",
					},
				},
			};

			// Act
			const handleUserPostedAgentActivity = (
				edgeWorker as any
			).handleUserPostedAgentActivity.bind(edgeWorker);
			await handleUserPostedAgentActivity(promptedWebhook, mockRepository);

			// Assert
			expect(vi.mocked(ClaudeRunner)).toHaveBeenCalled();
			expect(capturedClaudeRunnerConfig).toBeDefined();
			expect(capturedClaudeRunnerConfig.appendSystemPrompt).toContain(
				"___LAST_MESSAGE_MARKER___",
			);
			expect(capturedClaudeRunnerConfig.resumeSessionId).toBe("claude-session-123");
		});

		it("should add message to existing stream when runner is streaming", async () => {
			// Setup
			vi.mocked(isAgentSessionPromptedWebhook).mockReturnValue(true);
			mockClaudeRunner.isStreaming.mockReturnValue(true); // Simulate active streaming

			// Arrange
			const promptedWebhook: LinearAgentSessionPromptedWebhook = {
				type: "Issue",
				action: "agentSessionPrompted",
				organizationId: "test-workspace",
				agentSession: {
					id: "agent-session-123",
					issue: {
						id: "issue-123",
						identifier: "TEST-123",
						team: { key: "TEST" },
					},
				},
				agentActivity: {
					sourceCommentId: "comment-456",
					content: {
						type: "user",
						body: "Here's another question while you're working",
					},
				},
			};

			// Act
			const handleUserPostedAgentActivity = (
				edgeWorker as any
			).handleUserPostedAgentActivity.bind(edgeWorker);
			await handleUserPostedAgentActivity(promptedWebhook, mockRepository);

			// Assert
			expect(mockClaudeRunner.addStreamMessage).toHaveBeenCalledWith(
				"Here's another question while you're working",
			);
			expect(vi.mocked(ClaudeRunner)).not.toHaveBeenCalled(); // Should not create new runner
			expect(mockClaudeRunner.stop).not.toHaveBeenCalled(); // Should not stop existing runner
		});

		it("should handle Claude messages and delegate to AgentSessionManager", async () => {
			// Setup initial session
			vi.mocked(isAgentSessionCreatedWebhook).mockReturnValue(true);
			const createdWebhook: LinearAgentSessionCreatedWebhook = {
				type: "Issue",
				action: "agentSessionCreated",
				organizationId: "test-workspace",
				agentSession: {
					id: "agent-session-123",
					issue: {
						id: "issue-123",
						identifier: "TEST-123",
						team: { key: "TEST" },
					},
				},
			};

			const handleAgentSessionCreatedWebhook = (
				edgeWorker as any
			).handleAgentSessionCreatedWebhook.bind(edgeWorker);
			await handleAgentSessionCreatedWebhook(createdWebhook, mockRepository);

			// Simulate Claude messages
			const testMessages: SDKMessage[] = [
				{
					type: "system",
					content: "System initialized",
				},
				{
					type: "user",
					content: "Please help me with this task",
				},
				{
					type: "assistant",
					content: "I'm analyzing the task...",
				},
				{
					type: "assistant",
					content: "___LAST_MESSAGE_MARKER___\nHere's my final response with the solution.",
				},
			];

			// Act - simulate onMessage callbacks
			for (const message of testMessages) {
				await capturedClaudeRunnerConfig.onMessage(message);
			}

			// Assert
			expect(mockAgentSessionManager.handleClaudeMessage).toHaveBeenCalledTimes(4);
			expect(capturedMessages).toEqual(testMessages);
			
			// Verify the last message contains the marker
			const lastMessage = capturedMessages[capturedMessages.length - 1];
			expect(lastMessage.type).toBe("assistant");
			expect(lastMessage.content).toContain("___LAST_MESSAGE_MARKER___");
		});

		it("should handle attachments when processing thread replies", async () => {
			// Setup
			vi.mocked(isAgentSessionPromptedWebhook).mockReturnValue(true);
			
			// Mock comment with attachment references
			mockLinearClient.client.rawRequest.mockResolvedValue({
				data: {
					comment: {
						id: "comment-123",
						body: "Please analyze this image: ![attachment](https://linear.app/api/attachments/123)",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						user: { name: "Test User", id: "user-123" },
					},
				},
			});

			// Arrange
			const promptedWebhook: LinearAgentSessionPromptedWebhook = {
				type: "Issue",
				action: "agentSessionPrompted",
				organizationId: "test-workspace",
				agentSession: {
					id: "agent-session-123",
					issue: {
						id: "issue-123",
						identifier: "TEST-123",
						team: { key: "TEST" },
					},
				},
				agentActivity: {
					sourceCommentId: "comment-123",
					content: {
						type: "user",
						body: "Please analyze this image",
					},
				},
			};

			// Act
			const handleUserPostedAgentActivity = (
				edgeWorker as any
			).handleUserPostedAgentActivity.bind(edgeWorker);
			await handleUserPostedAgentActivity(promptedWebhook, mockRepository);

			// Assert
			expect(mockLinearClient.client.rawRequest).toHaveBeenCalledWith(
				expect.stringContaining("query GetComment"),
				{ id: "comment-123" },
			);
			// The attachments directory should be included in allowed directories
			expect(capturedClaudeRunnerConfig.allowedDirectories).toBeDefined();
			expect(capturedClaudeRunnerConfig.allowedDirectories[0]).toContain("attachments");
		});

		it("should maintain system prompt consistency across thread replies", async () => {
			// Setup with label-based prompt
			vi.mocked(readFile).mockImplementation(async (path: any) => {
				if (path.includes("debugger.md")) {
					return `<version-tag value="debugger-v1.0.0" />
# Debugger System Prompt

You are in debugger mode.`;
				}
				return `<version-tag value="default-v1.0.0" />
# Default Template`;
			});

			// Update repository with label prompts
			mockRepository.labelPrompts = {
				debugger: ["bug"],
			};

			// Mock issue with bug label
			mockLinearClient.issue.mockResolvedValue({
				id: "issue-123",
				identifier: "TEST-123",
				title: "Bug Issue",
				description: "Bug description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { name: "Todo" },
				team: { id: "team-123" },
				labels: vi.fn().mockResolvedValue({
					nodes: [{ name: "bug" }],
				}),
			});

			// Create initial session
			vi.mocked(isAgentSessionCreatedWebhook).mockReturnValue(true);
			const createdWebhook: LinearAgentSessionCreatedWebhook = {
				type: "Issue",
				action: "agentSessionCreated",
				organizationId: "test-workspace",
				agentSession: {
					id: "agent-session-123",
					issue: {
						id: "issue-123",
						identifier: "TEST-123",
						team: { key: "TEST" },
					},
				},
			};

			const handleAgentSessionCreatedWebhook = (
				edgeWorker as any
			).handleAgentSessionCreatedWebhook.bind(edgeWorker);
			await handleAgentSessionCreatedWebhook(createdWebhook, mockRepository);

			const initialSystemPrompt = capturedClaudeRunnerConfig.appendSystemPrompt;
			expect(initialSystemPrompt).toContain("You are in debugger mode");
			expect(initialSystemPrompt).toContain("___LAST_MESSAGE_MARKER___");

			// Now handle a thread reply
			vi.mocked(isAgentSessionCreatedWebhook).mockReturnValue(false);
			vi.mocked(isAgentSessionPromptedWebhook).mockReturnValue(true);
			capturedClaudeRunnerConfig = null;

			const promptedWebhook: LinearAgentSessionPromptedWebhook = {
				type: "Issue",
				action: "agentSessionPrompted",
				organizationId: "test-workspace",
				agentSession: {
					id: "agent-session-123",
					issue: {
						id: "issue-123",
						identifier: "TEST-123",
						team: { key: "TEST" },
					},
				},
				agentActivity: {
					sourceCommentId: "comment-123",
					content: {
						type: "user",
						body: "Follow-up question",
					},
				},
			};

			const handleUserPostedAgentActivity = (
				edgeWorker as any
			).handleUserPostedAgentActivity.bind(edgeWorker);
			await handleUserPostedAgentActivity(promptedWebhook, mockRepository);

			// Assert - system prompt should be consistent
			expect(capturedClaudeRunnerConfig.appendSystemPrompt).toBe(initialSystemPrompt);
		});
	});
});