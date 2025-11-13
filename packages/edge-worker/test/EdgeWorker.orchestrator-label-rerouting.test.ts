import type { Issue } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock dependencies
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

describe("EdgeWorker - Orchestrator Label Rerouting", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockAgentSessionManager: any;
	let _mockIssueTracker: any;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		platform: "cli",
		linearToken: "test-token",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: ["Read", "Edit"],
		labelPrompts: {
			orchestrator: {
				labels: ["Orchestrator", "orchestrator"],
			},
		},
	};

	beforeEach(async () => {
		vi.clearAllMocks();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Mock AgentSessionManager
		mockAgentSessionManager = {
			postRoutingThought: vi.fn().mockResolvedValue(null),
			postProcedureSelectionThought: vi.fn().mockResolvedValue(undefined),
		};
		vi.mocked(AgentSessionManager).mockImplementation(
			() => mockAgentSessionManager,
		);

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: "/tmp/test-cyrus-home",
			platform: "cli",
			repositories: [mockRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/TEST-123",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Wait for EdgeWorker to initialize
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Get the mock issue tracker that was created
		const issueTrackers = (edgeWorker as any).issueTrackers as Map<string, any>;
		_mockIssueTracker = issueTrackers.get("test-repo");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("rerouteProcedureForSession - Orchestrator label enforcement", () => {
		it("should use orchestrator-full procedure when Orchestrator label is present", async () => {
			// Arrange - Create issue WITH Orchestrator label
			const issueWithLabel: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue with Orchestrator",
				description: "This is an orchestrator issue",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [{ id: "label-1", name: "Orchestrator", color: "#ff0000" }],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Here are the results from the child agent";

			// Act - Call the private method via type casting
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithLabel,
			);

			// Assert
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			const procedureCallArgs =
				mockAgentSessionManager.postProcedureSelectionThought.mock.calls[0];

			// Should use orchestrator-full procedure
			expect(procedureCallArgs[1]).toBe("orchestrator-full");
			// Should classify as orchestrator
			expect(procedureCallArgs[2]).toBe("orchestrator");

			// Verify the console log indicates Orchestrator label override
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining(
					"Using orchestrator-full procedure due to orchestrator label (skipping AI routing)",
				),
			);

			// Verify session metadata was initialized with orchestrator-full procedure
			expect(session.metadata.procedure).toBeDefined();
			expect(session.metadata.procedure.procedureName).toBe(
				"orchestrator-full",
			);
		});

		it("should use AI routing when Orchestrator label is NOT present", async () => {
			// Arrange - Create issue WITHOUT Orchestrator label
			const issueWithoutLabel: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "This is a test issue",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [], // No labels
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody =
				"Please implement a new feature with full testing and documentation";

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithoutLabel,
			);

			// Assert
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			const procedureCallArgs =
				mockAgentSessionManager.postProcedureSelectionThought.mock.calls[0];

			// Should NOT use orchestrator-full (will use AI routing)
			expect(procedureCallArgs[1]).not.toBe("orchestrator-full");

			// Verify the console log indicates AI routing was used
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("AI routing decision"),
			);
		});

		it("should consistently use orchestrator-full even with builder-like prompts when Orchestrator label is present", async () => {
			// Arrange - Create issue WITH Orchestrator label
			const issueWithLabel: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue with Orchestrator",
				description: "This is an orchestrator issue",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [{ id: "label-1", name: "Orchestrator", color: "#ff0000" }],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			// This is a builder-like prompt that might trigger AI to classify as builder
			const promptBody =
				"Please implement this feature with full tests and documentation. Create a PR when done.";

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithLabel,
			);

			// Assert
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			const procedureCallArgs =
				mockAgentSessionManager.postProcedureSelectionThought.mock.calls[0];

			// Should STILL use orchestrator-full despite builder-like prompt
			expect(procedureCallArgs[1]).toBe("orchestrator-full");
			expect(procedureCallArgs[2]).toBe("orchestrator");

			// Verify Orchestrator label override log
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining(
					"Using orchestrator-full procedure due to orchestrator label (skipping AI routing)",
				),
			);
		});

		it("should consistently use orchestrator-full when receiving child agent results", async () => {
			// Arrange - Create issue WITH lowercase orchestrator label
			const issueWithLabel: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue with Orchestrator",
				description: "This is an orchestrator issue",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [{ id: "label-1", name: "orchestrator", color: "#ff0000" }], // lowercase
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			// Simulating a child agent posting results - this was the problematic case
			const promptBody = `## Summary

Work completed on subtask TEST-124.

## Status

✅ Complete - PR created at https://github.com/org/repo/pull/123`;

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithLabel,
			);

			// Assert
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			const procedureCallArgs =
				mockAgentSessionManager.postProcedureSelectionThought.mock.calls[0];

			// Should use orchestrator-full, NOT switch to builder based on the summary content
			expect(procedureCallArgs[1]).toBe("orchestrator-full");
			expect(procedureCallArgs[2]).toBe("orchestrator");

			// Verify Orchestrator label override was used
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining(
					"Using orchestrator-full procedure due to orchestrator label (skipping AI routing)",
				),
			);
		});

		it("should handle non-existent label gracefully", async () => {
			// Arrange - Create issue with a non-matching label
			const issueWithDifferentLabel: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [{ id: "label-1", name: "Bug", color: "#ff0000" }], // Different label
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Test comment";

			// Act - Should not throw
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithDifferentLabel,
			);

			// Assert - Should fall back to AI routing without errors
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("AI routing decision"),
			);
		});

		it("should prioritize first matching label from configured variants", async () => {
			// Arrange - Create issue with multiple labels including orchestrator variant
			const issueWithMultipleLabels: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [
					{ id: "label-1", name: "Bug", color: "#ff0000" },
					{ id: "label-2", name: "orchestrator", color: "#00ff00" }, // lowercase variant
					{ id: "label-3", name: "Feature", color: "#0000ff" },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Test comment";

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithMultipleLabels,
			);

			// Assert - Should recognize orchestrator variant
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			const procedureCallArgs =
				mockAgentSessionManager.postProcedureSelectionThought.mock.calls[0];
			expect(procedureCallArgs[1]).toBe("orchestrator-full");
			expect(procedureCallArgs[2]).toBe("orchestrator");
		});

		it("should handle multiple matching labels with precedence", async () => {
			// Arrange - Issue with both Orchestrator variants
			const issueWithBothVariants: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [
					{ id: "label-1", name: "Orchestrator", color: "#ff0000" },
					{ id: "label-2", name: "orchestrator", color: "#00ff00" },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Test comment";

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithBothVariants,
			);

			// Assert - Should use orchestrator-full
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			const procedureCallArgs =
				mockAgentSessionManager.postProcedureSelectionThought.mock.calls[0];
			expect(procedureCallArgs[1]).toBe("orchestrator-full");
			expect(procedureCallArgs[2]).toBe("orchestrator");
		});

		it("should return original procedure when no matching labels found", async () => {
			// Arrange - Issue with no matching labels
			const issueWithNoMatchingLabels: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [
					{ id: "label-1", name: "Bug", color: "#ff0000" },
					{ id: "label-2", name: "Feature", color: "#00ff00" },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Test comment";

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithNoMatchingLabels,
			);

			// Assert - Should use AI routing
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("AI routing decision"),
			);
		});

		it("should handle label fetch errors gracefully and fall back to AI routing", async () => {
			// Arrange - Pass undefined issue (simulating fetch error)
			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Test comment";

			// Act - Pass undefined as issue to simulate error
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				undefined, // Simulate error scenario
			);

			// Assert - Should fall back to AI routing without crashing
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
		});

		it("should work with different Orchestrator label variants from config", async () => {
			// Arrange - Create issue with "orchestrator" (lowercase)
			const issueWithLowercaseLabel: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [{ id: "label-1", name: "orchestrator", color: "#ff0000" }], // lowercase
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Test comment";

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithLowercaseLabel,
			);

			// Assert
			expect(
				mockAgentSessionManager.postProcedureSelectionThought,
			).toHaveBeenCalled();
			const procedureCallArgs =
				mockAgentSessionManager.postProcedureSelectionThought.mock.calls[0];

			// Should recognize lowercase "orchestrator" from config
			expect(procedureCallArgs[1]).toBe("orchestrator-full");
			expect(procedureCallArgs[2]).toBe("orchestrator");
		});

		it("should skip AI routing entirely when Orchestrator label is present", async () => {
			// Arrange - Create issue WITH Orchestrator label
			const issueWithLabel: Issue = {
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				branchName: "test-branch",
				state: { id: "state-1", name: "In Progress", type: "started" },
				team: { id: "team-123", key: "TEST", name: "Test Team" },
				labels: [{ id: "label-1", name: "Orchestrator", color: "#ff0000" }],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const session: any = {
				linearAgentActivitySessionId: "agent-session-123",
				issueId: "issue-123",
				workspace: { path: "/test/workspaces/TEST-123", isGitWorktree: false },
				metadata: {},
			};

			const promptBody = "Test comment";

			// Act
			await (edgeWorker as any).rerouteProcedureForSession(
				session,
				"agent-session-123",
				mockAgentSessionManager,
				promptBody,
				mockRepository,
				issueWithLabel,
			);

			// Assert - Should NOT see AI routing decision logs
			const allLogCalls = (console.log as any).mock.calls.map(
				(call: any[]) => call[0],
			);

			// Should NOT have any AI routing logs
			const hasAIRoutingLogs = allLogCalls.some((msg: string) =>
				msg.includes("AI routing decision"),
			);
			expect(hasAIRoutingLogs).toBe(false);

			// SHOULD have the Orchestrator label override log
			const hasOrchestratorOverrideLog = allLogCalls.some((msg: string) =>
				msg.includes(
					"Using orchestrator-full procedure due to orchestrator label (skipping AI routing)",
				),
			);
			expect(hasOrchestratorOverrideLog).toBe(true);
		});
	});
});
