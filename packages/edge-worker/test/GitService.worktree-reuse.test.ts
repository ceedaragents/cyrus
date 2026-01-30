import { execSync } from "node:child_process";
import type { Issue, RepositoryConfig } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitService } from "../src/GitService.js";

// Mock child_process
vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

// Mock fs
vi.mock("node:fs", () => ({
	existsSync: vi.fn().mockReturnValue(false),
	mkdirSync: vi.fn(),
	statSync: vi.fn(),
}));

describe("GitService - Worktree Reuse When Branch Already Checked Out", () => {
	let gitService: GitService;
	const mockExecSync = vi.mocked(execSync);

	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	} as any;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/home/user/repos/cyrus",
		workspaceBaseDir: "/home/user/.cyrus/worktrees",
		baseBranch: "main",
		linearToken: "test-token",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: [],
		labelPrompts: {},
	};

	/**
	 * Create a synthetic Issue (similar to what EdgeWorker.createGitHubWorkspace() produces)
	 */
	function createSyntheticPRIssue(prNumber: number, branchName: string): Issue {
		return {
			id: `github-pr-${prNumber}`,
			identifier: `PR-${prNumber}`,
			title: `PR #${prNumber}`,
			description: null,
			url: "",
			branchName,
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
				Promise.resolve({
					success: true,
					issue: undefined,
					lastSyncId: 0,
				}),
		} as unknown as Issue;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		gitService = new GitService(mockLogger);
		// Ensure worktreeIncludeService.copyIgnoredFiles is mocked
		(gitService as any).worktreeIncludeService = {
			copyIgnoredFiles: vi.fn().mockResolvedValue(undefined),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * Helper to set up standard execSync mock responses.
	 * By default, sets up a scenario where:
	 * - Repository is a valid git repo
	 * - Branch already exists (createBranch = false)
	 * - git fetch succeeds
	 * - No worktree exists at the target path yet
	 */
	function setupStandardMocks(options: {
		branchName: string;
		existingWorktreePath?: string;
		existingWorktreeBranch?: string;
	}) {
		mockExecSync.mockImplementation((cmd: string, opts?: any) => {
			const cmdStr = String(cmd);
			// When encoding is specified (like "utf-8"), execSync returns a string;
			// otherwise it returns a Buffer.
			const returnsString = opts?.encoding != null;

			// git rev-parse --git-dir (verify it's a git repo)
			if (cmdStr.includes("git rev-parse --git-dir")) {
				return returnsString ? ".git\n" : Buffer.from(".git\n");
			}

			// git worktree list --porcelain (check existing worktrees)
			// Note: GitService calls this with encoding: "utf-8" so it returns a string
			if (cmdStr.includes("git worktree list --porcelain")) {
				let output: string;
				if (options.existingWorktreePath && options.existingWorktreeBranch) {
					output = `worktree ${options.existingWorktreePath}\nHEAD abc123\nbranch refs/heads/${options.existingWorktreeBranch}\n\n`;
				} else {
					output =
						"worktree /home/user/repos/cyrus\nHEAD abc123\nbranch refs/heads/main\n\n";
				}
				return returnsString ? output : Buffer.from(output);
			}

			// git rev-parse --verify (check if branch exists)
			if (cmdStr.includes("git rev-parse --verify")) {
				return returnsString ? "abc123\n" : Buffer.from("abc123\n");
			}

			// git fetch origin
			if (cmdStr.includes("git fetch origin")) {
				return returnsString ? "" : Buffer.from("");
			}

			// git worktree add (this is the command that fails when branch is already checked out)
			if (cmdStr.includes("git worktree add")) {
				if (
					options.existingWorktreeBranch === options.branchName &&
					!cmdStr.includes("-b")
				) {
					// Simulate the fatal error when branch is already checked out
					const error = new Error(
						`Command failed: ${cmdStr}\nfatal: '${options.branchName}' is already used by worktree at '${options.existingWorktreePath}'`,
					);
					throw error;
				}
				return returnsString ? "" : Buffer.from("");
			}

			return returnsString ? "" : Buffer.from("");
		});
	}

	it("should reuse existing worktree when PR branch is already checked out by another worktree", async () => {
		// This is the exact scenario from the bug report:
		// - A PR mentions @cyrusagent
		// - The PR's branch "cyrustester/tes-107-find-a-small-improvement" is already
		//   checked out by worktree at "/home/user/.cyrus/worktrees/TES-107"
		// - createGitHubWorkspace creates a synthetic issue with identifier "PR-6"
		// - GitService tries to create worktree at "/home/user/.cyrus/worktrees/PR-6"
		//   with the existing branch, which fails

		const existingWorktreePath = "/home/user/.cyrus/worktrees/TES-107";
		const branchName = "cyrustester/tes-107-find-a-small-improvement";

		setupStandardMocks({
			branchName,
			existingWorktreePath,
			existingWorktreeBranch: branchName,
		});

		const syntheticIssue = createSyntheticPRIssue(6, branchName);

		const result = await gitService.createGitWorktree(
			syntheticIssue,
			mockRepository,
		);

		// BUG: Currently, when the branch is already checked out in another worktree,
		// the `git worktree add` command fails, the error is caught by the outer try-catch,
		// and it falls back to creating a regular (non-git) directory.
		//
		// EXPECTED: The system should detect the branch is already in use and reuse
		// the existing worktree path, returning isGitWorktree: true.
		expect(result).toEqual({
			path: existingWorktreePath,
			isGitWorktree: true,
		});
	});

	it("should still create a new worktree when branch exists but is NOT checked out elsewhere", async () => {
		// This is the normal/happy path: branch exists but no other worktree has it
		const branchName = "feature/some-branch";

		setupStandardMocks({
			branchName,
			// No existing worktree for this branch
		});

		const syntheticIssue = createSyntheticPRIssue(7, branchName);

		const result = await gitService.createGitWorktree(
			syntheticIssue,
			mockRepository,
		);

		// Should successfully create a new worktree at the expected path
		expect(result).toEqual({
			path: "/home/user/.cyrus/worktrees/PR-7",
			isGitWorktree: true,
		});

		// Verify the worktree add command was called
		const worktreeAddCalls = mockExecSync.mock.calls.filter((call) =>
			String(call[0]).includes("git worktree add"),
		);
		expect(worktreeAddCalls.length).toBe(1);
		expect(String(worktreeAddCalls[0][0])).toContain(
			'git worktree add "/home/user/.cyrus/worktrees/PR-7" "feature/some-branch"',
		);
	});
});
