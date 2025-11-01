/**
 * Issue Tracker Interface
 *
 * Abstract interface for issue tracking systems (Linear, GitHub Issues, Jira, etc.)
 * This interface decouples the core orchestration logic from specific issue tracker implementations.
 */

/**
 * Represents an issue in the tracking system
 */
export interface Issue {
	/**
	 * Unique identifier (usually a UUID)
	 */
	id: string;

	/**
	 * Human-readable identifier (e.g., "CYPACK-264", "GH-123")
	 */
	identifier: string;

	/**
	 * Issue title
	 */
	title: string;

	/**
	 * Issue description/body (markdown format)
	 */
	description: string;

	/**
	 * Current state of the issue
	 */
	state: IssueState;

	/**
	 * Priority level (0 = none, 1 = urgent, 2 = high, 3 = normal, 4 = low)
	 */
	priority: number;

	/**
	 * Member assigned to this issue
	 */
	assignee?: Member;

	/**
	 * Labels applied to this issue
	 */
	labels: Label[];

	/**
	 * URL to view the issue in the tracker UI
	 */
	url: string;

	/**
	 * When the issue was created
	 */
	createdAt: Date;

	/**
	 * When the issue was last updated
	 */
	updatedAt: Date;

	/**
	 * Project this issue belongs to
	 */
	projectId?: string;

	/**
	 * Team this issue belongs to
	 */
	teamId?: string;
}

/**
 * Represents the state/status of an issue
 */
export interface IssueState {
	/**
	 * Standardized state type for cross-platform compatibility
	 */
	type:
		| "triage"
		| "backlog"
		| "unstarted"
		| "started"
		| "completed"
		| "canceled";

	/**
	 * Display name of the state (may be custom per workspace)
	 */
	name: string;

	/**
	 * Unique identifier for this state
	 */
	id?: string;
}

/**
 * Represents a comment on an issue
 */
export interface Comment {
	/**
	 * Unique identifier for the comment
	 */
	id?: string;

	/**
	 * Author of the comment
	 */
	author: Member;

	/**
	 * Comment content (markdown format)
	 */
	content: string;

	/**
	 * When the comment was created
	 */
	createdAt: Date;

	/**
	 * Whether this is a root comment (vs a reply)
	 */
	isRoot: boolean;

	/**
	 * ID of parent comment if this is a reply
	 */
	parentId?: string;

	/**
	 * When the comment was last edited
	 */
	updatedAt?: Date;
}

/**
 * Represents a team member or user
 */
export interface Member {
	/**
	 * Unique identifier
	 */
	id: string;

	/**
	 * Display name
	 */
	name: string;

	/**
	 * Email address
	 */
	email?: string;

	/**
	 * Avatar URL
	 */
	avatarUrl?: string;
}

/**
 * Represents a label/tag that can be applied to issues
 */
export interface Label {
	/**
	 * Unique identifier
	 */
	id: string;

	/**
	 * Label name
	 */
	name: string;

	/**
	 * Label color (hex format)
	 */
	color?: string;

	/**
	 * Label description
	 */
	description?: string;
}

/**
 * Filters for querying issues
 */
export interface IssueFilters {
	/**
	 * Filter by state type
	 */
	state?: IssueState["type"] | IssueState["type"][];

	/**
	 * Filter by priority
	 */
	priority?: number | number[];

	/**
	 * Filter by labels
	 */
	labels?: string[];

	/**
	 * Filter by project
	 */
	projectId?: string;

	/**
	 * Filter by team
	 */
	teamId?: string;

	/**
	 * Filter by creation date range
	 */
	createdAfter?: Date;
	createdBefore?: Date;

	/**
	 * Filter by update date range
	 */
	updatedAfter?: Date;
	updatedBefore?: Date;

	/**
	 * Maximum number of results to return
	 */
	limit?: number;
}

/**
 * Events that can be emitted by an issue tracker
 * Uses discriminated union for type safety
 */
export type IssueEvent =
	| IssueAssignedEvent
	| IssueUnassignedEvent
	| CommentAddedEvent
	| StateChangedEvent
	| SignalEvent;

/**
 * Issue was assigned to a member
 */
export interface IssueAssignedEvent {
	type: "assigned";
	/**
	 * The issue that was assigned
	 */
	issue: Issue;
	/**
	 * The member it was assigned to
	 */
	assignee: Member;
}

/**
 * Issue was unassigned
 */
export interface IssueUnassignedEvent {
	type: "unassigned";
	/**
	 * The issue that was unassigned
	 */
	issue: Issue;
	/**
	 * The member it was unassigned from
	 */
	previousAssignee: Member;
}

/**
 * A comment was added to an issue
 */
export interface CommentAddedEvent {
	type: "comment-added";
	/**
	 * The issue the comment was added to
	 */
	issue: Issue;
	/**
	 * The new comment
	 */
	comment: Comment;
}

/**
 * Issue state changed
 */
export interface StateChangedEvent {
	type: "state-changed";
	/**
	 * The issue whose state changed
	 */
	issue: Issue;
	/**
	 * Previous state
	 */
	oldState: IssueState;
	/**
	 * New state
	 */
	newState: IssueState;
}

/**
 * An agent signal was sent
 */
export interface SignalEvent {
	type: "signal";
	/**
	 * The issue the signal is for
	 */
	issue: Issue;
	/**
	 * The signal that was sent
	 */
	signal: AgentSignal;
}

/**
 * Signals that can be sent to control agent behavior
 * Uses discriminated union for type safety
 */
export type AgentSignal = StartSignal | StopSignal | FeedbackSignal;

/**
 * Signal to start agent processing
 */
export interface StartSignal {
	type: "start";
}

/**
 * Signal to stop agent processing
 */
export interface StopSignal {
	type: "stop";
	/**
	 * Optional reason for stopping
	 */
	reason?: string;
}

/**
 * Signal containing user feedback
 */
export interface FeedbackSignal {
	type: "feedback";
	/**
	 * Feedback message from user
	 */
	message: string;
	/**
	 * Optional attachments with feedback
	 */
	attachments?: Attachment[];
}

/**
 * Represents a file attachment
 */
export interface Attachment {
	/**
	 * File name
	 */
	name: string;

	/**
	 * File URL or path
	 */
	url: string;

	/**
	 * MIME type
	 */
	mimeType?: string;

	/**
	 * File size in bytes
	 */
	size?: number;
}

/**
 * Abstract interface for issue tracking systems
 *
 * Implementations of this interface handle the details of interacting with
 * specific issue trackers (Linear, GitHub, Jira, etc.)
 */
export interface IssueTracker {
	/**
	 * Get an issue by its ID
	 *
	 * @param issueId - Unique identifier of the issue
	 * @returns Promise that resolves to the issue
	 * @throws Error if issue is not found
	 */
	getIssue(issueId: string): Promise<Issue>;

	/**
	 * List issues assigned to a specific member
	 *
	 * @param memberId - ID of the member
	 * @param filters - Optional filters to narrow results
	 * @returns Promise that resolves to array of issues
	 */
	listAssignedIssues(
		memberId: string,
		filters?: IssueFilters,
	): Promise<Issue[]>;

	/**
	 * Update the state of an issue
	 *
	 * @param issueId - ID of the issue to update
	 * @param state - New state to set
	 * @throws Error if update fails
	 */
	updateIssueState(issueId: string, state: IssueState): Promise<void>;

	/**
	 * Add a comment to an issue
	 *
	 * @param issueId - ID of the issue
	 * @param comment - Comment to add (without id, which will be generated)
	 * @returns Promise that resolves to the complete Comment object (including generated id)
	 * @throws Error if comment cannot be added
	 */
	addComment(issueId: string, comment: Omit<Comment, "id">): Promise<Comment>;

	/**
	 * Get all comments for an issue
	 *
	 * @param issueId - ID of the issue
	 * @returns Promise that resolves to array of comments
	 */
	getComments(issueId: string): Promise<Comment[]>;

	/**
	 * Watch for issue updates for a specific member
	 *
	 * @param memberId - ID of the member whose assigned issues to watch
	 * @returns Async iterable of issue events
	 */
	watchIssues(memberId: string): AsyncIterable<IssueEvent>;

	/**
	 * Get attachments for an issue
	 *
	 * @param issueId - ID of the issue
	 * @returns Promise that resolves to array of attachments
	 */
	getAttachments(issueId: string): Promise<Attachment[]>;

	/**
	 * Send a signal to control agent behavior on an issue
	 *
	 * @param issueId - ID of the issue
	 * @param signal - Signal to send
	 * @throws Error if signal cannot be sent
	 */
	sendSignal(issueId: string, signal: AgentSignal): Promise<void>;

	/**
	 * Get a member by their ID
	 *
	 * @param memberId - ID of the member
	 * @returns Promise that resolves to the member
	 * @throws Error if member is not found
	 */
	getMember(memberId: string): Promise<Member>;

	/**
	 * List all available labels in the workspace/team
	 *
	 * @param teamId - Optional team ID to filter labels by team
	 * @returns Promise that resolves to array of labels
	 */
	listLabels(teamId?: string): Promise<Label[]>;
}
