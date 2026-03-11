import { join } from "node:path";
import { LinearClient } from "@linear/sdk";
import { LinearEventTransport } from "cyrus-linear-event-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { TEST_CYRUS_HOME } from "./test-dirs.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
}));

// Mock dependencies
vi.mock("cyrus-claude-runner");
vi.mock("cyrus-codex-runner");
vi.mock("cyrus-cursor-runner");
vi.mock("cyrus-gemini-runner");
vi.mock("cyrus-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		isAgentSessionCreatedWebhook: vi.fn(),
		isAgentSessionPromptedWebhook: vi.fn(),
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});
vi.mock("file-type");

const mcpConfigsDir = join(TEST_CYRUS_HOME, "mcp-configs");

function createRepository(
	overrides?: Partial<RepositoryConfig>,
): RepositoryConfig {
	return {
		id: "repo-1",
		name: "test-repo",
		repositoryPath: "/tmp/repos/test",
		baseBranch: "main",
		linearWorkspaceId: "ws-1",
		linearToken: "test-token",
		workspaceBaseDir: "/tmp/worktrees",
		mcpConfigPath: [
			join(mcpConfigsDir, "mcp-server-a.json"),
			join(mcpConfigsDir, "mcp-server-b.json"),
		],
		...overrides,
	};
}

function createConfig(overrides?: Partial<EdgeWorkerConfig>): EdgeWorkerConfig {
	return {
		repositories: [createRepository()],
		cyrusHome: TEST_CYRUS_HOME,
		...overrides,
	};
}

describe("EdgeWorker - Session Source Trust", () => {
	let edgeWorker: EdgeWorker;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Mock LinearClient
		vi.mocked(LinearClient).mockImplementation(
			() =>
				({
					issueSearch: vi.fn().mockResolvedValue({ nodes: [] }),
					users: vi.fn().mockResolvedValue({ nodes: [] }),
				}) as any,
		);

		// Mock LinearEventTransport
		vi.mocked(LinearEventTransport).mockImplementation(
			() =>
				({
					on: vi.fn(),
					start: vi.fn(),
				}) as any,
		);

		// Mock SharedApplicationServer
		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					getApp: vi.fn().mockReturnValue({
						listen: vi.fn(),
						register: vi.fn(),
						post: vi.fn(),
						get: vi.fn(),
					}),
					start: vi.fn(),
				}) as any,
		);

		// Mock AgentSessionManager
		vi.mocked(AgentSessionManager).mockImplementation(
			() =>
				({
					getSession: vi.fn(),
					getAgentRunner: vi.fn(),
					on: vi.fn(),
				}) as any,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getEffectiveMcpConfigPaths", () => {
		describe("backward compatibility (no trust config)", () => {
			it("returns repository.mcpConfigPath when neither sessionSourceTrust nor mcpAccess is set", async () => {
				const config = createConfig();
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("linear", repo);

				expect(result).toEqual(repo.mcpConfigPath);
			});

			it("returns undefined when repository has no mcpConfigPath and no trust config", async () => {
				const config = createConfig();
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository({ mcpConfigPath: undefined });
				const result = edgeWorker.getEffectiveMcpConfigPaths("linear", repo);

				expect(result).toBeUndefined();
			});
		});

		describe("with sessionSourceTrust only (no mcpAccess)", () => {
			it("returns repository.mcpConfigPath when only sessionSourceTrust is set", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						linear: "trusted",
						github: "untrusted",
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("linear", repo);

				expect(result).toEqual(repo.mcpConfigPath);
			});
		});

		describe("with full trust configuration", () => {
			it("returns trusted MCP paths for a trusted source", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						linear: "trusted",
						github: "untrusted",
						slack: "untrusted",
					},
					mcpAccess: {
						trusted: ["server-a", "server-b"],
						untrusted: ["server-a"],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("linear", repo);

				expect(result).toEqual([
					join(mcpConfigsDir, "mcp-server-a.json"),
					join(mcpConfigsDir, "mcp-server-b.json"),
				]);
			});

			it("returns untrusted MCP paths for an untrusted source", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						linear: "trusted",
						github: "untrusted",
						slack: "untrusted",
					},
					mcpAccess: {
						trusted: ["server-a", "server-b"],
						untrusted: ["server-a"],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("github", repo);

				expect(result).toEqual([join(mcpConfigsDir, "mcp-server-a.json")]);
			});

			it("returns undefined for untrusted source when untrusted has no MCPs", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						linear: "trusted",
						slack: "untrusted",
					},
					mcpAccess: {
						trusted: ["server-a", "server-b"],
						untrusted: [],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("slack", repo);

				expect(result).toBeUndefined();
			});

			it("treats unknown sources as untrusted when sessionSourceTrust is configured", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						linear: "trusted",
					},
					mcpAccess: {
						trusted: ["server-a", "server-b"],
						untrusted: ["server-a"],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				// "slack" is not in sessionSourceTrust, should default to untrusted
				const result = edgeWorker.getEffectiveMcpConfigPaths("slack", repo);

				expect(result).toEqual([join(mcpConfigsDir, "mcp-server-a.json")]);
			});

			it("treats completely unknown sources as untrusted", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						linear: "trusted",
					},
					mcpAccess: {
						trusted: ["server-a"],
						untrusted: [],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("discord", repo);

				expect(result).toBeUndefined();
			});
		});

		describe("with mcpAccess only (no sessionSourceTrust)", () => {
			it("treats all sources as trusted when sessionSourceTrust is not set", async () => {
				const config = createConfig({
					mcpAccess: {
						trusted: ["server-a", "server-b"],
						untrusted: ["server-a"],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("slack", repo);

				expect(result).toEqual([
					join(mcpConfigsDir, "mcp-server-a.json"),
					join(mcpConfigsDir, "mcp-server-b.json"),
				]);
			});
		});

		describe("edge cases", () => {
			it("handles undefined untrusted array in mcpAccess", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						slack: "untrusted",
					},
					mcpAccess: {
						trusted: ["server-a"],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("slack", repo);

				expect(result).toBeUndefined();
			});

			it("handles undefined trusted array in mcpAccess", async () => {
				const config = createConfig({
					sessionSourceTrust: {
						linear: "trusted",
					},
					mcpAccess: {
						untrusted: ["server-a"],
					},
				});
				edgeWorker = new EdgeWorker(config);

				const repo = createRepository();
				const result = edgeWorker.getEffectiveMcpConfigPaths("linear", repo);

				expect(result).toBeUndefined();
			});
		});
	});
});
