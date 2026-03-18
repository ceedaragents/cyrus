import type { EdgeConfig } from "cyrus-core";

/**
 * Linear credentials obtained from OAuth flow
 */
export interface LinearCredentials {
	linearToken: string;
	linearWorkspaceId: string;
	linearWorkspaceName: string;
}

/**
 * Workspace information for issue processing
 */
export interface Workspace {
	path: string;
	hostPath?: string;
	isGitWorktree: boolean;
	repoPaths?: Record<string, string>;
	repoHostPaths?: Record<string, string>;
}

/**
 * Re-export EdgeConfig from cyrus-core for convenience
 */
export type { EdgeConfig };
