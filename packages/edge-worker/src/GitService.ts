import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve as pathResolve } from "node:path";

import type { Issue, RepositoryConfig, Workspace } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import { WorktreeIncludeService } from "./WorktreeIncludeService.js";

/**
 * Service responsible for Git worktree operations
 */
export class GitService {
	private logger: ILogger;
	private worktreeIncludeService: WorktreeIncludeService;

	constructor(logger?: ILogger) {
		this.logger = logger ?? createLogger({ component: "GitService" });
		this.worktreeIncludeService = new WorktreeIncludeService(this.logger);
	}
	/**
	 * Check if a branch exists locally or remotely
	 */
	async branchExists(branchName: string, repoPath: string): Promise<boolean> {
		try {
			// Check if branch exists locally
			execSync(`git rev-parse --verify "${branchName}"`, {
				cwd: repoPath,
				stdio: "pipe",
			});
			return true;
		} catch {
			// Branch doesn't exist locally, check remote
			try {
				const remoteOutput = execSync(
					`git ls-remote --heads origin "${branchName}"`,
					{
						cwd: repoPath,
						stdio: "pipe",
					},
				);
				// Check if output is non-empty (branch actually exists on remote)
				return remoteOutput && remoteOutput.toString().trim().length > 0;
			} catch {
				return false;
			}
		}
	}

	/**
	 * Sanitize branch name by removing backticks to prevent command injection
	 */
	public sanitizeBranchName(name: string): string {
		return name ? name.replace(/`/g, "") : name;
	}

	/**
	 * Resolve mutable Git metadata directories for a repository/worktree.
	 * This includes linked worktree metadata paths (for example
	 * `.git/worktrees/<name>/FETCH_HEAD`) that must be writable by sandboxes.
	 */
	public getGitMetadataDirectories(workingDirectory: string): string[] {
		const resolvedDirectories = new Set<string>();
		const revParse = (
			flag: "--git-dir" | "--git-common-dir",
		): string | null => {
			try {
				const output = execSync(`git rev-parse ${flag}`, {
					cwd: workingDirectory,
					encoding: "utf8",
					stdio: "pipe",
				}).trim();
				return output ? pathResolve(workingDirectory, output) : null;
			} catch {
				return null;
			}
		};

		const gitDir = revParse("--git-dir");
		if (gitDir) {
			resolvedDirectories.add(gitDir);
		}

		const gitCommonDir = revParse("--git-common-dir");
		if (gitCommonDir) {
			resolvedDirectories.add(gitCommonDir);
		}

		return [...resolvedDirectories];
	}

	/**
	 * Run a setup script with proper error handling and logging
	 */
	private async runSetupScript(
		scriptPath: string,
		scriptType: "global" | "repository",
		workspacePath: string,
		issue: Issue,
	): Promise<void> {
		// Expand ~ to home directory
		const expandedPath = scriptPath.replace(/^~/, homedir());

		// Check if script exists
		if (!existsSync(expandedPath)) {
			this.logger.warn(
				`⚠️  ${scriptType === "global" ? "Global" : "Repository"} setup script not found: ${scriptPath}`,
			);
			return;
		}

		// Check if script is executable (Unix only)
		if (process.platform !== "win32") {
			try {
				const stats = statSync(expandedPath);
				// Check if file has execute permission for the owner
				if (!(stats.mode & 0o100)) {
					this.logger.warn(
						`⚠️  ${scriptType === "global" ? "Global" : "Repository"} setup script is not executable: ${scriptPath}`,
					);
					this.logger.warn(`   Run: chmod +x "${expandedPath}"`);
					return;
				}
			} catch (error) {
				this.logger.warn(
					`⚠️  Cannot check permissions for ${scriptType} setup script: ${(error as Error).message}`,
				);
				return;
			}
		}

		const scriptName = basename(expandedPath);
		this.logger.info(`ℹ️  Running ${scriptType} setup script: ${scriptName}`);

		try {
			// Determine the command based on the script extension and platform
			let command: string;
			const isWindows = process.platform === "win32";

			if (scriptPath.endsWith(".ps1")) {
				command = `powershell -ExecutionPolicy Bypass -File "${expandedPath}"`;
			} else if (scriptPath.endsWith(".cmd") || scriptPath.endsWith(".bat")) {
				command = `"${expandedPath}"`;
			} else if (isWindows) {
				// On Windows, try to run with bash if available (Git Bash/WSL)
				command = `bash "${expandedPath}"`;
			} else {
				// On Unix, run directly with bash
				command = `bash "${expandedPath}"`;
			}

			execSync(command, {
				cwd: workspacePath,
				stdio: "inherit",
				env: {
					...process.env,
					LINEAR_ISSUE_ID: issue.id,
					LINEAR_ISSUE_IDENTIFIER: issue.identifier,
					LINEAR_ISSUE_TITLE: issue.title || "",
				},
				timeout: 5 * 60 * 1000, // 5 minute timeout
			});

			this.logger.info(
				`✅ ${scriptType === "global" ? "Global" : "Repository"} setup script completed successfully`,
			);
		} catch (error) {
			const errorMessage =
				(error as any).signal === "SIGTERM"
					? "Script execution timed out (exceeded 5 minutes)"
					: (error as Error).message;

			this.logger.error(
				`❌ ${scriptType === "global" ? "Global" : "Repository"} setup script failed: ${errorMessage}`,
			);

			// Log stderr if available
			if ((error as any).stderr) {
				this.logger.error("   stderr:", (error as any).stderr.toString());
			}

			// Continue execution despite setup script failure
			this.logger.info(`   Continuing with worktree creation...`);
		}
	}

	/**
	 * Find an existing worktree by its checked-out branch name.
	 * Parses `git worktree list --porcelain` output and returns the worktree path
	 * if a worktree is found with the given branch checked out, or null otherwise.
	 */
	findWorktreeByBranch(branchName: string, repoPath: string): string | null {
		try {
			const output = execSync("git worktree list --porcelain", {
				cwd: repoPath,
				encoding: "utf-8",
			});

			const blocks = output.split("\n\n");
			for (const block of blocks) {
				const lines = block.split("\n");
				let worktreePath: string | null = null;
				let branchRef: string | null = null;

				for (const line of lines) {
					if (line.startsWith("worktree ")) {
						worktreePath = line.slice("worktree ".length);
					} else if (line.startsWith("branch ")) {
						branchRef = line.slice("branch refs/heads/".length);
					}
				}

				if (worktreePath && branchRef === branchName) {
					return worktreePath;
				}
			}

			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Create a git worktree for an issue
	 */
	async createGitWorktree(
		issue: Issue,
		repository: RepositoryConfig,
		globalSetupScript?: string,
	): Promise<Workspace> {
		try {
			// Verify this is a git repository
			try {
				execSync("git rev-parse --git-dir", {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
			} catch (_e) {
				this.logger.error(
					`${repository.repositoryPath} is not a git repository`,
				);
				throw new Error("Not a git repository");
			}

			// Use Linear's preferred branch name, or generate one if not available
			const rawBranchName =
				issue.branchName ||
				`${issue.identifier}-${issue.title
					?.toLowerCase()
					.replace(/\s+/g, "-")
					.substring(0, 30)}`;
			const branchName = this.sanitizeBranchName(rawBranchName);
			const workspacePath = join(repository.workspaceBaseDir, issue.identifier);

			// Ensure workspace directory exists
			mkdirSync(repository.workspaceBaseDir, { recursive: true });

			// Check if worktree already exists
			try {
				const worktrees = execSync("git worktree list --porcelain", {
					cwd: repository.repositoryPath,
					encoding: "utf-8",
				});

				if (worktrees.includes(workspacePath)) {
					this.logger.info(
						`Worktree already exists at ${workspacePath}, using existing`,
					);
					return {
						path: workspacePath,
						isGitWorktree: true,
					};
				}
			} catch (_e) {
				// git worktree command failed, continue with creation
			}

			// Check if branch already exists
			let createBranch = true;
			try {
				execSync(`git rev-parse --verify "${branchName}"`, {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
				createBranch = false;
			} catch (_e) {
				// Branch doesn't exist, we'll create it
			}

			// If the branch already exists, check if it's already checked out in another worktree
			if (!createBranch) {
				const existingWorktreePath = this.findWorktreeByBranch(
					branchName,
					repository.repositoryPath,
				);
				if (existingWorktreePath && existingWorktreePath !== workspacePath) {
					this.logger.info(
						`Branch "${branchName}" is already checked out in worktree at ${existingWorktreePath}, reusing existing worktree`,
					);
					return {
						path: existingWorktreePath,
						isGitWorktree: true,
					};
				}
			}

			// Determine base branch for this issue
			let baseBranch = repository.baseBranch;

			// Check if issue has a parent
			try {
				const parent = await (issue as any).parent;
				if (parent) {
					this.logger.info(
						`Issue ${issue.identifier} has parent: ${parent.identifier}`,
					);

					// Get parent's branch name
					const parentRawBranchName =
						parent.branchName ||
						`${parent.identifier}-${parent.title
							?.toLowerCase()
							.replace(/\s+/g, "-")
							.substring(0, 30)}`;
					const parentBranchName = this.sanitizeBranchName(parentRawBranchName);

					// Check if parent branch exists
					const parentBranchExists = await this.branchExists(
						parentBranchName,
						repository.repositoryPath,
					);

					if (parentBranchExists) {
						baseBranch = parentBranchName;
						this.logger.info(
							`Using parent issue branch '${parentBranchName}' as base for sub-issue ${issue.identifier}`,
						);
					} else {
						this.logger.info(
							`Parent branch '${parentBranchName}' not found, using default base branch '${repository.baseBranch}'`,
						);
					}
				}
			} catch (_error) {
				// Parent field might not exist or couldn't be fetched, use default base branch
				this.logger.info(
					`No parent issue found for ${issue.identifier}, using default base branch '${repository.baseBranch}'`,
				);
			}

			// Fetch latest changes from remote
			this.logger.debug("Fetching latest changes from remote...");
			let hasRemote = true;
			try {
				execSync("git fetch origin", {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
			} catch (e) {
				this.logger.warn(
					"Warning: git fetch failed, proceeding with local branch:",
					(e as Error).message,
				);
				hasRemote = false;
			}

			// Create the worktree - use determined base branch
			let worktreeCmd: string;
			if (createBranch) {
				if (hasRemote) {
					// Check if the base branch exists remotely
					let useRemoteBranch = false;
					try {
						const remoteOutput = execSync(
							`git ls-remote --heads origin "${baseBranch}"`,
							{
								cwd: repository.repositoryPath,
								stdio: "pipe",
							},
						);
						// Check if output is non-empty (branch actually exists on remote)
						useRemoteBranch =
							remoteOutput && remoteOutput.toString().trim().length > 0;
						if (!useRemoteBranch) {
							this.logger.info(
								`Base branch '${baseBranch}' not found on remote, checking locally...`,
							);
						}
					} catch {
						// Base branch doesn't exist remotely, use local or fall back to default
						this.logger.info(
							`Base branch '${baseBranch}' not found on remote, checking locally...`,
						);
					}

					if (useRemoteBranch) {
						// Use remote version of base branch with --track to set upstream
						const remoteBranch = `origin/${baseBranch}`;
						this.logger.info(
							`Creating git worktree at ${workspacePath} from ${remoteBranch} (tracking ${baseBranch})`,
						);
						worktreeCmd = `git worktree add --track -b "${branchName}" "${workspacePath}" "${remoteBranch}"`;
					} else {
						// Check if base branch exists locally
						try {
							execSync(`git rev-parse --verify "${baseBranch}"`, {
								cwd: repository.repositoryPath,
								stdio: "pipe",
							});
							// Use local base branch (can't track since remote doesn't have it)
							this.logger.info(
								`Creating git worktree at ${workspacePath} from local ${baseBranch}`,
							);
							worktreeCmd = `git worktree add -b "${branchName}" "${workspacePath}" "${baseBranch}"`;
						} catch {
							// Base branch doesn't exist locally either, fall back to remote default with --track
							this.logger.info(
								`Base branch '${baseBranch}' not found locally, falling back to remote ${repository.baseBranch} (tracking ${repository.baseBranch})`,
							);
							const defaultRemoteBranch = `origin/${repository.baseBranch}`;
							worktreeCmd = `git worktree add --track -b "${branchName}" "${workspacePath}" "${defaultRemoteBranch}"`;
						}
					}
				} else {
					// No remote, use local branch (no tracking since no remote)
					this.logger.info(
						`Creating git worktree at ${workspacePath} from local ${baseBranch}`,
					);
					worktreeCmd = `git worktree add -b "${branchName}" "${workspacePath}" "${baseBranch}"`;
				}
			} else {
				// Branch already exists, just check it out
				this.logger.info(
					`Creating git worktree at ${workspacePath} with existing branch ${branchName}`,
				);
				worktreeCmd = `git worktree add "${workspacePath}" "${branchName}"`;
			}

			execSync(worktreeCmd, {
				cwd: repository.repositoryPath,
				stdio: "pipe",
			});

			// Copy files specified in .worktreeinclude that are also in .gitignore
			// This runs before setup scripts so they can access these files
			await this.worktreeIncludeService.copyIgnoredFiles(
				repository.repositoryPath,
				workspacePath,
			);

			// First, run the global setup script if configured
			if (globalSetupScript) {
				await this.runSetupScript(
					globalSetupScript,
					"global",
					workspacePath,
					issue,
				);
			}

			// Then, check for repository setup scripts (cross-platform)
			const isWindows = process.platform === "win32";
			const setupScripts = [
				{
					file: "cyrus-setup.sh",
					platform: "unix",
				},
				{
					file: "cyrus-setup.ps1",
					platform: "windows",
				},
				{
					file: "cyrus-setup.cmd",
					platform: "windows",
				},
				{
					file: "cyrus-setup.bat",
					platform: "windows",
				},
			];

			// Find the first available setup script for the current platform
			const availableScript = setupScripts.find((script) => {
				const scriptPath = join(repository.repositoryPath, script.file);
				const isCompatible = isWindows
					? script.platform === "windows"
					: script.platform === "unix";
				return existsSync(scriptPath) && isCompatible;
			});

			// Fallback: on Windows, try bash if no Windows scripts found (for Git Bash/WSL users)
			const fallbackScript =
				!availableScript && isWindows
					? setupScripts.find((script) => {
							const scriptPath = join(repository.repositoryPath, script.file);
							return script.platform === "unix" && existsSync(scriptPath);
						})
					: null;

			const scriptToRun = availableScript || fallbackScript;

			if (scriptToRun) {
				const scriptPath = join(repository.repositoryPath, scriptToRun.file);
				await this.runSetupScript(
					scriptPath,
					"repository",
					workspacePath,
					issue,
				);
			}

			return {
				path: workspacePath,
				isGitWorktree: true,
			};
		} catch (error) {
			const errorMessage = (error as Error).message;
			this.logger.error("Failed to create git worktree:", errorMessage);

			// Check if the error is "branch already checked out in another worktree"
			// Git error format: "fatal: 'branch-name' is already used by worktree at '/path/to/worktree'"
			const worktreeMatch = errorMessage.match(
				/already used by worktree at '([^']+)'/,
			);
			if (worktreeMatch?.[1] && existsSync(worktreeMatch[1])) {
				this.logger.info(
					`Reusing existing worktree at ${worktreeMatch[1]} (branch already checked out)`,
				);
				return {
					path: worktreeMatch[1],
					isGitWorktree: true,
				};
			}

			// Fall back to regular directory if git worktree fails
			const fallbackPath = join(repository.workspaceBaseDir, issue.identifier);
			mkdirSync(fallbackPath, { recursive: true });
			return {
				path: fallbackPath,
				isGitWorktree: false,
			};
		}
	}

	/**
	 * Delete worktrees for an issue.
	 *
	 * Removes the entire workspace directory at `workspaceBaseDir/<issueIdentifier>/`.
	 * This handles both single-repo and multi-repo layouts since the issue identifier
	 * directory is the root in both cases.
	 *
	 * For each git worktree within the directory, runs `git worktree remove --force`
	 * to cleanly unregister it from git before deleting the directory.
	 *
	 * @param workspaceBaseDir - Base directory where worktrees are stored
	 * @param issueIdentifier - Issue identifier (e.g., "DEF-123")
	 */
	async deleteWorktree(
		workspaceBaseDir: string,
		issueIdentifier: string,
	): Promise<void> {
		const workspacePath = join(workspaceBaseDir, issueIdentifier);

		if (!existsSync(workspacePath)) {
			this.logger.info(
				`Worktree directory does not exist, nothing to delete: ${workspacePath}`,
			);
			return;
		}

		// Find all git worktrees that point into this directory.
		// In multi-repo layout, there may be subdirectories that are each worktrees.
		// In single-repo layout, the directory itself is the worktree.
		const worktreePaths = this.findWorktreesUnderPath(workspacePath);

		// Remove each worktree from git's tracking
		for (const wtPath of worktreePaths) {
			try {
				this.logger.info(`Removing git worktree: ${wtPath}`);
				execSync(`git worktree remove --force "${wtPath}"`, {
					stdio: "pipe",
					// Run from the worktree itself so git can find the common dir
					cwd: wtPath,
				});
			} catch (error) {
				// Log but don't fail — the directory removal below will clean up
				this.logger.warn(
					`Failed to git worktree remove ${wtPath}: ${(error as Error).message}`,
				);
			}
		}

		// Remove the entire directory tree
		try {
			await rm(workspacePath, { recursive: true, force: true });
			this.logger.info(`Deleted worktree directory: ${workspacePath}`);
		} catch (error) {
			this.logger.error(
				`Failed to delete worktree directory ${workspacePath}: ${(error as Error).message}`,
			);
		}

		// Prune stale worktree references from any parent repos
		this.pruneWorktreeReferences(workspaceBaseDir);
	}

	/**
	 * Find all git worktree paths under a given directory.
	 * Checks if the directory itself is a worktree, then checks subdirectories.
	 */
	private findWorktreesUnderPath(dirPath: string): string[] {
		const worktrees: string[] = [];

		// Check if the directory itself is a git worktree
		if (this.isGitWorktree(dirPath)) {
			worktrees.push(dirPath);
			return worktrees;
		}

		// Check subdirectories (multi-repo layout)
		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const subPath = join(dirPath, entry.name);
					if (this.isGitWorktree(subPath)) {
						worktrees.push(subPath);
					}
				}
			}
		} catch {
			// Directory might not be readable
		}

		return worktrees;
	}

	/**
	 * Check if a directory is a git worktree.
	 */
	private isGitWorktree(dirPath: string): boolean {
		try {
			execSync("git rev-parse --is-inside-work-tree", {
				cwd: dirPath,
				stdio: "pipe",
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Prune stale worktree references from repos that had worktrees under the base dir.
	 */
	private pruneWorktreeReferences(workspaceBaseDir: string): void {
		// Walk up from the workspace base dir to find parent repos
		// and prune their worktree lists
		try {
			const parentDir = join(workspaceBaseDir, "..");
			if (existsSync(parentDir)) {
				// Find repos by looking for .git directories or common git dirs
				execSync("git worktree prune", {
					cwd: parentDir,
					stdio: "pipe",
				});
			}
		} catch {
			// Best-effort prune
		}
	}
}
