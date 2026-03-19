import { describe, expect, it } from "vitest";
import type { RequestClassification } from "../../src/procedures/types.js";
import {
	CLASSIFICATION_TO_WORKFLOW,
	getWorkflowForClassification,
} from "../../src/skills/workflows.js";

/**
 * All valid request classifications, used to verify exhaustive coverage.
 */
const ALL_CLASSIFICATIONS: RequestClassification[] = [
	"code",
	"question",
	"documentation",
	"transient",
	"planning",
	"debugger",
	"orchestrator",
	"user-testing",
	"release",
];

describe("Workflow Templates", () => {
	describe("getWorkflowForClassification", () => {
		it("returns the correct workflow for 'code' classification", () => {
			const workflow = getWorkflowForClassification("code");

			expect(workflow.name).toBe("full-development");
			expect(workflow.description).toContain("Code changes");
		});

		it("returns the correct workflow for 'question' classification", () => {
			const workflow = getWorkflowForClassification("question");

			expect(workflow.name).toBe("question");
			expect(workflow.description).toContain("question");
		});

		it("returns the correct workflow for 'documentation' classification", () => {
			const workflow = getWorkflowForClassification("documentation");

			expect(workflow.name).toBe("documentation");
			expect(workflow.description).toContain("Documentation");
		});

		it("returns the correct workflow for 'transient' classification", () => {
			const workflow = getWorkflowForClassification("transient");

			expect(workflow.name).toBe("question");
			expect(workflow.description).toContain("Quick question");
		});

		it("returns the correct workflow for 'planning' classification", () => {
			const workflow = getWorkflowForClassification("planning");

			expect(workflow.name).toBe("plan-mode");
			expect(workflow.description).toContain("Planning");
		});

		it("returns the correct workflow for 'debugger' classification", () => {
			const workflow = getWorkflowForClassification("debugger");

			expect(workflow.name).toBe("debugger");
			expect(workflow.description).toContain("debugging");
		});

		it("returns the correct workflow for 'orchestrator' classification", () => {
			const workflow = getWorkflowForClassification("orchestrator");

			expect(workflow.name).toBe("orchestrator");
			expect(workflow.description).toContain("sub-issues");
		});

		it("returns the correct workflow for 'user-testing' classification", () => {
			const workflow = getWorkflowForClassification("user-testing");

			expect(workflow.name).toBe("user-testing");
			expect(workflow.description).toContain("testing");
		});

		it("returns the correct workflow for 'release' classification", () => {
			const workflow = getWorkflowForClassification("release");

			expect(workflow.name).toBe("release");
			expect(workflow.description).toContain("release");
		});
	});

	describe("exhaustive classification coverage", () => {
		it("has a workflow mapping for every valid RequestClassification", () => {
			for (const classification of ALL_CLASSIFICATIONS) {
				const workflow = getWorkflowForClassification(classification);

				expect(workflow).toBeDefined();
				expect(workflow.name).toBeTruthy();
				expect(workflow.description).toBeTruthy();
				expect(workflow.skills).toBeDefined();
				expect(workflow.workflowGuidance).toBeDefined();
				expect(typeof workflow.involvesCodeChanges).toBe("boolean");
			}
		});

		it("CLASSIFICATION_TO_WORKFLOW keys match all RequestClassification values", () => {
			const workflowKeys = Object.keys(CLASSIFICATION_TO_WORKFLOW).sort();
			const classificationValues = [...ALL_CLASSIFICATIONS].sort();

			expect(workflowKeys).toEqual(classificationValues);
		});
	});

	describe("involvesCodeChanges flag", () => {
		it("'code' classification returns workflow with involvesCodeChanges: true", () => {
			const workflow = getWorkflowForClassification("code");

			expect(workflow.involvesCodeChanges).toBe(true);
		});

		it("'documentation' classification returns workflow with involvesCodeChanges: true", () => {
			const workflow = getWorkflowForClassification("documentation");

			expect(workflow.involvesCodeChanges).toBe(true);
		});

		it("'debugger' classification returns workflow with involvesCodeChanges: true", () => {
			const workflow = getWorkflowForClassification("debugger");

			expect(workflow.involvesCodeChanges).toBe(true);
		});

		it("'question' classification returns workflow with involvesCodeChanges: false", () => {
			const workflow = getWorkflowForClassification("question");

			expect(workflow.involvesCodeChanges).toBe(false);
		});

		it("'transient' classification returns workflow with involvesCodeChanges: false", () => {
			const workflow = getWorkflowForClassification("transient");

			expect(workflow.involvesCodeChanges).toBe(false);
		});

		it("'planning' classification returns workflow with involvesCodeChanges: false", () => {
			const workflow = getWorkflowForClassification("planning");

			expect(workflow.involvesCodeChanges).toBe(false);
		});

		it("'orchestrator' classification returns workflow with involvesCodeChanges: false", () => {
			const workflow = getWorkflowForClassification("orchestrator");

			expect(workflow.involvesCodeChanges).toBe(false);
		});

		it("'user-testing' classification returns workflow with involvesCodeChanges: false", () => {
			const workflow = getWorkflowForClassification("user-testing");

			expect(workflow.involvesCodeChanges).toBe(false);
		});

		it("'release' classification returns workflow with involvesCodeChanges: false", () => {
			const workflow = getWorkflowForClassification("release");

			expect(workflow.involvesCodeChanges).toBe(false);
		});
	});

	describe("skills arrays", () => {
		it("all workflows have non-empty skills arrays", () => {
			for (const classification of ALL_CLASSIFICATIONS) {
				const workflow = getWorkflowForClassification(classification);

				expect(
					workflow.skills.length,
					`${classification} workflow should have at least one skill`,
				).toBeGreaterThan(0);
			}
		});

		it("skills arrays contain only string values", () => {
			for (const classification of ALL_CLASSIFICATIONS) {
				const workflow = getWorkflowForClassification(classification);

				for (const skill of workflow.skills) {
					expect(typeof skill).toBe("string");
					expect(skill.length).toBeGreaterThan(0);
				}
			}
		});

		it("'code' workflow includes implementation, verify-and-ship, and summarize", () => {
			const workflow = getWorkflowForClassification("code");

			expect(workflow.skills).toEqual([
				"implementation",
				"verify-and-ship",
				"summarize",
			]);
		});

		it("'question' workflow includes investigate-and-answer", () => {
			const workflow = getWorkflowForClassification("question");

			expect(workflow.skills).toEqual(["investigate-and-answer"]);
		});

		it("'debugger' workflow includes debug-and-fix, verify-and-ship, and summarize", () => {
			const workflow = getWorkflowForClassification("debugger");

			expect(workflow.skills).toEqual([
				"debug-and-fix",
				"verify-and-ship",
				"summarize",
			]);
		});
	});

	describe("workflowGuidance", () => {
		it("all workflows have non-empty workflowGuidance strings", () => {
			for (const classification of ALL_CLASSIFICATIONS) {
				const workflow = getWorkflowForClassification(classification);

				expect(workflow.workflowGuidance.length).toBeGreaterThan(0);
				expect(workflow.workflowGuidance).toContain("Workflow");
			}
		});

		it("code-change workflows include numbered steps", () => {
			const codeChangingClassifications: RequestClassification[] = [
				"code",
				"documentation",
				"debugger",
			];

			for (const classification of codeChangingClassifications) {
				const workflow = getWorkflowForClassification(classification);

				// Should contain numbered steps
				expect(workflow.workflowGuidance).toMatch(/1\./);
				expect(workflow.workflowGuidance).toMatch(/2\./);
			}
		});
	});
});
