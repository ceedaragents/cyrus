import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	McpConfigService,
	type McpConfigServiceDeps,
} from "../src/McpConfigService.js";

// Mock cyrus-mcp-tools
vi.mock("cyrus-mcp-tools", () => ({
	createCyrusToolsServer: vi.fn().mockReturnValue({}),
}));

describe("McpConfigService - Figma MCP", () => {
	let deps: McpConfigServiceDeps;
	let service: McpConfigService;

	const mockLinearClient = {
		getClient: () => ({}),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.SLACK_BOT_TOKEN;

		deps = {
			getLinearTokenForWorkspace: vi.fn().mockReturnValue("lin_oauth_test"),
			getIssueTracker: vi.fn().mockReturnValue(mockLinearClient),
			getCyrusToolsMcpUrl: vi
				.fn()
				.mockReturnValue("http://127.0.0.1:3456/mcp/cyrus-tools"),
			createCyrusToolsOptions: vi.fn().mockReturnValue({}),
			getFigmaToken: vi.fn().mockReturnValue(undefined),
		};
	});

	it("should not include Figma MCP when no token is configured", () => {
		service = new McpConfigService(deps);
		const config = service.buildMcpConfig("repo-1", "ws-1");

		expect(config.figma).toBeUndefined();
		expect(config.linear).toBeDefined();
	});

	it("should include Figma MCP when token is configured", () => {
		deps.getFigmaToken = vi.fn().mockReturnValue("figma-token-abc123");
		service = new McpConfigService(deps);
		const config = service.buildMcpConfig("repo-1", "ws-1");

		expect(config.figma).toEqual({
			type: "http",
			url: "https://mcp.figma.com/mcp",
			headers: {
				Authorization: "Bearer figma-token-abc123",
			},
		});
	});

	it("should include Figma MCP alongside other MCP servers", () => {
		deps.getFigmaToken = vi.fn().mockReturnValue("figma-token-abc123");
		service = new McpConfigService(deps);
		const config = service.buildMcpConfig("repo-1", "ws-1");

		expect(config.linear).toBeDefined();
		expect(config["cyrus-tools"]).toBeDefined();
		expect(config["cyrus-docs"]).toBeDefined();
		expect(config.figma).toBeDefined();
	});

	it("should not include Figma MCP when getFigmaToken is not provided", () => {
		deps.getFigmaToken = undefined;
		service = new McpConfigService(deps);
		const config = service.buildMcpConfig("repo-1", "ws-1");

		expect(config.figma).toBeUndefined();
	});

	it("should not include Figma MCP when getFigmaToken returns empty string", () => {
		deps.getFigmaToken = vi.fn().mockReturnValue("");
		service = new McpConfigService(deps);
		const config = service.buildMcpConfig("repo-1", "ws-1");

		expect(config.figma).toBeUndefined();
	});
});
