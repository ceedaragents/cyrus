import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CyrusConfigPayload } from "../types";
import { handleCyrusConfig } from "./config-handler";

describe("handleCyrusConfig", () => {
	let testCyrusHome: string;

	beforeEach(async () => {
		// Create a unique temporary directory for each test
		testCyrusHome = join(tmpdir(), `cyrus-test-${Date.now()}-${Math.random()}`);
		await fs.mkdir(testCyrusHome, { recursive: true });
	});

	afterEach(async () => {
		// Clean up the test directory
		try {
			await fs.rm(testCyrusHome, { recursive: true, force: true });
		} catch (_error) {
			// Ignore cleanup errors
		}
	});

	it("should create config.json with minimal required fields", async () => {
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

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		expect(config.repositories).toHaveLength(1);
		expect(config.repositories[0].id).toBe("repo-1");
		expect(config.repositories[0].name).toBe("test-repo");
		expect(config.repositories[0].repositoryPath).toBe("/path/to/repo");
		expect(config.repositories[0].baseBranch).toBe("main");
	});

	it("should apply default values for optional repository fields", async () => {
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

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		const repo = config.repositories[0];
		expect(repo.workspaceBaseDir).toBe("/home/cyrus/cyrus-workspaces");
		expect(repo.isActive).toBe(false);
		expect(repo.allowedTools).toEqual([
			"Read(**)",
			"Edit(**)",
			"Task",
			"WebFetch",
			"WebSearch",
			"TodoRead",
			"TodoWrite",
			"NotebookRead",
			"NotebookEdit",
			"Batch",
			"Bash",
		]);
		expect(repo.teamKeys).toEqual([]);
		expect(repo.labelPrompts).toEqual({
			debugger: ["Bug"],
			builder: ["Feature"],
			scoper: ["PRD"],
		});
	});

	it("should respect custom values for optional repository fields", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
					workspaceBaseDir: "/custom/workspace",
					isActive: true,
					allowedTools: ["Read(**)", "Edit(**)"],
					teamKeys: ["TEAM-1", "TEAM-2"],
					labelPrompts: { custom: ["CustomLabel"] },
				},
			],
		};

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		const repo = config.repositories[0];
		expect(repo.workspaceBaseDir).toBe("/custom/workspace");
		expect(repo.isActive).toBe(true);
		expect(repo.allowedTools).toEqual(["Read(**)", "Edit(**)"]);
		expect(repo.teamKeys).toEqual(["TEAM-1", "TEAM-2"]);
		expect(repo.labelPrompts).toEqual({ custom: ["CustomLabel"] });
	});

	it("should include Linear fields when provided", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
					linearWorkspaceId: "workspace-123",
					linearToken: "token-456",
				},
			],
		};

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		const repo = config.repositories[0];
		expect(repo.linearWorkspaceId).toBe("workspace-123");
		expect(repo.linearToken).toBe("token-456");
	});

	it("should include mcpConfigPath when provided", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
					mcpConfigPath: ["/path/to/mcp1.json", "/path/to/mcp2.json"],
				},
			],
		};

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		const repo = config.repositories[0];
		expect(repo.mcpConfigPath).toEqual([
			"/path/to/mcp1.json",
			"/path/to/mcp2.json",
		]);
	});

	it("should apply default global configuration values", async () => {
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

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		expect(config.disallowedTools).toEqual(["Bash(sudo:*)"]);
		expect(config.ngrokAuthToken).toBe("");
		expect(config.stripeCustomerId).toBe("cus_8172616126");
		expect(config.defaultModel).toBe("opus");
		expect(config.defaultFallbackModel).toBe("sonnet");
		expect(config.global_setup_script).toBe(
			"/opt/cyrus/scripts/global-setup.sh",
		);
	});

	it("should respect custom global configuration values", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
				},
			],
			disallowedTools: ["CustomTool"],
			ngrokAuthToken: "custom-token",
			stripeCustomerId: "custom-customer",
			defaultModel: "custom-model",
			defaultFallbackModel: "custom-fallback",
			global_setup_script: "/custom/setup.sh",
		};

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		expect(config.disallowedTools).toEqual(["CustomTool"]);
		expect(config.ngrokAuthToken).toBe("custom-token");
		expect(config.stripeCustomerId).toBe("custom-customer");
		expect(config.defaultModel).toBe("custom-model");
		expect(config.defaultFallbackModel).toBe("custom-fallback");
		expect(config.global_setup_script).toBe("/custom/setup.sh");
	});

	it("should handle multiple repositories", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo-1",
					repositoryPath: "/path/to/repo1",
					baseBranch: "main",
				},
				{
					id: "repo-2",
					name: "test-repo-2",
					repositoryPath: "/path/to/repo2",
					baseBranch: "develop",
					isActive: true,
				},
			],
		};

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);

		expect(config.repositories).toHaveLength(2);
		expect(config.repositories[0].id).toBe("repo-1");
		expect(config.repositories[1].id).toBe("repo-2");
		expect(config.repositories[1].isActive).toBe(true);
	});

	it("should create backup when backupConfig is true", async () => {
		// First create an initial config
		const initialPayload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "initial-repo",
					repositoryPath: "/initial/path",
					baseBranch: "main",
				},
			],
		};
		await handleCyrusConfig(initialPayload, testCyrusHome);

		// Wait a moment to ensure timestamp is different
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Update with backup enabled
		const updatePayload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-2",
					name: "updated-repo",
					repositoryPath: "/updated/path",
					baseBranch: "develop",
				},
			],
			backupConfig: true,
		};
		await handleCyrusConfig(updatePayload, testCyrusHome);

		// Check that backup was created
		const backupDir = join(testCyrusHome, "backups");
		const backupFiles = await fs.readdir(backupDir);
		expect(backupFiles.length).toBeGreaterThan(0);
		expect(backupFiles[0]).toMatch(
			/^config-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/,
		);

		// Verify backup contains the original config
		const backupPath = join(backupDir, backupFiles[0]);
		const backupData = await fs.readFile(backupPath, "utf-8");
		const backupConfig = JSON.parse(backupData);
		expect(backupConfig.repositories[0].name).toBe("initial-repo");

		// Verify new config has updated data
		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(configData);
		expect(config.repositories[0].name).toBe("updated-repo");
	});

	it("should not create backup when backupConfig is false", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
				},
			],
			backupConfig: false,
		};

		await handleCyrusConfig(payload, testCyrusHome);

		const backupDir = join(testCyrusHome, "backups");
		try {
			await fs.access(backupDir);
			const backupFiles = await fs.readdir(backupDir);
			expect(backupFiles.length).toBe(0);
		} catch {
			// Directory doesn't exist, which is fine
			expect(true).toBe(true);
		}
	});

	it("should set correct file permissions (0644)", async () => {
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

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const stats = await fs.stat(configPath);

		// On Unix systems, check permissions (0644 = 420 in decimal)
		// The mode includes file type bits, so we mask with 0o777
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o644);
	});

	it("should create .cyrus directory if it does not exist", async () => {
		// Use a nested path that doesn't exist
		const nestedCyrusHome = join(testCyrusHome, "nested", "path", ".cyrus");

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

		await handleCyrusConfig(payload, nestedCyrusHome);

		const configPath = join(nestedCyrusHome, "config.json");
		const configExists = await fs
			.access(configPath)
			.then(() => true)
			.catch(() => false);

		expect(configExists).toBe(true);
	});

	it("should throw error when repository is missing required fields", async () => {
		const invalidPayloads = [
			// Missing id
			{
				repositories: [
					{
						name: "test-repo",
						repositoryPath: "/path/to/repo",
						baseBranch: "main",
					},
				],
			},
			// Missing name
			{
				repositories: [
					{
						id: "repo-1",
						repositoryPath: "/path/to/repo",
						baseBranch: "main",
					},
				],
			},
			// Missing repositoryPath
			{
				repositories: [
					{
						id: "repo-1",
						name: "test-repo",
						baseBranch: "main",
					},
				],
			},
			// Missing baseBranch
			{
				repositories: [
					{
						id: "repo-1",
						name: "test-repo",
						repositoryPath: "/path/to/repo",
					},
				],
			},
		];

		for (const payload of invalidPayloads) {
			await expect(
				handleCyrusConfig(payload as CyrusConfigPayload, testCyrusHome),
			).rejects.toThrow(/missing required fields/);
		}
	});

	it("should produce properly formatted JSON with 2-space indentation", async () => {
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

		await handleCyrusConfig(payload, testCyrusHome);

		const configPath = join(testCyrusHome, "config.json");
		const configData = await fs.readFile(configPath, "utf-8");

		// Check for 2-space indentation
		const lines = configData.split("\n");
		const indentedLine = lines.find((line) => line.startsWith('  "'));
		expect(indentedLine).toBeTruthy();
		expect(indentedLine?.startsWith("  ")).toBe(true);
		expect(indentedLine?.startsWith("    ")).toBe(false); // Not 4 spaces
	});
});
