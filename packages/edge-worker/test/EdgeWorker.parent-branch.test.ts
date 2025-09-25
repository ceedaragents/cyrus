import { readFile } from "node:fs/promises";
import { LinearClient } from "@linear/sdk";
import { ClaudeRunner } from "cyrus-claude-runner";
import type { LinearAgentSessionCreatedWebhook } from "cyrus-core";
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

describe("EdgeWorker - Parent Branch Handling", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockLinearClient: any;
	let mockClaudeRunner: any;
	let mockAgentSessionManager: any;
	let capturedClaudeRunnerConfig: any = null;

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
		labelPrompts: {
			debugger: ["bug", "error"],
			builder: ["feature", "enhancement"],
			scoper: ["scope", "research"],
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Mock LinearClient - default issue without parent
		mockLinearClient = {
			issue: vi.fn().mockResolvedValue({
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "This is a test issue",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: Promise.resolve({ name: "Todo" }),
				team: { id: "team-123" },
				labels: vi.fn().mockResolvedValue({
					nodes: [],
				}),
				parent: Promise.resolve(null), // No parent by default
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
		};
		vi.mocked(LinearClient).mockImplementation(() => mockLinearClient);

		// Mock ClaudeRunner to capture config
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

		// Mock AgentSessionManager
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

		// Mock readFile to return default prompt
		vi.mocked(readFile).mockImplementation(async (_path: any) => {
			return `<version-tag value="default-v1.0.0" />
# Default Template

Repository: {{repository_name}}
Issue: {{issue_identifier}}
Base Branch: {{base_branch}}`;
		});

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [mockRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Mock branchExists to always return true so parent branches are used
		vi.spyOn(edgeWorker as any, "branchExists").mockResolvedValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should use repository baseBranch when issue has no parent", async () => {
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

		// Check that startStreaming was called with a prompt containing the correct base branch
		expect(mockClaudeRunner.startStreaming).toHaveBeenCalled();
		const promptArg = mockClaudeRunner.startStreaming.mock.calls[0][0];
		expect(promptArg).toContain("Base Branch: main"); // Should contain the repository's base branch
	});

	it("should use parent issue branch when issue has a parent", async () => {
		// Arrange - Mock issue with parent
		mockLinearClient.issue.mockResolvedValue({
			id: "issue-123",
			identifier: "TEST-123",
			title: "Test Issue",
			description: "This is a test issue",
			url: "https://linear.app/test/issue/TEST-123",
			branchName: "test-branch",
			state: Promise.resolve({ name: "Todo" }),
			team: { id: "team-123" },
			labels: vi.fn().mockResolvedValue({
				nodes: [],
			}),
			parent: Promise.resolve({
				id: "parent-issue-456",
				identifier: "TEST-456",
				branchName: "parent-feature-branch",
			}),
		});

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

		// Check that startStreaming was called with a prompt containing the parent branch
		expect(mockClaudeRunner.startStreaming).toHaveBeenCalled();
		const promptArg = mockClaudeRunner.startStreaming.mock.calls[0][0];
		expect(promptArg).toContain("Base Branch: parent-feature-branch"); // Should contain the parent's branch
	});

	it("should fall back to repository baseBranch when parent has no branch name", async () => {
		// Arrange - Mock issue with parent but no branch name
		mockLinearClient.issue.mockResolvedValue({
			id: "issue-123",
			identifier: "TEST-123",
			title: "Test Issue",
			description: "This is a test issue",
			url: "https://linear.app/test/issue/TEST-123",
			branchName: "test-branch",
			state: Promise.resolve({ name: "Todo" }),
			team: { id: "team-123" },
			labels: vi.fn().mockResolvedValue({
				nodes: [],
			}),
			parent: Promise.resolve({
				id: "parent-issue-456",
				identifier: "TEST-456",
				branchName: null, // Parent has no branch name
				title: "Parent Issue Title", // Add title so branch name can be generated
			}),
		});

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

		// Check that startStreaming was called with a prompt containing the generated parent branch name
		expect(mockClaudeRunner.startStreaming).toHaveBeenCalled();
		const promptArg = mockClaudeRunner.startStreaming.mock.calls[0][0];
		expect(promptArg).toContain("Base Branch: TEST-456-parent-issue-title"); // Should use generated branch name
	});

	it("should handle deeply nested parent issues", async () => {
		// Arrange - Mock issue with nested parent structure
		mockLinearClient.issue.mockResolvedValue({
			id: "issue-123",
			identifier: "TEST-123",
			title: "Test Issue",
			description: "This is a test issue",
			url: "https://linear.app/test/issue/TEST-123",
			branchName: "test-branch",
			state: Promise.resolve({ name: "Todo" }),
			team: { id: "team-123" },
			labels: vi.fn().mockResolvedValue({
				nodes: [],
			}),
			parent: Promise.resolve({
				id: "parent-issue-456",
				identifier: "TEST-456",
				branchName: "parent-branch-456",
				parent: {
					id: "grandparent-issue-789",
					identifier: "TEST-789",
					branchName: "grandparent-branch-789",
				},
			}),
		});

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

		// Assert - should use immediate parent branch, not grandparent
		expect(vi.mocked(ClaudeRunner)).toHaveBeenCalled();
		expect(capturedClaudeRunnerConfig).toBeDefined();

		// Check that startStreaming was called with a prompt containing the immediate parent branch
		expect(mockClaudeRunner.startStreaming).toHaveBeenCalled();
		const promptArg = mockClaudeRunner.startStreaming.mock.calls[0][0];
		expect(promptArg).toContain("Base Branch: parent-branch-456"); // Should use immediate parent
		expect(promptArg).not.toContain("grandparent-branch-789"); // Should not contain grandparent
	});
});
