import { join } from "node:path";

/**
 * Shared constants used across Cyrus packages
 */

/**
 * Default proxy URL for Cyrus hosted services
 */
export const DEFAULT_PROXY_URL = "https://cyrus-proxy.ceedar.workers.dev";

/**
 * Default directory name for git worktrees
 */
export const DEFAULT_WORKTREES_DIR = "worktrees";

/**
 * Default directory name for cloned repositories
 */
export const DEFAULT_REPOS_DIR = "repos";

/**
 * Resolves the repos directory, preferring CYRUS_REPOS_DIR env var over the default.
 */
export function getDefaultReposDir(cyrusHome: string): string {
	return (
		process.env.CYRUS_REPOS_DIR?.trim() || join(cyrusHome, DEFAULT_REPOS_DIR)
	);
}

/**
 * Default base branch for new repositories
 */
export const DEFAULT_BASE_BRANCH = "main";

/**
 * Default config filename
 */
export const DEFAULT_CONFIG_FILENAME = "config.json";
