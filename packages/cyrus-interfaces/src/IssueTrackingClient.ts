import type {
	AgentActivity,
	AgentSession,
	AgentSessionStatus,
	Comment,
	Issue,
	IssueState,
	Label,
	Team,
	User,
} from "./types.js";

/**
 * Options for updating an issue.
 */
export interface UpdateIssueOptions {
	/** New title */
	title?: string;
	/** New description */
	description?: string;
	/** New state ID */
	stateId?: string;
	/** New assignee ID */
	assigneeId?: string;
	/** New priority */
	priority?: number;
	/** New labels */
	labelIds?: string[];
	/** New due date */
	dueDate?: Date;
	/** New parent issue ID */
	parentId?: string;
}

/**
 * Options for creating an agent activity.
 */
export interface CreateActivityOptions {
	/** Activity type */
	type: "thought" | "action" | "response" | "error" | "elicitation";
	/** Activity content */
	content: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
	/** Whether this is an ephemeral activity (transient, hidden from user) */
	ephemeral?: boolean;
}

/**
 * Options for listing issues.
 */
export interface ListIssuesOptions {
	/** Filter by team ID */
	teamId?: string;
	/** Filter by assignee ID */
	assigneeId?: string;
	/** Filter by state ID */
	stateId?: string;
	/** Filter by label IDs */
	labelIds?: string[];
	/** Maximum number of results */
	limit?: number;
	/** Pagination cursor */
	cursor?: string;
}

/**
 * Paginated result for listing operations.
 */
export interface PaginatedResult<T> {
	/** Array of items */
	items: T[];
	/** Whether there are more items */
	hasMore: boolean;
	/** Cursor for next page */
	nextCursor?: string;
}

/**
 * Abstract interface for issue tracking system integration.
 *
 * This interface provides a platform-agnostic way to interact with issue tracking systems
 * like Linear, GitHub Issues, Jira, etc. It abstracts the core operations needed for
 * Cyrus to monitor issues, update their state, and communicate back to users.
 *
 * @example
 * ```typescript
 * const client: IssueTrackingClient = new LinearClient(apiKey);
 * const issue = await client.getIssue('ISSUE-123');
 * await client.updateIssueState(issue.id, 'in-progress-state-id');
 * await client.createComment(issue.id, 'Working on this now!');
 * ```
 */
export interface IssueTrackingClient {
	/**
	 * Retrieves a single issue by its ID or identifier.
	 *
	 * @param issueId - The issue ID or human-readable identifier (e.g., "ENG-123")
	 * @returns The issue object
	 * @throws Error if the issue is not found
	 */
	getIssue(issueId: string): Promise<Issue>;

	/**
	 * Lists issues based on filter criteria.
	 *
	 * @param options - Filtering and pagination options
	 * @returns Paginated list of issues
	 */
	listIssues(options?: ListIssuesOptions): Promise<PaginatedResult<Issue>>;

	/**
	 * Updates an issue's state.
	 *
	 * @param issueId - The issue ID
	 * @param stateId - The new state ID
	 * @throws Error if the issue or state is not found
	 */
	updateIssueState(issueId: string, stateId: string): Promise<void>;

	/**
	 * Updates an issue with new values.
	 *
	 * @param issueId - The issue ID
	 * @param updates - Object containing fields to update
	 * @throws Error if the issue is not found
	 */
	updateIssue(issueId: string, updates: UpdateIssueOptions): Promise<void>;

	/**
	 * Retrieves all teams in the workspace.
	 *
	 * @returns Array of teams
	 */
	getTeams(): Promise<Team[]>;

	/**
	 * Retrieves all available labels.
	 *
	 * @returns Array of labels
	 */
	getLabels(): Promise<Label[]>;

	/**
	 * Retrieves all workflow states for a team.
	 *
	 * @param teamId - The team ID
	 * @returns Array of workflow states
	 */
	getWorkflowStates(teamId: string): Promise<IssueState[]>;

	/**
	 * Creates a comment on an issue.
	 *
	 * @param issueId - The issue ID
	 * @param body - Comment body (markdown format)
	 * @param parentId - Optional parent comment ID for replies
	 * @returns The created comment
	 */
	createComment(
		issueId: string,
		body: string,
		parentId?: string,
	): Promise<Comment>;

	/**
	 * Retrieves all comments for an issue.
	 *
	 * @param issueId - The issue ID
	 * @returns Array of comments
	 */
	getComments(issueId: string): Promise<Comment[]>;

	/**
	 * Retrieves a user by their ID.
	 *
	 * @param userId - The user ID
	 * @returns The user object
	 * @throws Error if the user is not found
	 */
	getUser(userId: string): Promise<User>;

	/**
	 * Retrieves the current authenticated user.
	 *
	 * @returns The current user
	 */
	getCurrentUser(): Promise<User>;

	/**
	 * Creates an agent session for an issue.
	 *
	 * This is used to track agent processing activities and maintain conversation state.
	 *
	 * @param issueId - The issue ID
	 * @param metadata - Optional session metadata
	 * @returns The created agent session
	 */
	createAgentSession(
		issueId: string,
		metadata?: Record<string, unknown>,
	): Promise<AgentSession>;

	/**
	 * Retrieves an agent session by ID.
	 *
	 * @param sessionId - The session ID
	 * @returns The agent session
	 * @throws Error if the session is not found
	 */
	getAgentSession(sessionId: string): Promise<AgentSession>;

	/**
	 * Creates an activity within an agent session.
	 *
	 * Activities represent the agent's thought process, actions taken, responses given,
	 * and any errors encountered. They appear in the issue's activity timeline.
	 *
	 * @param sessionId - The session ID
	 * @param activity - Activity options
	 * @returns The created activity
	 */
	createAgentActivity(
		sessionId: string,
		activity: CreateActivityOptions,
	): Promise<AgentActivity>;

	/**
	 * Updates an agent session's status.
	 *
	 * @param sessionId - The session ID
	 * @param status - The new status
	 */
	updateAgentSessionStatus(
		sessionId: string,
		status: AgentSessionStatus,
	): Promise<void>;

	/**
	 * Lists all activities in an agent session.
	 *
	 * @param sessionId - The session ID
	 * @returns Array of activities in chronological order
	 */
	listAgentActivities(sessionId: string): Promise<AgentActivity[]>;
}
