/**
 * Ralph Wiggum Loop Module
 *
 * Exports for the Ralph Wiggum iterative development loop feature.
 */

export {
	buildContinuationPrompt,
	checkCompletionPromise,
	deactivateLoop,
	getLoopStatusMessage,
	incrementIteration,
	initializeRalphWiggumLoop,
	loadRalphWiggumState,
	parseRalphWiggumConfig,
	saveRalphWiggumState,
	shouldContinueLoop,
} from "./RalphWiggumLoop.js";

export type {
	RalphWiggumConfig,
	RalphWiggumState,
} from "./types.js";

export {
	DEFAULT_RALPH_WIGGUM_CONFIG,
	RALPH_WIGGUM_LABEL_PATTERN,
} from "./types.js";
