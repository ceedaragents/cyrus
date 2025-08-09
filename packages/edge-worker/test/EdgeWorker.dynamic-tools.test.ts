import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies BEFORE imports
vi.mock("cyrus-ndjson-client");
vi.mock("cyrus-claude-runner", () => ({
	ClaudeRunner: vi.fn(),
	getSafeTools: vi.fn(() => [
		"Read",
		"Edit",
		"Task",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"TodoWrite",
		"NotebookRead",
		"NotebookEdit",
		"Batch",
	]),
	getReadOnlyTools: vi.fn(() => [
		"Read",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"NotebookRead",
		"Task",
		"Batch",
	]),
	getAllTools: vi.fn(() => [
		"Read",
		"Edit",
		"Task",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"TodoWrite",
		"NotebookRead",
		"NotebookEdit",
		"Batch",
		"Bash",
	]),
}));
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { LinearClient } from "@linear/sdk";
import {
	getAllTools,
	getReadOnlyTools,
	getSafeTools,
} from "cyrus-claude-runner";
import { NdjsonClient } from "cyrus-ndjson-client";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

describe("EdgeWorker - Dynamic Tools Configuration", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Create mock configuration
		mockConfig = {
			proxyUrl: "http://localhost:3000",
			defaultAllowedTools: ["Read", "Write", "Edit"],
			repositories: [
				{
					id: "test-repo",
					name: "Test Repo",
					repositoryPath: "/test/repo",
					workspaceBaseDir: "/test/workspaces",
					baseBranch: "main",
					linearToken: "test-token",
					linearWorkspaceId: "test-workspace",
					isActive: true,
				},
			],
		};

		// Mock SharedApplicationServer
		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					start: vi.fn().mockResolvedValue(undefined),
					stop: vi.fn().mockResolvedValue(undefined),
					setWebhookHandler: vi.fn(),
					setOAuthCallbackHandler: vi.fn(),
				}) as any,
		);

		// Mock AgentSessionManager
		vi.mocked(AgentSessionManager).mockImplementation(
			() =>
				({
					addSession: vi.fn(),
					getSession: vi.fn(),
					removeSession: vi.fn(),
					getAllSessions: vi.fn().mockReturnValue([]),
					clearAllSessions: vi.fn(),
				}) as any,
		);

		// Mock NdjsonClient
		vi.mocked(NdjsonClient).mockImplementation(
			() =>
				({
					connect: vi.fn().mockResolvedValue(undefined),
					send: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn(),
					on: vi.fn(),
					reconnect: vi.fn().mockResolvedValue(undefined),
				}) as any,
		);

		// Mock LinearClient
		vi.mocked(LinearClient).mockImplementation(
			() =>
				({
					viewer: vi
						.fn()
						.mockResolvedValue({ id: "test-user", email: "test@example.com" }),
					issue: vi.fn(),
					comment: vi.fn(),
					createComment: vi.fn(),
					webhook: vi.fn(),
					webhooks: vi.fn(),
					createWebhook: vi.fn(),
					updateWebhook: vi.fn(),
					deleteWebhook: vi.fn(),
					user: vi.fn(),
				}) as any,
		);

		edgeWorker = new EdgeWorker(mockConfig);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("buildAllowedTools", () => {
		// Access private method for testing
		const getBuildAllowedTools = (ew: EdgeWorker) =>
			(ew as any).buildAllowedTools.bind(ew);

		it("should use repository-specific prompt type configuration when available", () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				labelPrompts: {
					debugger: {
						labels: ["bug", "error"],
						allowedTools: "readOnly",
					},
					builder: {
						labels: ["feature"],
						allowedTools: ["Read", "Edit", "Task"],
					},
					scoper: {
						labels: ["prd"],
						allowedTools: "safe",
					},
				},
			};

			const buildAllowedTools = getBuildAllowedTools(edgeWorker);

			// Test debugger prompt with readOnly preset
			const debuggerTools = buildAllowedTools(repository, "debugger");
			expect(debuggerTools).toEqual([...getReadOnlyTools(), "mcp__linear"]);

			// Test builder prompt with custom array
			const builderTools = buildAllowedTools(repository, "builder");
			expect(builderTools).toEqual(["Read", "Edit", "Task", "mcp__linear"]);

			// Test scoper prompt with safe preset
			const scoperTools = buildAllowedTools(repository, "scoper");
			expect(scoperTools).toEqual([...getSafeTools(), "mcp__linear"]);
		});

		it("should use global prompt defaults when repository-specific config is not available", () => {
			const configWithDefaults: EdgeWorkerConfig = {
				...mockConfig,
				promptDefaults: {
					debugger: {
						allowedTools: "all",
					},
					builder: {
						allowedTools: "safe",
					},
					scoper: {
						allowedTools: ["Read", "WebFetch"],
					},
				},
			};

			const edgeWorkerWithDefaults = new EdgeWorker(configWithDefaults);
			const buildAllowedTools = getBuildAllowedTools(edgeWorkerWithDefaults);

			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
			};

			// Test debugger prompt with global all preset
			const debuggerTools = buildAllowedTools(repository, "debugger");
			expect(debuggerTools).toEqual([...getAllTools(), "mcp__linear"]);

			// Test builder prompt with global safe preset
			const builderTools = buildAllowedTools(repository, "builder");
			expect(builderTools).toEqual([...getSafeTools(), "mcp__linear"]);

			// Test scoper prompt with global custom array
			const scoperTools = buildAllowedTools(repository, "scoper");
			expect(scoperTools).toEqual(["Read", "WebFetch", "mcp__linear"]);
		});

		it("should fall back to repository-level allowed tools when no prompt type is specified", () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				allowedTools: ["Read", "Write"],
			};

			const buildAllowedTools = getBuildAllowedTools(edgeWorker);
			const tools = buildAllowedTools(repository);

			expect(tools).toEqual(["Read", "Write", "mcp__linear"]);
		});

		it("should fall back to global default allowed tools when no other config is available", () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
			};

			const buildAllowedTools = getBuildAllowedTools(edgeWorker);
			const tools = buildAllowedTools(repository);

			// Should use global defaultAllowedTools from mockConfig
			expect(tools).toEqual(["Read", "Write", "Edit", "mcp__linear"]);
		});

		it("should fall back to safe tools when no configuration is provided", () => {
			const configWithoutDefaults: EdgeWorkerConfig = {
				...mockConfig,
				defaultAllowedTools: undefined,
			};

			const edgeWorkerNoDefaults = new EdgeWorker(configWithoutDefaults);
			const buildAllowedTools = getBuildAllowedTools(edgeWorkerNoDefaults);

			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
			};

			const tools = buildAllowedTools(repository);
			expect(tools).toEqual([...getSafeTools(), "mcp__linear"]);
		});

		it("should always include Linear MCP tools", () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				allowedTools: ["Read", "mcp__linear"], // Already includes Linear MCP
			};

			const buildAllowedTools = getBuildAllowedTools(edgeWorker);
			const tools = buildAllowedTools(repository);

			// Should deduplicate Linear MCP tools
			expect(tools).toEqual(["Read", "mcp__linear"]);
			expect(tools.filter((t) => t === "mcp__linear")).toHaveLength(1);
		});

		it("should handle backward compatibility with old array-based labelPrompts", () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				labelPrompts: {
					debugger: ["bug", "error"] as any, // Old format
					builder: {
						labels: ["feature"],
						allowedTools: "safe",
					},
				} as any,
			};

			const buildAllowedTools = getBuildAllowedTools(edgeWorker);

			// Old format should fall back to repository/global defaults
			const debuggerTools = buildAllowedTools(repository, "debugger");
			expect(debuggerTools).toEqual(["Read", "Write", "Edit", "mcp__linear"]);

			// New format should work as expected
			const builderTools = buildAllowedTools(repository, "builder");
			expect(builderTools).toEqual([...getSafeTools(), "mcp__linear"]);
		});

		it("should handle single tool string in resolveToolPreset", () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				labelPrompts: {
					debugger: {
						labels: ["bug"],
						allowedTools: "CustomTool" as any, // Single non-preset string
					},
				},
			};

			const buildAllowedTools = getBuildAllowedTools(edgeWorker);
			const tools = buildAllowedTools(repository, "debugger");

			expect(tools).toEqual(["CustomTool", "mcp__linear"]);
		});
	});

	describe("determineSystemPromptFromLabels", () => {
		// Access private method for testing
		const getDetermineSystemPromptFromLabels = (ew: EdgeWorker) =>
			(ew as any).determineSystemPromptFromLabels.bind(ew);

		beforeEach(() => {
			// Mock file system for prompt templates
			vi.mocked(readFile).mockImplementation(async (path: string) => {
				if (path.includes("debugger.md")) {
					return 'Debugger prompt content\n<version-tag value="debugger-v1.0.0" />';
				}
				if (path.includes("builder.md")) {
					return 'Builder prompt content\n<version-tag value="builder-v2.0.0" />';
				}
				if (path.includes("scoper.md")) {
					return "Scoper prompt content";
				}
				throw new Error(`File not found: ${path}`);
			});
		});

		it("should return prompt with type for matching labels", async () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				labelPrompts: {
					debugger: {
						labels: ["bug", "error"],
						allowedTools: "readOnly",
					},
					builder: {
						labels: ["feature"],
						allowedTools: "safe",
					},
				},
			};

			const determineSystemPromptFromLabels =
				getDetermineSystemPromptFromLabels(edgeWorker);

			// Test debugger prompt
			const debuggerResult = await determineSystemPromptFromLabels(
				["bug", "unrelated"],
				repository,
			);
			expect(debuggerResult).toEqual({
				prompt:
					'Debugger prompt content\n<version-tag value="debugger-v1.0.0" />',
				version: "debugger-v1.0.0",
				type: "debugger",
			});

			// Test builder prompt
			const builderResult = await determineSystemPromptFromLabels(
				["feature", "enhancement"],
				repository,
			);
			expect(builderResult).toEqual({
				prompt:
					'Builder prompt content\n<version-tag value="builder-v2.0.0" />',
				version: "builder-v2.0.0",
				type: "builder",
			});
		});

		it("should handle backward compatibility with old array format", async () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				labelPrompts: {
					debugger: ["bug", "error"] as any, // Old format
					builder: {
						labels: ["feature"],
						allowedTools: "safe",
					},
				} as any,
			};

			const determineSystemPromptFromLabels =
				getDetermineSystemPromptFromLabels(edgeWorker);

			// Old format should still work for prompt selection
			const result = await determineSystemPromptFromLabels(["bug"], repository);
			expect(result).toEqual({
				prompt: expect.stringContaining("Debugger prompt content"),
				version: "debugger-v1.0.0",
				type: "debugger",
			});
		});

		it("should return undefined when no labels match", async () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				labelPrompts: {
					debugger: {
						labels: ["bug"],
						allowedTools: "readOnly",
					},
				},
			};

			const determineSystemPromptFromLabels =
				getDetermineSystemPromptFromLabels(edgeWorker);
			const result = await determineSystemPromptFromLabels(
				["feature", "enhancement"],
				repository,
			);

			expect(result).toBeUndefined();
		});

		it("should return undefined when labelPrompts is not configured", async () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
			};

			const determineSystemPromptFromLabels =
				getDetermineSystemPromptFromLabels(edgeWorker);
			const result = await determineSystemPromptFromLabels(["bug"], repository);

			expect(result).toBeUndefined();
		});

		it("should return undefined when labels array is empty", async () => {
			const repository: RepositoryConfig = {
				...mockConfig.repositories[0],
				labelPrompts: {
					debugger: {
						labels: ["bug"],
						allowedTools: "readOnly",
					},
				},
			};

			const determineSystemPromptFromLabels =
				getDetermineSystemPromptFromLabels(edgeWorker);
			const result = await determineSystemPromptFromLabels([], repository);

			expect(result).toBeUndefined();
		});
	});
});
