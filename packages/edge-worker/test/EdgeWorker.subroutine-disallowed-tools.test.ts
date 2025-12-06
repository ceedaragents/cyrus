/**
 * Tests for subroutine-level disallowedTools functionality
 *
 * Verifies that summary subroutines (concise-summary, verbose-summary,
 * question-answer, plan-summary) properly block Linear comment tools
 * to prevent the agent from getting stuck in maxTurns=1 scenarios.
 */

import type { CyrusAgentSession } from "cyrus-core";
import { beforeEach, describe, expect, it } from "vitest";
import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";
import { PROCEDURES, SUBROUTINES } from "../src/procedures/registry";

describe("EdgeWorker - Subroutine DisallowedTools", () => {
	let procedureAnalyzer: ProcedureAnalyzer;

	beforeEach(() => {
		procedureAnalyzer = new ProcedureAnalyzer({
			cyrusHome: "/test/.cyrus",
		});
	});

	describe("Summary Subroutines Configuration", () => {
		it("should have disallowedTools configured for concise-summary", () => {
			const subroutine = SUBROUTINES.conciseSummary;
			expect(subroutine.disallowedTools).toBeDefined();
			expect(subroutine.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
			expect(subroutine.singleTurn).toBe(true);
			expect(subroutine.suppressThoughtPosting).toBe(true);
		});

		it("should have disallowedTools configured for verbose-summary", () => {
			const subroutine = SUBROUTINES.verboseSummary;
			expect(subroutine.disallowedTools).toBeDefined();
			expect(subroutine.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
			expect(subroutine.singleTurn).toBe(true);
			expect(subroutine.suppressThoughtPosting).toBe(true);
		});

		it("should have disallowedTools configured for question-answer", () => {
			const subroutine = SUBROUTINES.questionAnswer;
			expect(subroutine.disallowedTools).toBeDefined();
			expect(subroutine.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
			expect(subroutine.singleTurn).toBe(true);
			expect(subroutine.suppressThoughtPosting).toBe(true);
		});

		it("should have disallowedTools configured for plan-summary", () => {
			const subroutine = SUBROUTINES.planSummary;
			expect(subroutine.disallowedTools).toBeDefined();
			expect(subroutine.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
			expect(subroutine.singleTurn).toBe(true);
			expect(subroutine.suppressThoughtPosting).toBe(true);
		});

		it("should NOT have disallowedTools for non-summary subroutines", () => {
			// Verify that regular subroutines don't have disallowedTools
			expect(SUBROUTINES.primary.disallowedTools).toBeUndefined();
			expect(SUBROUTINES.codingActivity.disallowedTools).toBeUndefined();
			expect(SUBROUTINES.verifications.disallowedTools).toBeUndefined();
			expect(SUBROUTINES.gitGh.disallowedTools).toBeUndefined();
			expect(SUBROUTINES.questionInvestigation.disallowedTools).toBeUndefined();
			expect(SUBROUTINES.preparation.disallowedTools).toBeUndefined();
		});
	});

	describe("Procedure Integration", () => {
		it("should expose disallowedTools when at concise-summary subroutine in full-development procedure", () => {
			const procedure = PROCEDURES["full-development"];
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

			procedureAnalyzer.initializeProcedureMetadata(session, procedure);

			// Advance to concise-summary (last subroutine)
			// full-development: coding-activity → verifications → git-gh → concise-summary
			procedureAnalyzer.advanceToNextSubroutine(session, "claude-123"); // Move to verifications
			procedureAnalyzer.advanceToNextSubroutine(session, "claude-123"); // Move to git-gh
			procedureAnalyzer.advanceToNextSubroutine(session, "claude-123"); // Move to concise-summary

			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("concise-summary");
			expect(currentSubroutine?.disallowedTools).toBeDefined();
			expect(currentSubroutine?.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
		});

		it("should expose disallowedTools when at verbose-summary subroutine", () => {
			// Create a custom procedure with verbose-summary for testing
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
					title: "Test Issue",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-456",
				metadata: {
					procedure: {
						procedureName: "test-verbose",
						currentSubroutineIndex: 0,
						subroutineHistory: [],
					},
				},
			};

			// Manually register a procedure with verbose-summary
			procedureAnalyzer.registerProcedure({
				name: "test-verbose",
				description: "Test procedure with verbose summary",
				subroutines: [SUBROUTINES.verboseSummary],
			});

			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("verbose-summary");
			expect(currentSubroutine?.disallowedTools).toBeDefined();
			expect(currentSubroutine?.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
		});

		it("should expose disallowedTools for question-answer in simple-question procedure", () => {
			const procedure = PROCEDURES["simple-question"];
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
					title: "Test Question",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-789",
				metadata: {},
			};

			procedureAnalyzer.initializeProcedureMetadata(session, procedure);

			// simple-question: question-investigation → question-answer
			procedureAnalyzer.advanceToNextSubroutine(session, "claude-789"); // Move to question-answer

			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("question-answer");
			expect(currentSubroutine?.disallowedTools).toBeDefined();
			expect(currentSubroutine?.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
		});

		it("should expose disallowedTools for plan-summary in plan-mode procedure", () => {
			const procedure = PROCEDURES["plan-mode"];
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-101",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-101",
				issue: {
					id: "issue-101",
					identifier: "TEST-4",
					title: "Test Planning",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-101",
				metadata: {},
			};

			procedureAnalyzer.initializeProcedureMetadata(session, procedure);

			// plan-mode: preparation → plan-summary
			procedureAnalyzer.advanceToNextSubroutine(session, "claude-101"); // Move to plan-summary

			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("plan-summary");
			expect(currentSubroutine?.disallowedTools).toBeDefined();
			expect(currentSubroutine?.disallowedTools).toContain(
				"mcp__linear__create_comment",
			);
		});

		it("should NOT expose disallowedTools for non-summary subroutines", () => {
			const procedure = PROCEDURES["full-development"];
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-202",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-202",
				issue: {
					id: "issue-202",
					identifier: "TEST-5",
					title: "Test Issue",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-202",
				metadata: {},
			};

			procedureAnalyzer.initializeProcedureMetadata(session, procedure);

			// Check coding-activity (first subroutine)
			let currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("coding-activity");
			expect(currentSubroutine?.disallowedTools).toBeUndefined();

			// Advance to verifications
			procedureAnalyzer.advanceToNextSubroutine(session, "claude-202");
			currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("verifications");
			expect(currentSubroutine?.disallowedTools).toBeUndefined();

			// Advance to git-gh
			procedureAnalyzer.advanceToNextSubroutine(session, "claude-202");
			currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("git-gh");
			expect(currentSubroutine?.disallowedTools).toBeUndefined();
		});
	});

	describe("Type Definitions", () => {
		it("should support disallowedTools in SubroutineDefinition type", () => {
			// This is a compile-time test - if this compiles, the type supports disallowedTools
			const testSubroutine: typeof SUBROUTINES.conciseSummary = {
				name: "test-subroutine",
				promptPath: "test/path.md",
				singleTurn: true,
				description: "Test subroutine",
				suppressThoughtPosting: true,
				disallowedTools: ["mcp__linear__create_comment", "some_other_tool"],
			};

			expect(testSubroutine.disallowedTools).toBeDefined();
			expect(testSubroutine.disallowedTools?.length).toBe(2);
		});
	});
});
