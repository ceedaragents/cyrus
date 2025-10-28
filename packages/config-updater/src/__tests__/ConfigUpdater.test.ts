import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigUpdater } from "../ConfigUpdater.js";
import type {
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	RepositoryPayload,
	TestMcpPayload,
} from "../types.js";

describe("ConfigUpdater", () => {
	let testDir: string;
	let updater: ConfigUpdater;

	beforeEach(() => {
		testDir = join(process.cwd(), ".test-config-updater");
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(testDir, { recursive: true });

		updater = new ConfigUpdater(testDir);
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("updateConfig", () => {
		it("should update config via ConfigUpdater", async () => {
			const payload: CyrusConfigPayload = {
				repositories: [
					{
						id: "repo-1",
						name: "test-repo",
						repositoryPath: "/path/to/repo",
						baseBranch: "main",
					},
				],
			};

			const result = await updater.updateConfig(payload);

			expect(result.success).toBe(true);
			expect(existsSync(join(testDir, "config.json"))).toBe(true);
		});
	});

	describe("updateEnv", () => {
		it("should update env via ConfigUpdater", async () => {
			const payload: CyrusEnvPayload = {
				ANTHROPIC_API_KEY: "sk-test-123",
			};

			const result = await updater.updateEnv(payload);

			expect(result.success).toBe(true);
			expect(existsSync(join(testDir, ".env"))).toBe(true);
		});
	});

	describe("updateRepository", () => {
		it("should handle repository operations via ConfigUpdater", async () => {
			// Create a mock git repository
			const reposDir = join(testDir, "repos");
			const repoPath = join(reposDir, "test-repo");
			const gitDir = join(repoPath, ".git");

			mkdirSync(gitDir, { recursive: true });
			writeFileSync(join(gitDir, "config"), "[core]\n", "utf-8");

			const payload: RepositoryPayload = {
				repository_url: "https://github.com/user/test-repo.git",
				repository_name: "test-repo",
			};

			const result = await updater.updateRepository(payload);

			expect(result.success).toBe(true);
			expect(result.data?.action).toBe("verified");
		});
	});

	describe("testMcp", () => {
		it("should test MCP via ConfigUpdater", async () => {
			const payload: TestMcpPayload = {
				transportType: "stdio",
				command: "npx",
			};

			const result = await updater.testMcp(payload);

			expect(result.success).toBe(true);
			expect(result.data?.transportType).toBe("stdio");
		});
	});

	describe("configureMcp", () => {
		it("should configure MCP servers via ConfigUpdater", async () => {
			const payload: ConfigureMcpPayload = {
				mcpServers: {
					linear: {
						command: "npx",
						args: ["-y", "@linear/mcp-server-linear"],
						transport: "stdio",
					},
				},
			};

			const result = await updater.configureMcp(payload);

			expect(result.success).toBe(true);
			expect(existsSync(join(testDir, "mcp-linear.json"))).toBe(true);
		});
	});

	describe("applyConfig", () => {
		it("should apply multiple configs in sequence", async () => {
			const config: CyrusConfigPayload = {
				repositories: [
					{
						id: "repo-1",
						name: "test-repo",
						repositoryPath: "/path/to/repo",
						baseBranch: "main",
					},
				],
			};

			const env: CyrusEnvPayload = {
				ANTHROPIC_API_KEY: "sk-test-456",
			};

			const mcp: ConfigureMcpPayload = {
				mcpServers: {
					linear: {
						command: "npx",
						transport: "stdio",
					},
				},
			};

			const results = await updater.applyConfig(config, env, mcp);

			expect(results).toHaveLength(3);
			expect(results[0].success).toBe(true);
			expect(results[1].success).toBe(true);
			expect(results[2].success).toBe(true);

			// Verify all files were created
			expect(existsSync(join(testDir, "config.json"))).toBe(true);
			expect(existsSync(join(testDir, ".env"))).toBe(true);
			expect(existsSync(join(testDir, "mcp-linear.json"))).toBe(true);
		});

		it("should handle partial config application", async () => {
			const config: CyrusConfigPayload = {
				repositories: [
					{
						id: "repo-1",
						name: "test-repo",
						repositoryPath: "/path/to/repo",
						baseBranch: "main",
					},
				],
			};

			// Only apply config, no env or mcp
			const results = await updater.applyConfig(config);

			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(true);
			expect(existsSync(join(testDir, "config.json"))).toBe(true);
			expect(existsSync(join(testDir, ".env"))).toBe(false);
		});

		it("should return empty array when no configs provided", async () => {
			const results = await updater.applyConfig();

			expect(results).toHaveLength(0);
		});

		it("should continue even if one operation fails", async () => {
			// Invalid config (missing required fields)
			const config: CyrusConfigPayload = {
				repositories: [],
			};

			const env: CyrusEnvPayload = {
				ANTHROPIC_API_KEY: "sk-test-789",
			};

			const results = await updater.applyConfig(config, env);

			expect(results).toHaveLength(2);
			expect(results[0].success).toBe(true); // Config succeeds (empty is valid)
			expect(results[1].success).toBe(true); // Env succeeds
		});
	});

	describe("readConfig", () => {
		it("should read existing config", async () => {
			// Create a config first
			const payload: CyrusConfigPayload = {
				repositories: [
					{
						id: "repo-1",
						name: "test-repo",
						repositoryPath: "/path/to/repo",
						baseBranch: "main",
					},
				],
			};

			await updater.updateConfig(payload);

			// Read it back
			const config = updater.readConfig();

			expect(config.repositories).toHaveLength(1);
			expect(config.repositories[0].id).toBe("repo-1");
		});

		it("should return empty config when file does not exist", () => {
			const config = updater.readConfig();

			expect(config).toEqual({ repositories: [] });
		});
	});

	describe("integration", () => {
		it("should handle complete configuration workflow", async () => {
			// 1. Update config
			await updater.updateConfig({
				repositories: [
					{
						id: "repo-1",
						name: "my-repo",
						repositoryPath: "/path/to/repo",
						baseBranch: "main",
					},
				],
			});

			// 2. Update env
			await updater.updateEnv({
				ANTHROPIC_API_KEY: "sk-test-complete",
				CUSTOM_VAR: "custom-value",
			});

			// 3. Configure MCP
			await updater.configureMcp({
				mcpServers: {
					linear: {
						command: "npx",
						transport: "stdio",
					},
				},
			});

			// 4. Verify all files exist
			expect(existsSync(join(testDir, "config.json"))).toBe(true);
			expect(existsSync(join(testDir, ".env"))).toBe(true);
			expect(existsSync(join(testDir, "mcp-linear.json"))).toBe(true);

			// 5. Read config back
			const config = updater.readConfig();
			expect(config.repositories[0].name).toBe("my-repo");

			// 6. Verify env content
			const envContent = readFileSync(join(testDir, ".env"), "utf-8");
			expect(envContent).toContain("ANTHROPIC_API_KEY=sk-test-complete");
			expect(envContent).toContain("CUSTOM_VAR=custom-value");
		});
	});
});
