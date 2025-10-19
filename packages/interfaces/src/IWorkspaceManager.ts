/**
 * Manages isolated workspaces for processing work items.
 * Workspaces can be implemented using git worktrees, docker containers,
 * VMs, or any other isolation mechanism.
 */
export interface IWorkspaceManager {
	/**
	 * Create a new workspace for a work item.
	 *
	 * @param request - The workspace creation request
	 * @returns The created workspace
	 */
	createWorkspace(request: WorkspaceRequest): Promise<Workspace>;

	/**
	 * Destroy a workspace and clean up its resources.
	 *
	 * @param id - The ID of the workspace to destroy
	 */
	destroyWorkspace(id: string): Promise<void>;

	/**
	 * Get a workspace by its ID.
	 *
	 * @param id - The ID of the workspace
	 * @returns The workspace, if found, or null
	 */
	getWorkspace(id: string): Promise<Workspace | null>;

	/**
	 * List all workspaces managed by this manager.
	 *
	 * @returns Array of all workspaces
	 */
	listWorkspaces(): Promise<Workspace[]>;
}

/**
 * Represents a request to create a new workspace.
 */
export interface WorkspaceRequest {
	/** ID of the work item this workspace is for */
	workItemId: string;

	/** Repository information for the workspace */
	repository: {
		/** URL of the repository */
		url: string;

		/** Branch to check out (optional) */
		branch?: string;

		/** Specific commit to check out (optional) */
		commit?: string;
	};
}

/**
 * Represents an isolated workspace where work can be performed.
 */
export interface Workspace {
	/** Unique identifier for this workspace */
	id: string;

	/** Filesystem path to the workspace */
	path: string;

	/** Current status of the workspace */
	status: "initializing" | "ready" | "active" | "destroyed";

	/** When this workspace was created */
	createdAt: Date;

	/** Additional metadata about the workspace */
	metadata: Record<string, unknown>;
}
