import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { DOCS_BUNDLE } from "../../../src/tools/docs-tools/docs-bundle.js";
import {
	createCyrusDocsServer,
	registerDocsTools,
} from "../../../src/tools/docs-tools/index.js";

/**
 * Helper to call a registered tool on an McpServer by name.
 * _registeredTools is a plain object keyed by tool name.
 */
function callTool(
	server: McpServer,
	name: string,
	args: Record<string, unknown>,
) {
	const tool = (server as any)._registeredTools[name];
	if (!tool) throw new Error(`Tool ${name} not found`);
	// MCP SDK uses 'handler' (not 'callback') for the tool function
	return tool.handler(args, {} as any) as Promise<{
		content: Array<{ type: string; text: string }>;
	}>;
}

describe("docs-tools", () => {
	describe("docs-bundle", () => {
		it("should contain documentation entries", () => {
			expect(DOCS_BUNDLE.length).toBeGreaterThan(0);
		});

		it("should have required fields on every entry", () => {
			for (const doc of DOCS_BUNDLE) {
				expect(doc.slug).toBeTruthy();
				expect(doc.title).toBeTruthy();
				expect(typeof doc.group).toBe("string");
				expect(typeof doc.content).toBe("string");
				expect(doc.content.length).toBeGreaterThan(0);
			}
		});

		it("should include key documentation pages", () => {
			const slugs = DOCS_BUNDLE.map((d) => d.slug);
			expect(slugs).toContain("introduction");
			expect(slugs).toContain("getting-started");
			expect(slugs).toContain("mcp-servers");
			expect(slugs).toContain("labels-and-routing");
			expect(slugs).toContain("agent-security");
		});

		it("should have navigation groups", () => {
			const groups = new Set(DOCS_BUNDLE.map((d) => d.group));
			expect(groups.has("Getting Started")).toBe(true);
			expect(groups.has("Agent Configuration")).toBe(true);
		});
	});

	describe("registerDocsTools", () => {
		it("should register tools on an existing McpServer", () => {
			const server = new McpServer({
				name: "test-server",
				version: "1.0.0",
			});

			registerDocsTools(server);

			expect(server).toBeDefined();
			expect(server.server).toBeDefined();

			// Verify tools were registered
			const tools = (server as any)._registeredTools;
			expect(tools.search_docs).toBeDefined();
			expect(tools.get_doc).toBeDefined();
			expect(tools.list_docs).toBeDefined();
		});
	});

	describe("createCyrusDocsServer", () => {
		it("should create a standalone docs server", () => {
			const server = createCyrusDocsServer();

			expect(server).toBeDefined();
			expect(server.server).toBeDefined();
		});
	});

	describe("search_docs tool", () => {
		const server = createCyrusDocsServer();

		it("should find docs matching a query", async () => {
			const result = await callTool(server, "search_docs", {
				query: "MCP servers",
			});
			const parsed = JSON.parse(result.content[0]!.text);

			expect(parsed.success).toBe(true);
			expect(parsed.resultCount).toBeGreaterThan(0);
			expect(parsed.results[0]).toHaveProperty("slug");
			expect(parsed.results[0]).toHaveProperty("title");
			expect(parsed.results[0]).toHaveProperty("snippet");
		});

		it("should find security documentation", async () => {
			const result = await callTool(server, "search_docs", {
				query: "security",
			});
			const parsed = JSON.parse(result.content[0]!.text);

			expect(parsed.success).toBe(true);
			const slugs = parsed.results.map((r: { slug: string }) => r.slug);
			expect(slugs).toContain("agent-security");
		});

		it("should respect limit parameter", async () => {
			const result = await callTool(server, "search_docs", {
				query: "Cyrus",
				limit: 3,
			});
			const parsed = JSON.parse(result.content[0]!.text);

			expect(parsed.success).toBe(true);
			expect(parsed.results.length).toBeLessThanOrEqual(3);
		});

		it("should return error for empty query", async () => {
			const result = await callTool(server, "search_docs", {
				query: "   ",
			});
			const parsed = JSON.parse(result.content[0]!.text);

			expect(parsed.success).toBe(false);
			expect(parsed.error).toContain("searchable term");
		});
	});

	describe("get_doc tool", () => {
		const server = createCyrusDocsServer();

		it("should return full content for a valid slug", async () => {
			const result = await callTool(server, "get_doc", {
				slug: "introduction",
			});
			const parsed = JSON.parse(result.content[0]!.text);

			expect(parsed.success).toBe(true);
			expect(parsed.title).toBe("Cyrus");
			expect(parsed.group).toBe("Getting Started");
			expect(parsed.content).toContain("intelligent agent");
		});

		it("should return error for unknown slug", async () => {
			const result = await callTool(server, "get_doc", {
				slug: "nonexistent-page",
			});
			const parsed = JSON.parse(result.content[0]!.text);

			expect(parsed.success).toBe(false);
			expect(parsed.error).toContain("not found");
			expect(parsed.availableSlugs).toBeDefined();
		});
	});

	describe("list_docs tool", () => {
		const server = createCyrusDocsServer();

		it("should list all docs organized by group", async () => {
			const result = await callTool(server, "list_docs", {});
			const parsed = JSON.parse(result.content[0]!.text);

			expect(parsed.success).toBe(true);
			expect(parsed.totalDocs).toBe(DOCS_BUNDLE.length);
			expect(parsed.groups.length).toBeGreaterThan(0);

			const groupNames = parsed.groups.map((g: { group: string }) => g.group);
			expect(groupNames).toContain("Getting Started");
			expect(groupNames).toContain("Agent Configuration");
		});
	});
});
