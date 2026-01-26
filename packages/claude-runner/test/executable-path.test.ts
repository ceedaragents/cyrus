import { existsSync } from "node:fs";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test case for CYPACK-762: Claude Code executable not found error
 *
 * Root cause: When ClaudeRunner calls the SDK's query() function, it doesn't
 * pass `pathToClaudeCodeExecutable`. The SDK then tries to derive the path
 * from import.meta.url, which can fail in certain environments:
 *
 * 1. Global npm installs where the package is symlinked
 * 2. pnpm's nested node_modules structure where the SDK is not directly
 *    in the expected location
 * 3. Bundled/compiled code where import.meta.url doesn't resolve correctly
 *
 * The error manifests as:
 * "Claude Code executable not found at <path>/cli.js. Is options.pathToClaudeCodeExecutable set?"
 *
 * Solution: ClaudeRunner should explicitly pass pathToClaudeCodeExecutable
 * to the SDK query() function, deriving it from:
 * 1. An explicit config option if provided
 * 2. The SDK's actual installed location (via require.resolve)
 */

// Store captured query options for inspection
let capturedQueryOptions:
	| Parameters<typeof import("@anthropic-ai/claude-agent-sdk").query>[0]
	| null = null;

// Mock the SDK to capture what options are passed
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(async function* (opts) {
		capturedQueryOptions = opts;
		// Yield a minimal response to complete the session
		yield {
			type: "assistant",
			message: { content: [{ type: "text", text: "Test response" }] },
			parent_tool_use_id: null,
			session_id: "test-session",
		};
	}),
}));

// Mock file system operations - note: existsSync returns true by default
// so that auto-resolution can verify the cli.js file exists
vi.mock("fs", () => ({
	mkdirSync: vi.fn(),
	existsSync: vi.fn(() => true),
	readFileSync: vi.fn(() => ""),
	createWriteStream: vi.fn(() => ({
		write: vi.fn(),
		end: vi.fn(),
		on: vi.fn(),
	})),
}));

// Mock os module
vi.mock("os", () => ({
	homedir: vi.fn(() => "/mock/home"),
}));

import { ClaudeRunner } from "../src/ClaudeRunner";
import type { ClaudeRunnerConfig } from "../src/types";

describe("CYPACK-762: pathToClaudeCodeExecutable", () => {
	const defaultConfig: ClaudeRunnerConfig = {
		workingDirectory: "/tmp/test",
		cyrusHome: "/tmp/test-cyrus-home",
	};

	beforeEach(() => {
		capturedQueryOptions = null;
		vi.clearAllMocks();
		// Reset existsSync to return true by default
		vi.mocked(existsSync).mockReturnValue(true);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * This test verifies that ClaudeRunner auto-resolves pathToClaudeCodeExecutable
	 * when not explicitly provided in config, fixing issues in symlinked environments.
	 */
	it("should auto-resolve pathToClaudeCodeExecutable when not configured", async () => {
		const runner = new ClaudeRunner(defaultConfig);
		await runner.start("Test prompt");

		expect(capturedQueryOptions).not.toBeNull();
		const options = capturedQueryOptions!.options as Options;

		// ClaudeRunner should auto-resolve the path using require.resolve
		expect(options.pathToClaudeCodeExecutable).toBeDefined();
		expect(options.pathToClaudeCodeExecutable).toMatch(/cli\.js$/);
	});

	/**
	 * This test verifies that when a custom pathToClaudeCodeExecutable is
	 * provided in the config, it takes precedence over auto-resolution.
	 */
	it("should respect custom pathToClaudeCodeExecutable from config", async () => {
		const customPath = "/custom/path/to/cli.js";
		const configWithPath: ClaudeRunnerConfig = {
			...defaultConfig,
			pathToClaudeCodeExecutable: customPath,
		};

		const runner = new ClaudeRunner(configWithPath);
		await runner.start("Test prompt");

		expect(capturedQueryOptions).not.toBeNull();
		const options = capturedQueryOptions!.options as Options;

		// Config value should take precedence over auto-resolution
		expect(options.pathToClaudeCodeExecutable).toBe(customPath);
	});

	/**
	 * This test verifies that if cli.js doesn't exist at the resolved path,
	 * ClaudeRunner gracefully falls back to not passing the option.
	 */
	it("should not pass pathToClaudeCodeExecutable when cli.js doesn't exist", async () => {
		// Mock existsSync to return false for cli.js check
		vi.mocked(existsSync).mockReturnValue(false);

		const runner = new ClaudeRunner(defaultConfig);
		await runner.start("Test prompt");

		expect(capturedQueryOptions).not.toBeNull();
		const options = capturedQueryOptions!.options as Options;

		// When cli.js doesn't exist, we don't pass pathToClaudeCodeExecutable
		// The SDK will use its default resolution logic
		expect(options.pathToClaudeCodeExecutable).toBeUndefined();
	});

	/**
	 * This test verifies the resolved path ends with cli.js as expected by the SDK.
	 */
	it("should resolve to a path ending with cli.js", async () => {
		const runner = new ClaudeRunner(defaultConfig);
		await runner.start("Test prompt");

		expect(capturedQueryOptions).not.toBeNull();
		const options = capturedQueryOptions!.options as Options;

		// The resolved path must end with cli.js
		expect(options.pathToClaudeCodeExecutable).toBeDefined();
		expect(options.pathToClaudeCodeExecutable).toMatch(/cli\.js$/);
	});
});
