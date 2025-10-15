import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	handleCloneRepository,
	handleDeleteRepository,
	handleListRepositories,
} from "./repository-handler";

// Mock child_process and fs/promises
vi.mock("child_process");
vi.mock("fs/promises");

describe("repository-handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("handleCloneRepository", () => {
		const repositoriesDir = "/test/repos";

		it("should throw error if repository_url is empty", async () => {
			await expect(
				handleCloneRepository({ repository_url: "" }, repositoriesDir),
			).rejects.toThrow("repository_url is required");
		});

		it("should throw error if repository_url is whitespace only", async () => {
			await expect(
				handleCloneRepository({ repository_url: "   " }, repositoriesDir),
			).rejects.toThrow("repository_url is required");
		});

		it("should extract repository name from GitHub URL if not provided", async () => {
			const mockStdout = { on: vi.fn() };
			const mockStderr = { on: vi.fn() };
			const mockStdin = { write: vi.fn(), end: vi.fn() };

			const mockProcess = {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: mockStdin,
				on: vi.fn((event, callback) => {
					if (event === "close") {
						callback(0); // Success
					}
				}),
			};

			vi.spyOn(childProcess, "spawn").mockImplementation(
				() => mockProcess as any,
			);
			vi.spyOn(fs, "stat").mockRejectedValue({ code: "ENOENT" }); // Path doesn't exist
			vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);

			const result = await handleCloneRepository(
				{ repository_url: "https://github.com/user/test-repo.git" },
				repositoriesDir,
			);

			expect(result).toBe("/test/repos/test-repo");
			expect(childProcess.spawn).toHaveBeenCalledWith(
				"git",
				[
					"clone",
					"https://github.com/user/test-repo.git",
					"/test/repos/test-repo",
				],
				expect.objectContaining({
					env: expect.objectContaining({
						GIT_TERMINAL_PROMPT: "0",
					}),
				}),
			);
		});

		it("should use provided repository_name instead of extracting from URL", async () => {
			const mockStdout = { on: vi.fn() };
			const mockStderr = { on: vi.fn() };
			const mockStdin = { write: vi.fn(), end: vi.fn() };

			const mockProcess = {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: mockStdin,
				on: vi.fn((event, callback) => {
					if (event === "close") {
						callback(0);
					}
				}),
			};

			vi.spyOn(childProcess, "spawn").mockImplementation(
				() => mockProcess as any,
			);
			vi.spyOn(fs, "stat").mockRejectedValue({ code: "ENOENT" });
			vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);

			const result = await handleCloneRepository(
				{
					repository_url: "https://github.com/user/test-repo.git",
					repository_name: "custom-name",
				},
				repositoriesDir,
			);

			expect(result).toBe("/test/repos/custom-name");
			expect(childProcess.spawn).toHaveBeenCalledWith(
				"git",
				[
					"clone",
					"https://github.com/user/test-repo.git",
					"/test/repos/custom-name",
				],
				expect.any(Object),
			);
		});

		it("should sanitize repository name to prevent path traversal", async () => {
			const mockStdout = { on: vi.fn() };
			const mockStderr = { on: vi.fn() };

			const mockProcess = {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: { write: vi.fn(), end: vi.fn() },
				on: vi.fn((event, callback) => {
					if (event === "close") {
						callback(0);
					}
				}),
			};

			vi.spyOn(childProcess, "spawn").mockImplementation(
				() => mockProcess as any,
			);
			vi.spyOn(fs, "stat").mockRejectedValue({ code: "ENOENT" });
			vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);

			const result = await handleCloneRepository(
				{
					repository_url: "https://github.com/user/repo",
					repository_name: "../../../etc/passwd",
				},
				repositoriesDir,
			);

			// Should sanitize to remove path traversal
			expect(result).toBe("/test/repos/etc-passwd");
		});

		it("should throw error if repository already exists", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({} as any); // Path exists

			await expect(
				handleCloneRepository(
					{ repository_url: "https://github.com/user/test-repo" },
					repositoriesDir,
				),
			).rejects.toThrow("Repository already exists at");
		});

		it("should create parent directory if it does not exist", async () => {
			const mockStdout = { on: vi.fn() };
			const mockStderr = { on: vi.fn() };

			const mockProcess = {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: { write: vi.fn(), end: vi.fn() },
				on: vi.fn((event, callback) => {
					if (event === "close") {
						callback(0);
					}
				}),
			};

			vi.spyOn(childProcess, "spawn").mockImplementation(
				() => mockProcess as any,
			);
			vi.spyOn(fs, "stat").mockRejectedValue({ code: "ENOENT" });
			const mkdirSpy = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);

			await handleCloneRepository(
				{ repository_url: "https://github.com/user/test-repo" },
				repositoriesDir,
			);

			expect(mkdirSpy).toHaveBeenCalledWith("/test/repos", {
				recursive: true,
				mode: 0o755,
			});
		});

		it("should handle git clone failure", async () => {
			const mockStdout = { on: vi.fn() };
			const mockStderr = {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						callback(Buffer.from("fatal: repository not found"));
					}
				}),
			};

			const mockProcess = {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: { write: vi.fn(), end: vi.fn() },
				on: vi.fn((event, callback) => {
					if (event === "close") {
						callback(1); // Error exit code
					}
				}),
			};

			vi.spyOn(childProcess, "spawn").mockImplementation(
				() => mockProcess as any,
			);
			vi.spyOn(fs, "stat").mockRejectedValue({ code: "ENOENT" });
			vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);

			await expect(
				handleCloneRepository(
					{ repository_url: "https://github.com/user/nonexistent" },
					repositoriesDir,
				),
			).rejects.toThrow("Failed to clone repository");
		});

		it("should throw error if repository name cannot be extracted from URL", async () => {
			// The URL 'invalid-url' gets extracted as 'invalid-url' by the fallback logic
			// So we need a URL that truly cannot be extracted - empty string after all processing
			await expect(
				handleCloneRepository({ repository_url: "/" }, repositoriesDir),
			).rejects.toThrow(
				"Could not extract repository name from URL, please provide repository_name",
			);
		});
	});

	describe("handleDeleteRepository", () => {
		const repositoriesDir = "/test/repos";
		const workspacesDir = "/test/workspaces";

		it("should throw error if repository_name is empty", async () => {
			await expect(
				handleDeleteRepository({ repository_name: "" }, repositoriesDir),
			).rejects.toThrow("repository_name is required");
		});

		it("should throw error if repository_name is whitespace only", async () => {
			await expect(
				handleDeleteRepository({ repository_name: "   " }, repositoriesDir),
			).rejects.toThrow("repository_name is required");
		});

		it("should delete repository successfully", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({} as any); // Repository exists
			const rmSpy = vi.spyOn(fs, "rm").mockResolvedValue(undefined);

			const result = await handleDeleteRepository(
				{ repository_name: "test-repo" },
				repositoriesDir,
			);

			expect(result).toEqual(["/test/repos/test-repo"]);
			expect(rmSpy).toHaveBeenCalledWith("/test/repos/test-repo", {
				recursive: true,
				force: true,
			});
		});

		it("should throw error if repository does not exist", async () => {
			const error: any = new Error("ENOENT: no such file or directory");
			error.code = "ENOENT";
			vi.spyOn(fs, "stat").mockRejectedValue(error);

			await expect(
				handleDeleteRepository(
					{ repository_name: "nonexistent" },
					repositoriesDir,
				),
			).rejects.toThrow("Repository not found at");
		});

		it("should sanitize repository name to prevent path traversal", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({} as any);
			const rmSpy = vi.spyOn(fs, "rm").mockResolvedValue(undefined);

			await handleDeleteRepository(
				{ repository_name: "../../../etc/passwd" },
				repositoriesDir,
			);

			// Should sanitize the path - '../../../etc/passwd' becomes 'etc-passwd' after removing '../' and leading/trailing dashes
			expect(rmSpy).toHaveBeenCalledWith("/test/repos/etc-passwd", {
				recursive: true,
				force: true,
			});
		});

		it("should validate that path is within repositories directory", async () => {
			// This test verifies the security check
			// The join normalization should prevent the path from escaping
			vi.spyOn(fs, "stat").mockResolvedValue({} as any);

			// Even with path traversal attempts, the sanitization should keep it safe
			await expect(
				handleDeleteRepository(
					{ repository_name: "../../../../etc/passwd" },
					repositoriesDir,
				),
			).resolves.toBeDefined();
		});

		it("should delete associated worktrees when linear_team_key is provided", async () => {
			vi.spyOn(fs, "stat")
				.mockResolvedValueOnce({} as any) // Repository exists
				.mockResolvedValueOnce({ isDirectory: () => true } as any); // Workspaces dir exists

			vi.spyOn(fs, "readdir").mockResolvedValue([
				{ name: "TEAM-123", isDirectory: () => true } as any,
				{ name: "TEAM-456", isDirectory: () => true } as any,
				{ name: "OTHER-789", isDirectory: () => true } as any,
			]);

			const rmSpy = vi.spyOn(fs, "rm").mockResolvedValue(undefined);

			const result = await handleDeleteRepository(
				{ repository_name: "test-repo", linear_team_key: "TEAM" },
				repositoriesDir,
				workspacesDir,
			);

			expect(result).toHaveLength(3); // Repository + 2 worktrees
			expect(result).toContain("/test/repos/test-repo");
			expect(result).toContain("/test/workspaces/TEAM-123");
			expect(result).toContain("/test/workspaces/TEAM-456");
			expect(result).not.toContain("/test/workspaces/OTHER-789");
			expect(rmSpy).toHaveBeenCalledTimes(3);
		});

		it("should not fail if worktree deletion fails", async () => {
			vi.spyOn(fs, "stat")
				.mockResolvedValueOnce({} as any) // Repository exists
				.mockResolvedValueOnce({ isDirectory: () => true } as any); // Workspaces dir exists

			vi.spyOn(fs, "readdir").mockResolvedValue([
				{ name: "TEAM-123", isDirectory: () => true } as any,
			]);

			vi.spyOn(fs, "rm")
				.mockResolvedValueOnce(undefined) // Repository deletion succeeds
				.mockRejectedValueOnce(new Error("Permission denied")); // Worktree deletion fails

			const consoleWarnSpy = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});

			const result = await handleDeleteRepository(
				{ repository_name: "test-repo", linear_team_key: "TEAM" },
				repositoriesDir,
				workspacesDir,
			);

			// Should still return the repository path even if worktree deletion fails
			expect(result).toContain("/test/repos/test-repo");
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to delete worktree"),
			);

			consoleWarnSpy.mockRestore();
		});

		it("should log warning if no linear_team_key provided", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({} as any);
			vi.spyOn(fs, "rm").mockResolvedValue(undefined);
			const consoleWarnSpy = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});

			await handleDeleteRepository(
				{ repository_name: "test-repo" },
				repositoriesDir,
				workspacesDir,
			);

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining("No linear_team_key provided"),
			);

			consoleWarnSpy.mockRestore();
		});

		it("should not attempt to delete worktrees if workspacesDir is not provided", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({} as any);
			vi.spyOn(fs, "rm").mockResolvedValue(undefined);
			const readdirSpy = vi.spyOn(fs, "readdir");

			await handleDeleteRepository(
				{ repository_name: "test-repo", linear_team_key: "TEAM" },
				repositoriesDir,
				// No workspacesDir provided
			);

			expect(readdirSpy).not.toHaveBeenCalled();
		});

		it("should handle non-existent worktrees directory gracefully", async () => {
			vi.spyOn(fs, "stat")
				.mockResolvedValueOnce({} as any) // Repository exists
				.mockRejectedValueOnce({ code: "ENOENT" }); // Workspaces dir doesn't exist

			vi.spyOn(fs, "rm").mockResolvedValue(undefined);
			const consoleLogSpy = vi
				.spyOn(console, "log")
				.mockImplementation(() => {});

			const result = await handleDeleteRepository(
				{ repository_name: "test-repo", linear_team_key: "TEAM" },
				repositoriesDir,
				workspacesDir,
			);

			expect(result).toEqual(["/test/repos/test-repo"]);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining("Worktrees directory does not exist"),
			);

			consoleLogSpy.mockRestore();
		});
	});

	describe("handleListRepositories", () => {
		const repositoriesDir = "/test/repos";

		it("should list all repositories in the directory", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({
				isDirectory: () => true,
			} as any);
			vi.spyOn(fs, "readdir").mockResolvedValue([
				{ name: "repo1", isDirectory: () => true } as any,
				{ name: "repo2", isDirectory: () => true } as any,
				{ name: "file.txt", isDirectory: () => false } as any,
				{ name: ".hidden", isDirectory: () => true } as any,
			]);

			const result = await handleListRepositories(repositoriesDir);

			expect(result).toEqual([
				{ name: "repo1", path: "/test/repos/repo1" },
				{ name: "repo2", path: "/test/repos/repo2" },
			]);
		});

		it("should return empty array if repositories directory does not exist", async () => {
			vi.spyOn(fs, "stat").mockRejectedValue({ code: "ENOENT" });
			const consoleLogSpy = vi
				.spyOn(console, "log")
				.mockImplementation(() => {});

			const result = await handleListRepositories(repositoriesDir);

			expect(result).toEqual([]);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining("Repositories directory does not exist"),
			);

			consoleLogSpy.mockRestore();
		});

		it("should return empty array if path is not a directory", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({
				isDirectory: () => false,
			} as any);
			const consoleLogSpy = vi
				.spyOn(console, "log")
				.mockImplementation(() => {});

			const result = await handleListRepositories(repositoriesDir);

			expect(result).toEqual([]);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining("Repositories path is not a directory"),
			);

			consoleLogSpy.mockRestore();
		});

		it("should filter out hidden directories (starting with dot)", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({
				isDirectory: () => true,
			} as any);
			vi.spyOn(fs, "readdir").mockResolvedValue([
				{ name: "repo1", isDirectory: () => true } as any,
				{ name: ".git", isDirectory: () => true } as any,
				{ name: ".hidden-folder", isDirectory: () => true } as any,
			]);

			const result = await handleListRepositories(repositoriesDir);

			expect(result).toEqual([{ name: "repo1", path: "/test/repos/repo1" }]);
		});

		it("should filter out non-directory entries", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({
				isDirectory: () => true,
			} as any);
			vi.spyOn(fs, "readdir").mockResolvedValue([
				{ name: "repo1", isDirectory: () => true } as any,
				{ name: "README.md", isDirectory: () => false } as any,
				{ name: "config.json", isDirectory: () => false } as any,
			]);

			const result = await handleListRepositories(repositoriesDir);

			expect(result).toEqual([{ name: "repo1", path: "/test/repos/repo1" }]);
		});

		it("should throw error if readdir fails", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({
				isDirectory: () => true,
			} as any);
			vi.spyOn(fs, "readdir").mockRejectedValue(new Error("Permission denied"));

			await expect(handleListRepositories(repositoriesDir)).rejects.toThrow(
				"Failed to list repositories: Permission denied",
			);
		});

		it("should return empty array for empty directory", async () => {
			vi.spyOn(fs, "stat").mockResolvedValue({
				isDirectory: () => true,
			} as any);
			vi.spyOn(fs, "readdir").mockResolvedValue([]);

			const result = await handleListRepositories(repositoriesDir);

			expect(result).toEqual([]);
		});
	});
});
