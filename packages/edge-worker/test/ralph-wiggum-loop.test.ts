import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildContinuationPrompt,
	checkCompletionPromise,
	DEFAULT_RALPH_WIGGUM_CONFIG,
	deactivateLoop,
	getLoopStatusMessage,
	incrementIteration,
	initializeRalphWiggumLoop,
	loadRalphWiggumState,
	parseRalphWiggumConfig,
	RALPH_WIGGUM_LABEL_PATTERN,
	type RalphWiggumConfig,
	type RalphWiggumState,
	saveRalphWiggumState,
	shouldContinueLoop,
} from "../src/ralph-wiggum/index.js";

describe("Ralph Wiggum Loop", () => {
	let testWorkspace: string;

	beforeEach(() => {
		// Create a temporary workspace directory for each test
		testWorkspace = join(tmpdir(), `ralph-wiggum-test-${Date.now()}`);
		mkdirSync(testWorkspace, { recursive: true });
	});

	afterEach(() => {
		// Clean up the temporary workspace
		if (existsSync(testWorkspace)) {
			rmSync(testWorkspace, { recursive: true, force: true });
		}
	});

	describe("RALPH_WIGGUM_LABEL_PATTERN", () => {
		it("should match ralph-wiggum label", () => {
			expect("ralph-wiggum").toMatch(RALPH_WIGGUM_LABEL_PATTERN);
		});

		it("should match ralph-wiggum with iteration count", () => {
			expect("ralph-wiggum-10").toMatch(RALPH_WIGGUM_LABEL_PATTERN);
			expect("ralph-wiggum-5").toMatch(RALPH_WIGGUM_LABEL_PATTERN);
			expect("ralph-wiggum-100").toMatch(RALPH_WIGGUM_LABEL_PATTERN);
		});

		it("should be case insensitive", () => {
			expect("Ralph-Wiggum").toMatch(RALPH_WIGGUM_LABEL_PATTERN);
			expect("RALPH-WIGGUM-20").toMatch(RALPH_WIGGUM_LABEL_PATTERN);
		});

		it("should not match invalid labels", () => {
			expect("ralph-wiggum-abc").not.toMatch(RALPH_WIGGUM_LABEL_PATTERN);
			expect("ralph").not.toMatch(RALPH_WIGGUM_LABEL_PATTERN);
			expect("wiggum").not.toMatch(RALPH_WIGGUM_LABEL_PATTERN);
			expect("other-label").not.toMatch(RALPH_WIGGUM_LABEL_PATTERN);
		});
	});

	describe("parseRalphWiggumConfig", () => {
		it("should return null for empty labels", () => {
			expect(parseRalphWiggumConfig([])).toBeNull();
		});

		it("should return null for labels without ralph-wiggum", () => {
			expect(parseRalphWiggumConfig(["bug", "feature", "priority"])).toBeNull();
		});

		it("should parse ralph-wiggum label with default max iterations", () => {
			const config = parseRalphWiggumConfig([
				"bug",
				"ralph-wiggum",
				"priority",
			]);
			expect(config).not.toBeNull();
			expect(config!.enabled).toBe(true);
			expect(config!.maxIterations).toBe(
				DEFAULT_RALPH_WIGGUM_CONFIG.maxIterations,
			);
			expect(config!.completionPromise).toBe(
				DEFAULT_RALPH_WIGGUM_CONFIG.completionPromise,
			);
		});

		it("should parse ralph-wiggum-N label with custom max iterations", () => {
			const config = parseRalphWiggumConfig(["ralph-wiggum-25"]);
			expect(config).not.toBeNull();
			expect(config!.enabled).toBe(true);
			expect(config!.maxIterations).toBe(25);
		});

		it("should handle case variations", () => {
			const config = parseRalphWiggumConfig(["Ralph-Wiggum-15"]);
			expect(config).not.toBeNull();
			expect(config!.maxIterations).toBe(15);
		});

		it("should return first matching ralph-wiggum label", () => {
			const config = parseRalphWiggumConfig([
				"ralph-wiggum-5",
				"ralph-wiggum-10",
			]);
			expect(config).not.toBeNull();
			expect(config!.maxIterations).toBe(5);
		});
	});

	describe("DEFAULT_RALPH_WIGGUM_CONFIG", () => {
		it("should have enabled set to true", () => {
			expect(DEFAULT_RALPH_WIGGUM_CONFIG.enabled).toBe(true);
		});

		it("should have default maxIterations of 10", () => {
			expect(DEFAULT_RALPH_WIGGUM_CONFIG.maxIterations).toBe(10);
		});

		it("should have default completion promise", () => {
			expect(DEFAULT_RALPH_WIGGUM_CONFIG.completionPromise).toBe(
				"TASK COMPLETE",
			);
		});
	});

	describe("initializeRalphWiggumLoop", () => {
		it("should create state file in workspace", () => {
			const config: RalphWiggumConfig = {
				enabled: true,
				maxIterations: 15,
				completionPromise: "DONE",
			};

			const state = initializeRalphWiggumLoop(
				testWorkspace,
				config,
				"Test prompt content",
				"session-123",
			);

			expect(state.active).toBe(true);
			expect(state.iteration).toBe(1);
			expect(state.maxIterations).toBe(15);
			expect(state.completionPromise).toBe("DONE");
			expect(state.originalPrompt).toBe("Test prompt content");
			expect(state.linearAgentSessionId).toBe("session-123");

			// Verify file was created
			const stateFile = join(testWorkspace, ".claude", "ralph-loop.local.md");
			expect(existsSync(stateFile)).toBe(true);
		});

		it("should create .claude directory if it doesn't exist", () => {
			const claudeDir = join(testWorkspace, ".claude");
			expect(existsSync(claudeDir)).toBe(false);

			initializeRalphWiggumLoop(
				testWorkspace,
				DEFAULT_RALPH_WIGGUM_CONFIG,
				"Test",
				"session-1",
			);

			expect(existsSync(claudeDir)).toBe(true);
		});
	});

	describe("loadRalphWiggumState", () => {
		it("should return null if state file doesn't exist", () => {
			expect(loadRalphWiggumState(testWorkspace)).toBeNull();
		});

		it("should load state from file", () => {
			// Initialize first
			const config: RalphWiggumConfig = {
				enabled: true,
				maxIterations: 20,
				completionPromise: "ALL DONE",
			};
			initializeRalphWiggumLoop(testWorkspace, config, "My prompt", "sess-456");

			// Load it back
			const state = loadRalphWiggumState(testWorkspace);
			expect(state).not.toBeNull();
			expect(state!.active).toBe(true);
			expect(state!.iteration).toBe(1);
			expect(state!.maxIterations).toBe(20);
			expect(state!.completionPromise).toBe("ALL DONE");
			expect(state!.originalPrompt).toBe("My prompt");
			expect(state!.linearAgentSessionId).toBe("sess-456");
		});

		it("should handle state with null completion promise", () => {
			const config: RalphWiggumConfig = {
				enabled: true,
				maxIterations: 5,
			};
			initializeRalphWiggumLoop(testWorkspace, config, "Test", "sess-789");

			const state = loadRalphWiggumState(testWorkspace);
			expect(state).not.toBeNull();
			expect(state!.completionPromise).toBeNull();
		});
	});

	describe("saveRalphWiggumState", () => {
		it("should save and preserve state roundtrip", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 5,
				maxIterations: 10,
				completionPromise: "FINISHED",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Do the thing",
				linearAgentSessionId: "session-abc",
			};

			saveRalphWiggumState(testWorkspace, state);
			const loaded = loadRalphWiggumState(testWorkspace);

			expect(loaded).toEqual(state);
		});

		it("should handle multi-line prompts", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 1,
				maxIterations: 5,
				completionPromise: null,
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Line 1\nLine 2\nLine 3",
				linearAgentSessionId: "session-xyz",
			};

			saveRalphWiggumState(testWorkspace, state);
			const loaded = loadRalphWiggumState(testWorkspace);

			expect(loaded).not.toBeNull();
			expect(loaded!.originalPrompt).toBe("Line 1\nLine 2\nLine 3");
		});
	});

	describe("incrementIteration", () => {
		it("should increment iteration count", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 3,
				maxIterations: 10,
				completionPromise: "DONE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			const updated = incrementIteration(testWorkspace, state);

			expect(updated.iteration).toBe(4);
			expect(updated.active).toBe(true);

			// Verify persisted
			const loaded = loadRalphWiggumState(testWorkspace);
			expect(loaded!.iteration).toBe(4);
		});
	});

	describe("deactivateLoop", () => {
		it("should set active to false", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 5,
				maxIterations: 10,
				completionPromise: "DONE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			deactivateLoop(testWorkspace, state, "Max iterations reached");

			const loaded = loadRalphWiggumState(testWorkspace);
			expect(loaded!.active).toBe(false);
			expect(loaded!.iteration).toBe(5); // Preserved
		});
	});

	describe("checkCompletionPromise", () => {
		it("should return false for null completion promise", () => {
			expect(checkCompletionPromise("Some response", null)).toBe(false);
		});

		it("should detect exact promise in response", () => {
			const response =
				"Work done. <promise>TASK COMPLETE</promise> All finished.";
			expect(checkCompletionPromise(response, "TASK COMPLETE")).toBe(true);
		});

		it("should be case insensitive", () => {
			const response = "<promise>Task Complete</promise>";
			expect(checkCompletionPromise(response, "TASK COMPLETE")).toBe(true);
		});

		it("should return false if promise not found", () => {
			const response = "Still working on this task...";
			expect(checkCompletionPromise(response, "TASK COMPLETE")).toBe(false);
		});

		it("should return false for wrong promise", () => {
			const response = "<promise>SOMETHING ELSE</promise>";
			expect(checkCompletionPromise(response, "TASK COMPLETE")).toBe(false);
		});

		it("should handle multiple promise tags", () => {
			const response =
				"<promise>WRONG</promise> and then <promise>TASK COMPLETE</promise>";
			expect(checkCompletionPromise(response, "TASK COMPLETE")).toBe(true);
		});

		it("should handle whitespace in promise content", () => {
			const response = "<promise>  TASK COMPLETE  </promise>";
			expect(checkCompletionPromise(response, "TASK COMPLETE")).toBe(true);
		});
	});

	describe("shouldContinueLoop", () => {
		it("should return false if loop is not active", () => {
			const state: RalphWiggumState = {
				active: false,
				iteration: 1,
				maxIterations: 10,
				completionPromise: "DONE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			const result = shouldContinueLoop(state);
			expect(result.shouldContinue).toBe(false);
			expect(result.reason).toContain("not active");
		});

		it("should return false if completion promise is satisfied", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 2,
				maxIterations: 10,
				completionPromise: "TASK COMPLETE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			const result = shouldContinueLoop(
				state,
				"<promise>TASK COMPLETE</promise>",
			);
			expect(result.shouldContinue).toBe(false);
			expect(result.reason).toContain("Completion promise satisfied");
		});

		it("should return false if max iterations reached", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 10,
				maxIterations: 10,
				completionPromise: "DONE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			const result = shouldContinueLoop(state);
			expect(result.shouldContinue).toBe(false);
			expect(result.reason).toContain("Max iterations reached");
		});

		it("should return true if loop should continue", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 5,
				maxIterations: 10,
				completionPromise: "DONE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			const result = shouldContinueLoop(state, "Still working...");
			expect(result.shouldContinue).toBe(true);
			expect(result.reason).toBe("Continuing loop");
		});

		it("should handle unlimited iterations (maxIterations = 0)", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 100,
				maxIterations: 0,
				completionPromise: "DONE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			const result = shouldContinueLoop(state, "Still working...");
			expect(result.shouldContinue).toBe(true);
		});
	});

	describe("buildContinuationPrompt", () => {
		it("should build prompt with iteration info", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 3,
				maxIterations: 10,
				completionPromise: "TASK COMPLETE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Build a feature",
				linearAgentSessionId: "session-1",
			};

			const prompt = buildContinuationPrompt(state);

			expect(prompt).toContain("Iteration 4/10");
			expect(prompt).toContain("iteration 4");
			expect(prompt).toContain("Build a feature");
			expect(prompt).toContain("<promise>TASK COMPLETE</promise>");
		});

		it("should handle unlimited iterations", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 50,
				maxIterations: 0,
				completionPromise: null,
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Keep working",
				linearAgentSessionId: "session-1",
			};

			const prompt = buildContinuationPrompt(state);

			expect(prompt).toContain("51 (unlimited)");
			expect(prompt).toContain("until max iterations are reached");
		});

		it("should include warning about false promises", () => {
			const state: RalphWiggumState = {
				active: true,
				iteration: 1,
				maxIterations: 5,
				completionPromise: "DONE",
				startedAt: "2025-01-01T00:00:00.000Z",
				originalPrompt: "Test",
				linearAgentSessionId: "session-1",
			};

			const prompt = buildContinuationPrompt(state);

			expect(prompt).toContain("TRULY complete");
			expect(prompt).toContain("Do NOT output a false promise");
		});
	});

	describe("getLoopStatusMessage", () => {
		const state: RalphWiggumState = {
			active: true,
			iteration: 3,
			maxIterations: 10,
			completionPromise: "DONE",
			startedAt: "2025-01-01T00:00:00.000Z",
			originalPrompt: "Test",
			linearAgentSessionId: "session-1",
		};

		it("should return started message", () => {
			const message = getLoopStatusMessage(state, "started");
			expect(message).toContain("started");
			expect(message).toContain("max iterations: 10");
		});

		it("should return continuing message", () => {
			const message = getLoopStatusMessage(state, "continuing");
			expect(message).toContain("continuing");
			expect(message).toContain("iteration 4");
		});

		it("should return completed message", () => {
			const message = getLoopStatusMessage(state, "completed");
			expect(message).toContain("completed");
			expect(message).toContain("3/10");
		});

		it("should return max_iterations message", () => {
			const message = getLoopStatusMessage(state, "max_iterations");
			expect(message).toContain("stopped");
			expect(message).toContain("max iterations (10)");
		});

		it("should handle unlimited iterations", () => {
			const unlimitedState = { ...state, maxIterations: 0 };
			const message = getLoopStatusMessage(unlimitedState, "started");
			expect(message).toContain("unlimited");
		});
	});
});
