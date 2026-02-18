import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Must set env before importing config module
const testDir = resolve(tmpdir(), `cyrus-telegram-test-${Date.now()}`);

describe("loadConfig", () => {
	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });

		// Write a minimal config.json
		writeFileSync(
			resolve(testDir, "config.json"),
			JSON.stringify({
				repositories: [
					{
						id: "repo-1",
						name: "test-repo",
						repositoryPath: "/tmp/repo",
						baseBranch: "main",
						linearWorkspaceId: "ws-123",
						linearToken: "lin_test_token",
						workspaceBaseDir: "/tmp/workspaces",
					},
				],
			}),
		);
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});

	it("loads config from environment and config file", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:ABC");
		vi.stubEnv("TELEGRAM_ALLOWED_USERS", "111,222");
		vi.stubEnv("CYRUS_LINEAR_TEAM_ID", "team-uuid");
		vi.stubEnv("CYRUS_HOME", testDir);

		// Dynamic import to pick up env changes
		const { loadConfig } = await import("../src/config.js");
		const config = loadConfig();

		expect(config.botToken).toBe("123:ABC");
		expect(config.allowedUserIds).toEqual([111, 222]);
		expect(config.defaultTeamId).toBe("team-uuid");
		expect(config.linearToken).toBe("lin_test_token");
		expect(config.linearWorkspaceId).toBe("ws-123");
		expect(config.pollIntervalMs).toBe(15_000);
	});

	it("throws when required env vars are missing", async () => {
		vi.stubEnv("CYRUS_HOME", testDir);
		// Missing TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS, CYRUS_LINEAR_TEAM_ID

		const { loadConfig } = await import("../src/config.js");
		expect(() => loadConfig()).toThrow();
	});

	it("throws when config.json has no repositories", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:ABC");
		vi.stubEnv("TELEGRAM_ALLOWED_USERS", "111");
		vi.stubEnv("CYRUS_LINEAR_TEAM_ID", "team-uuid");
		vi.stubEnv("CYRUS_HOME", testDir);

		writeFileSync(
			resolve(testDir, "config.json"),
			JSON.stringify({ repositories: [] }),
		);

		const { loadConfig } = await import("../src/config.js");
		expect(() => loadConfig()).toThrow("No repositories configured");
	});
});
