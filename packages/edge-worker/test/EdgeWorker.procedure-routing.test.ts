import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcedureRouter } from "../src/procedures/ProcedureRouter";
import { PROCEDURES, SUBROUTINES } from "../src/procedures/registry";

describe("EdgeWorker - Procedure Routing", () => {
	let procedureRouter: ProcedureRouter;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Create a standalone ProcedureRouter for testing
		procedureRouter = new ProcedureRouter({
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
			procedureRouter.initializeProcedureMetadata(session, fullDevProcedure);

			// Verify initial state
			expect(session.metadata.procedure.procedureName).toBe("full-development");
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(0);

			// Simulate completing primary subroutine
			procedureRouter.advanceToNextSubroutine(session, null);
			expect(procedureRouter.isProcedureComplete(session)).toBe(false); // Not complete yet
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(1);

			// Simulate completing verifications subroutine
			procedureRouter.advanceToNextSubroutine(session, null);
			expect(procedureRouter.isProcedureComplete(session)).toBe(false);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(2);

			// Simulate completing git-gh subroutine - advances to last subroutine
			procedureRouter.advanceToNextSubroutine(session, null);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(3);
			expect(procedureRouter.isProcedureComplete(session)).toBe(true); // At last subroutine, no next
		});

		it("should execute all subroutines in sequence for documentation-edit procedure", async () => {
			const docEditProcedure = PROCEDURES["documentation-edit"];
			const session = { metadata: {} } as any;

			// Initialize procedure metadata
			procedureRouter.initializeProcedureMetadata(session, docEditProcedure);

			// Verify initial state
			expect(session.metadata.procedure.procedureName).toBe(
				"documentation-edit",
			);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(0);

			// Complete primary
			procedureRouter.advanceToNextSubroutine(session, null);
			expect(procedureRouter.isProcedureComplete(session)).toBe(false);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(1);

			// Complete git-gh - advances to last subroutine
			procedureRouter.advanceToNextSubroutine(session, null);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(2);
			expect(procedureRouter.isProcedureComplete(session)).toBe(true); // At last subroutine, no next
		});

		it("should execute all subroutines in sequence for simple-question procedure", async () => {
			const simpleQuestionProcedure = PROCEDURES["simple-question"];
			const session = { metadata: {} } as any;

			// Initialize procedure metadata
			procedureRouter.initializeProcedureMetadata(
				session,
				simpleQuestionProcedure,
			);

			// Verify initial state
			expect(session.metadata.procedure.procedureName).toBe("simple-question");
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(0);

			// Complete primary - advances to last subroutine
			procedureRouter.advanceToNextSubroutine(session, null);
			expect(session.metadata.procedure.currentSubroutineIndex).toBe(1);
			expect(procedureRouter.isProcedureComplete(session)).toBe(true); // At last subroutine, no next
		});

		it("should get current subroutine correctly at each step", async () => {
			const fullDevProcedure = PROCEDURES["full-development"];
			const session = { metadata: {} } as any;

			procedureRouter.initializeProcedureMetadata(session, fullDevProcedure);

			// Check each subroutine
			expect(procedureRouter.getCurrentSubroutine(session)?.name).toBe(
				"primary",
			);

			procedureRouter.advanceToNextSubroutine(session, null);
			expect(procedureRouter.getCurrentSubroutine(session)?.name).toBe(
				"verifications",
			);

			procedureRouter.advanceToNextSubroutine(session, null);
			expect(procedureRouter.getCurrentSubroutine(session)?.name).toBe(
				"git-gh",
			);

			procedureRouter.advanceToNextSubroutine(session, null);
			expect(procedureRouter.getCurrentSubroutine(session)?.name).toBe(
				"verbose-summary",
			);

			procedureRouter.advanceToNextSubroutine(session, null);
			expect(procedureRouter.getCurrentSubroutine(session)).toBeNull();
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

		it("should suppress thoughts/actions but not responses during concise-summary", async () => {
			const session = { metadata: {} } as any;
			const simpleQuestionProcedure = PROCEDURES["simple-question"];

			// Initialize with simple-question procedure (ends with concise-summary)
			procedureRouter.initializeProcedureMetadata(
				session,
				simpleQuestionProcedure,
			);

			// Advance to concise-summary subroutine
			procedureRouter.advanceToNextSubroutine(session, null);

			// Get current subroutine
			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("concise-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true);
		});

		it("should suppress thoughts/actions but not responses during verbose-summary", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			// Initialize with full-development procedure (ends with verbose-summary)
			procedureRouter.initializeProcedureMetadata(session, fullDevProcedure);

			// Advance to verbose-summary subroutine (skip 3 subroutines)
			procedureRouter.advanceToNextSubroutine(session, null); // primary -> verifications
			procedureRouter.advanceToNextSubroutine(session, null); // verifications -> git-gh
			procedureRouter.advanceToNextSubroutine(session, null); // git-gh -> verbose-summary

			// Get current subroutine
			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("verbose-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true);
		});

		it("should NOT suppress during primary subroutine", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			procedureRouter.initializeProcedureMetadata(session, fullDevProcedure);

			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("primary");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();
		});

		it("should NOT suppress during verifications subroutine", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			procedureRouter.initializeProcedureMetadata(session, fullDevProcedure);
			procedureRouter.advanceToNextSubroutine(session, null);

			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("verifications");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();
		});

		it("should NOT suppress during git-gh subroutine", async () => {
			const session = { metadata: {} } as any;
			const fullDevProcedure = PROCEDURES["full-development"];

			procedureRouter.initializeProcedureMetadata(session, fullDevProcedure);
			procedureRouter.advanceToNextSubroutine(session, null);
			procedureRouter.advanceToNextSubroutine(session, null);

			const currentSubroutine = procedureRouter.getCurrentSubroutine(session);

			expect(currentSubroutine?.name).toBe("git-gh");
			expect(currentSubroutine?.suppressThoughtPosting).toBeUndefined();
		});
	});
});
