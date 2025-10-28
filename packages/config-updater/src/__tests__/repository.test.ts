import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRepository } from "../handlers/repository.js";
import type { RepositoryPayload } from "../types.js";

describe("handleRepository", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(process.cwd(), ".test-cyrus-repos");
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

	it("should reject payload without repository_url", async () => {
		const payload = {} as RepositoryPayload;

		const result = await handleRepository(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe("Repository URL is required");
	});

	it("should extract repository name from URL when not provided", async () => {
		const payload: RepositoryPayload = {
			repository_url: "https://github.com/user/my-repo.git",
			repository_name: "",
		};

		// This will attempt to clone, which will fail in test environment
		// But we can check the error message contains the extracted name
		const result = await handleRepository(payload, testDir);

		// Since git clone will likely fail, check error details
		if (!result.success) {
			expect(result.details).toContain("my-repo");
		}
	});

	it("should use provided repository_name", async () => {
		const payload: RepositoryPayload = {
			repository_url: "https://github.com/user/repo.git",
			repository_name: "custom-name",
		};

		const result = await handleRepository(payload, testDir);

		// Check that custom name is used in path
		if (!result.success) {
			expect(result.details).toContain("custom-name");
		}
	});

	it("should verify existing repository", async () => {
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

		const result = await handleRepository(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.message).toBe("Repository already exists");
		expect(result.data?.action).toBe("verified");
	});

	it("should fail when directory exists but is not a git repo", async () => {
		// Create a non-git directory
		const reposDir = join(testDir, "repos");
		const repoPath = join(reposDir, "not-a-repo");

		mkdirSync(repoPath, { recursive: true });
		writeFileSync(join(repoPath, "some-file.txt"), "content", "utf-8");

		const payload: RepositoryPayload = {
			repository_url: "https://github.com/user/not-a-repo.git",
			repository_name: "not-a-repo",
		};

		const result = await handleRepository(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe("Directory exists but is not a Git repository");
	});

	it("should create repos directory if it does not exist", async () => {
		const reposDir = join(testDir, "repos");
		expect(existsSync(reposDir)).toBe(false);

		const payload: RepositoryPayload = {
			repository_url: "https://github.com/user/repo.git",
			repository_name: "repo",
		};

		// This will fail to clone, but repos directory should be created
		await handleRepository(payload, testDir);

		expect(existsSync(reposDir)).toBe(true);
	});

	// Note: We cannot easily test actual git cloning in unit tests
	// That would require network access and a real repository
	// Integration tests or E2E tests should cover that scenario

	it("should handle git clone errors gracefully", async () => {
		const payload: RepositoryPayload = {
			repository_url: "https://invalid-url-that-does-not-exist.com/repo.git",
			repository_name: "invalid-repo",
		};

		const result = await handleRepository(payload, testDir);

		// Git clone might succeed or fail depending on network/DNS
		// We just verify the handler doesn't throw and returns a valid response
		expect(result).toHaveProperty("success");
		if (!result.success) {
			expect(result.error).toBeDefined();
			expect(result.details).toBeDefined();
		}
	});

	it("should extract repository name from various URL formats", async () => {
		const testCases = [
			{
				url: "https://github.com/user/repo.git",
				expectedName: "repo",
			},
			{
				url: "https://github.com/user/repo",
				expectedName: "repo",
			},
			{
				url: "git@github.com:user/repo.git",
				expectedName: "repo",
			},
		];

		for (const testCase of testCases) {
			const payload: RepositoryPayload = {
				repository_url: testCase.url,
				repository_name: "", // Let it extract from URL
			};

			const result = await handleRepository(payload, testDir);

			// Check error message contains extracted name
			if (!result.success) {
				expect(result.details).toContain(testCase.expectedName);
			}
		}
	});
});
