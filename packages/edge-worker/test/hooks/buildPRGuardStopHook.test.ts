import { exec } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPRGuardStopHook } from "../../src/hooks/buildPRGuardStopHook.js";

vi.mock("node:child_process", () => ({
	exec: vi.fn(),
}));

const mockExec = vi.mocked(exec);

/**
 * Helper to simulate exec returning a result via callback (promisify pattern).
 * We mock exec to invoke its callback synchronously with the given stdout/stderr.
 */
function _mockExecResult(stdout: string, stderr = "") {
	mockExec.mockImplementation((_cmd: any, _opts: any, callback?: any) => {
		// promisify passes (err, {stdout, stderr})
		const cb = callback || _opts;
		if (typeof cb === "function") {
			cb(null, { stdout, stderr });
		}
		return undefined as any;
	});
}

/**
 * Helper to simulate exec throwing an error.
 */
function mockExecError(error: Error) {
	mockExec.mockImplementation((_cmd: any, _opts: any, callback?: any) => {
		const cb = callback || _opts;
		if (typeof cb === "function") {
			cb(error, { stdout: "", stderr: "" });
		}
		return undefined as any;
	});
}

/**
 * Helper to simulate exec returning different results for different commands.
 */
function mockExecByCommand(commandResults: Record<string, string>) {
	mockExec.mockImplementation((cmd: any, _opts: any, callback?: any) => {
		const cb = callback || _opts;
		if (typeof cb === "function") {
			const cmdStr = String(cmd);
			for (const [pattern, stdout] of Object.entries(commandResults)) {
				if (cmdStr.includes(pattern)) {
					cb(null, { stdout, stderr: "" });
					return undefined as any;
				}
			}
			// Default: empty output
			cb(null, { stdout: "", stderr: "" });
		}
		return undefined as any;
	});
}

describe("buildPRGuardStopHook", () => {
	const mockLogger: any = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		withContext: vi.fn().mockReturnThis(),
		getLevel: vi.fn(),
		setLevel: vi.fn(),
	};

	const cwd = "/workspace/repo";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * Invoke the hook with the given input and return the result.
	 */
	async function invokeHook(stopHookActive: boolean) {
		const matchers = buildPRGuardStopHook(cwd, mockLogger);
		expect(matchers).toHaveLength(1);
		expect(matchers[0].hooks).toHaveLength(1);

		const hookFn = matchers[0].hooks[0];
		const input = {
			hook_event_name: "Stop",
			stop_hook_active: stopHookActive,
		} as any;
		const signal = new AbortController().signal;

		return hookFn(input, undefined, { signal });
	}

	describe("infinite loop prevention", () => {
		it("returns empty/allow when stop_hook_active is true", async () => {
			// When stop_hook_active is true, the hook should allow stopping
			// regardless of code changes or PR status
			mockExecByCommand({
				"git status": " M src/file.ts", // Uncommitted changes exist
			});

			const result = await invokeHook(true);

			expect(result).toEqual({});
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining("stop_hook_active=true"),
			);
		});

		it("does not run git checks when stop_hook_active is true", async () => {
			await invokeHook(true);

			// exec should not be called at all when stop_hook_active is true
			expect(mockExec).not.toHaveBeenCalled();
		});
	});

	describe("blocking behavior", () => {
		it("blocks when there are uncommitted changes and no PR", async () => {
			mockExecByCommand({
				"git status --porcelain": " M src/file.ts\n",
				"gh pr view": "", // Will be called but the check won't reach it
			});

			const result = await invokeHook(false);

			expect(result).toEqual({
				decision: "block",
				reason: expect.stringContaining("haven't created a pull request"),
			});
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("blocking stop"),
			);
		});

		it("blocks when there are unpushed commits and no PR", async () => {
			mockExecByCommand({
				"git status --porcelain": "", // No uncommitted changes
				"git log --oneline": "abc1234 feat: add new feature\n", // Unpushed commits exist
				"gh pr view": "", // No PR
			});

			// Need more precise control: git status returns empty, git log returns commits
			mockExec.mockImplementation((cmd: any, _opts: any, callback?: any) => {
				const cb = callback || _opts;
				if (typeof cb === "function") {
					const cmdStr = String(cmd);
					if (cmdStr.includes("git status --porcelain")) {
						cb(null, { stdout: "", stderr: "" });
					} else if (cmdStr.includes("git log --oneline")) {
						cb(null, {
							stdout: "abc1234 feat: add new feature\n",
							stderr: "",
						});
					} else if (cmdStr.includes("gh pr view")) {
						cb(new Error("no pull requests found"), {
							stdout: "",
							stderr: "",
						});
					} else {
						cb(null, { stdout: "", stderr: "" });
					}
				}
				return undefined as any;
			});

			const result = await invokeHook(false);

			expect(result).toEqual({
				decision: "block",
				reason: expect.stringContaining("pull request"),
			});
		});

		it("block reason includes instructions for creating a PR", async () => {
			mockExecByCommand({
				"git status --porcelain": " M changed-file.ts\n",
			});

			const result = await invokeHook(false);

			expect(result).toEqual(
				expect.objectContaining({
					decision: "block",
					reason: expect.stringContaining("git push"),
				}),
			);
			expect((result as any).reason).toContain("gh pr create");
		});
	});

	describe("allowing stop", () => {
		it("allows when no changes exist (clean working tree, no unpushed commits)", async () => {
			// git status returns empty, git log returns empty
			mockExec.mockImplementation((_cmd: any, _opts: any, callback?: any) => {
				const cb = callback || _opts;
				if (typeof cb === "function") {
					cb(null, { stdout: "", stderr: "" });
				}
				return undefined as any;
			});

			const result = await invokeHook(false);

			expect(result).toEqual({});
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining("no code changes"),
			);
		});

		it("allows when PR already exists despite code changes", async () => {
			mockExec.mockImplementation((cmd: any, _opts: any, callback?: any) => {
				const cb = callback || _opts;
				if (typeof cb === "function") {
					const cmdStr = String(cmd);
					if (cmdStr.includes("git status --porcelain")) {
						cb(null, {
							stdout: " M src/modified.ts\n",
							stderr: "",
						});
					} else if (cmdStr.includes("gh pr view")) {
						cb(null, {
							stdout: "https://github.com/org/repo/pull/42\n",
							stderr: "",
						});
					} else {
						cb(null, { stdout: "", stderr: "" });
					}
				}
				return undefined as any;
			});

			const result = await invokeHook(false);

			expect(result).toEqual({});
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining("PR already exists"),
			);
		});
	});

	describe("error handling", () => {
		it("allows stop when exec throws an error (graceful degradation)", async () => {
			// When all exec calls fail, hasCodeChanges catches the error internally
			// and returns false (assumes no changes), so the hook allows stop.
			mockExecError(new Error("git not found"));

			const result = await invokeHook(false);

			expect(result).toEqual({});
			// The debug log comes from the "no code changes" path since hasCodeChanges
			// catches the error and returns false
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining("no code changes"),
			);
		});

		it("allows stop when git status command fails", async () => {
			mockExec.mockImplementation((_cmd: any, _opts: any, callback?: any) => {
				const cb = callback || _opts;
				if (typeof cb === "function") {
					cb(new Error("fatal: not a git repository"), {
						stdout: "",
						stderr: "",
					});
				}
				return undefined as any;
			});

			const result = await invokeHook(false);

			// hasCodeChanges catches the error and returns false, so stop is allowed
			expect(result).toEqual({});
		});
	});

	describe("return structure", () => {
		it("buildPRGuardStopHook returns an array with one HookCallbackMatcher", () => {
			const matchers = buildPRGuardStopHook(cwd, mockLogger);

			expect(Array.isArray(matchers)).toBe(true);
			expect(matchers).toHaveLength(1);
		});

		it("HookCallbackMatcher has a hooks array with one function", () => {
			const matchers = buildPRGuardStopHook(cwd, mockLogger);

			expect(matchers[0].hooks).toBeDefined();
			expect(Array.isArray(matchers[0].hooks)).toBe(true);
			expect(matchers[0].hooks).toHaveLength(1);
			expect(typeof matchers[0].hooks[0]).toBe("function");
		});
	});
});
