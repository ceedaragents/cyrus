/**
 * Registry of predefined procedures and analysis rules
 */

import type { ProcedureDefinition, RequestClassification } from "./types.js";

/**
 * Predefined subroutine definitions
 */
export const SUBROUTINES = {
	primary: {
		name: "primary",
		promptPath: "primary", // Special: resolved via label (debugger/builder/scoper/orchestrator) or direct user input
		description: "Main work execution phase",
	},
	debuggerReproduction: {
		name: "debugger-reproduction",
		promptPath: "subroutines/debugger-reproduction.md",
		description: "Reproducing bug and analyzing root cause",
	},
	getApproval: {
		name: "get-approval",
		promptPath: "subroutines/get-approval.md",
		description: "Requesting user approval before proceeding",
		singleTurn: true,
		requiresApproval: true, // Flag to trigger approval workflow
	},
	debuggerFix: {
		name: "debugger-fix",
		promptPath: "subroutines/debugger-fix.md",
		description: "Implementing fix based on root cause analysis",
	},
	verifications: {
		name: "verifications",
		promptPath: "subroutines/verifications.md",
		description: "Running tests, linting, and type checking",
		usesValidationLoop: true, // Enable validation loop with retry logic
	},
	validationFixer: {
		name: "validation-fixer",
		promptPath: "subroutines/validation-fixer.md",
		description: "Fixing validation failures",
	},
	gitCommit: {
		name: "git-commit",
		promptPath: "subroutines/git-commit.md",
		description: "Committing and pushing changes",
	},
	ghPr: {
		name: "gh-pr",
		promptPath: "subroutines/gh-pr.md",
		description: "Creating or updating pull request",
	},
	changelogUpdate: {
		name: "changelog-update",
		promptPath: "subroutines/changelog-update.md",
		description: "Updating changelog",
	},
	conciseSummary: {
		name: "concise-summary",
		promptPath: "subroutines/concise-summary.md",
		singleTurn: true,
		description: "Creating summary",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	verboseSummary: {
		name: "verbose-summary",
		promptPath: "subroutines/verbose-summary.md",
		singleTurn: true,
		description: "Creating detailed summary",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	questionInvestigation: {
		name: "question-investigation",
		promptPath: "subroutines/question-investigation.md",
		description: "Investigating question",
	},
	questionAnswer: {
		name: "question-answer",
		promptPath: "subroutines/question-answer.md",
		singleTurn: true,
		description: "Formatting answer",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	codingActivity: {
		name: "coding-activity",
		promptPath: "subroutines/coding-activity.md",
		description: "Implementing code changes",
	},
	preparation: {
		name: "preparation",
		promptPath: "subroutines/preparation.md",
		description: "Analyzing request and planning approach",
	},
	planSummary: {
		name: "plan-summary",
		promptPath: "subroutines/plan-summary.md",
		singleTurn: true,
		description: "Presenting implementation plan",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	userTesting: {
		name: "user-testing",
		promptPath: "subroutines/user-testing.md",
		description: "Performing user-requested testing",
	},
	userTestingSummary: {
		name: "user-testing-summary",
		promptPath: "subroutines/user-testing-summary.md",
		singleTurn: true,
		description: "Creating test results summary",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	releaseExecution: {
		name: "release-execution",
		promptPath: "subroutines/release-execution.md",
		description: "Executing release process",
	},
	releaseSummary: {
		name: "release-summary",
		promptPath: "subroutines/release-summary.md",
		singleTurn: true,
		description: "Creating release summary",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
} as const;

/**
 * Predefined procedure definitions
 */
export const PROCEDURES: Record<string, ProcedureDefinition> = {
	"simple-question": {
		name: "simple-question",
		description: "For questions or requests that don't modify the codebase",
		subroutines: [
			SUBROUTINES.questionInvestigation,
			SUBROUTINES.questionAnswer,
		],
	},

	"documentation-edit": {
		name: "documentation-edit",
		description:
			"For documentation/markdown edits that don't require verification",
		subroutines: [
			SUBROUTINES.primary,
			SUBROUTINES.gitCommit,
			SUBROUTINES.ghPr,
			SUBROUTINES.conciseSummary,
		],
	},

	"full-development": {
		name: "full-development",
		description: "For code changes requiring full verification and PR creation",
		subroutines: [
			SUBROUTINES.codingActivity,
			SUBROUTINES.verifications,
			SUBROUTINES.changelogUpdate,
			SUBROUTINES.gitCommit,
			SUBROUTINES.ghPr,
			SUBROUTINES.conciseSummary,
		],
	},

	"debugger-full": {
		name: "debugger-full",
		description:
			"Full debugging workflow with reproduction, fix, and verification",
		subroutines: [
			SUBROUTINES.debuggerReproduction,
			SUBROUTINES.debuggerFix,
			SUBROUTINES.verifications,
			SUBROUTINES.changelogUpdate,
			SUBROUTINES.gitCommit,
			SUBROUTINES.ghPr,
			SUBROUTINES.conciseSummary,
		],
	},

	"orchestrator-full": {
		name: "orchestrator-full",
		description:
			"Full orchestration workflow with decomposition and delegation to sub-agents",
		subroutines: [SUBROUTINES.primary, SUBROUTINES.conciseSummary],
	},

	"plan-mode": {
		name: "plan-mode",
		description:
			"Planning mode for requests needing clarification or implementation planning",
		subroutines: [SUBROUTINES.preparation, SUBROUTINES.planSummary],
	},

	"user-testing": {
		name: "user-testing",
		description: "User-driven testing workflow for manual testing sessions",
		subroutines: [SUBROUTINES.userTesting, SUBROUTINES.userTestingSummary],
	},

	release: {
		name: "release",
		description:
			"Release workflow that invokes project release skill or asks user for release info",
		subroutines: [SUBROUTINES.releaseExecution, SUBROUTINES.releaseSummary],
	},
};

/**
 * Mapping from request classification to procedure name
 */
export const CLASSIFICATION_TO_PROCEDURE: Record<
	RequestClassification,
	string
> = {
	question: "simple-question",
	documentation: "documentation-edit",
	transient: "simple-question",
	planning: "plan-mode",
	code: "full-development",
	debugger: "debugger-full",
	orchestrator: "orchestrator-full",
	"user-testing": "user-testing",
	release: "release",
};

/**
 * Get a procedure definition by name
 */
export function getProcedure(name: string): ProcedureDefinition | undefined {
	return PROCEDURES[name];
}

/**
 * Get procedure name for a given classification
 */
export function getProcedureForClassification(
	classification: RequestClassification,
): string {
	return CLASSIFICATION_TO_PROCEDURE[classification];
}

/**
 * Get all available procedure names
 */
export function getAllProcedureNames(): string[] {
	return Object.keys(PROCEDURES);
}
