import type { TeamTask } from "./types.js";

/**
 * Subroutine name constants matching the procedure registry in
 * packages/edge-worker/src/procedures/registry.ts
 */
const SUBROUTINE_NAMES = {
	codingActivity: "coding-activity",
	verifications: "verifications",
	changelogUpdate: "changelog-update",
	gitCommit: "git-commit",
	ghPr: "gh-pr",
	conciseSummary: "concise-summary",
	debuggerReproduction: "debugger-reproduction",
	debuggerFix: "debugger-fix",
	primary: "primary",
} as const;

/**
 * Build a dependency-aware parallel task graph for the full-development procedure.
 *
 * Parallelization strategy:
 *   - "Run verifications" and "Update changelog" run in parallel after implementation
 *   - "Commit and push" waits for both to complete before proceeding
 */
export function buildFullDevelopmentTasks(issueContext: string): TeamTask[] {
	return [
		{
			id: "fd-1",
			subject: "Research codebase context",
			description: `Investigate the codebase to understand relevant files, patterns, and constraints.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: [],
			assignTo: "researcher",
			subroutineName: SUBROUTINE_NAMES.codingActivity,
		},
		{
			id: "fd-2",
			subject: "Implement changes",
			description: `Implement the requested changes based on research findings.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["fd-1"],
			assignTo: "implementer",
			subroutineName: SUBROUTINE_NAMES.codingActivity,
		},
		{
			id: "fd-3",
			subject: "Run verifications",
			description: `Run tests, linting, and type checking to verify the implementation.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["fd-2"],
			assignTo: "verifier",
			subroutineName: SUBROUTINE_NAMES.verifications,
		},
		{
			id: "fd-4",
			subject: "Update changelog",
			description: `Update changelog with a summary of the changes made.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["fd-2"],
			assignTo: "implementer",
			subroutineName: SUBROUTINE_NAMES.changelogUpdate,
		},
		{
			id: "fd-5",
			subject: "Commit and push changes",
			description: `Stage, commit, and push all changes to remote.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["fd-3", "fd-4"],
			assignTo: "git-handler",
			subroutineName: SUBROUTINE_NAMES.gitCommit,
		},
		{
			id: "fd-6",
			subject: "Create or update Pull Request",
			description: `Create or update the GitHub Pull Request.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["fd-5"],
			assignTo: "git-handler",
			subroutineName: SUBROUTINE_NAMES.ghPr,
		},
		{
			id: "fd-7",
			subject: "Generate summary",
			description: `Generate a concise summary of the work completed.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["fd-6"],
			assignTo: "summarizer",
			subroutineName: SUBROUTINE_NAMES.conciseSummary,
		},
	];
}

/**
 * Build a dependency-aware parallel task graph for the debugger procedure.
 *
 * Parallelization strategy:
 *   - Three investigation tasks run in parallel with competing hypotheses
 *   - Fix implementation waits for all investigations to complete
 */
export function buildDebuggerTasks(issueContext: string): TeamTask[] {
	return [
		{
			id: "dbg-1",
			subject: "Investigate most likely root cause",
			description: `Reproduce the bug and investigate the most likely root cause.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: [],
			assignTo: "researcher",
			subroutineName: SUBROUTINE_NAMES.debuggerReproduction,
		},
		{
			id: "dbg-2",
			subject: "Investigate alternative root cause",
			description: `Explore alternative hypotheses for the bug's root cause.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: [],
			assignTo: "researcher",
			subroutineName: SUBROUTINE_NAMES.debuggerReproduction,
		},
		{
			id: "dbg-3",
			subject: "Search git history for related changes",
			description: `Search git history for recent changes that may have introduced the bug.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: [],
			assignTo: "researcher",
			subroutineName: SUBROUTINE_NAMES.debuggerReproduction,
		},
		{
			id: "dbg-4",
			subject: "Synthesize findings and implement fix",
			description: `Combine investigation findings and implement a minimal fix.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["dbg-1", "dbg-2", "dbg-3"],
			assignTo: "implementer",
			subroutineName: SUBROUTINE_NAMES.debuggerFix,
		},
		{
			id: "dbg-5",
			subject: "Run verifications",
			description: `Run tests, linting, and type checking to verify the fix.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["dbg-4"],
			assignTo: "verifier",
			subroutineName: SUBROUTINE_NAMES.verifications,
		},
		{
			id: "dbg-6",
			subject: "Commit, push, and create PR",
			description: `Stage, commit, push changes, and create a Pull Request.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["dbg-5"],
			assignTo: "git-handler",
			subroutineName: SUBROUTINE_NAMES.gitCommit,
		},
		{
			id: "dbg-7",
			subject: "Generate summary",
			description: `Generate a concise summary of the debugging session.\n\nIssue context:\n${issueContext}`,
			activeForm: "pending",
			blockedBy: ["dbg-6"],
			assignTo: "summarizer",
			subroutineName: SUBROUTINE_NAMES.conciseSummary,
		},
	];
}

/**
 * Build paired implementation/verification tasks for orchestrated sub-issues.
 *
 * Each sub-issue gets two tasks (implement + verify) and dependencies between
 * sub-issues are preserved by making the implementation task of a dependent
 * sub-issue wait for the verification task of the dependency.
 */
export function buildOrchestratorTasks(
	subIssues: Array<{
		id: string;
		title: string;
		description: string;
		dependsOn?: string[];
	}>,
): TeamTask[] {
	const tasks: TeamTask[] = [];

	// Map sub-issue IDs to their verification task IDs so we can wire up
	// cross-issue dependencies correctly
	const verifyTaskIdBySubIssue = new Map<string, string>();
	for (const subIssue of subIssues) {
		verifyTaskIdBySubIssue.set(subIssue.id, `orch-${subIssue.id}-verify`);
	}

	for (const subIssue of subIssues) {
		const implTaskId = `orch-${subIssue.id}-impl`;
		const verifyTaskId = `orch-${subIssue.id}-verify`;

		// Implementation task depends on verification of upstream sub-issues
		const implBlockedBy: string[] = [];
		if (subIssue.dependsOn) {
			for (const depId of subIssue.dependsOn) {
				const depVerifyId = verifyTaskIdBySubIssue.get(depId);
				if (depVerifyId) {
					implBlockedBy.push(depVerifyId);
				}
			}
		}

		tasks.push({
			id: implTaskId,
			subject: `Implement: ${subIssue.title}`,
			description: subIssue.description,
			activeForm: "pending",
			blockedBy: implBlockedBy,
			assignTo: "implementer",
			subroutineName: SUBROUTINE_NAMES.codingActivity,
		});

		tasks.push({
			id: verifyTaskId,
			subject: `Verify: ${subIssue.title}`,
			description: `Run verifications for: ${subIssue.title}`,
			activeForm: "pending",
			blockedBy: [implTaskId],
			assignTo: "verifier",
			subroutineName: SUBROUTINE_NAMES.verifications,
		});
	}

	return tasks;
}
