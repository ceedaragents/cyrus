/**
 * Registry of predefined procedures and routing rules
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
		maxTurns: 1,
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
	},
	gitGh: {
		name: "git-gh",
		promptPath: "subroutines/git-gh.md",
		description: "Commit changes and create/update PR",
	},
	conciseSummary: {
		name: "concise-summary",
		promptPath: "subroutines/concise-summary.md",
		maxTurns: 1,
		description: "Brief summary for simple requests",
		suppressThoughtPosting: true,
	},
	verboseSummary: {
		name: "verbose-summary",
		promptPath: "subroutines/verbose-summary.md",
		maxTurns: 1,
		description: "Detailed summary with implementation details",
		suppressThoughtPosting: true,
	},
	questionInvestigation: {
		name: "question-investigation",
		promptPath: "subroutines/question-investigation.md",
		description: "Gather information needed to answer a question",
	},
	questionAnswer: {
		name: "question-answer",
		promptPath: "subroutines/question-answer.md",
		maxTurns: 1,
		description: "Format final answer to user question",
		suppressThoughtPosting: true,
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
		maxTurns: 1,
		description: "Present clarifying questions or implementation plan",
		suppressThoughtPosting: true,
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
			SUBROUTINES.gitGh,
			SUBROUTINES.conciseSummary,
		],
	},

	"full-development": {
		name: "full-development",
		description: "For code changes requiring full verification and PR creation",
		subroutines: [
			SUBROUTINES.codingActivity,
			SUBROUTINES.verifications,
			SUBROUTINES.gitGh,
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
			SUBROUTINES.gitGh,
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
	code: "full-development",
	debugger: "debugger-full",
	orchestrator: "orchestrator-full",
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
