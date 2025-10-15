import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConfigureMCPPayload, TestMCPPayload } from "../types";
import {
	deleteMCPConfigFile,
	handleConfigureMCP,
	handleTestMCP,
} from "./mcp-handler";

describe("MCP Handler", () => {
	let testDir: string;

	beforeEach(async () => {
		// Create a unique temporary directory for each test
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(7);
		testDir = join(tmpdir(), `mcp-handler-test-${timestamp}-${random}`);
		await fs.mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		// Clean up test directory
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch (error) {
			console.warn(`Failed to clean up test directory: ${error}`);
		}
	});

	describe("handleConfigureMCP", () => {
		it("should write individual MCP config files", async () => {
			const payload: ConfigureMCPPayload = {
				mcpServers: {
					linear: {
						command: "npx",
						args: ["-y", "@linear/mcp-server-linear"],
						env: {
							LINEAR_API_KEY: "test_key",
						},
					},
					github: {
						command: "npx",
						args: ["-y", "@github/mcp-server-github"],
						env: {
							GITHUB_TOKEN: "test_token",
						},
					},
				},
			};

			const filesWritten = await handleConfigureMCP(payload, testDir);

			// Should return 2 file paths
			expect(filesWritten).toHaveLength(2);

			// Check that files were created
			const linearPath = join(testDir, "mcp-linear.json");
			const githubPath = join(testDir, "mcp-github.json");

			expect(filesWritten).toContain(linearPath);
			expect(filesWritten).toContain(githubPath);

			// Verify file contents
			const linearContent = JSON.parse(await fs.readFile(linearPath, "utf-8"));
			expect(linearContent).toEqual({
				mcpServers: {
					linear: {
						command: "npx",
						args: ["-y", "@linear/mcp-server-linear"],
						env: {
							LINEAR_API_KEY: "test_key",
						},
					},
				},
			});

			const githubContent = JSON.parse(await fs.readFile(githubPath, "utf-8"));
			expect(githubContent).toEqual({
				mcpServers: {
					github: {
						command: "npx",
						args: ["-y", "@github/mcp-server-github"],
						env: {
							GITHUB_TOKEN: "test_token",
						},
					},
				},
			});
		});

		it("should create .cyrus directory if it does not exist", async () => {
			const nonExistentDir = join(testDir, "non-existent", ".cyrus");

			const payload: ConfigureMCPPayload = {
				mcpServers: {
					test: {
						command: "test-command",
					},
				},
			};

			await handleConfigureMCP(payload, nonExistentDir);

			// Directory should have been created
			const stats = await fs.stat(nonExistentDir);
			expect(stats.isDirectory()).toBe(true);

			// File should exist
			const filePath = join(nonExistentDir, "mcp-test.json");
			const fileStats = await fs.stat(filePath);
			expect(fileStats.isFile()).toBe(true);
		});

		it("should handle MCP server with transport and URL", async () => {
			const payload: ConfigureMCPPayload = {
				mcpServers: {
					"remote-mcp": {
						url: "https://example.com/mcp",
						transport: "sse",
						headers: {
							Authorization: "Bearer token123",
						},
					},
				},
			};

			const filesWritten = await handleConfigureMCP(payload, testDir);

			expect(filesWritten).toHaveLength(1);

			const filePath = join(testDir, "mcp-remote-mcp.json");
			const content = JSON.parse(await fs.readFile(filePath, "utf-8"));

			expect(content).toEqual({
				mcpServers: {
					"remote-mcp": {
						url: "https://example.com/mcp",
						transport: "sse",
						headers: {
							Authorization: "Bearer token123",
						},
					},
				},
			});
		});

		it("should throw error if no MCP servers provided", async () => {
			const payload: ConfigureMCPPayload = {
				mcpServers: {},
			};

			await expect(handleConfigureMCP(payload, testDir)).rejects.toThrow(
				"No MCP servers provided",
			);
		});

		it("should throw error for empty slug", async () => {
			const payload = {
				mcpServers: {
					"": {
						command: "test",
					},
				},
			} as ConfigureMCPPayload;

			await expect(handleConfigureMCP(payload, testDir)).rejects.toThrow(
				"Empty MCP slug not allowed",
			);
		});

		it("should throw error for invalid slug with special characters", async () => {
			const payload = {
				mcpServers: {
					"invalid/slug": {
						command: "test",
					},
				},
			} as ConfigureMCPPayload;

			await expect(handleConfigureMCP(payload, testDir)).rejects.toThrow(
				/Invalid MCP slug.*only alphanumeric characters, hyphens, and underscores are allowed/,
			);
		});

		it("should throw error for slug with path traversal attempt", async () => {
			const payload = {
				mcpServers: {
					"../../../etc/passwd": {
						command: "test",
					},
				},
			} as ConfigureMCPPayload;

			await expect(handleConfigureMCP(payload, testDir)).rejects.toThrow(
				/Invalid MCP slug.*only alphanumeric characters/,
			);
		});

		it("should allow valid slug with hyphens and underscores", async () => {
			const payload: ConfigureMCPPayload = {
				mcpServers: {
					"valid-slug_123": {
						command: "test-command",
					},
				},
			};

			const filesWritten = await handleConfigureMCP(payload, testDir);

			expect(filesWritten).toHaveLength(1);
			const filePath = join(testDir, "mcp-valid-slug_123.json");
			expect(filesWritten).toContain(filePath);

			const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
			expect(content.mcpServers["valid-slug_123"]).toBeDefined();
		});

		it("should overwrite existing MCP config file", async () => {
			const slug = "test-mcp";
			const filePath = join(testDir, `mcp-${slug}.json`);

			// Write initial config
			const initialPayload: ConfigureMCPPayload = {
				mcpServers: {
					[slug]: {
						command: "old-command",
					},
				},
			};
			await handleConfigureMCP(initialPayload, testDir);

			// Verify initial content
			let content = JSON.parse(await fs.readFile(filePath, "utf-8"));
			expect(content.mcpServers[slug].command).toBe("old-command");

			// Write updated config
			const updatedPayload: ConfigureMCPPayload = {
				mcpServers: {
					[slug]: {
						command: "new-command",
						args: ["--flag"],
					},
				},
			};
			await handleConfigureMCP(updatedPayload, testDir);

			// Verify updated content
			content = JSON.parse(await fs.readFile(filePath, "utf-8"));
			expect(content.mcpServers[slug].command).toBe("new-command");
			expect(content.mcpServers[slug].args).toEqual(["--flag"]);
		});
	});

	describe("deleteMCPConfigFile", () => {
		it("should delete an existing MCP config file", async () => {
			const slug = "test-delete";
			const filePath = join(testDir, `mcp-${slug}.json`);

			// Create a config file
			const payload: ConfigureMCPPayload = {
				mcpServers: {
					[slug]: {
						command: "test-command",
					},
				},
			};
			await handleConfigureMCP(payload, testDir);

			// Verify file exists
			await fs.access(filePath);

			// Delete the file
			await deleteMCPConfigFile(slug, testDir);

			// Verify file no longer exists
			await expect(fs.access(filePath)).rejects.toThrow();
		});

		it("should not throw error when deleting non-existent file", async () => {
			const slug = "non-existent";

			// Should not throw
			await expect(deleteMCPConfigFile(slug, testDir)).resolves.toBeUndefined();
		});
	});

	describe("handleTestMCP", () => {
		it("should accept valid stdio transport configuration", async () => {
			const payload: TestMCPPayload = {
				transportType: "stdio",
				command: "npx",
				commandArgs: [
					{ value: "-y", order: 0 },
					{ value: "@linear/mcp-server-linear", order: 1 },
				],
				envVars: [{ key: "LINEAR_API_KEY", value: "test_key" }],
			};

			const result = await handleTestMCP(payload);

			expect(result.success).toBe(true);
			expect(result.server_info).toBeDefined();
			expect(result.tools).toBeDefined();
		});

		it("should accept valid sse transport configuration", async () => {
			const payload: TestMCPPayload = {
				transportType: "sse",
				serverUrl: "https://example.com/mcp",
				headers: [{ name: "Authorization", value: "Bearer token123" }],
			};

			const result = await handleTestMCP(payload);

			expect(result.success).toBe(true);
			expect(result.server_info).toBeDefined();
			expect(result.tools).toBeDefined();
		});

		it("should accept valid http transport configuration", async () => {
			const payload: TestMCPPayload = {
				transportType: "http",
				serverUrl: "https://example.com/mcp",
				headers: [{ name: "X-API-Key", value: "key123" }],
			};

			const result = await handleTestMCP(payload);

			expect(result.success).toBe(true);
			expect(result.server_info).toBeDefined();
			expect(result.tools).toBeDefined();
		});

		it("should throw error for invalid transport type", async () => {
			const payload = {
				transportType: "invalid",
			} as TestMCPPayload;

			await expect(handleTestMCP(payload)).rejects.toThrow(
				/Invalid transport type.*Must be one of: stdio, sse, http/,
			);
		});

		it("should throw error for stdio transport without command", async () => {
			const payload: TestMCPPayload = {
				transportType: "stdio",
				commandArgs: [{ value: "test", order: 0 }],
			};

			await expect(handleTestMCP(payload)).rejects.toThrow(
				"command is required for stdio transport",
			);
		});

		it("should throw error for sse transport without serverUrl", async () => {
			const payload: TestMCPPayload = {
				transportType: "sse",
			};

			await expect(handleTestMCP(payload)).rejects.toThrow(
				"serverUrl is required for sse transport",
			);
		});

		it("should throw error for http transport without serverUrl", async () => {
			const payload: TestMCPPayload = {
				transportType: "http",
			};

			await expect(handleTestMCP(payload)).rejects.toThrow(
				"serverUrl is required for http transport",
			);
		});

		it("should handle command args with proper ordering", async () => {
			const payload: TestMCPPayload = {
				transportType: "stdio",
				command: "node",
				commandArgs: [
					{ value: "script.js", order: 1 },
					{ value: "--verbose", order: 0 },
					{ value: "--output=file.txt", order: 2 },
				],
			};

			const result = await handleTestMCP(payload);

			// Should not throw and should succeed
			expect(result.success).toBe(true);
		});

		it("should handle empty headers array", async () => {
			const payload: TestMCPPayload = {
				transportType: "sse",
				serverUrl: "https://example.com/mcp",
				headers: [],
			};

			const result = await handleTestMCP(payload);

			expect(result.success).toBe(true);
		});

		it("should handle empty envVars array", async () => {
			const payload: TestMCPPayload = {
				transportType: "stdio",
				command: "test-command",
				envVars: [],
			};

			const result = await handleTestMCP(payload);

			expect(result.success).toBe(true);
		});
	});

	describe("Integration Tests", () => {
		it("should configure and then delete MCP server", async () => {
			const slug = "integration-test";

			// Configure
			const configPayload: ConfigureMCPPayload = {
				mcpServers: {
					[slug]: {
						command: "test-command",
						args: ["--flag"],
					},
				},
			};
			const filesWritten = await handleConfigureMCP(configPayload, testDir);

			expect(filesWritten).toHaveLength(1);

			const filePath = join(testDir, `mcp-${slug}.json`);
			await fs.access(filePath); // Verify exists

			// Delete
			await deleteMCPConfigFile(slug, testDir);

			// Verify deleted
			await expect(fs.access(filePath)).rejects.toThrow();
		});

		it("should handle multiple MCP servers in sequence", async () => {
			// First batch
			const payload1: ConfigureMCPPayload = {
				mcpServers: {
					server1: { command: "cmd1" },
					server2: { command: "cmd2" },
				},
			};
			await handleConfigureMCP(payload1, testDir);

			// Second batch
			const payload2: ConfigureMCPPayload = {
				mcpServers: {
					server3: { command: "cmd3" },
				},
			};
			await handleConfigureMCP(payload2, testDir);

			// All files should exist
			await fs.access(join(testDir, "mcp-server1.json"));
			await fs.access(join(testDir, "mcp-server2.json"));
			await fs.access(join(testDir, "mcp-server3.json"));

			// Delete one
			await deleteMCPConfigFile("server2", testDir);

			// Verify state
			await fs.access(join(testDir, "mcp-server1.json"));
			await expect(
				fs.access(join(testDir, "mcp-server2.json")),
			).rejects.toThrow();
			await fs.access(join(testDir, "mcp-server3.json"));
		});
	});
});
