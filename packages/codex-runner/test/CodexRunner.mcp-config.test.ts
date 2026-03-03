import { describe, expect, it } from "vitest";
import { CodexRunner } from "../src/CodexRunner.js";

describe("CodexRunner MCP config mapping", () => {
	it("maps generic headers to Codex http_headers for HTTP MCP servers", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
			mcpConfig: {
				linear: {
					type: "http",
					url: "https://mcp.linear.app/mcp",
					headers: {
						Authorization: "Bearer linear-token",
					},
				},
				"cyrus-tools": {
					type: "http",
					url: "http://127.0.0.1:4444/mcp/cyrus-tools",
					headers: {
						Authorization: "Bearer cyrus-api-key",
						"x-cyrus-mcp-context-id": "repo-1:session-1",
					},
				},
			},
		});

		const mcpServers = (runner as any).buildCodexMcpServersConfig();
		expect(mcpServers.linear.http_headers).toEqual({
			Authorization: "Bearer linear-token",
		});
		expect(mcpServers["cyrus-tools"].http_headers).toEqual({
			Authorization: "Bearer cyrus-api-key",
			"x-cyrus-mcp-context-id": "repo-1:session-1",
		});
	});

	it("preserves codex-native header fields when provided", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
			mcpConfig: {
				linear: {
					type: "http",
					url: "https://mcp.linear.app/mcp",
					http_headers: {
						"x-test-header": "value",
					},
					env_http_headers: {
						Authorization: "LINEAR_API_TOKEN",
					},
					bearer_token_env_var: "LINEAR_API_TOKEN",
				} as any,
			},
		});

		const mcpServers = (runner as any).buildCodexMcpServersConfig();
		expect(mcpServers.linear.http_headers).toEqual({
			"x-test-header": "value",
		});
		expect(mcpServers.linear.env_http_headers).toEqual({
			Authorization: "LINEAR_API_TOKEN",
		});
		expect(mcpServers.linear.bearer_token_env_var).toBe("LINEAR_API_TOKEN");
	});

	it("does not inject sandbox workspace-write config when none is provided", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
		});

		const configOverrides = (runner as any).buildConfigOverrides();
		expect(configOverrides).toBeUndefined();
	});

	it("preserves explicit sandbox workspace-write config without forcing network_access", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
			configOverrides: {
				sandbox_workspace_write: {
					read_only_access: {
						network: true,
						include_tmpdir: true,
					},
				},
			},
		});

		const configOverrides = (runner as any).buildConfigOverrides();
		expect(configOverrides).toEqual({
			sandbox_workspace_write: {
				read_only_access: {
					network: true,
					include_tmpdir: true,
				},
			},
		});
	});

	it("does not default sandbox mode when sandbox is not configured", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
			model: "gpt-5",
		});

		const threadOptions = (runner as any).buildThreadOptions();
		expect(threadOptions.sandboxMode).toBeUndefined();
	});

	it("passes sandbox mode when explicitly configured", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
			model: "gpt-5",
			sandbox: "workspace-write",
		});

		const threadOptions = (runner as any).buildThreadOptions();
		expect(threadOptions.sandboxMode).toBe("workspace-write");
	});
});
