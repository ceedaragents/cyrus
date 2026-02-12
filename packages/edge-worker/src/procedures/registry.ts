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
		description: "Reproduce bug and perform root cause analysis",
	},
	getApproval: {
		name: "get-approval",
		promptPath: "subroutines/get-approval.md",
		description: "Request user approval before proceeding",
		singleTurn: true,
		requiresApproval: true, // Flag to trigger approval workflow
	},
	debuggerFix: {
		name: "debugger-fix",
		promptPath: "subroutines/debugger-fix.md",
		description: "Implement minimal fix based on approved reproduction",
	},
	verifications: {
		name: "verifications",
		promptPath: "subroutines/verifications.md",
		description: "Run tests, linting, and type checking",
		usesValidationLoop: true, // Enable validation loop with retry logic
	},
	validationFixer: {
		name: "validation-fixer",
		promptPath: "subroutines/validation-fixer.md",
		description: "Fix validation failures from the verifications subroutine",
	},
	gitCommit: {
		name: "git-commit",
		promptPath: "subroutines/git-commit.md",
		description: "Stage, commit, and push changes to remote",
	},
	ghPr: {
		name: "gh-pr",
		promptPath: "subroutines/gh-pr.md",
		description: "Create or update GitHub Pull Request",
	},
	changelogUpdate: {
		name: "changelog-update",
		promptPath: "subroutines/changelog-update.md",
		description: "Update changelog (only if changelog files exist)",
	},
	conciseSummary: {
		name: "concise-summary",
		promptPath: "subroutines/concise-summary.md",
		singleTurn: true,
		description: "Brief summary for simple requests",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	verboseSummary: {
		name: "verbose-summary",
		promptPath: "subroutines/verbose-summary.md",
		singleTurn: true,
		description: "Detailed summary with implementation details",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	questionInvestigation: {
		name: "question-investigation",
		promptPath: "subroutines/question-investigation.md",
		description: "Gather information needed to answer a question",
	},
	questionAnswer: {
		name: "question-answer",
		promptPath: "subroutines/question-answer.md",
		singleTurn: true,
		description: "Format final answer to user question",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	codingActivity: {
		name: "coding-activity",
		promptPath: "subroutines/coding-activity.md",
		description: "Implementation phase for code changes (no git/gh operations)",
	},
	preparation: {
		name: "preparation",
		promptPath: "subroutines/preparation.md",
		description:
			"Analyze request to determine if clarification or planning is needed",
	},
	planSummary: {
		name: "plan-summary",
		promptPath: "subroutines/plan-summary.md",
		singleTurn: true,
		description: "Present clarifying questions or implementation plan",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	userTesting: {
		name: "user-testing",
		promptPath: "subroutines/user-testing.md",
		description: "Perform testing as requested by the user",
	},
	userTestingSummary: {
		name: "user-testing-summary",
		promptPath: "subroutines/user-testing-summary.md",
		singleTurn: true,
		description: "Summary of user testing session results",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	releaseExecution: {
		name: "release-execution",
		promptPath: "subroutines/release-execution.md",
		description:
			"Execute release process using project skill or gather release info via AskUserQuestion",
	},
	releaseSummary: {
		name: "release-summary",
		promptPath: "subroutines/release-summary.md",
		singleTurn: true,
		description: "Summary of the release process",
		suppressThoughtPosting: true,
		disallowAllTools: true,
	},
	teamDevelopment: {
		name: "team-development",
		promptPath: "subroutines/team-development.md",
		description:
			"Parallel team-based development using Claude Code Agent Teams",
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

	"team-development": {
		name: "team-development",
		description:
			"Complex tasks executed by a coordinated team of specialized agents",
		subroutines: [
			SUBROUTINES.teamDevelopment,
			SUBROUTINES.verifications,
			SUBROUTINES.changelogUpdate,
			SUBROUTINES.gitCommit,
			SUBROUTINES.ghPr,
			SUBROUTINES.conciseSummary,
		],
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
	team: "team-development",
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
