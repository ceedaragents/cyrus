import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexRunner } from "../src/CodexRunner.js";
import type { CodexRunnerConfig } from "../src/types.js";

/**
 * Integration tests for CodexRunner
 *
 * These tests verify the core functionality of CodexRunner:
 * - Configuration handling
 * - CLI argument building
 * - Event emission
 * - Message tracking
 * - Session management
 */

describe("CodexRunner", () => {
	let config: CodexRunnerConfig;

	beforeEach(() => {
		config = {
			cyrusHome: "/tmp/test-cyrus-home",
			workingDirectory: "/tmp/test-workspace",
			model: "gpt-4o",
			autoApprove: true,
		};
	});

	describe("Constructor", () => {
		it("should create a CodexRunner instance", () => {
			const runner = new CodexRunner(config);
			expect(runner).toBeInstanceOf(CodexRunner);
			expect(runner).toBeInstanceOf(EventEmitter);
		});

		it("should set supportsStreamingInput to false", () => {
			const runner = new CodexRunner(config);
			expect(runner.supportsStreamingInput).toBe(false);
		});

		it("should forward config callbacks to events", () => {
			const onMessage = vi.fn();
			const onError = vi.fn();
			const onComplete = vi.fn();

			const runner = new CodexRunner({
				...config,
				onMessage,
				onError,
				onComplete,
			});

			// Emit test events
			runner.emit("message", {
				type: "user",
				message: { role: "user", content: "test" },
				parent_tool_use_id: null,
				session_id: "test",
			});
			runner.emit("error", new Error("test error"));
			runner.emit("complete", []);

			expect(onMessage).toHaveBeenCalledOnce();
			expect(onError).toHaveBeenCalledOnce();
			expect(onComplete).toHaveBeenCalledOnce();
		});
	});

	describe("Session Management", () => {
		it("should initially not be running", () => {
			const runner = new CodexRunner(config);
			expect(runner.isRunning()).toBe(false);
		});

		it("should return empty messages array initially", () => {
			const runner = new CodexRunner(config);
			expect(runner.getMessages()).toEqual([]);
		});

		it("should return a copy of messages array", () => {
			const runner = new CodexRunner(config);
			const messages1 = runner.getMessages();
			const messages2 = runner.getMessages();
			expect(messages1).not.toBe(messages2);
		});
	});

	describe("Formatter", () => {
		it("should return a CodexMessageFormatter instance", () => {
			const runner = new CodexRunner(config);
			const formatter = runner.getFormatter();
			expect(formatter).toBeDefined();
			expect(formatter.formatToolParameter).toBeInstanceOf(Function);
			expect(formatter.formatToolActionName).toBeInstanceOf(Function);
			expect(formatter.formatToolResult).toBeInstanceOf(Function);
		});
	});

	describe("CLI Argument Building", () => {
		it("should build basic args with exec --json", () => {
			const runner = new CodexRunner(config);
			// Access private method through type assertion for testing
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test prompt");

			expect(args).toContain("exec");
			expect(args).toContain("--json");
			expect(args[args.length - 1]).toBe("test prompt");
		});

		it("should add --dangerously-bypass-approvals-and-sandbox when autoApprove is true", () => {
			const runner = new CodexRunner({ ...config, autoApprove: true });
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test");

			expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
		});

		it("should add --full-auto when fullAuto is true", () => {
			const runner = new CodexRunner({ ...config, fullAuto: true });
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test");

			expect(args).toContain("--full-auto");
		});

		it("should add --cd with working directory", () => {
			const runner = new CodexRunner(config);
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test");

			expect(args).toContain("--cd");
			expect(args).toContain("/tmp/test-workspace");
		});

		it("should add --skip-git-repo-check when skipGitRepoCheck is true", () => {
			const runner = new CodexRunner({ ...config, skipGitRepoCheck: true });
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test");

			expect(args).toContain("--skip-git-repo-check");
		});

		it("should add --search when webSearchEnabled is true", () => {
			const runner = new CodexRunner({ ...config, webSearchEnabled: true });
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test");

			expect(args).toContain("--search");
		});

		it("should add --model with specified model", () => {
			const runner = new CodexRunner({ ...config, model: "gpt-5.1-codex-max" });
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test");

			expect(args).toContain("--model");
			expect(args).toContain("gpt-5.1-codex-max");
		});

		it("should add --add-dir for each additional directory", () => {
			const runner = new CodexRunner({
				...config,
				additionalDirectories: ["/path/to/dir1", "/path/to/dir2"],
			});
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "test");

			expect(args).toContain("--add-dir");
			expect(args).toContain("/path/to/dir1");
			expect(args).toContain("/path/to/dir2");
		});

		it("should put prompt as the last argument", () => {
			const runner = new CodexRunner(config);
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "my test prompt");

			expect(args[args.length - 1]).toBe("my test prompt");
		});

		it("should build complex args with all options", () => {
			const runner = new CodexRunner({
				...config,
				autoApprove: true,
				fullAuto: true,
				skipGitRepoCheck: true,
				webSearchEnabled: true,
				model: "gpt-4o",
				additionalDirectories: ["/dir1", "/dir2"],
			});
			const buildArgs = (
				runner as unknown as { buildArgs: (prompt: string) => string[] }
			).buildArgs;
			const args = buildArgs.call(runner, "complex prompt");

			expect(args).toEqual([
				"exec",
				"--json",
				"--dangerously-bypass-approvals-and-sandbox",
				"--full-auto",
				"--cd",
				"/tmp/test-workspace",
				"--skip-git-repo-check",
				"--search",
				"--model",
				"gpt-4o",
				"--add-dir",
				"/dir1",
				"--add-dir",
				"/dir2",
				"complex prompt",
			]);
		});
	});

	describe("Stop Method", () => {
		it("should not throw when called on non-running session", () => {
			const runner = new CodexRunner(config);
			expect(() => runner.stop()).not.toThrow();
		});

		it("should set isRunning to false", () => {
			const runner = new CodexRunner(config);
			// Manually set sessionInfo to simulate running state
			(
				runner as unknown as { sessionInfo: { isRunning: boolean } }
			).sessionInfo = {
				isRunning: true,
			};

			runner.stop();
			expect(runner.isRunning()).toBe(false);
		});
	});

	describe("MCP Server Building", () => {
		it("should build MCP servers from config", () => {
			const runner = new CodexRunner({
				...config,
				mcpConfig: {
					linear: {
						command: "npx",
						args: ["-y", "@linear/mcp-server"],
						env: { LINEAR_API_KEY: "test-key" },
					},
				},
			});

			const buildMcpServers = (
				runner as unknown as { buildMcpServers: () => Record<string, unknown> }
			).buildMcpServers;
			const servers = buildMcpServers.call(runner);

			expect(servers).toHaveProperty("linear");
		});

		it("should filter servers by allowMCPServers", () => {
			const runner = new CodexRunner({
				...config,
				mcpConfig: {
					linear: { command: "linear-server" },
					github: { command: "github-server" },
				},
				allowMCPServers: ["linear"],
			});

			const buildMcpServers = (
				runner as unknown as { buildMcpServers: () => Record<string, unknown> }
			).buildMcpServers;
			const servers = buildMcpServers.call(runner);

			expect(servers).toHaveProperty("linear");
			expect(servers).not.toHaveProperty("github");
		});

		it("should filter servers by excludeMCPServers", () => {
			const runner = new CodexRunner({
				...config,
				mcpConfig: {
					linear: { command: "linear-server" },
					github: { command: "github-server" },
				},
				excludeMCPServers: ["github"],
			});

			const buildMcpServers = (
				runner as unknown as { buildMcpServers: () => Record<string, unknown> }
			).buildMcpServers;
			const servers = buildMcpServers.call(runner);

			expect(servers).toHaveProperty("linear");
			expect(servers).not.toHaveProperty("github");
		});
	});

	describe("Configuration Options", () => {
		it("should accept all config options from acceptance criteria", () => {
			const fullConfig: CodexRunnerConfig = {
				cyrusHome: "/home/user/.cyrus",
				workingDirectory: "/path/to/repo",
				model: "gpt-4o",
				codexPath: "/custom/path/to/codex",
				sandboxMode: "workspace-write",
				approvalPolicy: "on-request",
				autoApprove: true,
				fullAuto: false,
				webSearchEnabled: true,
				additionalDirectories: ["/dir1", "/dir2"],
				skipGitRepoCheck: true,
				mcpConfig: {},
				mcpConfigPaths: ["/path/to/.mcp.json"],
				allowMCPServers: ["linear"],
				excludeMCPServers: ["github"],
			};

			const runner = new CodexRunner(fullConfig);
			expect(runner).toBeInstanceOf(CodexRunner);
		});
	});
});
