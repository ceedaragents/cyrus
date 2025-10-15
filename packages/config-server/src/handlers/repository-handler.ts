import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	DeleteRepositoryPayload,
	RepositoryInfo,
	RepositoryPayload,
} from "../types";

/**
 * Executes a git command using child_process.spawn
 * @param args - Array of git command arguments
 * @param cwd - Working directory for the command
 * @param env - Environment variables to pass to the command
 * @returns Promise that resolves with stdout or rejects with stderr
 */
async function executeGitCommand(
	args: string[],
	cwd?: string,
	env?: Record<string, string>,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const processEnv = {
			...process.env,
			GIT_TERMINAL_PROMPT: "0", // Disable git credential prompts
			...env,
		};

		const proc = spawn("git", args, {
			cwd,
			env: processEnv,
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("error", (error) => {
			reject(new Error(`Failed to execute git: ${error.message}`));
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`git ${args[0]} failed: ${stderr || stdout}`));
			} else {
				resolve(stdout);
			}
		});
	});
}

/**
 * Extracts repository name from a GitHub URL
 * @param url - The repository URL
 * @returns The extracted repository name
 */
function extractRepoNameFromURL(url: string): string {
	// Remove .git suffix if present
	let cleanUrl = url.trim();
	if (cleanUrl.endsWith(".git")) {
		cleanUrl = cleanUrl.slice(0, -4);
	}

	// Handle different GitHub URL formats
	if (cleanUrl.includes("github.com")) {
		const parts = cleanUrl.split("/");
		if (parts.length > 0) {
			const lastPart = parts[parts.length - 1];
			if (lastPart) {
				return lastPart;
			}
		}
	}

	// Fallback: use last path component
	const parts = cleanUrl.split("/");
	if (parts.length > 0) {
		const lastPart = parts[parts.length - 1];
		if (lastPart) {
			return lastPart;
		}
	}

	return "";
}

/**
 * Sanitizes repository name to prevent path traversal attacks
 * @param name - The repository name to sanitize
 * @returns Sanitized repository name
 */
function sanitizeRepoName(name: string): string {
	// Remove any path separators and parent directory references
	let sanitized = name.replace(/[/\\]/g, "-");
	sanitized = sanitized.replace(/\.\./g, "");

	// Remove leading/trailing spaces, dots, and dashes
	sanitized = sanitized.trim().replace(/^[.-]+|[.-]+$/g, "");

	return sanitized;
}

/**
 * Finds and deletes all worktrees matching the linear team key pattern
 * @param linearTeamKey - The Linear team key to match worktrees against
 * @param workspacesDir - Directory containing worktrees
 * @returns Array of deleted worktree paths
 */
async function findAndDeleteWorktrees(
	linearTeamKey: string,
	workspacesDir: string,
): Promise<string[]> {
	const deletedWorktrees: string[] = [];

	try {
		// Check if worktrees directory exists
		const dirStat = await stat(workspacesDir);
		if (!dirStat.isDirectory()) {
			console.log(`Worktrees path is not a directory: ${workspacesDir}`);
			return deletedWorktrees;
		}
	} catch (_error) {
		// Directory doesn't exist
		console.log(`Worktrees directory does not exist: ${workspacesDir}`);
		return deletedWorktrees;
	}

	try {
		// Read all entries in the worktrees directory
		const entries = await readdir(workspacesDir, { withFileTypes: true });

		// Pattern to match: {linearTeamKey}-{issueNumber}
		const prefix = `${linearTeamKey}-`;

		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.startsWith(prefix)) {
				const worktreePath = join(workspacesDir, entry.name);
				console.log(`Deleting worktree at ${worktreePath}`);

				try {
					await rm(worktreePath, { recursive: true, force: true });
					deletedWorktrees.push(worktreePath);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.warn(
						`Warning: Failed to delete worktree ${worktreePath}: ${errorMessage}`,
					);
					// Continue with other worktrees even if one fails
				}
			}
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read worktrees directory: ${errorMessage}`);
	}

	return deletedWorktrees;
}

/**
 * Handles cloning a repository
 * @param payload - Repository payload containing URL and optional name
 * @param repositoriesDir - Directory where repositories are stored
 * @returns The path where the repository was cloned
 */
export async function handleCloneRepository(
	payload: RepositoryPayload,
	repositoriesDir: string,
): Promise<string> {
	// Validate required fields
	if (!payload.repository_url || payload.repository_url.trim() === "") {
		throw new Error("repository_url is required");
	}

	// Extract repository name from URL if not provided
	let repositoryName = payload.repository_name || "";
	if (repositoryName === "") {
		repositoryName = extractRepoNameFromURL(payload.repository_url);
		if (repositoryName === "") {
			throw new Error(
				"Could not extract repository name from URL, please provide repository_name",
			);
		}
	}

	// Sanitize repository name to prevent path traversal
	repositoryName = sanitizeRepoName(repositoryName);

	// Set target path
	const targetPath = join(repositoriesDir, repositoryName);

	// Check if repository already exists
	try {
		await stat(targetPath);
		throw new Error(`Repository already exists at ${targetPath}`);
	} catch (error) {
		// If stat throws, the path doesn't exist, which is what we want
		if (
			error instanceof Error &&
			error.message.includes("Repository already exists")
		) {
			throw error;
		}
		if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
			throw error;
		}
		// ENOENT is expected - path doesn't exist, continue
	}

	// Ensure parent directory exists
	const parentDir = dirname(targetPath);
	await mkdir(parentDir, { recursive: true, mode: 0o755 });

	// Clone the repository
	console.log(`Cloning repository ${payload.repository_url} to ${targetPath}`);
	try {
		await executeGitCommand(["clone", payload.repository_url, targetPath]);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to clone repository: ${errorMessage}`);
		throw new Error(`Failed to clone repository: ${errorMessage}`);
	}

	console.log(
		`Repository ${payload.repository_url} cloned successfully to ${targetPath}`,
	);
	return targetPath;
}

/**
 * Handles deleting a repository and optionally its associated worktrees
 * @param payload - Delete repository payload containing repository name and optional team key
 * @param repositoriesDir - Directory where repositories are stored
 * @param workspacesDir - Directory where worktrees are stored (optional)
 * @returns Array containing the deleted repository path and any deleted worktree paths
 */
export async function handleDeleteRepository(
	payload: DeleteRepositoryPayload,
	repositoriesDir: string,
	workspacesDir?: string,
): Promise<string[]> {
	// Validate required fields
	if (!payload.repository_name || payload.repository_name.trim() === "") {
		throw new Error("repository_name is required");
	}

	// Sanitize repository name to prevent path traversal
	const repositoryName = sanitizeRepoName(payload.repository_name);

	// Construct repository path
	const repoPath = join(repositoriesDir, repositoryName);

	// Validate that the path is within the expected directory (security check)
	// Resolve both paths to handle symlinks and relative paths
	const resolvedRepoPath = join(repoPath); // path.join normalizes the path
	const resolvedRepositoriesDir = join(repositoriesDir);

	if (!resolvedRepoPath.startsWith(resolvedRepositoriesDir)) {
		throw new Error("Invalid repository path");
	}

	// Check if repository exists
	try {
		await stat(repoPath);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			throw new Error(`Repository not found at ${repoPath}`);
		}
		throw error;
	}

	// Delete the repository
	console.log(`Deleting repository at ${repoPath}`);
	try {
		await rm(repoPath, { recursive: true, force: true });
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to delete repository: ${errorMessage}`);
		throw new Error(`Failed to delete repository: ${errorMessage}`);
	}

	const deletedPaths: string[] = [repoPath];

	// Delete related worktrees if linear_team_key is provided
	if (payload.linear_team_key && workspacesDir) {
		try {
			const deletedWorktrees = await findAndDeleteWorktrees(
				payload.linear_team_key,
				workspacesDir,
			);
			deletedPaths.push(...deletedWorktrees);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.warn(`Warning: Error while deleting worktrees: ${errorMessage}`);
			// Don't fail the entire request if worktree deletion has issues
		}
	} else if (!payload.linear_team_key) {
		console.warn(
			`Warning: No linear_team_key provided for repository ${repositoryName} - worktrees will not be deleted`,
		);
	}

	console.log(`Repository ${repositoryName} deleted successfully`);
	return deletedPaths;
}

/**
 * Handles listing all repositories
 * @param repositoriesDir - Directory where repositories are stored
 * @returns Array of repository information objects
 */
export async function handleListRepositories(
	repositoriesDir: string,
): Promise<RepositoryInfo[]> {
	const repositories: RepositoryInfo[] = [];

	try {
		// Check if repositories directory exists
		const dirStat = await stat(repositoriesDir);
		if (!dirStat.isDirectory()) {
			console.log(`Repositories path is not a directory: ${repositoriesDir}`);
			return repositories;
		}
	} catch (_error) {
		// Directory doesn't exist, return empty array
		console.log(`Repositories directory does not exist: ${repositoriesDir}`);
		return repositories;
	}

	try {
		// List repositories in app directory
		const entries = await readdir(repositoriesDir, { withFileTypes: true });

		for (const entry of entries) {
			// Include directories that don't start with a dot
			if (entry.isDirectory() && !entry.name.startsWith(".")) {
				repositories.push({
					name: entry.name,
					path: join(repositoriesDir, entry.name),
				});
			}
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to list repositories: ${errorMessage}`);
	}

	return repositories;
}
