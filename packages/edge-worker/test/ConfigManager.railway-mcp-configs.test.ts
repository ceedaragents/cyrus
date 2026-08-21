import { readFile } from "node:fs/promises";
import type { EdgeWorkerConfig, ILogger } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigManager } from "../src/ConfigManager.js";

vi.mock("node:fs/promises");

/**
 * Tests for `railwayMcpConfigs`: ensure the field participates in the config
 * hot-reload pipeline — both the merge in `loadConfigSafely()` and the
 * global-change detection in `detectGlobalConfigChanges()`. Without these, a
 * `railwayMcpConfigs` change written to config.json while Cyrus is running
 * would be silently dropped (see CLAUDE.md note #9, and the identical
 * regression this bit us with for `slackMcpConfigs`/`linearMcpConfigs`/
 * `githubMcpConfigs` in CYHOST-967).
 */
describe("ConfigManager - railwayMcpConfigs hot-reload", () => {
	let logger: ILogger;

	const baseConfig: EdgeWorkerConfig = {
		proxyUrl: "http://localhost:3000",
		cyrusHome: "/tmp/cyrus-home",
		repositories: [
			{
				id: "repo-1",
				name: "Repo 1",
				repositoryPath: "/test/repo",
				baseBranch: "main",
				workspaceBaseDir: "/test/workspaces",
			},
		],
	} as unknown as EdgeWorkerConfig;

	function makeManager(config: EdgeWorkerConfig): ConfigManager {
		return new ConfigManager(
			config,
			logger,
			"/tmp/cyrus-home/config.json",
			new Map(config.repositories.map((r) => [r.id, r])),
		);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		} as unknown as ILogger;
	});

	it("merges railwayMcpConfigs from the reloaded config file", async () => {
		const manager = makeManager(baseConfig);
		vi.mocked(readFile).mockResolvedValue(
			JSON.stringify({
				repositories: baseConfig.repositories,
				railwayMcpConfigs: ["/home/user/.cyrus/mcp-configs/mcp-railway.json"],
			}) as any,
		);

		const newConfig = await (manager as any).loadConfigSafely();

		expect(newConfig).not.toBeNull();
		expect(newConfig.railwayMcpConfigs).toEqual([
			"/home/user/.cyrus/mcp-configs/mcp-railway.json",
		]);
	});

	it("detects a railwayMcpConfigs change as a global config change", () => {
		const manager = makeManager(baseConfig);

		const changed = (manager as any).detectGlobalConfigChanges({
			...baseConfig,
			railwayMcpConfigs: ["/home/user/.cyrus/mcp-configs/mcp-railway.json"],
		});

		expect(changed).toBe(true);
	});

	it("preserves an existing railwayMcpConfigs value when the file omits it", async () => {
		const manager = makeManager({
			...baseConfig,
			railwayMcpConfigs: ["/home/user/.cyrus/mcp-configs/mcp-railway.json"],
		});
		vi.mocked(readFile).mockResolvedValue(
			JSON.stringify({ repositories: baseConfig.repositories }) as any,
		);

		const newConfig = await (manager as any).loadConfigSafely();

		expect(newConfig.railwayMcpConfigs).toEqual([
			"/home/user/.cyrus/mcp-configs/mcp-railway.json",
		]);
	});
});
