import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";
import { PROCEDURES, SUBROUTINES } from "../src/procedures/registry";

describe("EdgeWorker - Procedure Routing", () => {
	let procedureAnalyzer: ProcedureAnalyzer;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Create a standalone ProcedureAnalyzer for testing
		procedureAnalyzer = new ProcedureAnalyzer({
			cyrusHome: "/test/.cyrus",
		});
	});

	describe("Subroutine Execution Flow", () => {
		it("should execute all subroutines in sequence for full-development procedure", async () => {
			const fullDevProcedure = PROCEDURES["full-development"];
			const session: any = {
				metadata: {},
			};

			// Initialize procedure metadata
			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Verify initial state
			expect(session.metadata.procedure.procedureName).toBe("full-development");
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(0);

			// Simulate completing primary subroutine
			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(procedureAnalyzer.isProcedureComplete(session)).toBe(false); // Not complete yet
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(1);

			// Simulate completing verifications subroutine
			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(procedureAnalyzer.isProcedureComplete(session)).toBe(false);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(2);

			// Simulate completing git-gh subroutine - advances to last subroutine
			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(3);
			expect(procedureAnalyzer.isProcedureComplete(session)).toBe(true); // At last subroutine, no next
		});

		it("should execute all subroutines in sequence for documentation-edit procedure", async () => {
			const docEditProcedure = PROCEDURES["documentation-edit"];
			const session = { metadata: {} } as any;

			// Initialize procedure metadata
			procedureAnalyzer.initializeProcedureMetadata(session, docEditProcedure);

			// Verify initial state
			expect(session.metadata.procedure.procedureName).toBe(
				"documentation-edit",
			);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(0);

			// Complete primary
			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(procedureAnalyzer.isProcedureComplete(session)).toBe(false);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(1);

			// Complete git-gh - advances to last subroutine
			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(2);
			expect(procedureAnalyzer.isProcedureComplete(session)).toBe(true); // At last subroutine, no next
		});

		it("should execute all subroutines in sequence for simple-question procedure", async () => {
			const simpleQuestionProcedure = PROCEDURES["simple-question"];
			const session = { metadata: {} } as any;

			// Initialize procedure metadata
			procedureAnalyzer.initializeProcedureMetadata(
				session,
				simpleQuestionProcedure,
			);

			// Verify initial state
			expect(session.metadata.procedure.procedureName).toBe("simple-question");
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(0);

			// Complete primary - advances to last subroutine
			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(1);
			expect(procedureAnalyzer.isProcedureComplete(session)).toBe(true); // At last subroutine, no next
		});

		it("should get current subroutine correctly at each step", async () => {
			const fullDevProcedure = PROCEDURES["full-development"];
			const session = { metadata: {} } as any;

			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Check each subroutine
			expect(procedureAnalyzer.getCurrentSubroutine(session)?.name).toBe(
				"coding-activity",
			);

			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(procedureAnalyzer.getCurrentSubroutine(session)?.name).toBe(
				"verifications",
			);

			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(procedureAnalyzer.getCurrentSubroutine(session)?.name).toBe(
				"git-gh",
			);

			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(procedureAnalyzer.getCurrentSubroutine(session)?.name).toBe(
				"concise-summary",
			);

			procedureAnalyzer.advanceToNextSubroutine(session, null);
			expect(procedureAnalyzer.getCurrentSubroutine(session)).toBeNull();
		});
	});

	describe("suppressThoughtPosting Flag", () => {
		it("should have suppressThoughtPosting enabled ONLY on concise-summary", () => {
			expect(SUBROUTINES.conciseSummary.suppressThoughtPosting).toBe(true);
		});

		it("should have suppressThoughtPosting enabled ONLY on verbose-summary", () => {
			expect(SUBROUTINES.verboseSummary.suppressThoughtPosting).toBe(true);
		});

		it("should NOT have suppressThoughtPosting on primary subroutine", () => {
			expect(SUBROUTINES.primary.suppressThoughtPosting).toBeUndefined();
		});

		it("should NOT have suppressThoughtPosting on verifications subroutine", () => {
			expect(SUBROUTINES.verifications.suppressThoughtPosting).toBeUndefined();
		});

		it("should NOT have suppressThoughtPosting on git-gh subroutine", () => {
			expect(SUBROUTINES.gitGh.suppressThoughtPosting).toBeUndefined();
		});

		it("should suppress thoughts/actions but not responses during question-answer", async () => {
			const session = { metadata: {} } as any;
			const simpleQuestionProcedure = PROCEDURES["simple-question"];

			// Initialize with simple-question procedure (ends with question-answer)
			procedureAnalyzer.initializeProcedureMetadata(
				session,
				simpleQuestionProcedure,
			);

			// Advance to question-answer subroutine
			procedureAnalyzer.advanceToNextSubroutine(session, null);

			// Get current subroutine
			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("question-answer");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true);
		});

		it("should suppress thoughts/actions but not responses during concise-summary in full-development", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			// Initialize with full-development procedure (ends with concise-summary)
			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Advance to concise-summary subroutine (skip 3 subroutines)
			procedureAnalyzer.advanceToNextSubroutine(session, null); // coding-activity -> verifications
			procedureAnalyzer.advanceToNextSubroutine(session, null); // verifications -> git-gh
			procedureAnalyzer.advanceToNextSubroutine(session, null); // git-gh -> concise-summary

			// Get current subroutine
			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("concise-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true);
		});

		it("should NOT suppress during coding-activity subroutine", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("coding-activity");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();
		});

		it("should NOT suppress during verifications subroutine", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);
			procedureAnalyzer.advanceToNextSubroutine(session, null);

			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("verifications");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();
		});

		it("should NOT suppress during git-gh subroutine", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);
			procedureAnalyzer.advanceToNextSubroutine(session, null);
			procedureAnalyzer.advanceToNextSubroutine(session, null);

			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("git-gh");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();
		});
	});
});
