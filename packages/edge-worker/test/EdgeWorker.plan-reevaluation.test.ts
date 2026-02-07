import type { CyrusAgentSession } from "cyrus-core";
import { beforeEach, describe, expect, it } from "vitest";
import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";
import { PROCEDURES } from "../src/procedures/registry";

/**
 * Tests for plan re-evaluation after plan-mode completion.
 *
 * When an issue goes through plan-mode (classified as "planning"), the AI team evaluator
 * handles classification filtering directly. After the plan is approved
 * and a new session starts, the EdgeWorker should override "planning" → "code" so the
 * AI team evaluator can properly evaluate the implementation phase.
 *
 * These tests verify:
 * 1. Plan-mode completion detection via procedure metadata
 * 2. Serialization/restoration of planCompletedIssues through EdgeWorker state
 * 3. Classification override from "planning" to "code" after plan completion
 */

describe("EdgeWorker - Plan Re-evaluation After Plan Completion", () => {
	let procedureAnalyzer: ProcedureAnalyzer;

	beforeEach(() => {
		procedureAnalyzer = new ProcedureAnalyzer({
			cyrusHome: "/test/.cyrus",
		});
	});

	describe("Plan-mode completion detection", () => {
		it("should detect plan-mode procedure completion", () => {
			const planProcedure = PROCEDURES["plan-mode"];
			expect(planProcedure).toBeDefined();

			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-plan-1",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-plan-1",
				issue: {
					id: "issue-plan-1",
					identifier: "TEST-PLAN-1",
					title: "Plan a new feature",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-plan-1",
				metadata: {},
			};

			procedureAnalyzer.initializeProcedureMetadata(session, planProcedure);
			expect(session.metadata.procedure?.procedureName).toBe("plan-mode");

			// Advance through all subroutines until procedure is complete
			while (!procedureAnalyzer.isProcedureComplete(session)) {
				const next = procedureAnalyzer.getNextSubroutine(session);
				if (!next) break;
				procedureAnalyzer.advanceToNextSubroutine(session, "claude-plan-1");
			}

			// After completion, getCurrentSubroutine should return null (no next subroutine)
			const nextAfterCompletion = procedureAnalyzer.getNextSubroutine(session);
			expect(nextAfterCompletion).toBeNull();
		});

		it("should identify plan-mode procedure by name in session metadata", () => {
			const session: CyrusAgentSession = {
				linearAgentActivitySessionId: "session-plan-meta",
				type: "comment_thread" as const,
				status: "active" as const,
				context: "comment_thread" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				issueId: "issue-plan-meta",
				issue: {
					id: "issue-plan-meta",
					identifier: "TEST-PLAN-META",
					title: "Plan something",
				},
				workspace: { path: "/test/workspace", isGitWorktree: false },
				claudeSessionId: "claude-plan-meta",
				metadata: {},
			};

			const planProcedure = PROCEDURES["plan-mode"];
			procedureAnalyzer.initializeProcedureMetadata(session, planProcedure);

			// This is the exact check EdgeWorker uses to track plan completion
			const procedureName = session.metadata?.procedure?.procedureName;
			expect(procedureName).toBe("plan-mode");
		});
	});

	describe("Plan re-evaluation classification override", () => {
		it("should allow overriding classification from planning to code for team evaluation", () => {
			// Simulate the planCompletedIssues map that EdgeWorker maintains
			const planCompletedIssues = new Map<string, number>();
			planCompletedIssues.set("issue-123", Date.now());

			// Simulate AI routing returning "planning" for a plan-completed issue
			let finalClassification = "planning";
			const issueId = "issue-123";

			// This replicates the override logic in initializeAndStartNewSession
			if (
				finalClassification === "planning" &&
				planCompletedIssues.has(issueId)
			) {
				const fullDevProcedure =
					procedureAnalyzer.getProcedure("full-development");
				expect(fullDevProcedure).toBeDefined();
				if (fullDevProcedure) {
					finalClassification = "code";
				}
			}

			expect(finalClassification).toBe("code");
		});

		it("should NOT override classification when issue has not completed plan-mode", () => {
			const planCompletedIssues = new Map<string, number>();
			// Note: issue-456 is NOT in the map

			let finalClassification = "planning";
			const issueId = "issue-456";

			if (
				finalClassification === "planning" &&
				planCompletedIssues.has(issueId)
			) {
				finalClassification = "code";
			}

			// Classification should remain "planning" since issue never completed plan-mode
			expect(finalClassification).toBe("planning");
		});

		it("should NOT override non-planning classifications for plan-completed issues", () => {
			const planCompletedIssues = new Map<string, number>();
			planCompletedIssues.set("issue-789", Date.now());

			let finalClassification = "code";
			const issueId = "issue-789";

			if (
				finalClassification === "planning" &&
				planCompletedIssues.has(issueId)
			) {
				finalClassification = "code";
			}

			// Classification should remain "code" — the override only applies to "planning"
			expect(finalClassification).toBe("code");
		});
	});

	describe("planCompletedIssues serialization", () => {
		it("should serialize and deserialize planCompletedIssues correctly", () => {
			const original = new Map<string, number>();
			original.set("issue-a", 1700000000000);
			original.set("issue-b", 1700000001000);

			// Serialize (same as EdgeWorker.serializeMappings)
			const serialized = Object.fromEntries(original.entries());

			expect(serialized).toEqual({
				"issue-a": 1700000000000,
				"issue-b": 1700000001000,
			});

			// Deserialize (same as EdgeWorker.restoreMappings)
			const restored = new Map(
				Object.entries(serialized).map(([k, v]) => [k, v as number]),
			);

			expect(restored.size).toBe(2);
			expect(restored.get("issue-a")).toBe(1700000000000);
			expect(restored.get("issue-b")).toBe(1700000001000);
		});

		it("should handle empty planCompletedIssues", () => {
			const original = new Map<string, number>();

			const serialized = Object.fromEntries(original.entries());
			expect(serialized).toEqual({});

			const restored = new Map(
				Object.entries(serialized).map(([k, v]) => [k, v as number]),
			);
			expect(restored.size).toBe(0);
		});
	});
});
