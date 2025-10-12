import type { CyrusAgentSession } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import { ProcedureRouter } from "../src/procedures/ProcedureRouter";
import { PROCEDURES } from "../src/procedures/registry";

/**
 * Integration tests for procedure routing as used by EdgeWorker and AgentSessionManager
 * These tests verify the actual flow of procedure routing in production
 */

describe("EdgeWorker - Procedure Routing Integration", () => {
	let procedureRouter: ProcedureRouter;
	let agentSessionManager: AgentSessionManager;
	let mockLinearClient: any;

	beforeEach(() => {
		// Create ProcedureRouter
		procedureRouter = new ProcedureRouter({
			cyrusHome: "/test/.cyrus",
		});

		// Create minimal mock Linear client
		mockLinearClient = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-123" }),
			}),
		};

		// Create AgentSessionManager with procedure router
		agentSessionManager = new AgentSessionManager(
			mockLinearClient,
			undefined, // getParentSessionId
			undefined, // resumeParentSession
			undefined, // resumeNextSubroutine
			procedureRouter,
		);
	});

	describe("Full Workflow: Procedure Execution → Completion", () => {
		it("should handle full-development procedure end-to-end", async () => {
			// Step 1: Use full-development procedure directly (skip AI classification for deterministic tests)
			const fullDevProcedure = PROCEDURES["full-development"];

			// Step 2: EdgeWorker creates session and initializes procedure metadata
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-123",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-123",
				issue: {
					id: "issue-123",
					identifier: "TEST-1",
					title: "Test Issue",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-123",
				metadata: {},
			};

			procedureRouter.initializeProcedureMetadata(session, fullDevProcedure);

			// Verify initial state
			expect(session.metadata.procedure).toBeDefined();
			expect(session.metadata.procedure?.procedureName).toBe(
				"full-development",
			);
			expect(session.metadata.procedure?.currentSubroutineIndex).toBe(0);

			// Step 3: Execute primary subroutine (manually simulated completion)
			let currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("primary");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();

			// Step 4: Primary completes, AgentSessionManager checks for next subroutine
			let nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine).toBeDefined();
			expect(nextSubroutine?.name).toBe("verifications");

			// Step 5: AgentSessionManager advances to next subroutine
			procedureRouter.advanceToNextSubroutine(session, "claude-123");
			expect(session.metadata.procedure?.currentSubroutineIndex).toBe(1);

			// Step 6: Execute verifications subroutine
			currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("verifications");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();

			// Step 7: Verifications completes, advance to git-gh
			nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine?.name).toBe("git-gh");
			procedureRouter.advanceToNextSubroutine(session, "claude-123");

			// Step 8: Execute git-gh subroutine
			currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("git-gh");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();

			// Step 9: git-gh completes, advance to verbose-summary (last subroutine)
			nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine?.name).toBe("verbose-summary");
			procedureRouter.advanceToNextSubroutine(session, "claude-123");

			// Step 10: Execute verbose-summary (with thought suppression!)
			currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("verbose-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true); // Suppression active!

			// Step 11: Check that we're at the last subroutine
			nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine).toBeNull(); // No more subroutines
			expect(procedureRouter.isProcedureComplete(session)).toBe(true);

			// Verify subroutine history (only 3 recorded because we're still AT verbose-summary)
			// History only records completed subroutines when advancing AWAY from them
			expect(session.metadata.procedure?.subroutineHistory).toHaveLength(3);
			expect(session.metadata.procedure?.subroutineHistory[0].subroutine).toBe(
				"primary",
			);
			expect(session.metadata.procedure?.subroutineHistory[1].subroutine).toBe(
				"verifications",
			);
			expect(session.metadata.procedure?.subroutineHistory[2].subroutine).toBe(
				"git-gh",
			);
			// verbose-summary is NOT yet in history because we haven't advanced away from it
		});

		it("should handle documentation-edit procedure with correct suppressions", async () => {
			// Step 1: Use documentation-edit procedure directly (skip AI classification)
			const docEditProcedure = PROCEDURES["documentation-edit"];

			// Step 2: Create and initialize session
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-456",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-456",
				issue: {
					id: "issue-456",
					identifier: "TEST-2",
					title: "Update README",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-456",
				metadata: {},
			};

			procedureRouter.initializeProcedureMetadata(session, docEditProcedure);

			// Step 3: Execute primary (no suppression)
			let currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("primary");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();

			// Step 4: Advance to git-gh (no suppression)
			let nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine?.name).toBe("git-gh");
			procedureRouter.advanceToNextSubroutine(session, "claude-456");

			currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("git-gh");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();

			// Step 5: Advance to concise-summary (WITH suppression)
			nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine?.name).toBe("concise-summary");
			procedureRouter.advanceToNextSubroutine(session, "claude-456");

			currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("concise-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true); // Suppression!

			// Step 6: Procedure complete
			nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine).toBeNull();
			expect(procedureRouter.isProcedureComplete(session)).toBe(true);
		});

		it("should handle simple-question procedure with minimal workflow", async () => {
			// Step 1: Use simple-question procedure directly (skip AI classification)
			const simpleQuestionProcedure = PROCEDURES["simple-question"];

			// Step 2: Create and initialize session
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-789",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-789",
				issue: {
					id: "issue-789",
					identifier: "TEST-3",
					title: "Test Coverage Question",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-789",
				metadata: {},
			};

			procedureRouter.initializeProcedureMetadata(
				session,
				simpleQuestionProcedure,
			);

			// Step 3: Execute primary (no suppression)
			let currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("primary");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();

			// Step 4: Advance to concise-summary (WITH suppression)
			let nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine?.name).toBe("concise-summary");
			procedureRouter.advanceToNextSubroutine(session, "claude-789");

			currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("concise-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true);

			// Step 5: Procedure complete
			nextSubroutine = procedureRouter.getNextSubroutine(session);
			expect(nextSubroutine).toBeNull();
			expect(procedureRouter.isProcedureComplete(session)).toBe(true);
		});
	});

	describe("Thought/Action Suppression in AgentSessionManager", () => {
		it("should suppress thoughts during concise-summary subroutine", async () => {
			// Create a session already at concise-summary
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-suppress-1",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-suppress-1",
				issue: {
					id: "issue-suppress-1",
					identifier: "TEST-SUPPRESS-1",
					title: "Test Suppression",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-suppress-1",
				metadata: {
					procedure: {
						procedureName: "simple-question",
						currentSubroutineIndex: 1, // concise-summary
						subroutineHistory: [],
					},
				},
			};

			// Register session with AgentSessionManager
			agentSessionManager.sessions.set("session-suppress-1", session as any);

			// Verify suppression is active
			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("concise-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true);

			// The AgentSessionManager.syncEntryToLinear method checks this flag
			// and skips posting thoughts/actions when suppressThoughtPosting is true
		});

		it("should NOT suppress thoughts during primary subroutine", async () => {
			// Create a session at primary
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-no-suppress",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-no-suppress",
				issue: {
					id: "issue-no-suppress",
					identifier: "TEST-NO-SUPPRESS",
					title: "Test No Suppression",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-no-suppress",
				metadata: {
					procedure: {
						procedureName: "full-development",
						currentSubroutineIndex: 0, // primary
						subroutineHistory: [],
					},
				},
			};

			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("primary");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();
		});
	});

	describe("Procedure State Reset for New Issues", () => {
		it("should initialize fresh procedure metadata for each new session", async () => {
			// First session
			const session1: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-1",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-1",
				issue: {
					id: "issue-1",
					identifier: "TEST-1",
					title: "First Issue",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-1",
				metadata: {},
			};

			const procedure1 = PROCEDURES["full-development"];
			procedureRouter.initializeProcedureMetadata(session1, procedure1);

			// Advance through some subroutines
			procedureRouter.advanceToNextSubroutine(session1, "claude-1");
			procedureRouter.advanceToNextSubroutine(session1, "claude-1");

			expect(session1.metadata.procedure?.currentSubroutineIndex).toBe(2);
			expect(session1.metadata.procedure?.subroutineHistory).toHaveLength(2);

			// Second session (simulating new issue/comment)
			const session2: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-2",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-2",
				issue: {
					id: "issue-2",
					identifier: "TEST-2",
					title: "Second Issue",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-2",
				metadata: {},
			};

			const procedure2 = PROCEDURES["simple-question"];
			procedureRouter.initializeProcedureMetadata(session2, procedure2);

			// Verify session2 has fresh state
			expect(session2.metadata.procedure?.procedureName).toBe(
				"simple-question",
			);
			expect(session2.metadata.procedure?.currentSubroutineIndex).toBe(0);
			expect(session2.metadata.procedure?.subroutineHistory).toHaveLength(0);

			// Verify session1 state is unchanged
			expect(session1.metadata.procedure?.currentSubroutineIndex).toBe(2);
			expect(session1.metadata.procedure?.subroutineHistory).toHaveLength(2);
		});
	});

	describe("Procedure Routing on New Comments", () => {
		it("should route fresh procedure for each new comment in same session", async () => {
			// Simulate an existing session that has a procedure already running
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-routing-test",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-routing",
				issue: {
					id: "issue-routing",
					identifier: "TEST-ROUTING",
					title: "Test Routing",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-routing",
				metadata: {
					procedure: {
						procedureName: "full-development",
						currentSubroutineIndex: 2, // Mid-procedure
						subroutineHistory: [
							{
								subroutine: "primary",
								completedAt: Date.now(),
								claudeSessionId: "claude-routing",
							},
							{
								subroutine: "verifications",
								completedAt: Date.now(),
								claudeSessionId: "claude-routing",
							},
						],
					},
				},
			};

			// Verify initial state
			expect(session.metadata.procedure?.procedureName).toBe(
				"full-development",
			);
			expect(session.metadata.procedure?.currentSubroutineIndex).toBe(2);
			expect(session.metadata.procedure?.subroutineHistory).toHaveLength(2);

			// Now simulate a new comment arriving (EdgeWorker would route this)
			// In the new behavior, initializeProcedureMetadata is called again
			const newProcedure = PROCEDURES["simple-question"];
			procedureRouter.initializeProcedureMetadata(session, newProcedure);

			// Verify procedure was reset to the new one
			expect(session.metadata.procedure?.procedureName).toBe("simple-question");
			expect(session.metadata.procedure?.currentSubroutineIndex).toBe(0);
			expect(session.metadata.procedure?.subroutineHistory).toHaveLength(0);

			// This demonstrates that each new comment gets fresh procedure routing
			// rather than continuing the old procedure
		});
	});

	describe("Error Handling", () => {
		it("should handle errors during procedure execution gracefully", () => {
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-error",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-error",
				issue: {
					id: "issue-error",
					identifier: "TEST-ERROR",
					title: "Error Test",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-error",
				metadata: {},
			};

			// Attempting to get current subroutine without initialization should return null
			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);
			expect(currentSubroutine).toBeNull();

			// Attempting to advance without initialization should throw
			expect(() => {
				procedureRouter.advanceToNextSubroutine(session, "claude-error");
			}).toThrow("Cannot advance: session has no procedure metadata");
		});
	});
});
