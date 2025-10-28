import { describe, expect, it } from "vitest";
import { handleTestMcp } from "../handlers/testMcp.js";
import type { TestMcpPayload } from "../types.js";

describe("handleTestMcp", () => {
	it("should reject payload without transportType", async () => {
		const payload = {} as TestMcpPayload;

		const result = await handleTestMcp(payload);

		expect(result.success).toBe(false);
		expect(result.error).toBe("MCP test requires transport type");
	});

	it("should reject invalid transportType", async () => {
		const payload = {
			transportType: "invalid",
		} as any;

		const result = await handleTestMcp(payload);

		expect(result.success).toBe(false);
		expect(result.error).toBe("Invalid MCP transport type");
	});

	it("should reject stdio transport without command", async () => {
		const payload: TestMcpPayload = {
			transportType: "stdio",
			command: null,
		};

		const result = await handleTestMcp(payload);

		expect(result.success).toBe(false);
		expect(result.error).toBe("MCP stdio transport requires command");
	});

	it("should reject sse transport without serverUrl", async () => {
		const payload: TestMcpPayload = {
			transportType: "sse",
			serverUrl: null,
		};

		const result = await handleTestMcp(payload);

		expect(result.success).toBe(false);
		expect(result.error).toBe("MCP SSE transport requires server URL");
	});

	it("should return placeholder response for valid stdio config", async () => {
		const payload: TestMcpPayload = {
			transportType: "stdio",
			command: "npx",
			commandArgs: [
				{ value: "-y", order: 0 },
				{ value: "@linear/mcp-server-linear", order: 1 },
			],
		};

		const result = await handleTestMcp(payload);

		expect(result.success).toBe(true);
		expect(result.message).toContain("placeholder");
		expect(result.data?.transportType).toBe("stdio");
		expect(result.data?.tools).toEqual([]);
	});

	it("should return placeholder response for valid sse config", async () => {
		const payload: TestMcpPayload = {
			transportType: "sse",
			serverUrl: "https://mcp.example.com",
			headers: [{ name: "Authorization", value: "Bearer token" }],
		};

		const result = await handleTestMcp(payload);

		expect(result.success).toBe(true);
		expect(result.message).toContain("placeholder");
		expect(result.data?.transportType).toBe("sse");
	});

	it("should include server info in response", async () => {
		const payload: TestMcpPayload = {
			transportType: "stdio",
			command: "node",
		};

		const result = await handleTestMcp(payload);

		expect(result.success).toBe(true);
		expect(result.data?.serverInfo).toBeDefined();
		expect(result.data?.serverInfo.name).toBe("placeholder");
		expect(result.data?.serverInfo.protocol).toBe("mcp/1.0");
	});
});
