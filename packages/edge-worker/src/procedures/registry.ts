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
		promptPath: "primary", // Special: resolved via label (debugger/builder/scoper/orchestrator)
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
} as const;

/**
 * Predefined procedure definitions
 */
export const PROCEDURES: Record<string, ProcedureDefinition> = {
	"simple-question": {
		name: "simple-question",
		description: "For questions or requests that don't modify the codebase",
		subroutines: [SUBROUTINES.primary, SUBROUTINES.conciseSummary],
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
			SUBROUTINES.primary,
			SUBROUTINES.verifications,
			SUBROUTINES.gitGh,
			SUBROUTINES.verboseSummary,
		],
	},

	"debugger-full": {
		name: "debugger-full",
		description:
			"Full debugging workflow with reproduction, approval, fix, and verification",
		subroutines: [
			SUBROUTINES.debuggerReproduction,
			SUBROUTINES.getApproval,
			SUBROUTINES.debuggerFix,
			SUBROUTINES.verifications,
			SUBROUTINES.gitGh,
			SUBROUTINES.verboseSummary,
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
	code: "full-development",
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
