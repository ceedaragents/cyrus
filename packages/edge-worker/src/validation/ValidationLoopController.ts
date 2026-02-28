/**
 * ValidationLoopController - Orchestrates the validation loop with retry logic
 *
 * This controller manages the validation loop that runs verifications and fixes
 * up to a configurable maximum number of iterations.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ValidationFixerContext,
	ValidationLoopConfig,
	ValidationLoopState,
	ValidationResult,
} from "./types.js";
import {
	DEFAULT_VALIDATION_LOOP_CONFIG,
	VALIDATION_RESULT_SCHEMA,
	ValidationResultSchema,
} from "./types.js";

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse a validation result from an agent's response
 *
 * Supports multiple formats:
 * 1. Native structured output (message.structured_output) - validated with Zod
 * 2. JSON in response text - validated with Zod
 * 3. Fallback prompt engineering extraction (for Gemini and other runners)
 */
export function parseValidationResult(
	response: string | undefined,
	structuredOutput?: unknown,
): ValidationResult {
	// 1. Try native structured output first (Claude SDK) - validate with Zod
	if (structuredOutput && typeof structuredOutput === "object") {
		const parsed = ValidationResultSchema.safeParse(structuredOutput);
		if (parsed.success) {
			return parsed.data;
		}
		// Log validation error for debugging but continue to fallback methods
		console.debug(
			"[parseValidationResult] Structured output validation failed:",
			parsed.error.message,
		);
	}

	// 2. Try to parse JSON from response - validate with Zod
	if (response) {
		// Try to extract JSON from markdown code blocks
		const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
		const jsonString = jsonMatch
			? (jsonMatch[1] ?? "").trim()
			: response.trim();

		try {
			const jsonParsed = JSON.parse(jsonString);
			const zodParsed = ValidationResultSchema.safeParse(jsonParsed);
			if (zodParsed.success) {
				return zodParsed.data;
			}
		} catch {
			// JSON parsing failed, continue to fallback
		}

		// 3. Fallback: try to infer from response text (for Gemini and other runners)
		const lowerResponse = response.toLowerCase();

		// Check for explicit pass/fail indicators
		if (
			lowerResponse.includes('"pass": true') ||
			lowerResponse.includes('"pass":true') ||
			lowerResponse.includes("pass: true")
		) {
			// Extract reason if possible
			const reasonMatch = response.match(
				/"reason"\s*:\s*"([^"]+)"|reason:\s*["']?([^"'\n]+)/i,
			);
			return {
				pass: true,
				reason: reasonMatch
					? (reasonMatch[1] ?? reasonMatch[2] ?? "Verifications passed")
					: "Verifications passed",
			};
		}

		if (
			lowerResponse.includes('"pass": false') ||
			lowerResponse.includes('"pass":false') ||
			lowerResponse.includes("pass: false")
		) {
			const reasonMatch = response.match(
				/"reason"\s*:\s*"([^"]+)"|reason:\s*["']?([^"'\n]+)/i,
			);
			return {
				pass: false,
				reason: reasonMatch
					? (reasonMatch[1] ?? reasonMatch[2] ?? "Verifications failed")
					: "Verifications failed",
			};
		}

		// Last resort: look for success/failure indicators in natural language
		if (
			lowerResponse.includes("all verifications passed") ||
			lowerResponse.includes("all tests pass") ||
			lowerResponse.includes("verifications successful") ||
			lowerResponse.includes("cursor mock session completed")
		) {
			return {
				pass: true,
				reason: response.substring(0, 200),
			};
		}

		if (
			lowerResponse.includes("verification failed") ||
			lowerResponse.includes("tests failed") ||
			lowerResponse.includes("error") ||
			lowerResponse.includes("failure")
		) {
			return {
				pass: false,
				reason: response.substring(0, 500),
			};
		}
	}

	// Default: assume failure if we can't parse
	return {
		pass: false,
		reason: response
			? `Could not parse validation result: ${response.substring(0, 200)}`
			: "No response received from validation",
	};
}

/**
 * Get the JSON schema for validation results
 */
export function getValidationResultSchema(): typeof VALIDATION_RESULT_SCHEMA {
	return VALIDATION_RESULT_SCHEMA;
}

/**
 * Load the validation-fixer prompt template
 */
export function loadValidationFixerPrompt(): string {
	const promptPath = join(
		__dirname,
		"..",
		"prompts",
		"subroutines",
		"validation-fixer.md",
	);
	return readFileSync(promptPath, "utf-8");
}

/**
 * Render the validation-fixer prompt with context
 */
export function renderValidationFixerPrompt(
	context: ValidationFixerContext,
): string {
	let template = loadValidationFixerPrompt();

	// Replace template variables
	template = template.replace("{{FAILURE_REASON}}", context.failureReason);
	template = template.replace("{{ITERATION}}", String(context.iteration));
	template = template.replace(
		"{{MAX_ITERATIONS}}",
		String(context.maxIterations),
	);

	// Handle previous attempts section
	if (context.previousAttempts.length > 0) {
		const attemptsText = context.previousAttempts
			.map((attempt) => `- Attempt ${attempt.iteration}: ${attempt.reason}`)
			.join("\n");
		template = template.replace("{{#if PREVIOUS_ATTEMPTS}}", "");
		template = template.replace("{{/if}}", "");
		template = template.replace("{{PREVIOUS_ATTEMPTS}}", attemptsText);
	} else {
		// Remove the conditional block if no previous attempts
		template = template.replace(
			/{{#if PREVIOUS_ATTEMPTS}}[\s\S]*?{{\/if}}/g,
			"",
		);
	}

	return template;
}

/**
 * Create initial validation loop state
 */
export function createInitialState(): ValidationLoopState {
	return {
		iteration: 0,
		attempts: [],
		completed: false,
		outcome: "in_progress",
	};
}

/**
 * Record a validation attempt and determine next action
 */
export function recordAttempt(
	state: ValidationLoopState,
	result: ValidationResult,
	config: ValidationLoopConfig = DEFAULT_VALIDATION_LOOP_CONFIG,
): ValidationLoopState {
	const newIteration = state.iteration + 1;
	const newAttempts = [
		...state.attempts,
		{
			iteration: newIteration,
			result,
			timestamp: Date.now(),
		},
	];

	if (result.pass) {
		return {
			iteration: newIteration,
			attempts: newAttempts,
			completed: true,
			outcome: "passed",
		};
	}

	if (newIteration >= config.maxIterations) {
		return {
			iteration: newIteration,
			attempts: newAttempts,
			completed: true,
			outcome: "failed_max_retries",
		};
	}

	return {
		iteration: newIteration,
		attempts: newAttempts,
		completed: false,
		outcome: "in_progress",
	};
}

/**
 * Get the fixer context for the current state
 */
export function getFixerContext(
	state: ValidationLoopState,
	config: ValidationLoopConfig = DEFAULT_VALIDATION_LOOP_CONFIG,
): ValidationFixerContext | null {
	if (state.completed || state.attempts.length === 0) {
		return null;
	}

	const lastAttempt = state.attempts[state.attempts.length - 1];
	if (!lastAttempt) {
		return null;
	}

	return {
		failureReason: lastAttempt.result.reason,
		iteration: state.iteration,
		maxIterations: config.maxIterations,
		previousAttempts: state.attempts.slice(0, -1).map((a) => ({
			iteration: a.iteration,
			reason: a.result.reason,
		})),
	};
}

/**
 * Check if the validation loop should continue
 */
export function shouldContinueLoop(state: ValidationLoopState): boolean {
	return !state.completed && state.outcome === "in_progress";
}

/**
 * Check if we should proceed to the next subroutine after validation
 */
export function shouldProceedAfterValidation(
	state: ValidationLoopState,
	config: ValidationLoopConfig = DEFAULT_VALIDATION_LOOP_CONFIG,
): boolean {
	if (state.outcome === "passed") {
		return true;
	}

	if (state.outcome === "failed_max_retries") {
		return config.continueOnMaxRetries;
	}

	// Still in progress - shouldn't call this
	return false;
}

/**
 * Get a summary of the validation loop execution
 */
export function getValidationSummary(state: ValidationLoopState): string {
	if (state.outcome === "passed") {
		const lastAttempt = state.attempts[state.attempts.length - 1];
		return `Validation passed after ${state.iteration} attempt(s): ${lastAttempt?.result.reason ?? "unknown"}`;
	}

	if (state.outcome === "failed_max_retries") {
		const reasons = state.attempts
			.map((a) => `Attempt ${a.iteration}: ${a.result.reason}`)
			.join("\n");
		return `Validation failed after ${state.iteration} attempts:\n${reasons}`;
	}

	return `Validation in progress: ${state.iteration} attempt(s) so far`;
}
