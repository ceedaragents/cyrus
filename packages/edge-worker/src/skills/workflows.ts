/**
 * Workflow templates that map request classifications to skill sets.
 *
 * Each workflow defines which skills to load and provides ordering guidance
 * that gets injected into the system prompt.
 */

import type { RequestClassification } from "../procedures/types.js";
import type { WorkflowTemplate } from "./types.js";

/**
 * Mapping from request classification to workflow template.
 */
export const CLASSIFICATION_TO_WORKFLOW: Record<
	RequestClassification,
	WorkflowTemplate
> = {
	code: {
		name: "full-development",
		description: "Code changes with verification and PR creation",
		skills: ["implementation", "verify-and-ship", "summarize"],
		involvesCodeChanges: true,
		workflowGuidance: `## Workflow

Follow this workflow to completion:

1. **Implement** — Implement the requested changes. Write production-ready code, follow existing patterns, and run tests to verify your work.
2. **Verify & Ship** — Run all quality checks (tests, lint, typecheck). Fix any failures, retrying up to 3 times. Then update the changelog, commit, push, and create/update the pull request.
3. **Summarize** — Post a concise summary of the work to Linear.

Do NOT skip steps. Complete each phase before moving to the next.`,
	},

	question: {
		name: "question",
		description: "Answer a question about the codebase or project",
		skills: ["investigate-and-answer"],
		involvesCodeChanges: false,
		workflowGuidance: `## Workflow

1. **Investigate** — Search the codebase, read relevant files, and gather the information needed to answer the question.
2. **Answer** — Provide a clear, direct answer with code references and line numbers where applicable.`,
	},

	documentation: {
		name: "documentation",
		description: "Documentation or markdown edits with PR creation",
		skills: ["implementation", "verify-and-ship", "summarize"],
		involvesCodeChanges: true,
		workflowGuidance: `## Workflow

Follow this workflow to completion:

1. **Implement** — Make the requested documentation changes. Follow existing formatting and style conventions.
2. **Verify & Ship** — Run any applicable checks (lint, etc.). Commit, push, and create/update the pull request.
3. **Summarize** — Post a concise summary of the work to Linear.`,
	},

	transient: {
		name: "question",
		description: "Quick question or informational request",
		skills: ["investigate-and-answer"],
		involvesCodeChanges: false,
		workflowGuidance: `## Workflow

1. **Investigate** — Gather the information needed to answer the question.
2. **Answer** — Provide a clear, direct answer.`,
	},

	planning: {
		name: "plan-mode",
		description: "Planning mode for unclear requirements",
		skills: ["plan-and-present"],
		involvesCodeChanges: false,
		workflowGuidance: `## Workflow

1. **Analyze** — Analyze the request to determine if it needs clarification or can be planned.
2. **Present** — Present either clarifying questions or an implementation plan in Linear-compatible markdown.`,
	},

	debugger: {
		name: "debugger",
		description: "Full debugging workflow with reproduction, fix, and PR",
		skills: ["debug-and-fix", "verify-and-ship", "summarize"],
		involvesCodeChanges: true,
		workflowGuidance: `## Workflow

Follow this workflow to completion:

1. **Debug & Fix** — Reproduce the bug with a failing test case, perform root cause analysis, and implement a minimal, targeted fix.
2. **Verify & Ship** — Run all quality checks (tests, lint, typecheck). Fix any failures, retrying up to 3 times. Then update the changelog, commit, push, and create/update the pull request.
3. **Summarize** — Post a concise summary of the debugging and fix to Linear.`,
	},

	orchestrator: {
		name: "orchestrator",
		description: "Break down work into sub-issues and delegate",
		skills: ["implementation", "summarize"],
		involvesCodeChanges: false,
		workflowGuidance: `## Workflow

1. **Orchestrate** — Break down the request into well-defined sub-issues and create them in Linear.
2. **Summarize** — Post a concise summary of the decomposition and delegation to Linear.`,
	},

	"user-testing": {
		name: "user-testing",
		description: "User-driven testing workflow",
		skills: ["user-testing"],
		involvesCodeChanges: false,
		workflowGuidance: `## Workflow

1. **Test** — Execute the testing activities requested by the user. Be responsive to feedback during the testing process.
2. **Summarize** — Post a comprehensive testing summary with results, issues found, and recommendations.`,
	},

	release: {
		name: "release",
		description: "Execute a software release",
		skills: ["release"],
		involvesCodeChanges: false,
		workflowGuidance: `## Workflow

1. **Release** — Check for release instructions (skill, CLAUDE.md, README.md), then execute the release process.
2. **Summarize** — Post a release summary with version information, changes included, and any follow-up actions.`,
	},
};

/**
 * Get the workflow template for a given classification.
 */
export function getWorkflowForClassification(
	classification: RequestClassification,
): WorkflowTemplate {
	return CLASSIFICATION_TO_WORKFLOW[classification];
}
