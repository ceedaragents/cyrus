/**
 * Types for the validation loop system
 */

/**
 * Result of a validation run, used with structured outputs
 */
export interface ValidationResult {
	/** Whether all verifications passed */
	pass: boolean;
	/** Summary of validation results or failure reasons */
	reason: string;
}

/**
 * JSON Schema for ValidationResult - used with Claude SDK structured outputs
 */
export const VALIDATION_RESULT_SCHEMA = {
	type: "object",
	properties: {
		pass: {
			type: "boolean",
			description: "Whether all verifications passed",
		},
		reason: {
			type: "string",
			description:
				"Summary of validation results (e.g., '47 tests passing, linting clean, types valid') or failure reasons (e.g., 'TypeScript error in src/foo.ts:42 - Property x does not exist on type Y')",
		},
	},
	required: ["pass", "reason"],
	additionalProperties: false,
} as const;

/**
 * Configuration for the validation loop
 */
export interface ValidationLoopConfig {
	/** Maximum number of validation attempts (default: 4) */
	maxIterations: number;
	/** Whether to continue to next subroutine even if validation fails after all retries */
	continueOnMaxRetries: boolean;
}

/**
 * Default validation loop configuration
 */
export const DEFAULT_VALIDATION_LOOP_CONFIG: ValidationLoopConfig = {
	maxIterations: 4,
	continueOnMaxRetries: true,
};

/**
 * State tracking for a validation loop execution
 */
export interface ValidationLoopState {
	/** Current iteration (1-based) */
	iteration: number;
	/** Results from each validation attempt */
	attempts: Array<{
		iteration: number;
		result: ValidationResult;
		timestamp: number;
	}>;
	/** Whether the loop has completed (either passed or exhausted retries) */
	completed: boolean;
	/** Final outcome */
	outcome: "passed" | "failed_max_retries" | "in_progress";
}

/**
 * Context passed to the validation-fixer subroutine
 */
export interface ValidationFixerContext {
	/** The failure reason from the previous validation attempt */
	failureReason: string;
	/** Current iteration number */
	iteration: number;
	/** Maximum iterations allowed */
	maxIterations: number;
	/** Previous attempt results for context */
	previousAttempts: Array<{
		iteration: number;
		reason: string;
	}>;
}
