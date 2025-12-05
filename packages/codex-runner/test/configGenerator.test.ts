import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import toml from "@iarna/toml";
import type { McpServerConfig } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	autoDetectMcpConfig,
	backupCodexConfig,
	type CodexConfigOptions,
	convertToCodexMcpConfig,
	deleteCodexConfig,
	loadMcpConfigFromPaths,
	restoreCodexConfig,
	setupCodexConfig,
	writeCodexConfig,
} from "../src/configGenerator.js";
import type { CodexMcpServerConfig } from "../src/types.js";

const TEST_DIR = join(homedir(), ".codex-test");

// Mock the homedir to use our test directory
vi.mock("node:os", () => ({
	homedir: vi.fn(() => "/tmp"),
}));

// Mock the CODEX_DIR path
const mockCodexDir = join("/tmp", ".codex");
const mockConfigPath = join(mockCodexDir, "config.toml");
const mockBackupPath = join(mockCodexDir, "config.toml.backup");

describe("configGenerator", () => {
	beforeEach(() => {
		// Clean up test directory before each test
		if (existsSync(mockCodexDir)) {
			rmSync(mockCodexDir, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		// Clean up test directory after each test
		if (existsSync(mockCodexDir)) {
			rmSync(mockCodexDir, { recursive: true, force: true });
		}
	});

	describe("convertToCodexMcpConfig", () => {
		it("should convert stdio transport config", () => {
			const config: McpServerConfig = {
				command: "npx",
				args: ["-y", "@anthropic-ai/mcp-linear"],
				env: {
					LINEAR_API_TOKEN: "test-token",
				},
			};

			const result = convertToCodexMcpConfig("linear", config);

			expect(result).toEqual({
				transport: "stdio",
				command: "npx",
				args: ["-y", "@anthropic-ai/mcp-linear"],
				env: {
					LINEAR_API_TOKEN: "test-token",
				},
				enabled: true,
			});
		});

		it("should convert stdio transport with cwd", () => {
			const config: McpServerConfig = {
				command: "node",
				args: ["server.js"],
				cwd: "/path/to/server",
			};

			const result = convertToCodexMcpConfig("custom", config);

			expect(result).toEqual({
				transport: "stdio",
				command: "node",
				args: ["server.js"],
				cwd: "/path/to/server",
				enabled: true,
			});
		});

		it("should convert stdio transport with timeout", () => {
			const config: McpServerConfig = {
				command: "npx",
				args: ["-y", "mcp-server"],
				timeout: 30000, // 30 seconds in milliseconds
			};

			const result = convertToCodexMcpConfig("test", config);

			expect(result).toEqual({
				transport: "stdio",
				command: "npx",
				args: ["-y", "mcp-server"],
				tool_timeout: { secs: 30 },
				enabled: true,
			});
		});

		it("should convert stdio transport with tool filtering", () => {
			const config: McpServerConfig = {
				command: "npx",
				args: ["-y", "mcp-server"],
				includeTools: ["tool1", "tool2"],
				excludeTools: ["tool3"],
			};

			const result = convertToCodexMcpConfig("test", config);

			expect(result).toEqual({
				transport: "stdio",
				command: "npx",
				args: ["-y", "mcp-server"],
				enabled_tools: ["tool1", "tool2"],
				disabled_tools: ["tool3"],
				enabled: true,
			});
		});

		it("should convert streamable_http transport config", () => {
			const config: McpServerConfig = {
				url: "https://api.example.com/mcp",
			};

			const result = convertToCodexMcpConfig("http-server", config);

			expect(result).toEqual({
				transport: "streamable_http",
				url: "https://api.example.com/mcp",
				enabled: true,
			});
		});

		it("should convert streamable_http with headers", () => {
			const config: McpServerConfig = {
				url: "https://api.example.com/mcp",
				headers: {
					"X-Custom-Header": "value",
					"Content-Type": "application/json",
				},
			};

			const result = convertToCodexMcpConfig("http-server", config);

			expect(result).toEqual({
				transport: "streamable_http",
				url: "https://api.example.com/mcp",
				headers: {
					"X-Custom-Header": "value",
					"Content-Type": "application/json",
				},
				enabled: true,
			});
		});

		it("should extract bearer token to bearer_env_var", () => {
			const config: McpServerConfig = {
				url: "https://api.example.com/mcp",
				headers: {
					// biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template variable extraction
					Authorization: "Bearer ${API_TOKEN}",
					"X-Custom": "value",
				},
			};

			const result = convertToCodexMcpConfig("http-server", config);

			expect(result).toEqual({
				transport: "streamable_http",
				url: "https://api.example.com/mcp",
				bearer_env_var: "API_TOKEN",
				headers: {
					"X-Custom": "value",
				},
				enabled: true,
			});
		});

		it("should remove headers object if only Authorization existed", () => {
			const config: McpServerConfig = {
				url: "https://api.example.com/mcp",
				headers: {
					// biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template variable extraction
					Authorization: "Bearer ${API_TOKEN}",
				},
			};

			const result = convertToCodexMcpConfig("http-server", config);

			expect(result).toEqual({
				transport: "streamable_http",
				url: "https://api.example.com/mcp",
				bearer_env_var: "API_TOKEN",
				enabled: true,
			});
			expect(result?.headers).toBeUndefined();
		});

		it("should convert streamable_http with timeout", () => {
			const config: McpServerConfig = {
				url: "https://api.example.com/mcp",
				timeout: 45000, // 45 seconds
			};

			const result = convertToCodexMcpConfig("http-server", config);

			expect(result).toEqual({
				transport: "streamable_http",
				url: "https://api.example.com/mcp",
				tool_timeout: { secs: 45 },
				enabled: true,
			});
		});

		it("should convert streamable_http with tool filtering", () => {
			const config: McpServerConfig = {
				url: "https://api.example.com/mcp",
				includeTools: ["search", "fetch"],
			};

			const result = convertToCodexMcpConfig("http-server", config);

			expect(result).toEqual({
				transport: "streamable_http",
				url: "https://api.example.com/mcp",
				enabled_tools: ["search", "fetch"],
				enabled: true,
			});
		});

		it("should return null for SDK instance (has listTools method)", () => {
			const config = {
				name: "sdk-server",
				listTools: () => Promise.resolve([]),
				callTool: () => Promise.resolve({}),
			} as unknown as McpServerConfig;

			const result = convertToCodexMcpConfig("sdk-server", config);

			expect(result).toBeNull();
		});

		it("should return null for config with no valid transport", () => {
			const config = {
				env: { KEY: "value" },
			} as McpServerConfig;

			const result = convertToCodexMcpConfig("invalid", config);

			expect(result).toBeNull();
		});

		it("should round up milliseconds to seconds for timeout", () => {
			const config: McpServerConfig = {
				command: "test",
				timeout: 1500, // 1.5 seconds -> should round up to 2
			};

			const result = convertToCodexMcpConfig("test", config);

			expect(result?.tool_timeout).toEqual({ secs: 2 });
		});
	});

	describe("loadMcpConfigFromPaths", () => {
		it("should return empty object for undefined path", () => {
			const result = loadMcpConfigFromPaths(undefined);
			expect(result).toEqual({});
		});

		it("should return empty object for empty array", () => {
			const result = loadMcpConfigFromPaths([]);
			expect(result).toEqual({});
		});

		it("should load MCP config from single file path", () => {
			// Create test config file
			const testConfigPath = join(TEST_DIR, "test-mcp.json");
			mkdirSync(TEST_DIR, { recursive: true });
			const testConfig = {
				mcpServers: {
					linear: {
						command: "npx",
						args: ["-y", "@anthropic-ai/mcp-linear"],
					},
				},
			};
			writeFileSync(testConfigPath, JSON.stringify(testConfig));

			const result = loadMcpConfigFromPaths(testConfigPath);

			expect(result).toEqual(testConfig.mcpServers);

			// Cleanup
			rmSync(TEST_DIR, { recursive: true, force: true });
		});

		it("should merge configs from multiple paths", () => {
			// Create test config files
			mkdirSync(TEST_DIR, { recursive: true });

			const config1Path = join(TEST_DIR, "config1.json");
			const config1 = {
				mcpServers: {
					linear: { command: "npx", args: ["-y", "linear"] },
				},
			};
			writeFileSync(config1Path, JSON.stringify(config1));

			const config2Path = join(TEST_DIR, "config2.json");
			const config2 = {
				mcpServers: {
					github: { command: "npx", args: ["-y", "github"] },
				},
			};
			writeFileSync(config2Path, JSON.stringify(config2));

			const result = loadMcpConfigFromPaths([config1Path, config2Path]);

			expect(result).toEqual({
				linear: { command: "npx", args: ["-y", "linear"] },
				github: { command: "npx", args: ["-y", "github"] },
			});

			// Cleanup
			rmSync(TEST_DIR, { recursive: true, force: true });
		});

		it("should handle invalid JSON gracefully", () => {
			// Create invalid JSON file
			const testConfigPath = join(TEST_DIR, "invalid.json");
			mkdirSync(TEST_DIR, { recursive: true });
			writeFileSync(testConfigPath, "{ invalid json }");

			const result = loadMcpConfigFromPaths(testConfigPath);

			expect(result).toEqual({});

			// Cleanup
			rmSync(TEST_DIR, { recursive: true, force: true });
		});
	});

	describe("autoDetectMcpConfig", () => {
		it("should return undefined for no working directory", () => {
			const result = autoDetectMcpConfig(undefined);
			expect(result).toBeUndefined();
		});

		it("should return undefined when .mcp.json doesn't exist", () => {
			const result = autoDetectMcpConfig(TEST_DIR);
			expect(result).toBeUndefined();
		});

		it("should return path when valid .mcp.json exists", () => {
			// Create valid .mcp.json
			mkdirSync(TEST_DIR, { recursive: true });
			const mcpPath = join(TEST_DIR, ".mcp.json");
			writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }));

			const result = autoDetectMcpConfig(TEST_DIR);

			expect(result).toBe(mcpPath);

			// Cleanup
			rmSync(TEST_DIR, { recursive: true, force: true });
		});

		it("should return undefined for invalid JSON", () => {
			// Create invalid .mcp.json
			mkdirSync(TEST_DIR, { recursive: true });
			const mcpPath = join(TEST_DIR, ".mcp.json");
			writeFileSync(mcpPath, "{ invalid }");

			const result = autoDetectMcpConfig(TEST_DIR);

			expect(result).toBeUndefined();

			// Cleanup
			rmSync(TEST_DIR, { recursive: true, force: true });
		});
	});

	describe("backup and restore operations", () => {
		it("should return false when backing up non-existent config", () => {
			const result = backupCodexConfig();
			expect(result).toBe(false);
		});

		it("should create backup of existing config", () => {
			// Create config file
			mkdirSync(mockCodexDir, { recursive: true });
			writeFileSync(mockConfigPath, "[mcp_servers]\n");

			const result = backupCodexConfig();

			expect(result).toBe(true);
			expect(existsSync(mockBackupPath)).toBe(true);
		});

		it("should return false when restoring non-existent backup", () => {
			const result = restoreCodexConfig();
			expect(result).toBe(false);
		});

		it("should restore config from backup", () => {
			// Create config and backup
			mkdirSync(mockCodexDir, { recursive: true });
			const originalContent = "[mcp_servers]\ntest = true\n";
			writeFileSync(mockConfigPath, "modified content");
			writeFileSync(mockBackupPath, originalContent);

			const result = restoreCodexConfig();

			expect(result).toBe(true);
			expect(readFileSync(mockConfigPath, "utf-8")).toBe(originalContent);
			expect(existsSync(mockBackupPath)).toBe(false);
		});

		it("should delete config when it exists", () => {
			mkdirSync(mockCodexDir, { recursive: true });
			writeFileSync(mockConfigPath, "test");

			deleteCodexConfig();

			expect(existsSync(mockConfigPath)).toBe(false);
		});

		it("should not throw when deleting non-existent config", () => {
			expect(() => deleteCodexConfig()).not.toThrow();
		});
	});

	describe("writeCodexConfig", () => {
		it("should create directory if it doesn't exist", () => {
			const options: CodexConfigOptions = {
				mcpServers: {},
			};

			writeCodexConfig(options);

			expect(existsSync(mockCodexDir)).toBe(true);
		});

		it("should write valid TOML config", () => {
			const options: CodexConfigOptions = {
				mcpServers: {
					linear: {
						transport: "stdio",
						command: "npx",
						args: ["-y", "@anthropic-ai/mcp-linear"],
						env: {
							LINEAR_API_TOKEN: "test-token",
						},
						enabled: true,
					},
				},
			};

			writeCodexConfig(options);

			const content = readFileSync(mockConfigPath, "utf-8");
			const parsed = toml.parse(content);

			expect(parsed).toHaveProperty("mcp_servers");
			expect(parsed.mcp_servers).toHaveProperty("linear");
			const linear = (parsed.mcp_servers as any).linear;
			expect(linear.transport).toBe("stdio");
			expect(linear.command).toBe("npx");
			expect(linear.enabled).toBe(true);
		});

		it("should write config with multiple servers", () => {
			const options: CodexConfigOptions = {
				mcpServers: {
					linear: {
						transport: "stdio",
						command: "npx",
						args: ["-y", "linear"],
						enabled: true,
					},
					github: {
						transport: "streamable_http",
						url: "https://api.github.com/mcp",
						enabled: true,
					},
				},
			};

			writeCodexConfig(options);

			const content = readFileSync(mockConfigPath, "utf-8");
			const parsed = toml.parse(content);

			expect(parsed.mcp_servers).toHaveProperty("linear");
			expect(parsed.mcp_servers).toHaveProperty("github");
		});
	});

	describe("setupCodexConfig", () => {
		it("should setup config and return cleanup function", () => {
			const servers: Record<string, CodexMcpServerConfig> = {
				linear: {
					transport: "stdio",
					command: "npx",
					enabled: true,
				},
			};

			const cleanup = setupCodexConfig(servers);

			// Config should be written
			expect(existsSync(mockConfigPath)).toBe(true);

			// Cleanup should delete the config
			cleanup();
			expect(existsSync(mockConfigPath)).toBe(false);
		});

		it("should restore original config on cleanup when backup exists", () => {
			// Create original config
			mkdirSync(mockCodexDir, { recursive: true });
			const originalContent = '[mcp_servers.original]\ntransport = "stdio"\n';
			writeFileSync(mockConfigPath, originalContent);

			const servers: Record<string, CodexMcpServerConfig> = {
				new: {
					transport: "stdio",
					command: "test",
					enabled: true,
				},
			};

			const cleanup = setupCodexConfig(servers);

			// New config should be different
			const newContent = readFileSync(mockConfigPath, "utf-8");
			expect(newContent).not.toBe(originalContent);

			// Cleanup should restore original
			cleanup();
			const restoredContent = readFileSync(mockConfigPath, "utf-8");
			expect(restoredContent).toBe(originalContent);
		});

		it("should delete config on cleanup when no backup existed", () => {
			const servers: Record<string, CodexMcpServerConfig> = {
				test: {
					transport: "stdio",
					command: "test",
					enabled: true,
				},
			};

			const cleanup = setupCodexConfig(servers);

			expect(existsSync(mockConfigPath)).toBe(true);

			cleanup();

			expect(existsSync(mockConfigPath)).toBe(false);
		});
	});

	describe("integration: full conversion workflow", () => {
		it("should convert and write complete config", () => {
			const mcpConfig: Record<string, McpServerConfig> = {
				linear: {
					command: "npx",
					args: ["-y", "@anthropic-ai/mcp-linear"],
					env: { LINEAR_API_TOKEN: "token" },
					timeout: 60000,
					includeTools: ["create_issue", "list_issues"],
				},
				http_server: {
					url: "https://api.example.com/mcp",
					headers: {
						// biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template variable extraction
						Authorization: "Bearer ${API_KEY}",
					},
					excludeTools: ["dangerous_tool"],
				},
			};

			// Convert all servers
			const codexServers: Record<string, CodexMcpServerConfig> = {};
			for (const [name, config] of Object.entries(mcpConfig)) {
				const converted = convertToCodexMcpConfig(name, config);
				if (converted) {
					codexServers[name] = converted;
				}
			}

			// Setup config
			const cleanup = setupCodexConfig(codexServers);

			// Verify TOML was written correctly
			const content = readFileSync(mockConfigPath, "utf-8");
			const parsed = toml.parse(content);

			expect(parsed.mcp_servers).toHaveProperty("linear");
			expect(parsed.mcp_servers).toHaveProperty("http_server");

			const linear = (parsed.mcp_servers as any).linear;
			expect(linear.transport).toBe("stdio");
			expect(linear.command).toBe("npx");
			expect(linear.enabled_tools).toEqual(["create_issue", "list_issues"]);

			const httpServer = (parsed.mcp_servers as any).http_server;
			expect(httpServer.transport).toBe("streamable_http");
			expect(httpServer.bearer_env_var).toBe("API_KEY");
			expect(httpServer.disabled_tools).toEqual(["dangerous_tool"]);

			// Cleanup
			cleanup();
		});
	});
});
