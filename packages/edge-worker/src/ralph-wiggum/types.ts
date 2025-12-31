/**
 * Ralph Wiggum Loop Types
 *
 * Types for the Ralph Wiggum iterative development loop feature.
 * Named after the Anthropic plugin that pioneered continuous AI loops.
 */

/**
 * Configuration for a Ralph Wiggum loop parsed from a Linear label
 */
export interface RalphWiggumConfig {
	/** Whether Ralph Wiggum loop is enabled */
	enabled: boolean;

	/** Maximum number of iterations before auto-stop (0 = unlimited) */
	maxIterations: number;

	/** Optional completion promise phrase */
	completionPromise?: string;
}

/**
 * State of an active Ralph Wiggum loop
 * Persisted to .claude/ralph-loop.local.md in the workspace
 */
export interface RalphWiggumState {
	/** Whether the loop is active */
	active: boolean;

	/** Current iteration number (1-indexed) */
	iteration: number;

	/** Maximum iterations (0 = unlimited) */
	maxIterations: number;

	/** Optional completion promise phrase */
	completionPromise: string | null;

	/** ISO timestamp when the loop started */
	startedAt: string;

	/** The original prompt that started the loop */
	originalPrompt: string;

	/** Linear agent session ID for tracking */
	linearAgentSessionId: string;
}

/**
 * Default configuration when ralph-wiggum label is present without iteration count
 */
export const DEFAULT_RALPH_WIGGUM_CONFIG: RalphWiggumConfig = {
	enabled: true,
	maxIterations: 10, // Conservative default
	completionPromise: "TASK COMPLETE",
};

/**
 * Label patterns for Ralph Wiggum configuration
 *
 * Supported formats:
 * - ralph-wiggum-N: Loop with N max iterations
 * - ralph-wiggum: Loop with default max iterations (10)
 */
export const RALPH_WIGGUM_LABEL_PATTERN = /^ralph-wiggum(?:-(\d+))?$/i;
