/**
 * Ralph Wiggum Loop Controller
 *
 * Manages the Ralph Wiggum iterative development loop.
 * Based on the Anthropic plugin that runs Claude in a self-referential
 * loop until task completion.
 *
 * The loop works by:
 * 1. Parsing the ralph-wiggum-N label to get max iterations
 * 2. Creating a state file to track loop progress
 * 3. Using a Stop hook to intercept session completion
 * 4. Re-feeding the prompt to continue the loop
 *
 * @see https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-wiggum
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RalphWiggumConfig, RalphWiggumState } from "./types.js";
import {
	DEFAULT_RALPH_WIGGUM_CONFIG,
	RALPH_WIGGUM_LABEL_PATTERN,
} from "./types.js";

/**
 * Path to the Ralph Wiggum state file within a workspace
 */
const RALPH_WIGGUM_STATE_FILE = ".claude/ralph-loop.local.md";

/**
 * Parse Ralph Wiggum configuration from issue labels
 *
 * Looks for labels matching the pattern:
 * - ralph-wiggum-N: Loop with N max iterations
 * - ralph-wiggum: Loop with default max iterations
 *
 * @param labels Array of label names from the Linear issue
 * @returns Configuration if ralph-wiggum label is found, null otherwise
 */
export function parseRalphWiggumConfig(
	labels: string[],
): RalphWiggumConfig | null {
	if (!labels || labels.length === 0) {
		return null;
	}

	for (const label of labels) {
		const match = label.match(RALPH_WIGGUM_LABEL_PATTERN);
		if (match) {
			const iterationCount = match[1] ? parseInt(match[1], 10) : null;

			return {
				enabled: true,
				maxIterations:
					iterationCount !== null && !Number.isNaN(iterationCount)
						? iterationCount
						: DEFAULT_RALPH_WIGGUM_CONFIG.maxIterations,
				completionPromise: DEFAULT_RALPH_WIGGUM_CONFIG.completionPromise,
			};
		}
	}

	return null;
}

/**
 * Create and persist initial Ralph Wiggum loop state
 *
 * @param workspacePath Path to the workspace directory
 * @param config Ralph Wiggum configuration
 * @param originalPrompt The original prompt that started the session
 * @param linearAgentSessionId Linear agent session ID for tracking
 * @returns The created state
 */
export function initializeRalphWiggumLoop(
	workspacePath: string,
	config: RalphWiggumConfig,
	originalPrompt: string,
	linearAgentSessionId: string,
): RalphWiggumState {
	const state: RalphWiggumState = {
		active: true,
		iteration: 1,
		maxIterations: config.maxIterations,
		completionPromise: config.completionPromise ?? null,
		startedAt: new Date().toISOString(),
		originalPrompt,
		linearAgentSessionId,
	};

	saveRalphWiggumState(workspacePath, state);

	console.log(
		`[RalphWiggumLoop] Initialized loop in ${workspacePath} with max ${config.maxIterations} iterations`,
	);

	return state;
}

/**
 * Load Ralph Wiggum state from the workspace
 *
 * @param workspacePath Path to the workspace directory
 * @returns The loaded state or null if not found
 */
export function loadRalphWiggumState(
	workspacePath: string,
): RalphWiggumState | null {
	const statePath = join(workspacePath, RALPH_WIGGUM_STATE_FILE);

	if (!existsSync(statePath)) {
		return null;
	}

	try {
		const content = readFileSync(statePath, "utf-8");
		return parseRalphWiggumStateFile(content);
	} catch (error) {
		console.error(
			`[RalphWiggumLoop] Failed to load state from ${statePath}:`,
			error,
		);
		return null;
	}
}

/**
 * Parse the Ralph Wiggum state file content
 *
 * The file format is markdown with YAML frontmatter:
 * ---
 * active: true
 * iteration: 1
 * max_iterations: 20
 * completion_promise: "TASK COMPLETE"
 * started_at: "2025-01-01T00:00:00Z"
 * linear_agent_session_id: "session-id"
 * ---
 *
 * Original prompt content here...
 */
function parseRalphWiggumStateFile(content: string): RalphWiggumState | null {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!frontmatterMatch) {
		return null;
	}

	const frontmatter = frontmatterMatch[1] ?? "";
	const originalPrompt = (frontmatterMatch[2] ?? "").trim();

	// Parse YAML-like frontmatter (simple key: value format)
	const getValue = (key: string): string | null => {
		const regex = new RegExp(`^${key}:\\s*(.*)$`, "m");
		const match = frontmatter.match(regex);
		if (!match) return null;
		// Remove quotes if present
		let value = match[1]?.trim() ?? "";
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		return value;
	};

	const activeStr = getValue("active");
	const iterationStr = getValue("iteration");
	const maxIterationsStr = getValue("max_iterations");
	const completionPromiseStr = getValue("completion_promise");
	const startedAt = getValue("started_at");
	const linearAgentSessionId = getValue("linear_agent_session_id");

	if (!activeStr || !iterationStr || !startedAt || !linearAgentSessionId) {
		return null;
	}

	return {
		active: activeStr === "true",
		iteration: parseInt(iterationStr, 10) || 1,
		maxIterations: parseInt(maxIterationsStr ?? "0", 10) || 0,
		completionPromise:
			completionPromiseStr === "null" ? null : (completionPromiseStr ?? null),
		startedAt,
		originalPrompt,
		linearAgentSessionId,
	};
}

/**
 * Save Ralph Wiggum state to the workspace
 *
 * @param workspacePath Path to the workspace directory
 * @param state The state to save
 */
export function saveRalphWiggumState(
	workspacePath: string,
	state: RalphWiggumState,
): void {
	const claudeDir = join(workspacePath, ".claude");
	const statePath = join(workspacePath, RALPH_WIGGUM_STATE_FILE);

	// Ensure .claude directory exists
	if (!existsSync(claudeDir)) {
		mkdirSync(claudeDir, { recursive: true });
	}

	const content = formatRalphWiggumStateFile(state);
	writeFileSync(statePath, content, "utf-8");
}

/**
 * Format the Ralph Wiggum state as a markdown file with YAML frontmatter
 */
function formatRalphWiggumStateFile(state: RalphWiggumState): string {
	const completionPromiseValue = state.completionPromise
		? `"${state.completionPromise}"`
		: "null";

	return `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseValue}
started_at: "${state.startedAt}"
linear_agent_session_id: "${state.linearAgentSessionId}"
---

${state.originalPrompt}
`;
}

/**
 * Increment the iteration counter and save state
 *
 * @param workspacePath Path to the workspace directory
 * @param state Current state
 * @returns Updated state
 */
export function incrementIteration(
	workspacePath: string,
	state: RalphWiggumState,
): RalphWiggumState {
	const updatedState: RalphWiggumState = {
		...state,
		iteration: state.iteration + 1,
	};

	saveRalphWiggumState(workspacePath, updatedState);

	console.log(
		`[RalphWiggumLoop] Advanced to iteration ${updatedState.iteration}/${updatedState.maxIterations || "unlimited"}`,
	);

	return updatedState;
}

/**
 * Deactivate the Ralph Wiggum loop
 *
 * @param workspacePath Path to the workspace directory
 * @param state Current state
 * @param reason Reason for deactivation
 */
export function deactivateLoop(
	workspacePath: string,
	state: RalphWiggumState,
	reason: string,
): void {
	const updatedState: RalphWiggumState = {
		...state,
		active: false,
	};

	saveRalphWiggumState(workspacePath, updatedState);

	console.log(
		`[RalphWiggumLoop] Loop deactivated at iteration ${state.iteration}: ${reason}`,
	);
}

/**
 * Check if the completion promise is satisfied in the response
 *
 * Looks for: <promise>COMPLETION_PHRASE</promise>
 *
 * @param response The agent's response text
 * @param completionPromise The expected completion phrase
 * @returns true if the promise is satisfied
 */
export function checkCompletionPromise(
	response: string,
	completionPromise: string | null,
): boolean {
	if (!completionPromise) {
		return false;
	}

	// Look for <promise>PHRASE</promise> pattern
	const promisePattern = /<promise>([\s\S]*?)<\/promise>/gi;
	let match: RegExpExecArray | null = promisePattern.exec(response);

	while (match !== null) {
		const promiseContent = match[1]?.trim();
		if (
			promiseContent &&
			promiseContent.toLowerCase() === completionPromise.toLowerCase()
		) {
			return true;
		}
		match = promisePattern.exec(response);
	}

	return false;
}

/**
 * Determine if the loop should continue
 *
 * @param state Current Ralph Wiggum state
 * @param lastResponse The last response from the agent (to check for completion promise)
 * @returns Object with shouldContinue flag and reason
 */
export function shouldContinueLoop(
	state: RalphWiggumState,
	lastResponse?: string,
): { shouldContinue: boolean; reason: string } {
	// Loop not active
	if (!state.active) {
		return { shouldContinue: false, reason: "Loop is not active" };
	}

	// Check completion promise
	if (lastResponse && state.completionPromise) {
		if (checkCompletionPromise(lastResponse, state.completionPromise)) {
			return {
				shouldContinue: false,
				reason: `Completion promise satisfied: ${state.completionPromise}`,
			};
		}
	}

	// Check max iterations
	if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
		return {
			shouldContinue: false,
			reason: `Max iterations reached: ${state.iteration}/${state.maxIterations}`,
		};
	}

	return { shouldContinue: true, reason: "Continuing loop" };
}

/**
 * Build the continuation prompt for the next iteration
 *
 * @param state Current Ralph Wiggum state
 * @returns The prompt to feed back to the agent
 */
export function buildContinuationPrompt(state: RalphWiggumState): string {
	const iterationInfo =
		state.maxIterations > 0
			? `${state.iteration + 1}/${state.maxIterations}`
			: `${state.iteration + 1} (unlimited)`;

	return `---
# Ralph Wiggum Loop - Iteration ${iterationInfo}

You are in a Ralph Wiggum self-referential development loop. This is iteration ${state.iteration + 1}.

## Context
Your previous work is visible in the modified files and git history. Review what you accomplished in the previous iteration and continue working on the task.

## Original Task
${state.originalPrompt}

## Completion
${
	state.completionPromise
		? `To complete this loop, output this EXACT text when the task is genuinely complete:
\`<promise>${state.completionPromise}</promise>\`

IMPORTANT: Only output this promise when the task is TRULY complete. Do NOT output a false promise to escape the loop.`
		: "This loop will continue until max iterations are reached."
}

## Instructions
1. Review your previous work in the files and git log
2. Continue working on the task
3. Make incremental progress each iteration
${state.completionPromise ? `4. Output the completion promise ONLY when genuinely done` : ""}

---`;
}

/**
 * Get a summary message for Linear about the Ralph Wiggum loop
 */
export function getLoopStatusMessage(
	state: RalphWiggumState,
	status: "started" | "continuing" | "completed" | "max_iterations",
): string {
	const iterationInfo =
		state.maxIterations > 0
			? `${state.iteration}/${state.maxIterations}`
			: `${state.iteration}`;

	switch (status) {
		case "started":
			return `Ralph Wiggum loop started (max iterations: ${state.maxIterations || "unlimited"})`;
		case "continuing":
			return `Ralph Wiggum loop continuing to iteration ${parseInt(iterationInfo, 10) + 1}`;
		case "completed":
			return `Ralph Wiggum loop completed at iteration ${iterationInfo}`;
		case "max_iterations":
			return `Ralph Wiggum loop stopped: max iterations (${state.maxIterations}) reached`;
	}
}
