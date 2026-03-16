import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitService } from "../src/GitService.js";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	rmSync: vi.fn(),
	statSync: vi.fn(),
}));

vi.mock("../src/WorktreeIncludeService.js", () => ({
	WorktreeIncludeService: vi.fn().mockImplementation(() => ({
		copyIgnoredFiles: vi.fn().mockResolvedValue(undefined),
	})),
}));

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockRmSync = vi.mocked(rmSync);
const mockStatSync = vi.mocked(statSync);

describe("GitService", () => {
	let gitService: GitService;
	const mockLogger: any = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		withContext: vi.fn().mockReturnThis(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		gitService = new GitService(mockLogger);
	});

	describe("findWorktreeByBranch", () => {
		it("returns the worktree path when the branch is found", () => {
			mockExecSync.mockReturnValue(
				[
					"worktree /home/user/repo",
					"HEAD abc123def456",
					"branch refs/heads/main",
					"",
					"worktree /home/user/.cyrus/worktrees/ENG-97",
					"HEAD 789abc012def",
					"branch refs/heads/cyrustester/eng-97-fix-shader",
					"",
				].join("\n"),
			);

			const result = gitService.findWorktreeByBranch(
				"cyrustester/eng-97-fix-shader",
				"/home/user/repo",
			);

			expect(result).toBe("/home/user/.cyrus/worktrees/ENG-97");
		});

		it("returns null when the branch is not found", () => {
			mockExecSync.mockReturnValue(
				[
					"worktree /home/user/repo",
					"HEAD abc123def456",
					"branch refs/heads/main",
					"",
				].join("\n"),
			);

			const result = gitService.findWorktreeByBranch(
				"nonexistent-branch",
				"/home/user/repo",
			);

			expect(result).toBeNull();
		});

		it("handles empty output gracefully", () => {
			mockExecSync.mockReturnValue("");

			const result = gitService.findWorktreeByBranch(
				"some-branch",
				"/home/user/repo",
			);

			expect(result).toBeNull();
		});

		it("handles bare worktree entries (no branch line)", () => {
			mockExecSync.mockReturnValue(
				[
					"worktree /home/user/repo",
					"HEAD abc123def456",
					"bare",
					"",
					"worktree /home/user/.cyrus/worktrees/ENG-97",
					"HEAD 789abc012def",
					"branch refs/heads/my-feature",
					"",
				].join("\n"),
			);

			const result = gitService.findWorktreeByBranch(
				"my-feature",
				"/home/user/repo",
			);

			expect(result).toBe("/home/user/.cyrus/worktrees/ENG-97");
		});

		it("returns null when git command fails", () => {
			mockExecSync.mockImplementation(() => {
				throw new Error("not a git repository");
			});

			const result = gitService.findWorktreeByBranch(
				"some-branch",
				"/not/a/repo",
			);

			expect(result).toBeNull();
		});

		it("handles detached HEAD entries (no branch line)", () => {
			mockExecSync.mockReturnValue(
				[
					"worktree /home/user/detached",
					"HEAD abc123def456",
					"detached",
					"",
				].join("\n"),
			);

			const result = gitService.findWorktreeByBranch(
				"some-branch",
				"/home/user/repo",
			);

			expect(result).toBeNull();
		});
	});

	// Shared helpers for test data
	const makeIssue = (overrides: Partial<any> = {}): any => ({
		id: "issue-1",
		identifier: "ENG-97",
		title: "Fix the shader",
		description: null,
		url: "",
		branchName: "cyrustester/eng-97-fix-shader",
		assigneeId: null,
		stateId: null,
		teamId: null,
		labelIds: [],
		priority: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
		archivedAt: null,
		state: Promise.resolve(undefined),
		assignee: Promise.resolve(undefined),
		team: Promise.resolve(undefined),
		parent: Promise.resolve(undefined),
		project: Promise.resolve(undefined),
		labels: () => Promise.resolve({ nodes: [] }),
		comments: () => Promise.resolve({ nodes: [] }),
		attachments: () => Promise.resolve({ nodes: [] }),
		children: () => Promise.resolve({ nodes: [] }),
		inverseRelations: () => Promise.resolve({ nodes: [] }),
		update: () =>
			Promise.resolve({ success: true, issue: undefined, lastSyncId: 0 }),
		...overrides,
	});

	const makeRepository = (overrides: Partial<any> = {}): any => ({
		id: "repo-1",
		name: "test-repo",
		repositoryPath: "/home/user/repo",
		workspaceBaseDir: "/home/user/.cyrus/worktrees",
		baseBranch: "main",
		...overrides,
	});

	describe("createGitWorktree - 1 repo (backward compat)", () => {
		it("reuses existing worktree when branch is already checked out at a different path", async () => {
			const issue = makeIssue();
			const repository = makeRepository();

			let callCount = 0;
			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (cmdStr === "git rev-parse --git-dir") {
					return Buffer.from(".git\n");
				}
				if (cmdStr === "git worktree list --porcelain") {
					callCount++;
					if (callCount === 1) {
						// First call: path-based check — doesn't contain workspacePath
						return "";
					}
					// Second call: branch-based check via findWorktreeByBranch
					return [
						"worktree /home/user/.cyrus/worktrees/LINEAR-SESSION",
						"HEAD 789abc012def",
						"branch refs/heads/cyrustester/eng-97-fix-shader",
						"",
					].join("\n");
				}
				if (
					cmdStr.includes(
						'git rev-parse --verify "cyrustester/eng-97-fix-shader"',
					)
				) {
					// Branch exists
					return Buffer.from("abc123\n");
				}
				return Buffer.from("");
			});

			const result = await gitService.createGitWorktree(issue, [repository]);

			expect(result.path).toBe("/home/user/.cyrus/worktrees/LINEAR-SESSION");
			expect(result.isGitWorktree).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("already checked out in worktree"),
			);
		});

		it("catches 'already used by worktree' error and reuses existing worktree", async () => {
			const issue = makeIssue();
			const repository = makeRepository();

			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (cmdStr === "git rev-parse --git-dir") {
					return Buffer.from(".git\n");
				}
				if (cmdStr === "git worktree list --porcelain") {
					// Both the path check and branch check return nothing
					return "";
				}
				if (
					cmdStr.includes(
						'git rev-parse --verify "cyrustester/eng-97-fix-shader"',
					)
				) {
					// Branch exists
					return Buffer.from("abc123\n");
				}
				if (cmdStr.includes("git fetch origin")) {
					return Buffer.from("");
				}
				if (cmdStr.includes("git worktree add")) {
					throw new Error(
						"fatal: 'cyrustester/eng-97-fix-shader' is already used by worktree at '/home/user/.cyrus/worktrees/LINEAR-SESSION'",
					);
				}
				return Buffer.from("");
			});

			mockExistsSync.mockImplementation((path: any) => {
				if (String(path) === "/home/user/.cyrus/worktrees/LINEAR-SESSION") {
					return true;
				}
				return false;
			});

			const result = await gitService.createGitWorktree(issue, [repository]);

			expect(result.path).toBe("/home/user/.cyrus/worktrees/LINEAR-SESSION");
			expect(result.isGitWorktree).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("Reusing existing worktree"),
			);
		});

		it("falls back to empty directory for unrecognized errors", async () => {
			const issue = makeIssue();
			const repository = makeRepository();

			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (cmdStr === "git rev-parse --git-dir") {
					return Buffer.from(".git\n");
				}
				if (cmdStr === "git worktree list --porcelain") {
					return "";
				}
				if (
					cmdStr.includes(
						'git rev-parse --verify "cyrustester/eng-97-fix-shader"',
					)
				) {
					return Buffer.from("abc123\n");
				}
				if (cmdStr.includes("git fetch origin")) {
					return Buffer.from("");
				}
				if (cmdStr.includes("git worktree add")) {
					throw new Error("fatal: some completely different error");
				}
				return Buffer.from("");
			});

			const result = await gitService.createGitWorktree(issue, [repository]);

			expect(result.path).toBe("/home/user/.cyrus/worktrees/ENG-97");
			expect(result.isGitWorktree).toBe(false);
		});
	});

	describe("deleteWorktree", () => {
		it("does nothing when workspace directory does not exist", () => {
			mockExistsSync.mockReturnValue(false);

			gitService.deleteWorktree("DEF-123", "/home/user/.cyrus/worktrees");

			expect(mockRmSync).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("does not exist"),
			);
		});

		it("removes single-repo worktree and deletes directory", () => {
			mockExistsSync.mockImplementation((path: any) => {
				const p = String(path);
				if (p === "/home/user/.cyrus/worktrees/DEF-123") return true;
				// .git file exists (it's a worktree)
				if (p === "/home/user/.cyrus/worktrees/DEF-123/.git") return true;
				return false;
			});

			mockStatSync.mockImplementation((path: any) => {
				const p = String(path);
				if (p === "/home/user/.cyrus/worktrees/DEF-123/.git") {
					return { isFile: () => true } as any;
				}
				return { isFile: () => false } as any;
			});

			mockExecSync.mockReturnValue(Buffer.from(""));

			gitService.deleteWorktree("DEF-123", "/home/user/.cyrus/worktrees");

			// Should run git worktree remove
			expect(mockExecSync).toHaveBeenCalledWith(
				'git worktree remove --force "/home/user/.cyrus/worktrees/DEF-123"',
				expect.objectContaining({ stdio: "pipe" }),
			);

			// Should delete the directory
			expect(mockRmSync).toHaveBeenCalledWith(
				"/home/user/.cyrus/worktrees/DEF-123",
				{ recursive: true, force: true },
			);
		});

		it("removes multi-repo worktrees and deletes directory", () => {
			mockExistsSync.mockImplementation((path: any) => {
				const p = String(path);
				if (p === "/home/user/.cyrus/worktrees/DEF-123") return true;
				// The root is NOT a worktree
				if (p === "/home/user/.cyrus/worktrees/DEF-123/.git") return false;
				// Subdirectory worktrees have .git files
				if (p === "/home/user/.cyrus/worktrees/DEF-123/repo-a/.git")
					return true;
				if (p === "/home/user/.cyrus/worktrees/DEF-123/repo-b/.git")
					return true;
				return false;
			});

			mockStatSync.mockImplementation((path: any) => {
				const p = String(path);
				if (
					p === "/home/user/.cyrus/worktrees/DEF-123/repo-a/.git" ||
					p === "/home/user/.cyrus/worktrees/DEF-123/repo-b/.git"
				) {
					return { isFile: () => true } as any;
				}
				return { isFile: () => false } as any;
			});

			mockReaddirSync.mockReturnValue([
				{ name: "repo-a", isDirectory: () => true },
				{ name: "repo-b", isDirectory: () => true },
			] as any);

			mockExecSync.mockReturnValue(Buffer.from(""));

			gitService.deleteWorktree("DEF-123", "/home/user/.cyrus/worktrees");

			// Should run git worktree remove for both subdirectories
			expect(mockExecSync).toHaveBeenCalledWith(
				'git worktree remove --force "/home/user/.cyrus/worktrees/DEF-123/repo-a"',
				expect.objectContaining({ stdio: "pipe" }),
			);
			expect(mockExecSync).toHaveBeenCalledWith(
				'git worktree remove --force "/home/user/.cyrus/worktrees/DEF-123/repo-b"',
				expect.objectContaining({ stdio: "pipe" }),
			);

			// Should delete the directory
			expect(mockRmSync).toHaveBeenCalledWith(
				"/home/user/.cyrus/worktrees/DEF-123",
				{ recursive: true, force: true },
			);
		});

		it("handles git worktree remove failure gracefully", () => {
			mockExistsSync.mockImplementation((path: any) => {
				const p = String(path);
				if (p === "/home/user/.cyrus/worktrees/DEF-123") return true;
				if (p === "/home/user/.cyrus/worktrees/DEF-123/.git") return true;
				return false;
			});

			mockStatSync.mockImplementation((path: any) => {
				const p = String(path);
				if (p === "/home/user/.cyrus/worktrees/DEF-123/.git") {
					return { isFile: () => true } as any;
				}
				return { isFile: () => false } as any;
			});

			mockExecSync.mockImplementation(() => {
				throw new Error("git worktree remove failed");
			});

			gitService.deleteWorktree("DEF-123", "/home/user/.cyrus/worktrees");

			// Should still attempt to delete the directory despite git failure
			expect(mockRmSync).toHaveBeenCalledWith(
				"/home/user/.cyrus/worktrees/DEF-123",
				{ recursive: true, force: true },
			);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to remove git worktree"),
			);
		});

		it("handles non-worktree directories (no .git file)", () => {
			mockExistsSync.mockImplementation((path: any) => {
				const p = String(path);
				if (p === "/home/user/.cyrus/worktrees/DEF-123") return true;
				// No .git file anywhere
				return false;
			});

			mockReaddirSync.mockReturnValue([] as any);

			gitService.deleteWorktree("DEF-123", "/home/user/.cyrus/worktrees");

			// Should not call git worktree remove
			expect(mockExecSync).not.toHaveBeenCalled();

			// Should still delete the directory
			expect(mockRmSync).toHaveBeenCalledWith(
				"/home/user/.cyrus/worktrees/DEF-123",
				{ recursive: true, force: true },
			);
		});
	});

	describe("createGitWorktree - 0 repos", () => {
		it("creates a plain folder with no git worktree", async () => {
			const issue = makeIssue();

			const result = await gitService.createGitWorktree(issue, [], {
				workspaceBaseDir: "/home/user/.cyrus/worktrees",
			});

			expect(result.path).toBe("/home/user/.cyrus/worktrees/ENG-97");
			expect(result.isGitWorktree).toBe(false);
			expect(result.repoPaths).toBeUndefined();
			expect(mockMkdirSync).toHaveBeenCalledWith(
				"/home/user/.cyrus/worktrees/ENG-97",
				{ recursive: true },
			);
		});

		it("throws if workspaceBaseDir is not provided with 0 repos", async () => {
			const issue = makeIssue();

			await expect(gitService.createGitWorktree(issue, [])).rejects.toThrow(
				"workspaceBaseDir is required",
			);
		});

		it("runs global setup script in the plain folder", async () => {
			const issue = makeIssue();

			// Mock existsSync to return true for the global script
			mockExistsSync.mockReturnValue(true);

			const result = await gitService.createGitWorktree(issue, [], {
				workspaceBaseDir: "/home/user/.cyrus/worktrees",
				globalSetupScript: "/home/user/setup.sh",
			});

			expect(result.path).toBe("/home/user/.cyrus/worktrees/ENG-97");
			expect(result.isGitWorktree).toBe(false);
		});
	});

	describe("createGitWorktree - N repos (multi-repo)", () => {
		it("creates parent folder with per-repo worktree subdirectories", async () => {
			const issue = makeIssue();
			const repo1 = makeRepository({
				id: "repo-1",
				name: "cyrus",
				repositoryPath: "/home/user/cyrus",
			});
			const repo2 = makeRepository({
				id: "repo-2",
				name: "cyrus-hosted",
				repositoryPath: "/home/user/cyrus-hosted",
			});

			// Mock git commands for both repos
			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (cmdStr === "git rev-parse --git-dir") {
					return Buffer.from(".git\n");
				}
				if (cmdStr === "git worktree list --porcelain") {
					return "";
				}
				if (cmdStr.includes("git rev-parse --verify")) {
					// Branch doesn't exist (will create new)
					throw new Error("not found");
				}
				if (cmdStr.includes("git fetch origin")) {
					return Buffer.from("");
				}
				if (cmdStr.includes("git ls-remote")) {
					return Buffer.from("abc123 refs/heads/main\n");
				}
				if (cmdStr.includes("git worktree add")) {
					return Buffer.from("");
				}
				return Buffer.from("");
			});

			const result = await gitService.createGitWorktree(issue, [repo1, repo2]);

			expect(result.path).toBe("/home/user/.cyrus/worktrees/ENG-97");
			expect(result.isGitWorktree).toBe(true);
			expect(result.repoPaths).toBeDefined();
			expect(result.repoPaths!["repo-1"]).toBe(
				"/home/user/.cyrus/worktrees/ENG-97/cyrus",
			);
			expect(result.repoPaths!["repo-2"]).toBe(
				"/home/user/.cyrus/worktrees/ENG-97/cyrus-hosted",
			);
		});

		it("uses first repo workspaceBaseDir when no override", async () => {
			const issue = makeIssue();
			const repo1 = makeRepository({
				id: "repo-1",
				name: "cyrus",
				repositoryPath: "/home/user/cyrus",
				workspaceBaseDir: "/home/user/.cyrus/worktrees",
			});
			const repo2 = makeRepository({
				id: "repo-2",
				name: "cyrus-hosted",
				repositoryPath: "/home/user/cyrus-hosted",
				workspaceBaseDir: "/other/base",
			});

			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (cmdStr === "git rev-parse --git-dir") {
					return Buffer.from(".git\n");
				}
				if (cmdStr === "git worktree list --porcelain") {
					return "";
				}
				if (cmdStr.includes("git rev-parse --verify")) {
					throw new Error("not found");
				}
				if (cmdStr.includes("git fetch origin")) {
					return Buffer.from("");
				}
				if (cmdStr.includes("git ls-remote")) {
					return Buffer.from("abc123 refs/heads/main\n");
				}
				if (cmdStr.includes("git worktree add")) {
					return Buffer.from("");
				}
				return Buffer.from("");
			});

			const result = await gitService.createGitWorktree(issue, [repo1, repo2]);

			// Parent path uses first repo's workspaceBaseDir
			expect(result.path).toBe("/home/user/.cyrus/worktrees/ENG-97");
		});

		it("falls back to plain directory for individual repo failures in N-repo mode", async () => {
			const issue = makeIssue();
			const repo1 = makeRepository({
				id: "repo-1",
				name: "cyrus",
				repositoryPath: "/home/user/cyrus",
			});
			const repo2 = makeRepository({
				id: "repo-2",
				name: "cyrus-hosted",
				repositoryPath: "/home/user/does-not-exist",
			});

			mockExecSync.mockImplementation((cmd: any, opts: any) => {
				const cmdStr = String(cmd);
				if (cmdStr === "git rev-parse --git-dir") {
					// Second repo is not a git repo
					if (opts?.cwd === "/home/user/does-not-exist") {
						throw new Error("Not a git directory");
					}
					return Buffer.from(".git\n");
				}
				if (cmdStr === "git worktree list --porcelain") {
					return "";
				}
				if (cmdStr.includes("git rev-parse --verify")) {
					throw new Error("not found");
				}
				if (cmdStr.includes("git fetch origin")) {
					return Buffer.from("");
				}
				if (cmdStr.includes("git ls-remote")) {
					return Buffer.from("abc123 refs/heads/main\n");
				}
				if (cmdStr.includes("git worktree add")) {
					return Buffer.from("");
				}
				return Buffer.from("");
			});

			const result = await gitService.createGitWorktree(issue, [repo1, repo2]);

			expect(result.repoPaths).toBeDefined();
			// First repo should have succeeded
			expect(result.repoPaths!["repo-1"]).toBe(
				"/home/user/.cyrus/worktrees/ENG-97/cyrus",
			);
			// Second repo falls back to plain directory
			expect(result.repoPaths!["repo-2"]).toBe(
				"/home/user/.cyrus/worktrees/ENG-97/cyrus-hosted",
			);
		});
	});

	describe("determineBaseBranch", () => {
		it("returns default base branch when no graphite label and no parent", async () => {
			const issue = makeIssue();
			const repository = makeRepository();

			const result = await gitService.determineBaseBranch(issue, repository);

			expect(result.branch).toBe("main");
			expect(result.source).toBe("default");
		});

		it("uses parent branch when parent exists", async () => {
			const issue = makeIssue({
				parent: Promise.resolve({
					identifier: "ENG-96",
					title: "Parent issue",
					branchName: "cyrustester/eng-96-parent-issue",
				}),
			});
			const repository = makeRepository();

			// Mock branchExists to return true for parent branch
			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (
					cmdStr.includes(
						'git rev-parse --verify "cyrustester/eng-96-parent-issue"',
					)
				) {
					return Buffer.from("abc123\n");
				}
				throw new Error("not found");
			});

			const result = await gitService.determineBaseBranch(issue, repository);

			expect(result.branch).toBe("cyrustester/eng-96-parent-issue");
			expect(result.source).toBe("parent-issue");
			expect(result.detail).toContain("ENG-96");
		});

		it("uses blocking issue branch when graphite label is present (priority over parent)", async () => {
			const blockingIssue = {
				identifier: "ENG-95",
				title: "Blocking issue",
				branchName: "cyrustester/eng-95-blocking",
			};

			const issue = makeIssue({
				parent: Promise.resolve({
					identifier: "ENG-96",
					title: "Parent issue",
					branchName: "cyrustester/eng-96-parent",
				}),
				labels: () =>
					Promise.resolve({
						nodes: [{ name: "graphite" }],
					}),
				inverseRelations: () =>
					Promise.resolve({
						nodes: [
							{
								type: "blocks",
								issue: Promise.resolve(blockingIssue),
							},
						],
					}),
			});
			const repository = makeRepository();

			// Mock branchExists to return true for blocking branch
			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (
					cmdStr.includes(
						'git rev-parse --verify "cyrustester/eng-95-blocking"',
					)
				) {
					return Buffer.from("abc123\n");
				}
				throw new Error("not found");
			});

			const result = await gitService.determineBaseBranch(issue, repository);

			expect(result.branch).toBe("cyrustester/eng-95-blocking");
			expect(result.source).toBe("graphite-blocked-by");
			expect(result.detail).toContain("ENG-95");
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("blocking issue branch"),
			);
		});

		it("falls back to parent when blocking branch does not exist", async () => {
			const blockingIssue = {
				identifier: "ENG-95",
				title: "Blocking issue",
				branchName: "cyrustester/eng-95-blocking",
			};

			const issue = makeIssue({
				parent: Promise.resolve({
					identifier: "ENG-96",
					title: "Parent issue",
					branchName: "cyrustester/eng-96-parent",
				}),
				labels: () =>
					Promise.resolve({
						nodes: [{ name: "graphite" }],
					}),
				inverseRelations: () =>
					Promise.resolve({
						nodes: [
							{
								type: "blocks",
								issue: Promise.resolve(blockingIssue),
							},
						],
					}),
			});
			const repository = makeRepository();

			// Mock branchExists: blocking branch doesn't exist, parent does
			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (
					cmdStr.includes('git rev-parse --verify "cyrustester/eng-96-parent"')
				) {
					return Buffer.from("abc123\n");
				}
				throw new Error("not found");
			});

			const result = await gitService.determineBaseBranch(issue, repository);

			expect(result.branch).toBe("cyrustester/eng-96-parent");
			expect(result.source).toBe("parent-issue");
			expect(result.detail).toContain("ENG-96");
		});

		it("falls back to default when no graphite blockers and no parent", async () => {
			const issue = makeIssue({
				labels: () =>
					Promise.resolve({
						nodes: [{ name: "graphite" }],
					}),
				// graphite label present but no blocking issues
				inverseRelations: () => Promise.resolve({ nodes: [] }),
			});
			const repository = makeRepository();

			const result = await gitService.determineBaseBranch(issue, repository);

			expect(result.branch).toBe("main");
			expect(result.source).toBe("default");
		});

		it("uses custom graphite label config", async () => {
			const blockingIssue = {
				identifier: "ENG-95",
				title: "Blocking",
				branchName: "eng-95-branch",
			};

			const issue = makeIssue({
				labels: () =>
					Promise.resolve({
						nodes: [{ name: "custom-graphite" }],
					}),
				inverseRelations: () =>
					Promise.resolve({
						nodes: [
							{
								type: "blocks",
								issue: Promise.resolve(blockingIssue),
							},
						],
					}),
			});
			const repository = makeRepository({
				labelPrompts: {
					graphite: { labels: ["custom-graphite"] },
				},
			});

			mockExecSync.mockImplementation((cmd: any) => {
				const cmdStr = String(cmd);
				if (cmdStr.includes('git rev-parse --verify "eng-95-branch"')) {
					return Buffer.from("abc123\n");
				}
				throw new Error("not found");
			});

			const result = await gitService.determineBaseBranch(issue, repository);

			expect(result.branch).toBe("eng-95-branch");
			expect(result.source).toBe("graphite-blocked-by");
			expect(result.detail).toContain("ENG-95");
		});
	});

	describe("hasGraphiteLabel", () => {
		it("returns true when issue has graphite label", async () => {
			const issue = makeIssue({
				labels: () =>
					Promise.resolve({
						nodes: [{ name: "graphite" }],
					}),
			});
			const repository = makeRepository();

			const result = await gitService.hasGraphiteLabel(issue, repository);

			expect(result).toBe(true);
		});

		it("returns false when issue does not have graphite label", async () => {
			const issue = makeIssue({
				labels: () =>
					Promise.resolve({
						nodes: [{ name: "bug" }],
					}),
			});
			const repository = makeRepository();

			const result = await gitService.hasGraphiteLabel(issue, repository);

			expect(result).toBe(false);
		});
	});

	describe("fetchBlockingIssues", () => {
		it("returns blocking issues from inverse relations", async () => {
			const blockingIssue = {
				identifier: "ENG-95",
				title: "Blocker",
			};
			const issue = makeIssue({
				inverseRelations: () =>
					Promise.resolve({
						nodes: [
							{
								type: "blocks",
								issue: Promise.resolve(blockingIssue),
							},
							{
								type: "related",
								issue: Promise.resolve({ identifier: "ENG-94" }),
							},
						],
					}),
			});

			const result = await gitService.fetchBlockingIssues(issue);

			expect(result).toHaveLength(1);
			expect(result[0]!.identifier).toBe("ENG-95");
		});

		it("returns empty array when no inverse relations", async () => {
			const issue = makeIssue({
				inverseRelations: () => Promise.resolve({ nodes: [] }),
			});

			const result = await gitService.fetchBlockingIssues(issue);

			expect(result).toHaveLength(0);
		});

		it("returns empty array when inverse relations fails", async () => {
			const issue = makeIssue({
				inverseRelations: () => Promise.reject(new Error("network error")),
			});

			const result = await gitService.fetchBlockingIssues(issue);

			expect(result).toHaveLength(0);
		});
	});
});
