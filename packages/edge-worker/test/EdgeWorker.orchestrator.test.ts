import type {
	LinearIssueStatusChangedWebhook,
	LinearWebhookIssueState,
} from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock dependencies
vi.mock("cyrus-ndjson-client");
vi.mock("cyrus-claude-runner", () => ({
	ClaudeRunner: vi.fn().mockImplementation(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		isStreaming: vi.fn().mockReturnValue(false),
		addStreamMessage: vi.fn(),
	})),
	getAllTools: vi.fn().mockReturnValue(["all", "tools"]),
	getSafeTools: vi.fn().mockReturnValue(["safe", "tools"]),
	getReadOnlyTools: vi.fn().mockReturnValue(["read", "only", "tools"]),
}));
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn().mockImplementation(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		getOAuthCallbackUrl: vi
			.fn()
			.mockReturnValue("http://localhost:3456/oauth/callback"),
		registerOAuthCallbackHandler: vi.fn(),
	})),
}));
vi.mock("../src/AgentSessionManager.js", () => ({
	AgentSessionManager: vi.fn().mockImplementation(() => ({
		startSession: vi.fn(),
		endSession: vi.fn(),
		createResponseActivity: vi.fn(),
		getSessionsByIssueId: vi.fn().mockReturnValue([]),
	})),
}));

vi.mock("cyrus-core", () => ({
	PersistenceManager: vi.fn().mockImplementation(() => ({
		saveEdgeWorkerState: vi.fn(),
		loadEdgeWorkerState: vi.fn(),
	})),
	isIssueAssignedWebhook: vi.fn().mockReturnValue(false),
	isIssueCommentMentionWebhook: vi.fn().mockReturnValue(false),
	isIssueNewCommentWebhook: vi.fn().mockReturnValue(false),
	isIssueUnassignedWebhook: vi.fn().mockReturnValue(false),
	isAgentSessionCreatedWebhook: vi.fn().mockReturnValue(false),
	isAgentSessionPromptedWebhook: vi.fn().mockReturnValue(false),
	isIssueStatusChangedWebhook: vi.fn().mockReturnValue(false),
}));
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	readdir: vi.fn(),
	rename: vi.fn(),
}));

// Mock file type detection
vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn().mockResolvedValue(null),
}));

// Mock console methods to reduce noise
global.console = {
	...console,
	log: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

describe("EdgeWorker - Orchestrator", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockRepository: RepositoryConfig;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Reset webhook type guards to default values
		const cyrusCore = await import("cyrus-core");
		vi.mocked(cyrusCore.isIssueAssignedWebhook).mockReturnValue(false);
		vi.mocked(cyrusCore.isIssueCommentMentionWebhook).mockReturnValue(false);
		vi.mocked(cyrusCore.isIssueNewCommentWebhook).mockReturnValue(false);
		vi.mocked(cyrusCore.isIssueUnassignedWebhook).mockReturnValue(false);
		vi.mocked(cyrusCore.isAgentSessionCreatedWebhook).mockReturnValue(false);
		vi.mocked(cyrusCore.isAgentSessionPromptedWebhook).mockReturnValue(false);
		vi.mocked(cyrusCore.isIssueStatusChangedWebhook).mockReturnValue(false);

		mockRepository = {
			id: "test-repo",
			name: "Test Repository",
			repositoryPath: "/test/repo",
			baseBranch: "main",
			linearWorkspaceId: "workspace-123",
			linearToken: "linear-token-123",
			workspaceBaseDir: "/test/workspaces",
			labelPrompts: {
				orchestrator: {
					labels: ["Epic", "Orchestrate"],
					allowedTools: "all",
				},
				debugger: {
					labels: ["Bug"],
					allowedTools: "safe",
				},
				builder: {
					labels: ["Feature"],
					allowedTools: "all",
				},
			},
		};

		mockConfig = {
			proxyUrl: "https://proxy.example.com",
			serverPort: 3456,
			repositories: [mockRepository],
			promptDefaults: {
				orchestrator: {
					allowedTools: "all",
				},
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	describe("Orchestrator Role Selection", () => {
		it("should select orchestrator prompt when Epic label is present", async () => {
			const { readFile } = await import("node:fs/promises");
			vi.mocked(readFile).mockResolvedValue(
				'Orchestrator system prompt\n<version-tag value="orchestrator-v1.0.0" />',
			);

			// Access private method for testing
			const determineSystemPromptFromLabels = (
				edgeWorker as any
			).determineSystemPromptFromLabels.bind(edgeWorker);

			const result = await determineSystemPromptFromLabels(
				["Epic", "Backend"],
				mockRepository,
			);

			expect(result).toBeDefined();
			expect(result?.type).toBe("orchestrator");
			expect(result?.version).toBe("orchestrator-v1.0.0");
			expect(result?.prompt).toContain("Orchestrator system prompt");
		});

		it("should select orchestrator prompt when Orchestrate label is present", async () => {
			const { readFile } = await import("node:fs/promises");
			vi.mocked(readFile).mockResolvedValue(
				'Orchestrator system prompt\n<version-tag value="orchestrator-v1.0.0" />',
			);

			const determineSystemPromptFromLabels = (
				edgeWorker as any
			).determineSystemPromptFromLabels.bind(edgeWorker);

			const result = await determineSystemPromptFromLabels(
				["Orchestrate", "Frontend"],
				mockRepository,
			);

			expect(result).toBeDefined();
			expect(result?.type).toBe("orchestrator");
		});

		it("should prioritize debugger over orchestrator when both labels present", async () => {
			const { readFile } = await import("node:fs/promises");
			vi.mocked(readFile).mockImplementation(async (path: string) => {
				if (path.includes("debugger.md")) {
					return 'Debugger prompt\n<version-tag value="debugger-v1.0.0" />';
				}
				if (path.includes("orchestrator.md")) {
					return 'Orchestrator prompt\n<version-tag value="orchestrator-v1.0.0" />';
				}
				throw new Error(`File not found: ${path}`);
			});

			const determineSystemPromptFromLabels = (
				edgeWorker as any
			).determineSystemPromptFromLabels.bind(edgeWorker);

			const result = await determineSystemPromptFromLabels(
				["Bug", "Epic"],
				mockRepository,
			);

			expect(result?.type).toBe("debugger");
		});
	});

	describe("Sub-Issue Completion Detection", () => {
		let mockLinearClient: any;
		let mockStateChangeWebhook: LinearIssueStatusChangedWebhook;

		beforeEach(() => {
			mockLinearClient = {
				viewer: vi.fn().mockResolvedValue({ id: "agent-user-id" }),
				issue: vi.fn(),
				createComment: vi.fn().mockResolvedValue({ success: true }),
				client: {
					rawRequest: vi.fn().mockResolvedValue({
						data: {
							issue: {
								comments: {
									nodes: [{ id: "first-comment-id" }],
								},
							},
						},
					}),
				},
			};

			// Set up the Linear client
			(edgeWorker as any).linearClients.set(
				mockRepository.id,
				mockLinearClient,
			);

			const fromState: LinearWebhookIssueState = {
				id: "state-1",
				name: "In Progress",
				type: "started",
				color: "#000000",
			};

			const toState: LinearWebhookIssueState = {
				id: "state-2",
				name: "Done",
				type: "completed",
				color: "#00FF00",
			};

			mockStateChangeWebhook = {
				type: "AppUserNotification",
				action: "issueStatusChanged",
				createdAt: new Date().toISOString(),
				organizationId: "workspace-123", // Match the repository's linearWorkspaceId
				oauthClientId: "client-123",
				appUserId: "user-123",
				notification: {
					id: "notification-123",
					type: "issueStatusChanged",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					actorId: "actor-123",
					externalUserActorId: null,
					userId: "user-123",
					issueId: "sub-issue-123",
					issue: {
						id: "sub-issue-123",
						identifier: "PACK-260",
						title: "Sub-task implementation",
						teamId: "team-123",
						team: {
							id: "team-123",
							key: "PACK",
							name: "Pack Team",
						},
						url: "https://linear.app/example/issue/PACK-260",
					},
					actor: {
						id: "actor-123",
						name: "Test User",
						email: "test@example.com",
						url: "https://linear.app/example/user/test",
					},
					fromStateId: fromState.id,
					toStateId: toState.id,
					fromState,
					toState,
				},
				webhookTimestamp: Date.now(),
				webhookId: "webhook-123",
			};
		});

		it("should trigger parent re-evaluation when sub-issue completes", async () => {
			// Mock the parent issue with orchestrator label
			const mockParentIssue = {
				id: "parent-issue-123",
				identifier: "PACK-259",
				title: "Parent Epic",
				assignee: Promise.resolve({ id: "agent-user-id" }),
				labels: vi.fn().mockResolvedValue({
					nodes: [
						{ id: "label-1", name: "Epic" },
						{ id: "label-2", name: "Backend" },
					],
				}),
			};

			const mockSubIssue = {
				id: "sub-issue-123",
				identifier: "PACK-260",
				parent: Promise.resolve(mockParentIssue),
				labels: vi.fn().mockResolvedValue({
					nodes: [{ id: "label-3", name: "Feature" }],
				}),
				// Add state property for when toState is missing from webhook
				state: Promise.resolve({
					id: "state-2",
					name: "Done",
					type: "completed",
					color: "#00FF00",
				}),
			};

			mockLinearClient.issue.mockResolvedValue(mockSubIssue);

			// Verify the webhook has a completed state
			expect(mockStateChangeWebhook.notification.toState?.type).toBe(
				"completed",
			);

			// Test the handleIssueStatusChangedWebhook method directly
			const handleIssueStatusChangedWebhook = (
				edgeWorker as any
			).handleIssueStatusChangedWebhook.bind(edgeWorker);

			await handleIssueStatusChangedWebhook(
				mockStateChangeWebhook,
				mockRepository,
			);

			// Check if issue was called to fetch sub-issue details
			expect(mockLinearClient.issue).toHaveBeenCalledWith("sub-issue-123");

			// Viewer check was removed after merging pack-259 since assignment check doesn't work with delegation
			// expect(mockLinearClient.viewer).toHaveBeenCalled();

			// Check if comment was created on parent issue
			expect(mockLinearClient.createComment).toHaveBeenCalledWith({
				issueId: "parent-issue-123",
				body: "Sub-issue PACK-260 has been completed. Re-evaluate progress and determining next steps...",
				parentId: { id: "first-comment-id" }, // Added to thread under first comment
			});
		});

		it("should not trigger re-evaluation if parent has no orchestrator label", async () => {
			// Mock the parent issue WITHOUT orchestrator label
			const mockParentIssue = {
				id: "parent-issue-123",
				identifier: "PACK-259",
				title: "Parent Issue",
				assignee: Promise.resolve({ id: "agent-user-id" }),
				labels: vi.fn().mockResolvedValue({
					nodes: [
						{ id: "label-1", name: "Feature" },
						{ id: "label-2", name: "Backend" },
					],
				}),
			};

			const mockSubIssue = {
				id: "sub-issue-123",
				identifier: "PACK-260",
				parent: Promise.resolve(mockParentIssue),
				labels: vi.fn().mockResolvedValue({
					nodes: [{ id: "label-3", name: "Bug" }],
				}),
				state: Promise.resolve({
					id: "state-2",
					name: "Done",
					type: "completed",
					color: "#00FF00",
				}),
			};

			mockLinearClient.issue.mockResolvedValue(mockSubIssue);

			// Mock the type guard to return true for this test
			const cyrusCore = await import("cyrus-core");
			vi.mocked(cyrusCore.isIssueStatusChangedWebhook).mockReturnValue(true);

			const handleWebhook = (edgeWorker as any).handleWebhook.bind(edgeWorker);
			await handleWebhook(mockStateChangeWebhook, [mockRepository]);

			// Should NOT post a comment since parent lacks orchestrator label
			expect(mockLinearClient.createComment).not.toHaveBeenCalled();
		});

		it.skip("should not trigger re-evaluation if parent is not assigned to agent", async () => {
			// SKIPPED: After merging pack-259, parent assignment check was removed as it doesn't work with delegation
			// The test is kept for reference but skipped since the functionality was intentionally removed

			// Mock the parent issue assigned to someone else
			const mockParentIssue = {
				id: "parent-issue-123",
				identifier: "PACK-259",
				title: "Parent Epic",
				assignee: Promise.resolve({ id: "other-user-id" }), // Different user
				labels: vi.fn().mockResolvedValue({
					nodes: [{ id: "label-1", name: "Epic" }],
				}),
			};

			const mockSubIssue = {
				id: "sub-issue-123",
				identifier: "PACK-260",
				parent: Promise.resolve(mockParentIssue),
				labels: vi.fn().mockResolvedValue({
					nodes: [{ id: "label-3", name: "Feature" }],
				}),
				state: Promise.resolve({
					id: "state-2",
					name: "Done",
					type: "completed",
					color: "#00FF00",
				}),
			};

			mockLinearClient.issue.mockResolvedValue(mockSubIssue);

			// Mock the type guard to return true for this test
			const cyrusCore = await import("cyrus-core");
			vi.mocked(cyrusCore.isIssueStatusChangedWebhook).mockReturnValue(true);

			const handleWebhook = (edgeWorker as any).handleWebhook.bind(edgeWorker);
			await handleWebhook(mockStateChangeWebhook, [mockRepository]);

			// Should NOT post a comment since parent is assigned to someone else
			expect(mockLinearClient.createComment).not.toHaveBeenCalled();
		});

		it("should not process if issue moves to non-completed state", async () => {
			// Change the webhook to a non-completion state change
			mockStateChangeWebhook.notification.toState = {
				id: "state-3",
				name: "In Review",
				type: "started", // Not completed
				color: "#0000FF",
			};

			// Mock the issue that's fetched to check the current state
			const mockIssue = {
				id: "sub-issue-123",
				identifier: "PACK-260",
				state: Promise.resolve({
					id: "state-in-progress",
					name: "In Progress",
					type: "started", // Not completed
					color: "#FFFF00",
				}),
			};
			mockLinearClient.issue.mockResolvedValue(mockIssue);

			// Mock the type guard to return true for this test
			const cyrusCore = await import("cyrus-core");
			vi.mocked(cyrusCore.isIssueStatusChangedWebhook).mockReturnValue(true);

			const handleWebhook = (edgeWorker as any).handleWebhook.bind(edgeWorker);
			await handleWebhook(mockStateChangeWebhook, [mockRepository]);

			// After SDK migration, we always fetch issue details to get current state
			// since the webhook doesn't include state transition details
			expect(mockLinearClient.issue).toHaveBeenCalledWith("sub-issue-123");
			// But should not create comment since it's not a completion
			expect(mockLinearClient.createComment).not.toHaveBeenCalled();
		});

		it("should handle errors gracefully when posting re-evaluation comment fails", async () => {
			// Mock the parent issue with orchestrator label
			const mockParentIssue = {
				id: "parent-issue-123",
				identifier: "PACK-259",
				title: "Parent Epic",
				assignee: Promise.resolve({ id: "agent-user-id" }),
				labels: vi.fn().mockResolvedValue({
					nodes: [{ id: "label-1", name: "Epic" }],
				}),
			};

			const mockSubIssue = {
				id: "sub-issue-123",
				identifier: "PACK-260",
				parent: Promise.resolve(mockParentIssue),
				labels: vi.fn().mockResolvedValue({
					nodes: [{ id: "label-3", name: "Feature" }],
				}),
				state: Promise.resolve({
					id: "state-2",
					name: "Done",
					type: "completed",
					color: "#00FF00",
				}),
			};

			mockLinearClient.issue.mockResolvedValue(mockSubIssue);
			mockLinearClient.createComment.mockRejectedValue(
				new Error("Failed to create comment"),
			);

			// Test the handleIssueStatusChangedWebhook method directly
			const handleIssueStatusChangedWebhook = (
				edgeWorker as any
			).handleIssueStatusChangedWebhook.bind(edgeWorker);

			// Should not throw even if comment creation fails
			await expect(
				handleIssueStatusChangedWebhook(mockStateChangeWebhook, mockRepository),
			).resolves.not.toThrow();

			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to post re-evaluation comment"),
				expect.any(Error),
			);
		});
	});

	describe("Orchestrator Tool Configuration", () => {
		it("should use all tools for orchestrator role by default", () => {
			const buildAllowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			);

			const tools = buildAllowedTools(mockRepository, "orchestrator");

			expect(tools).toContain("mcp__linear");
			expect(tools).toEqual(
				expect.arrayContaining(["all", "tools", "mcp__linear"]),
			);
		});

		it("should respect custom orchestrator tool configuration", () => {
			mockRepository.labelPrompts!.orchestrator!.allowedTools = [
				"custom",
				"tools",
			];

			const buildAllowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			);

			const tools = buildAllowedTools(mockRepository, "orchestrator");

			expect(tools).toContain("mcp__linear");
			expect(tools).toContain("custom");
			expect(tools).toContain("tools");
		});

		it("should use safe tools when orchestrator is configured with 'safe'", () => {
			mockRepository.labelPrompts!.orchestrator!.allowedTools = "safe";

			const buildAllowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			);

			const tools = buildAllowedTools(mockRepository, "orchestrator");

			expect(tools).toContain("mcp__linear");
			expect(tools).toEqual(
				expect.arrayContaining(["safe", "tools", "mcp__linear"]),
			);
		});
	});
});
