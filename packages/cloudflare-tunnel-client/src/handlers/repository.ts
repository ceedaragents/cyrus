import { exec } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ApiResponse, RepositoryPayload } from "../types.js";

const execAsync = promisify(exec);

/**
 * Check if a directory contains a git repository
 */
function isGitRepository(path: string): boolean {
	try {
		return existsSync(join(path, ".git"));
	} catch {
		return false;
	}
}

/**
 * Extract repository name from URL
 */
function getRepoNameFromUrl(repoUrl: string): string {
	// Handle URLs like: https://github.com/user/repo.git or git@github.com:user/repo.git
	const match = repoUrl.match(/\/([^/]+?)(\.git)?$/);
	if (match?.[1]) {
		return match[1];
	}
	// Fallback: use last part of URL
	return basename(repoUrl, ".git");
}

/**
 * Handle repository cloning or verification
 * - Clones repositories to ~/.cyrus/repos/<repo-name>
 * - If repository exists, verify it's a git repo and do nothing
 * - If repository doesn't exist, clone it to ~/.cyrus/repos/<repo-name>
 */
export async function handleRepository(
	payload: RepositoryPayload,
	cyrusHome: string,
): Promise<ApiResponse> {
	try {
		// Validate payload
		if (!payload.repoUrl || typeof payload.repoUrl !== "string") {
			return {
				success: false,
				error: "Repository URL is required",
				details:
					"Please provide a valid Git repository URL (e.g., https://github.com/user/repo.git)",
			};
		}

		// Extract repository name from URL
		const repoName = payload.name || getRepoNameFromUrl(payload.repoUrl);

		// Construct path within ~/.cyrus/repos
		const reposDir = join(cyrusHome, "repos");
		const repoPath = join(reposDir, repoName);

		// Ensure repos directory exists
		if (!existsSync(reposDir)) {
			try {
				mkdirSync(reposDir, { recursive: true });
			} catch (error) {
				return {
					success: false,
					error: "Failed to create repositories directory",
					details: `Could not create directory at ${reposDir}: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}

		// Check if repository already exists
		if (existsSync(repoPath)) {
			// Verify it's a git repository
			if (isGitRepository(repoPath)) {
				return {
					success: true,
					message: "Repository already exists",
					data: {
						path: repoPath,
						name: repoName,
						action: "verified",
					},
				};
			}

			return {
				success: false,
				error: "Directory exists but is not a Git repository",
				details: `A non-Git directory already exists at ${repoPath}. Please remove it manually or choose a different repository name.`,
			};
		}

		// Clone the repository
		try {
			const cloneCmd = `git clone "${payload.repoUrl}" "${repoPath}"`;
			await execAsync(cloneCmd);

			// Verify the clone was successful
			if (!isGitRepository(repoPath)) {
				return {
					success: false,
					error: "Repository clone verification failed",
					details: `Git clone command completed, but the cloned directory at ${repoPath} does not appear to be a valid Git repository.`,
				};
			}

			return {
				success: true,
				message: "Repository cloned successfully",
				data: {
					path: repoPath,
					name: repoName,
					repoUrl: payload.repoUrl,
					action: "cloned",
				},
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: "Failed to clone repository",
				details: `Could not clone repository from ${payload.repoUrl}: ${errorMessage}. Please verify the URL is correct and you have access to the repository.`,
			};
		}
	} catch (error) {
		return {
			success: false,
			error: "Repository operation failed",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
