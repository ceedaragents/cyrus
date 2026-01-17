import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	OpenCodeConfigBuilder,
	type OpenCodeConfigBuilderOptions,
} from "../src/configBuilder.js";

describe("OpenCodeConfigBuilder", () => {
	let builder: OpenCodeConfigBuilder;
	let testTempDir: string;

	beforeEach(async () => {
		builder = new OpenCodeConfigBuilder();
		// Create a unique temp directory for each test
		testTempDir = join(tmpdir(), `opencode-test-${Date.now()}`);
		await mkdir(testTempDir, { recursive: true });
	});

	afterEach(async () => {
		// Clean up temp directory
		if (existsSync(testTempDir)) {
			await rm(testTempDir, { recursive: true, force: true });
		}
	});

	describe("mapModelName", () => {
		it("should map 'opus' to anthropic/claude-opus-4-20250514", () => {
			expect(builder.mapModelName("opus")).toBe(
				"anthropic/claude-opus-4-20250514",
			);
		});

		it("should map 'sonnet' to anthropic/claude-sonnet-4-20250514", () => {
			expect(builder.mapModelName("sonnet")).toBe(
				"anthropic/claude-sonnet-4-20250514",
			);
		});

		it("should map 'haiku' to anthropic/claude-haiku-3-5-20241022", () => {
			expect(builder.mapModelName("haiku")).toBe(
				"anthropic/claude-haiku-3-5-20241022",
			);
		});

		it("should handle case-insensitive aliases", () => {
			expect(builder.mapModelName("OPUS")).toBe(
				"anthropic/claude-opus-4-20250514",
			);
			expect(builder.mapModelName("Sonnet")).toBe(
				"anthropic/claude-sonnet-4-20250514",
			);
		});

		it("should pass through models already in provider/model format", () => {
			expect(builder.mapModelName("openai/gpt-4o")).toBe("openai/gpt-4o");
			expect(builder.mapModelName("google/gemini-pro")).toBe(
				"google/gemini-pro",
			);
		});

		it("should handle partial model name matches", () => {
			expect(builder.mapModelName("claude-opus")).toBe(
				"anthropic/claude-opus-4-20250514",
			);
			expect(builder.mapModelName("my-sonnet-model")).toBe(
				"anthropic/claude-sonnet-4-20250514",
			);
		});

		it("should return undefined for undefined input", () => {
			expect(builder.mapModelName(undefined)).toBeUndefined();
		});

		it("should return unknown models as-is", () => {
			expect(builder.mapModelName("unknown-model")).toBe("unknown-model");
		});
	});

	describe("build", () => {
		it("should build basic config with model mapping", async () => {
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
					model: "opus",
				},
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			expect(result.config.model).toBe("anthropic/claude-opus-4-20250514");
			expect(result.systemPromptPath).toBeNull();

			await result.cleanup();
		});

		it("should map maxTurns to agent.build.maxSteps", async () => {
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
					maxTurns: 100,
				},
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			expect(result.config.agent?.build?.maxSteps).toBe(100);

			await result.cleanup();
		});

		it("should set autonomous mode permissions", async () => {
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
				},
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			// Check top-level permissions
			expect(result.config.permission?.edit).toBe("allow");
			expect(result.config.permission?.bash).toBe("allow");
			expect(result.config.permission?.webfetch).toBe("allow");
			expect(result.config.permission?.doom_loop).toBe("allow");
			expect(result.config.permission?.external_directory).toBe("allow");

			// Check agent-level permissions
			expect(result.config.agent?.build?.permission?.edit).toBe("allow");
			expect(result.config.agent?.build?.permission?.bash).toBe("allow");
			expect(result.config.agent?.build?.permission?.webfetch).toBe("allow");

			await result.cleanup();
		});

		it("should write system prompt to temp file with {file:path} syntax", async () => {
			const systemPrompt = "You are a helpful coding assistant.";
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
				},
				systemPrompt,
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			// Check that system prompt path is set
			expect(result.systemPromptPath).not.toBeNull();
			expect(result.systemPromptPath).toContain("opencode-system-prompts");
			expect(result.systemPromptPath).toContain("TEST-123.md");

			// Check that agent.build.prompt uses file reference syntax
			expect(result.config.agent?.build?.prompt).toBe(
				`{file:${result.systemPromptPath}}`,
			);

			// Verify file was created with correct content
			const fileContent = await readFile(result.systemPromptPath!, "utf8");
			expect(fileContent).toBe(systemPrompt);

			// Cleanup should remove the file
			await result.cleanup();
			expect(existsSync(result.systemPromptPath!)).toBe(false);
		});

		it("should handle tool configuration with allowed/disallowed tools", async () => {
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
					allowedTools: ["Read(**)", "Edit(**)", "Bash"],
					disallowedTools: ["Write(**)", "Delete"],
				},
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			// Allowed tools should be true
			expect(result.config.tools?.Read).toBe(true);
			expect(result.config.tools?.Edit).toBe(true);
			expect(result.config.tools?.Bash).toBe(true);

			// Disallowed tools should be false
			expect(result.config.tools?.Write).toBe(false);
			expect(result.config.tools?.Delete).toBe(false);

			await result.cleanup();
		});

		it("should strip glob patterns from tool names", async () => {
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
					allowedTools: ["Read(**)"],
				},
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			expect(result.config.tools?.Read).toBe(true);
			// Should not have the glob pattern version
			expect(result.config.tools?.["Read(**)"]).toBeUndefined();

			await result.cleanup();
		});
	});

	describe("convertMcpServerConfig", () => {
		it("should convert stdio MCP server to local config", () => {
			const mcpConfig = {
				command: "npx",
				args: ["-y", "@linear/mcp-server"],
				env: { LINEAR_API_TOKEN: "test-token" },
			};

			const result = builder.convertMcpServerConfig("linear", mcpConfig as any);

			expect(result).toEqual({
				type: "local",
				command: ["npx", "-y", "@linear/mcp-server"],
				environment: { LINEAR_API_TOKEN: "test-token" },
			});
		});

		it("should convert HTTP MCP server to remote config", () => {
			const mcpConfig = {
				type: "http",
				url: "https://mcp.example.com/v1",
				headers: { Authorization: "Bearer test" },
			};

			const result = builder.convertMcpServerConfig(
				"example",
				mcpConfig as any,
			);

			expect(result).toEqual({
				type: "remote",
				url: "https://mcp.example.com/v1",
				headers: { Authorization: "Bearer test" },
			});
		});

		it("should convert URL-only MCP server to remote config (SSE)", () => {
			const mcpConfig = {
				url: "https://sse.example.com/events",
			};

			const result = builder.convertMcpServerConfig("sse", mcpConfig as any);

			expect(result).toEqual({
				type: "remote",
				url: "https://sse.example.com/events",
			});
		});

		it("should skip SDK server instances (in-process)", () => {
			const mcpConfig = {
				name: "test-server",
				listTools: () => [],
				callTool: () => {},
			};

			const result = builder.convertMcpServerConfig("sdk", mcpConfig as any);

			expect(result).toBeNull();
		});

		it("should skip servers with no valid transport config", () => {
			const mcpConfig = {
				somethingElse: true,
			};

			const result = builder.convertMcpServerConfig(
				"invalid",
				mcpConfig as any,
			);

			expect(result).toBeNull();
		});

		it("should include timeout in local config", () => {
			const mcpConfig = {
				command: "node",
				args: ["server.js"],
				timeout: 10000,
			};

			const result = builder.convertMcpServerConfig("test", mcpConfig as any);

			expect(result?.type).toBe("local");
			expect((result as any).timeout).toBe(10000);
		});

		it("should include timeout in remote config", () => {
			const mcpConfig = {
				type: "http",
				url: "https://example.com",
				timeout: 5000,
			};

			const result = builder.convertMcpServerConfig("test", mcpConfig as any);

			expect(result?.type).toBe("remote");
			expect((result as any).timeout).toBe(5000);
		});
	});

	describe("build with MCP config", () => {
		it("should build config with MCP servers", async () => {
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
					mcpConfig: {
						linear: {
							command: "npx",
							args: ["-y", "@linear/mcp-server"],
						} as any,
						graphite: {
							type: "http",
							url: "https://mcp.graphite.dev",
						} as any,
					},
				},
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			expect(result.config.mcp?.linear).toEqual({
				type: "local",
				command: ["npx", "-y", "@linear/mcp-server"],
			});

			expect(result.config.mcp?.graphite).toEqual({
				type: "remote",
				url: "https://mcp.graphite.dev",
			});

			await result.cleanup();
		});

		it("should skip invalid MCP servers in build", async () => {
			const options: OpenCodeConfigBuilderOptions = {
				runnerConfig: {
					cyrusHome: testTempDir,
					mcpConfig: {
						valid: {
							command: "node",
							args: ["server.js"],
						} as any,
						invalid: {
							somethingElse: true,
						} as any,
					},
				},
				workspaceName: "TEST-123",
			};

			const result = await builder.build(options);

			expect(result.config.mcp?.valid).toBeDefined();
			expect(result.config.mcp?.invalid).toBeUndefined();

			await result.cleanup();
		});
	});

	describe("toConfigContent", () => {
		it("should serialize config to JSON string", () => {
			const config = {
				model: "anthropic/claude-sonnet-4-20250514",
				permission: {
					edit: "allow" as const,
					bash: "allow" as const,
				},
			};

			const content = OpenCodeConfigBuilder.toConfigContent(config);

			expect(content).toBe(JSON.stringify(config));
			expect(JSON.parse(content)).toEqual(config);
		});
	});
});
