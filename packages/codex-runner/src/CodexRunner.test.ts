/**
 * Tests for CodexRunner
 *
 * Tests the IAgentRunner implementation for Codex CLI.
 * These tests focus on the public interface and message handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexRunner } from "./CodexRunner.js";
import { CodexMessageFormatter } from "./formatter.js";
import type { CodexRunnerConfig } from "./types.js";

// Mock child_process and fs to avoid actually spawning processes
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
	createWriteStream: vi.fn(() => ({
		write: vi.fn(),
		end: vi.fn(),
	})),
	mkdirSync: vi.fn(),
	existsSync: vi.fn(() => false),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	copyFileSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

describe("CodexRunner", () => {
	let config: CodexRunnerConfig;

	beforeEach(() => {
		config = {
			cyrusHome: "/tmp/cyrus-test",
			workingDirectory: "/tmp/test-workspace",
			model: "gpt-5.1-codex-max",
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("constructor", () => {
		it("should create a CodexRunner instance", () => {
			const runner = new CodexRunner(config);
			expect(runner).toBeInstanceOf(CodexRunner);
		});

		it("should set supportsStreamingInput to false", () => {
			const runner = new CodexRunner(config);
			expect(runner.supportsStreamingInput).toBe(false);
		});

		it("should register onMessage callback as event listener", () => {
			const onMessage = vi.fn();
			const runner = new CodexRunner({ ...config, onMessage });

			// Emit a message event
			runner.emit("message", { type: "system", subtype: "init" } as any);
			expect(onMessage).toHaveBeenCalledTimes(1);
		});

		it("should register onError callback as event listener", () => {
			const onError = vi.fn();
			const runner = new CodexRunner({ ...config, onError });

			// Emit an error event
			const error = new Error("test error");
			runner.emit("error", error);
			expect(onError).toHaveBeenCalledWith(error);
		});

		it("should register onComplete callback as event listener", () => {
			const onComplete = vi.fn();
			const runner = new CodexRunner({ ...config, onComplete });

			// Emit a complete event
			runner.emit("complete", []);
			expect(onComplete).toHaveBeenCalledWith([]);
		});
	});

	describe("isRunning", () => {
		it("should return false initially", () => {
			const runner = new CodexRunner(config);
			expect(runner.isRunning()).toBe(false);
		});
	});

	describe("getMessages", () => {
		it("should return empty array initially", () => {
			const runner = new CodexRunner(config);
			expect(runner.getMessages()).toEqual([]);
		});

		it("should return a copy of messages array", () => {
			const runner = new CodexRunner(config);
			const messages1 = runner.getMessages();
			const messages2 = runner.getMessages();
			expect(messages1).not.toBe(messages2);
			expect(messages1).toEqual(messages2);
		});
	});

	describe("getFormatter", () => {
		it("should return CodexMessageFormatter", () => {
			const runner = new CodexRunner(config);
			const formatter = runner.getFormatter();
			expect(formatter).toBeInstanceOf(CodexMessageFormatter);
		});

		it("should return the same formatter instance", () => {
			const runner = new CodexRunner(config);
			const formatter1 = runner.getFormatter();
			const formatter2 = runner.getFormatter();
			expect(formatter1).toBe(formatter2);
		});
	});

	describe("getLastAgentMessage", () => {
		it("should return null initially", () => {
			const runner = new CodexRunner(config);
			expect(runner.getLastAgentMessage()).toBeNull();
		});
	});

	describe("stop", () => {
		it("should not throw when called without active session", () => {
			const runner = new CodexRunner(config);
			expect(() => runner.stop()).not.toThrow();
		});
	});

	describe("configuration options", () => {
		it("should accept all CodexRunnerConfig options", () => {
			const fullConfig: CodexRunnerConfig = {
				cyrusHome: "/home/user/.cyrus",
				workingDirectory: "/path/to/repo",
				model: "gpt-5.1-codex-max",
				codexPath: "/usr/local/bin/codex",
				sandboxMode: "workspace-write",
				reasoningEffort: "high",
				reasoningSummary: "detailed",
				approvalPolicy: "never",
				debug: true,
				skipGitRepoCheck: true,
				resumeSessionId: "thread_abc123",
				appendSystemPrompt: "You are a helpful assistant",
				mcpConfig: {
					linear: {
						command: "npx",
						args: ["-y", "@anthropic-ai/linear-mcp-server"],
					},
				},
				onMessage: vi.fn(),
				onError: vi.fn(),
				onComplete: vi.fn(),
			};

			const runner = new CodexRunner(fullConfig);
			expect(runner).toBeInstanceOf(CodexRunner);
		});
	});

	describe("event emitter interface", () => {
		it("should support on/emit for message events", () => {
			const runner = new CodexRunner(config);
			const listener = vi.fn();

			runner.on("message", listener);
			runner.emit("message", { type: "system" } as any);

			expect(listener).toHaveBeenCalledWith({ type: "system" });
		});

		it("should support on/emit for error events", () => {
			const runner = new CodexRunner(config);
			const listener = vi.fn();

			runner.on("error", listener);
			const error = new Error("test");
			runner.emit("error", error);

			expect(listener).toHaveBeenCalledWith(error);
		});

		it("should support on/emit for complete events", () => {
			const runner = new CodexRunner(config);
			const listener = vi.fn();

			runner.on("complete", listener);
			runner.emit("complete", [{ type: "result" }] as any);

			expect(listener).toHaveBeenCalledWith([{ type: "result" }]);
		});

		it("should support on/emit for threadEvent events", () => {
			const runner = new CodexRunner(config);
			const listener = vi.fn();

			runner.on("threadEvent", listener);
			runner.emit("threadEvent", { type: "thread.started", thread_id: "abc" });

			expect(listener).toHaveBeenCalledWith({
				type: "thread.started",
				thread_id: "abc",
			});
		});
	});
});

describe("CodexRunner config validation", () => {
	it("should require cyrusHome", () => {
		// TypeScript enforces this at compile time, but we can still test runtime behavior
		const config = {
			cyrusHome: "/tmp/cyrus",
		} as CodexRunnerConfig;

		const runner = new CodexRunner(config);
		expect(runner).toBeInstanceOf(CodexRunner);
	});
});
