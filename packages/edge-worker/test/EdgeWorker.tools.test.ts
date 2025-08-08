import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { getSafeTools } from "cyrus-claude-runner";
import * as fs from "node:fs";

// Mock dependencies
vi.mock("cyrus-core", () => ({
	createWorkspaceId: () => "workspace-123",
	PersistenceManager: vi.fn().mockImplementation(() => ({
		loadSession: vi.fn(),
		saveSession: vi.fn(),
		deleteSession: vi.fn(),
		listSessions: vi.fn(),
	})),
}));

vi.mock("../src/services/LinearSdkService.js", () => ({
	LinearSdkService: vi.fn().mockImplementation(() => ({
		init: vi.fn(),
		getIssue: vi.fn(),
		getAssignedIssues: vi.fn(),
		createComment: vi.fn(),
		getIssueComments: vi.fn(),
		getTeams: vi.fn(),
		getWorkflowStates: vi.fn(),
		updateIssue: vi.fn(),
	})),
}));

vi.mock("cyrus-claude-runner", () => ({
	ClaudeRunner: vi.fn(),
	getSafeTools: vi.fn(() => [
		"Read(**)",
		"Edit(**)",
		"Write(**)",
		"Bash",
		"LS",
		"Grep(**)",
		"Task",
		"TodoWrite",
		"NotebookRead(**)",
		"NotebookEdit(**)",
	]),
}));

vi.mock("node:fs");

describe("EdgeWorker Tool Configuration", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockRepository: RepositoryConfig;

	beforeEach(() => {
		mockRepository = {
			id: "test-repo",
			name: "Test Repository",
			repositoryPath: "/repos/test",
			baseBranch: "main",
			linearWorkspaceId: "test-workspace",
			linearToken: "test-token",
			workspaceBaseDir: "/workspaces",
		};

		mockConfig = {
			proxyUrl: "http://proxy.test",
			repositories: [mockRepository],
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Setup console mocks
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	describe("getMcpServerNames", () => {
		it("should always include linear server", () => {
			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);
			expect(serverNames).toContain("linear");
		});

		it("should parse single mcpConfigPath", () => {
			mockRepository.mcpConfigPath = "/path/to/mcp.json";
			vi.mocked(fs.readFileSync).mockReturnValue(
				JSON.stringify({
					mcpServers: {
						github: {},
						database: {},
					},
				}),
			);

			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);

			expect(serverNames).toContain("linear");
			expect(serverNames).toContain("github");
			expect(serverNames).toContain("database");
			expect(serverNames).toHaveLength(3);
		});

		it("should parse multiple mcpConfigPath array", () => {
			mockRepository.mcpConfigPath = [
				"/path/to/mcp1.json",
				"/path/to/mcp2.json",
			];
			vi.mocked(fs.readFileSync)
				.mockReturnValueOnce(
					JSON.stringify({
						mcpServers: {
							github: {},
						},
					}),
				)
				.mockReturnValueOnce(
					JSON.stringify({
						mcpServers: {
							database: {},
							slack: {},
						},
					}),
				);

			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);

			expect(serverNames).toContain("linear");
			expect(serverNames).toContain("github");
			expect(serverNames).toContain("database");
			expect(serverNames).toContain("slack");
			expect(serverNames).toHaveLength(4);
		});

		it("should handle missing mcpConfigPath gracefully", () => {
			// No mcpConfigPath set
			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);

			expect(serverNames).toEqual(["linear"]);
			expect(console.warn).not.toHaveBeenCalled();
		});

		it("should handle invalid JSON in mcpConfigPath", () => {
			mockRepository.mcpConfigPath = "/path/to/invalid.json";
			vi.mocked(fs.readFileSync).mockReturnValue("{ invalid json }");

			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);

			expect(serverNames).toEqual(["linear"]);
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to load MCP config"),
				expect.anything(),
			);
		});

		it("should handle file read errors gracefully", () => {
			mockRepository.mcpConfigPath = "/path/to/nonexistent.json";
			vi.mocked(fs.readFileSync).mockImplementation(() => {
				throw new Error("ENOENT: no such file or directory");
			});

			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);

			expect(serverNames).toEqual(["linear"]);
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to load MCP config"),
				expect.anything(),
			);
		});

		it("should deduplicate server names", () => {
			mockRepository.mcpConfigPath = [
				"/path/to/mcp1.json",
				"/path/to/mcp2.json",
			];
			vi.mocked(fs.readFileSync)
				.mockReturnValueOnce(
					JSON.stringify({
						mcpServers: {
							github: {},
							database: {},
						},
					}),
				)
				.mockReturnValueOnce(
					JSON.stringify({
						mcpServers: {
							github: {}, // duplicate
							slack: {},
						},
					}),
				);

			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);

			// Should deduplicate github
			expect(serverNames).toEqual(["linear", "github", "database", "slack"]);
		});

		it("should handle configs without mcpServers key", () => {
			mockRepository.mcpConfigPath = "/path/to/empty.json";
			vi.mocked(fs.readFileSync).mockReturnValue(
				JSON.stringify({
					// No mcpServers key
					someOtherConfig: {},
				}),
			);

			const serverNames = (edgeWorker as any).getMcpServerNames.bind(
				edgeWorker,
			)(mockRepository);

			expect(serverNames).toEqual(["linear"]);
		});
	});

	describe("buildAllowedTools", () => {
		it("should use repository allowedTools when specified", () => {
			mockRepository.allowedTools = ["Read(**)", "Edit(**)", "Task"];

			const allowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			)(mockRepository);

			expect(allowedTools).toContain("Read(**)");
			expect(allowedTools).toContain("Edit(**)");
			expect(allowedTools).toContain("Task");
			expect(allowedTools).toContain("mcp__linear");
		});

		it("should use defaultAllowedTools when repository tools not specified", () => {
			mockConfig.defaultAllowedTools = ["WebSearch", "WebFetch"];
			edgeWorker = new EdgeWorker(mockConfig);

			const allowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			)(mockRepository);

			expect(allowedTools).toContain("WebSearch");
			expect(allowedTools).toContain("WebFetch");
			expect(allowedTools).toContain("mcp__linear");
		});

		it("should fall back to getSafeTools when no tools configured", () => {
			const safeTools = getSafeTools();

			const allowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			)(mockRepository);

			// Should contain all safe tools plus MCP tools
			for (const tool of safeTools) {
				expect(allowedTools).toContain(tool);
			}
			expect(allowedTools).toContain("mcp__linear");
		});

		it("should add MCP wildcard tools for all configured servers", () => {
			mockRepository.allowedTools = ["Read(**)"];
			mockRepository.mcpConfigPath = "/path/to/mcp.json";
			vi.mocked(fs.readFileSync).mockReturnValue(
				JSON.stringify({
					mcpServers: {
						github: {},
						database: {},
					},
				}),
			);

			const allowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			)(mockRepository);

			expect(allowedTools).toContain("Read(**)");
			expect(allowedTools).toContain("mcp__linear");
			expect(allowedTools).toContain("mcp__github");
			expect(allowedTools).toContain("mcp__database");
		});

		it("should deduplicate tools if duplicates exist", () => {
			mockRepository.allowedTools = ["Read(**)", "mcp__linear", "Task"];

			const allowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			)(mockRepository);

			// Should not have duplicate mcp__linear
			const linearCount = allowedTools.filter(
				(tool) => tool === "mcp__linear",
			).length;
			expect(linearCount).toBe(1);
		});

		it("should handle empty allowedTools array", () => {
			mockRepository.allowedTools = [];

			const allowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			)(mockRepository);

			// Should only have MCP tools
			expect(allowedTools).toEqual(["mcp__linear"]);
		});

		it("should log allowed tools configuration", () => {
			mockRepository.allowedTools = ["Read(**)", "Edit(**)"];
			mockRepository.mcpConfigPath = "/path/to/mcp.json";
			vi.mocked(fs.readFileSync).mockReturnValue(
				JSON.stringify({
					mcpServers: {
						github: {},
					},
				}),
			);

			(edgeWorker as any).buildAllowedTools.bind(edgeWorker)(mockRepository);

			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Allowed tools for repository Test Repository"),
				expect.objectContaining({
					mcpWildcards: ["mcp__linear", "mcp__github"],
					totalCount: 4,
				}),
			);
		});
	});

	describe("Integration - buildAllowedTools with getMcpServerNames", () => {
		it("should correctly combine tools from multiple sources", () => {
			// Set up a realistic scenario
			mockRepository.allowedTools = [
				"Read(**)",
				"Edit(**)",
				"Bash",
				"Task",
				"WebSearch",
			];
			mockRepository.mcpConfigPath = [
				"/path/to/github-mcp.json",
				"/path/to/custom-mcp.json",
			];

			vi.mocked(fs.readFileSync)
				.mockReturnValueOnce(
					JSON.stringify({
						mcpServers: {
							github: {
								command: "npx",
								args: ["@modelcontextprotocol/server-github"],
							},
						},
					}),
				)
				.mockReturnValueOnce(
					JSON.stringify({
						mcpServers: {
							ceedardb: {
								command: "python",
								args: ["-m", "mcp_ceedar"],
							},
							slack: {
								command: "npx",
								args: ["@modelcontextprotocol/server-slack"],
							},
						},
					}),
				);

			const allowedTools = (edgeWorker as any).buildAllowedTools.bind(
				edgeWorker,
			)(mockRepository);

			// Should have all base tools
			expect(allowedTools).toContain("Read(**)");
			expect(allowedTools).toContain("Edit(**)");
			expect(allowedTools).toContain("Bash");
			expect(allowedTools).toContain("Task");
			expect(allowedTools).toContain("WebSearch");

			// Should have MCP wildcards for all servers
			expect(allowedTools).toContain("mcp__linear");
			expect(allowedTools).toContain("mcp__github");
			expect(allowedTools).toContain("mcp__ceedardb");
			expect(allowedTools).toContain("mcp__slack");

			// Total should be 9 unique tools
			expect(allowedTools).toHaveLength(9);

			// Check logging
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Found MCP servers in /path/to/github-mcp.json"),
			);
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Found MCP servers in /path/to/custom-mcp.json"),
			);
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Total MCP servers configured"),
			);
		});
	});
});