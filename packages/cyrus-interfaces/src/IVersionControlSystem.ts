/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
	path: string;
	branch: string;
	isDetached: boolean;
	isBare: boolean;
}

/**
 * Branch information
 */
export interface BranchInfo {
	name: string;
	isLocal: boolean;
	isRemote: boolean;
	tracksRemote?: string;
	lastCommit?: {
		hash: string;
		message: string;
		author: string;
		date: Date;
	};
}

/**
 * Repository status
 */
export interface RepositoryStatus {
	isRepository: boolean;
	isDirty: boolean;
	currentBranch: string;
	hasUncommittedChanges: boolean;
	unstagedChanges: string[];
	stagedChanges: string[];
}

/**
 * Main interface for version control operations
 *
 * This interface abstracts git operations for managing repositories,
 * branches, worktrees, and remote operations.
 */
export interface IVersionControlSystem {
	/**
	 * Repository verification
	 */

	/**
	 * Check if path is a valid git repository
	 * @param path - Path to check
	 * @returns True if the path is a git repository
	 */
	isRepository(path: string): boolean;

	/**
	 * Get repository status
	 * @param path - Repository path
	 * @returns Status information about the repository
	 */
	getRepositoryStatus(path: string): Promise<RepositoryStatus>;

	/**
	 * Branch operations
	 */

	/**
	 * Check if a branch exists locally
	 * @param branchName - Name of the branch
	 * @param path - Repository path
	 * @returns True if the branch exists locally
	 */
	branchExists(branchName: string, path: string): Promise<boolean>;

	/**
	 * Check if a branch exists on remote
	 * @param branchName - Name of the branch
	 * @param path - Repository path
	 * @param remote - Remote name (default: 'origin')
	 * @returns True if the branch exists on remote
	 */
	remoteBranchExists(
		branchName: string,
		path: string,
		remote?: string,
	): Promise<boolean>;

	/**
	 * List all local branches
	 * @param path - Repository path
	 * @returns Array of local branch information
	 */
	listLocalBranches(path: string): Promise<BranchInfo[]>;

	/**
	 * List all remote branches
	 * @param path - Repository path
	 * @param remote - Remote name (default: 'origin')
	 * @returns Array of remote branch information
	 */
	listRemoteBranches(path: string, remote?: string): Promise<BranchInfo[]>;

	/**
	 * Create a new branch
	 * @param branchName - Name for the new branch
	 * @param path - Repository path
	 * @param baseBranch - Branch to base the new branch on
	 */
	createBranch(
		branchName: string,
		path: string,
		baseBranch?: string,
	): Promise<void>;

	/**
	 * Delete a branch
	 * @param branchName - Name of the branch to delete
	 * @param path - Repository path
	 */
	deleteBranch(branchName: string, path: string): Promise<void>;

	/**
	 * Sanitize branch name for safety
	 * @param name - Raw branch name
	 * @returns Sanitized branch name safe for git
	 */
	sanitizeBranchName(name: string): string;

	/**
	 * Worktree operations
	 */

	/**
	 * Create a new git worktree
	 * @param worktreePath - Path where the worktree will be created
	 * @param branchName - Branch name for the worktree
	 * @param baseBranch - Base branch to create from
	 * @param repoPath - Main repository path
	 */
	createWorktree(
		worktreePath: string,
		branchName: string,
		baseBranch: string,
		repoPath: string,
	): Promise<void>;

	/**
	 * List all worktrees in repository
	 * @param path - Repository path
	 * @returns Array of worktree information
	 */
	listWorktrees(path: string): Promise<WorktreeInfo[]>;

	/**
	 * Delete a worktree
	 * @param worktreePath - Path to the worktree to delete
	 * @param repoPath - Main repository path
	 */
	deleteWorktree(worktreePath: string, repoPath: string): Promise<void>;

	/**
	 * Remote operations
	 */

	/**
	 * Fetch latest changes from remote
	 * @param path - Repository path
	 * @param remote - Remote name (default: 'origin')
	 */
	fetch(path: string, remote?: string): Promise<void>;

	/**
	 * Get list of remote repositories
	 * @param path - Repository path
	 * @returns Array of remote information
	 */
	getRemotes(path: string): Promise<{ name: string; url: string }[]>;

	/**
	 * Configuration
	 */

	/**
	 * Get the current branch name
	 * @param path - Repository path
	 * @returns Current branch name
	 */
	getCurrentBranch(path: string): Promise<string>;

	/**
	 * Get the default/base branch (usually main or master)
	 * @param path - Repository path
	 * @returns Base branch name
	 */
	getBaseBranch(path: string): Promise<string>;
}
