import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleCyrusConfig, readCyrusConfig } from "../handlers/cyrusConfig.js";
import type { CyrusConfigPayload } from "../types.js";

describe("handleCyrusConfig", () => {
	let testDir: string;

	beforeEach(() => {
		// Create temporary test directory
		testDir = join(process.cwd(), ".test-cyrus-config");
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("should create config.json with valid payload", async () => {
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

		const result = await handleCyrusConfig(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.message).toBe("Cyrus configuration updated successfully");

		// Verify file was created
		const configPath = join(testDir, "config.json");
		expect(existsSync(configPath)).toBe(true);

		// Verify content
		const content = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(content.repositories).toHaveLength(1);
		expect(content.repositories[0].id).toBe("repo-1");
	});

	it("should reject payload without repositories array", async () => {
		const payload = {} as CyrusConfigPayload;

		const result = await handleCyrusConfig(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"Configuration update requires repositories array",
		);
	});

	it("should reject repositories missing required fields", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					// Missing repositoryPath and baseBranch
				} as any,
			],
		};

		const result = await handleCyrusConfig(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe("Repository configuration is incomplete");
	});

	it("should set default values for optional fields", async () => {
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

		await handleCyrusConfig(payload, testDir);

		const configPath = join(testDir, "config.json");
		const content = JSON.parse(readFileSync(configPath, "utf-8"));

		expect(content.repositories[0].isActive).toBe(true);
		expect(content.repositories[0].teamKeys).toEqual([]);
		expect(content.repositories[0].workspaceBaseDir).toBe(
			join(testDir, "workspaces"),
		);
	});

	it("should include optional global settings when provided", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
				},
			],
			defaultModel: "claude-3-opus",
			disallowedTools: ["dangerous-tool"],
			ngrokAuthToken: "token-123",
		};

		await handleCyrusConfig(payload, testDir);

		const configPath = join(testDir, "config.json");
		const content = JSON.parse(readFileSync(configPath, "utf-8"));

		expect(content.defaultModel).toBe("claude-3-opus");
		expect(content.disallowedTools).toEqual(["dangerous-tool"]);
		expect(content.ngrokAuthToken).toBe("token-123");
	});

	it("should create backup when backupConfig is true", async () => {
		// First create an initial config
		const payload1: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
				},
			],
		};

		await handleCyrusConfig(payload1, testDir);

		// Update with backup flag
		const payload2: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-2",
					name: "new-repo",
					repositoryPath: "/path/to/new-repo",
					baseBranch: "develop",
				},
			],
			backupConfig: true,
		};

		await handleCyrusConfig(payload2, testDir);

		// Check for backup file
		const fs = await import("node:fs");
		const files = fs.readdirSync(testDir);
		const backupFiles = files.filter((f) => f.startsWith("config.backup-"));

		// At least one backup file should exist
		expect(backupFiles.length).toBeGreaterThan(0);
	});

	it("should return restartCyrus flag in response data", async () => {
		const payload: CyrusConfigPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "test-repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
				},
			],
			restartCyrus: true,
		};

		const result = await handleCyrusConfig(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.data?.restartCyrus).toBe(true);
	});
});

describe("readCyrusConfig", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(process.cwd(), ".test-cyrus-config-read");
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("should return empty config when file does not exist", () => {
		const config = readCyrusConfig(testDir);

		expect(config).toEqual({ repositories: [] });
	});

	it("should read existing config file", async () => {
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

		await handleCyrusConfig(payload, testDir);

		// Read it back
		const config = readCyrusConfig(testDir);

		expect(config.repositories).toHaveLength(1);
		expect(config.repositories[0].id).toBe("repo-1");
	});
});
