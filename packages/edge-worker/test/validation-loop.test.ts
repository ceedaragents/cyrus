import { describe, expect, it } from "vitest";
import {
	createInitialState,
	DEFAULT_VALIDATION_LOOP_CONFIG,
	getFixerContext,
	getValidationResultSchema,
	getValidationSummary,
	parseValidationResult,
	recordAttempt,
	renderValidationFixerPrompt,
	shouldContinueLoop,
	shouldProceedAfterValidation,
	type ValidationLoopState,
	type ValidationResult,
	ValidationResultSchema,
} from "../src/validation/index.js";

describe("Validation Loop", () => {
	describe("parseValidationResult", () => {
		describe("structured output parsing", () => {
			it("should parse native structured output", () => {
				const structuredOutput = { pass: true, reason: "All tests passed" };
				const result = parseValidationResult(undefined, structuredOutput);
				expect(result.pass).toBe(true);
				expect(result.reason).toBe("All tests passed");
			});

			it("should parse structured output with false pass", () => {
				const structuredOutput = {
					pass: false,
					reason: "TypeScript error in foo.ts",
				};
				const result = parseValidationResult(undefined, structuredOutput);
				expect(result.pass).toBe(false);
				expect(result.reason).toBe("TypeScript error in foo.ts");
			});

			it("should ignore invalid structured output", () => {
				const structuredOutput = { invalid: "data" };
				const result = parseValidationResult(
					'{"pass": true, "reason": "test"}',
					structuredOutput,
				);
				expect(result.pass).toBe(true);
				expect(result.reason).toBe("test");
			});
		});

		describe("JSON response parsing", () => {
			it("should parse valid JSON response", () => {
				const response = '{"pass": true, "reason": "47 tests passing"}';
				const result = parseValidationResult(response);
				expect(result.pass).toBe(true);
				expect(result.reason).toBe("47 tests passing");
			});

			it("should parse JSON from markdown code block", () => {
				const response = `Here is the result:
\`\`\`json
{"pass": false, "reason": "3 tests failing"}
\`\`\``;
				const result = parseValidationResult(response);
				expect(result.pass).toBe(false);
				expect(result.reason).toBe("3 tests failing");
			});

			it("should parse JSON from code block without language specifier", () => {
				const response = `\`\`\`
{"pass": true, "reason": "linting clean"}
\`\`\``;
				const result = parseValidationResult(response);
				expect(result.pass).toBe(true);
				expect(result.reason).toBe("linting clean");
			});
		});

		describe("fallback text pattern parsing", () => {
			it("should parse pass: true from text", () => {
				const response = 'The result is "pass": true with reason: "all good"';
				const result = parseValidationResult(response);
				expect(result.pass).toBe(true);
			});

			it("should parse pass: false from text", () => {
				const response =
					'Verification failed. "pass": false, reason: "type error"';
				const result = parseValidationResult(response);
				expect(result.pass).toBe(false);
			});

			it("should infer pass from natural language success indicators", () => {
				const response = "All verifications passed successfully";
				const result = parseValidationResult(response);
				expect(result.pass).toBe(true);
			});

			it("should infer fail from natural language failure indicators", () => {
				const response = "Verification failed: 3 tests not passing";
				const result = parseValidationResult(response);
				expect(result.pass).toBe(false);
			});

			it("should default to failure for unparseable response", () => {
				const response = "Some random text that has no indicators";
				const result = parseValidationResult(response);
				expect(result.pass).toBe(false);
				expect(result.reason).toContain("Could not parse validation result");
			});

			it("should handle empty response", () => {
				const result = parseValidationResult(undefined);
				expect(result.pass).toBe(false);
				expect(result.reason).toBe("No response received from validation");
			});
		});
	});

	describe("getValidationResultSchema", () => {
		it("should return a valid JSON schema", () => {
			const schema = getValidationResultSchema();
			expect(schema.type).toBe("object");
			expect(schema.properties).toHaveProperty("pass");
			expect(schema.properties).toHaveProperty("reason");
			expect(schema.required).toContain("pass");
			expect(schema.required).toContain("reason");
			expect(schema.additionalProperties).toBe(false);
		});
	});

	describe("ValidationResultSchema (Zod)", () => {
		it("should validate correct input", () => {
			const result = ValidationResultSchema.safeParse({
				pass: true,
				reason: "All tests passed",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.pass).toBe(true);
				expect(result.data.reason).toBe("All tests passed");
			}
		});

		it("should validate false pass value", () => {
			const result = ValidationResultSchema.safeParse({
				pass: false,
				reason: "TypeScript error",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.pass).toBe(false);
			}
		});

		it("should reject missing pass field", () => {
			const result = ValidationResultSchema.safeParse({
				reason: "Some reason",
			});
			expect(result.success).toBe(false);
		});

		it("should reject missing reason field", () => {
			const result = ValidationResultSchema.safeParse({
				pass: true,
			});
			expect(result.success).toBe(false);
		});

		it("should reject invalid pass type", () => {
			const result = ValidationResultSchema.safeParse({
				pass: "true",
				reason: "Some reason",
			});
			expect(result.success).toBe(false);
		});

		it("should reject invalid reason type", () => {
			const result = ValidationResultSchema.safeParse({
				pass: true,
				reason: 123,
			});
			expect(result.success).toBe(false);
		});

		it("should allow extra properties (Zod strips them)", () => {
			const result = ValidationResultSchema.safeParse({
				pass: true,
				reason: "Test",
				extra: "field",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				// Zod strips extra properties by default
				expect(result.data).not.toHaveProperty("extra");
			}
		});
	});

	describe("createInitialState", () => {
		it("should create initial state with correct defaults", () => {
			const state = createInitialState();
			expect(state.iteration).toBe(0);
			expect(state.attempts).toEqual([]);
			expect(state.completed).toBe(false);
			expect(state.outcome).toBe("in_progress");
		});
	});

	describe("recordAttempt", () => {
		it("should record a passing attempt and complete the loop", () => {
			const initialState = createInitialState();
			const result: ValidationResult = {
				pass: true,
				reason: "All tests passed",
			};

			const newState = recordAttempt(initialState, result);

			expect(newState.iteration).toBe(1);
			expect(newState.attempts).toHaveLength(1);
			expect(newState.attempts[0].result.pass).toBe(true);
			expect(newState.completed).toBe(true);
			expect(newState.outcome).toBe("passed");
		});

		it("should record a failing attempt and continue loop", () => {
			const initialState = createInitialState();
			const result: ValidationResult = { pass: false, reason: "Test failure" };

			const newState = recordAttempt(initialState, result);

			expect(newState.iteration).toBe(1);
			expect(newState.attempts).toHaveLength(1);
			expect(newState.attempts[0].result.pass).toBe(false);
			expect(newState.completed).toBe(false);
			expect(newState.outcome).toBe("in_progress");
		});

		it("should complete loop after max iterations", () => {
			let state = createInitialState();
			const failResult: ValidationResult = {
				pass: false,
				reason: "Test failure",
			};

			// Record 4 failing attempts
			for (let i = 0; i < 4; i++) {
				state = recordAttempt(state, failResult);
			}

			expect(state.iteration).toBe(4);
			expect(state.completed).toBe(true);
			expect(state.outcome).toBe("failed_max_retries");
		});

		it("should pass on any iteration when validation succeeds", () => {
			let state = createInitialState();
			const failResult: ValidationResult = {
				pass: false,
				reason: "Test failure",
			};
			const passResult: ValidationResult = {
				pass: true,
				reason: "All tests passed",
			};

			// Record 2 failing attempts, then pass
			state = recordAttempt(state, failResult);
			state = recordAttempt(state, failResult);
			state = recordAttempt(state, passResult);

			expect(state.iteration).toBe(3);
			expect(state.completed).toBe(true);
			expect(state.outcome).toBe("passed");
		});

		it("should respect custom maxIterations config", () => {
			let state = createInitialState();
			const failResult: ValidationResult = {
				pass: false,
				reason: "Test failure",
			};
			const customConfig = { maxIterations: 2, continueOnMaxRetries: true };

			state = recordAttempt(state, failResult, customConfig);
			expect(state.completed).toBe(false);

			state = recordAttempt(state, failResult, customConfig);
			expect(state.completed).toBe(true);
			expect(state.outcome).toBe("failed_max_retries");
		});
	});

	describe("getFixerContext", () => {
		it("should return null for completed state", () => {
			const state: ValidationLoopState = {
				iteration: 1,
				attempts: [
					{
						iteration: 1,
						result: { pass: true, reason: "passed" },
						timestamp: Date.now(),
					},
				],
				completed: true,
				outcome: "passed",
			};

			expect(getFixerContext(state)).toBeNull();
		});

		it("should return null for state with no attempts", () => {
			const state = createInitialState();
			expect(getFixerContext(state)).toBeNull();
		});

		it("should return correct context after first failure", () => {
			const state: ValidationLoopState = {
				iteration: 1,
				attempts: [
					{
						iteration: 1,
						result: { pass: false, reason: "TypeScript error" },
						timestamp: Date.now(),
					},
				],
				completed: false,
				outcome: "in_progress",
			};

			const context = getFixerContext(state);
			expect(context).not.toBeNull();
			expect(context!.failureReason).toBe("TypeScript error");
			expect(context!.iteration).toBe(1);
			expect(context!.maxIterations).toBe(4);
			expect(context!.previousAttempts).toEqual([]);
		});

		it("should include previous attempts in context", () => {
			const state: ValidationLoopState = {
				iteration: 3,
				attempts: [
					{
						iteration: 1,
						result: { pass: false, reason: "First error" },
						timestamp: Date.now(),
					},
					{
						iteration: 2,
						result: { pass: false, reason: "Second error" },
						timestamp: Date.now(),
					},
					{
						iteration: 3,
						result: { pass: false, reason: "Third error" },
						timestamp: Date.now(),
					},
				],
				completed: false,
				outcome: "in_progress",
			};

			const context = getFixerContext(state);
			expect(context).not.toBeNull();
			expect(context!.failureReason).toBe("Third error");
			expect(context!.previousAttempts).toHaveLength(2);
			expect(context!.previousAttempts[0].reason).toBe("First error");
			expect(context!.previousAttempts[1].reason).toBe("Second error");
		});
	});

	describe("shouldContinueLoop", () => {
		it("should return true for in_progress state", () => {
			const state = createInitialState();
			// Record one failure to get into the loop
			const newState = recordAttempt(state, {
				pass: false,
				reason: "error",
			});
			expect(shouldContinueLoop(newState)).toBe(true);
		});

		it("should return false for passed state", () => {
			const state = recordAttempt(createInitialState(), {
				pass: true,
				reason: "success",
			});
			expect(shouldContinueLoop(state)).toBe(false);
		});

		it("should return false for failed_max_retries state", () => {
			let state = createInitialState();
			for (let i = 0; i < 4; i++) {
				state = recordAttempt(state, { pass: false, reason: "error" });
			}
			expect(shouldContinueLoop(state)).toBe(false);
		});
	});

	describe("shouldProceedAfterValidation", () => {
		it("should return true for passed state", () => {
			const state = recordAttempt(createInitialState(), {
				pass: true,
				reason: "success",
			});
			expect(shouldProceedAfterValidation(state)).toBe(true);
		});

		it("should return true for failed_max_retries with continueOnMaxRetries", () => {
			let state = createInitialState();
			for (let i = 0; i < 4; i++) {
				state = recordAttempt(state, { pass: false, reason: "error" });
			}
			expect(
				shouldProceedAfterValidation(state, DEFAULT_VALIDATION_LOOP_CONFIG),
			).toBe(true);
		});

		it("should return false for failed_max_retries without continueOnMaxRetries", () => {
			let state = createInitialState();
			const config = { maxIterations: 4, continueOnMaxRetries: false };
			for (let i = 0; i < 4; i++) {
				state = recordAttempt(state, { pass: false, reason: "error" }, config);
			}
			expect(shouldProceedAfterValidation(state, config)).toBe(false);
		});
	});

	describe("getValidationSummary", () => {
		it("should return success message for passed state", () => {
			const state = recordAttempt(createInitialState(), {
				pass: true,
				reason: "47 tests passing",
			});
			const summary = getValidationSummary(state);
			expect(summary).toContain("passed");
			expect(summary).toContain("47 tests passing");
			expect(summary).toContain("1 attempt");
		});

		it("should return failure message for failed_max_retries state", () => {
			let state = createInitialState();
			for (let i = 0; i < 4; i++) {
				state = recordAttempt(state, {
					pass: false,
					reason: `Error ${i + 1}`,
				});
			}
			const summary = getValidationSummary(state);
			expect(summary).toContain("failed");
			expect(summary).toContain("4 attempts");
		});

		it("should return in progress message for in_progress state", () => {
			const state = recordAttempt(createInitialState(), {
				pass: false,
				reason: "error",
			});
			const summary = getValidationSummary(state);
			expect(summary).toContain("in progress");
		});
	});

	describe("renderValidationFixerPrompt", () => {
		it("should render prompt with failure context", () => {
			const prompt = renderValidationFixerPrompt({
				failureReason: "TypeScript error in UserService.ts:42",
				iteration: 1,
				maxIterations: 4,
				previousAttempts: [],
			});

			expect(prompt).toContain("TypeScript error in UserService.ts:42");
			expect(prompt).toContain("Attempt 1 of 4");
		});

		it("should include previous attempts when available", () => {
			const prompt = renderValidationFixerPrompt({
				failureReason: "Current error",
				iteration: 3,
				maxIterations: 4,
				previousAttempts: [
					{ iteration: 1, reason: "First error" },
					{ iteration: 2, reason: "Second error" },
				],
			});

			expect(prompt).toContain("Current error");
			expect(prompt).toContain("Attempt 3 of 4");
			expect(prompt).toContain("First error");
			expect(prompt).toContain("Second error");
		});
	});

	describe("DEFAULT_VALIDATION_LOOP_CONFIG", () => {
		it("should have default maxIterations of 4", () => {
			expect(DEFAULT_VALIDATION_LOOP_CONFIG.maxIterations).toBe(4);
		});

		it("should have continueOnMaxRetries set to true", () => {
			expect(DEFAULT_VALIDATION_LOOP_CONFIG.continueOnMaxRetries).toBe(true);
		});
	});
});
