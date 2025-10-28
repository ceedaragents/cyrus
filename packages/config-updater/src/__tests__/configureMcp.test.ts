import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleConfigureMcp } from "../handlers/configureMcp.js";
import type { ConfigureMcpPayload } from "../types.js";

describe("handleConfigureMcp", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(process.cwd(), ".test-cyrus-mcp");
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("should reject payload without mcpServers", async () => {
		const payload = {} as ConfigureMcpPayload;

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe("MCP configuration requires server definitions");
	});

	it("should reject payload with empty mcpServers", async () => {
		const payload: ConfigureMcpPayload = {
			mcpServers: {},
		};

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe("No MCP servers to configure");
	});

	it("should write MCP config file for single server", async () => {
		const payload: ConfigureMcpPayload = {
			mcpServers: {
				linear: {
					command: "npx",
					args: ["-y", "@linear/mcp-server-linear"],
					env: {
						LINEAR_API_KEY: "test-key",
					},
					transport: "stdio",
				},
			},
		};

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.message).toBe("MCP configuration files written successfully");

		// Verify file was created
		const mcpFilePath = join(testDir, "mcp-linear.json");
		expect(existsSync(mcpFilePath)).toBe(true);

		// Verify content
		const content = JSON.parse(readFileSync(mcpFilePath, "utf-8"));
		expect(content.mcpServers.linear).toBeDefined();
		expect(content.mcpServers.linear.command).toBe("npx");
	});

	it("should write multiple MCP config files", async () => {
		const payload: ConfigureMcpPayload = {
			mcpServers: {
				linear: {
					command: "npx",
					args: ["-y", "@linear/mcp-server-linear"],
					transport: "stdio",
				},
				github: {
					command: "npx",
					args: ["-y", "@github/mcp-server"],
					transport: "stdio",
				},
			},
		};

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.data?.serversConfigured).toEqual(["linear", "github"]);

		// Verify both files were created
		expect(existsSync(join(testDir, "mcp-linear.json"))).toBe(true);
		expect(existsSync(join(testDir, "mcp-github.json"))).toBe(true);
	});

	it("should perform environment variable substitution", async () => {
		const payload: ConfigureMcpPayload = {
			mcpServers: {
				linear: {
					command: "npx",
					args: ["-y", "@linear/mcp-server-linear"],
					env: {
						LINEAR_API_KEY: "my-secret-key",
						API_URL: "${LINEAR_API_KEY}/api",
					},
					transport: "stdio",
				},
			},
		};

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(true);

		// Verify substitution happened
		const mcpFilePath = join(testDir, "mcp-linear.json");
		const content = JSON.parse(readFileSync(mcpFilePath, "utf-8"));

		// ${LINEAR_API_KEY} should be replaced with actual value
		expect(content.mcpServers.linear.env.API_URL).toBe("my-secret-key/api");
	});

	it("should handle SSE transport config", async () => {
		const payload: ConfigureMcpPayload = {
			mcpServers: {
				"remote-mcp": {
					url: "https://mcp.example.com",
					transport: "sse",
					headers: {
						Authorization: "Bearer token",
					},
				},
			},
		};

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(true);

		const mcpFilePath = join(testDir, "mcp-remote-mcp.json");
		const content = JSON.parse(readFileSync(mcpFilePath, "utf-8"));

		expect(content.mcpServers["remote-mcp"].url).toBe(
			"https://mcp.example.com",
		);
		expect(content.mcpServers["remote-mcp"].transport).toBe("sse");
	});

	it("should return list of files written", async () => {
		const payload: ConfigureMcpPayload = {
			mcpServers: {
				server1: { command: "cmd1", transport: "stdio" },
				server2: { command: "cmd2", transport: "stdio" },
			},
		};

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.data?.mcpFilesWritten).toHaveLength(2);
		expect(result.data?.mcpFilesWritten[0]).toContain("mcp-server1.json");
		expect(result.data?.mcpFilesWritten[1]).toContain("mcp-server2.json");
	});

	it("should handle nested environment variable substitution", async () => {
		const payload: ConfigureMcpPayload = {
			mcpServers: {
				complex: {
					command: "npx",
					args: ["${PACKAGE_NAME}"],
					env: {
						PACKAGE_NAME: "@example/mcp-server",
						FULL_COMMAND: "npx ${PACKAGE_NAME}",
					},
					transport: "stdio",
				},
			},
		};

		const result = await handleConfigureMcp(payload, testDir);

		expect(result.success).toBe(true);

		const mcpFilePath = join(testDir, "mcp-complex.json");
		const content = JSON.parse(readFileSync(mcpFilePath, "utf-8"));

		// Substitution in args array
		expect(content.mcpServers.complex.args[0]).toBe("@example/mcp-server");

		// Substitution in env values
		expect(content.mcpServers.complex.env.FULL_COMMAND).toBe(
			"npx @example/mcp-server",
		);
	});
});
