/**
 * Validation loop module - provides functionality for running verification
 * subroutines with retry logic and structured outputs
 */

export {
	DEFAULT_VALIDATION_LOOP_CONFIG,
	VALIDATION_RESULT_SCHEMA,
	type ValidationFixerContext,
	type ValidationLoopConfig,
	type ValidationLoopState,
	type ValidationResult,
	ValidationResultSchema,
} from "./types.js";
export {
	createInitialState,
	getFixerContext,
	getValidationResultSchema,
	getValidationSummary,
	loadValidationFixerPrompt,
	parseValidationResult,
	recordAttempt,
	renderValidationFixerPrompt,
	shouldContinueLoop,
	shouldProceedAfterValidation,
} from "./ValidationLoopController.js";
