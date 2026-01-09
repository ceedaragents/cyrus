/**
 * Types for the validation loop system
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Zod schema for ValidationResult - the single source of truth
 * Used with Claude SDK structured outputs
 */
export const ValidationResultSchema = z.object({
	/** Whether all verifications passed */
	pass: z.boolean().describe("Whether all verifications passed"),
	/** Summary of validation results or failure reasons */
	reason: z
		.string()
		.describe(
			"Summary of validation results (e.g., '47 tests passing, linting clean, types valid') or failure reasons (e.g., 'TypeScript error in src/foo.ts:42 - Property x does not exist on type Y')",
		),
});

/**
 * TypeScript type inferred from the Zod schema
 */
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * JSON Schema for ValidationResult - converted from Zod schema
 * Used with Claude SDK structured outputs
 */
export const VALIDATION_RESULT_SCHEMA = zodToJsonSchema(
	ValidationResultSchema as any,
	{
		$refStrategy: "none",
		target: "jsonSchema7",
	},
) as {
	type: "object";
	properties: {
		pass: { type: "boolean"; description: string };
		reason: { type: "string"; description: string };
	};
	required: ["pass", "reason"];
	additionalProperties: false;
};

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
