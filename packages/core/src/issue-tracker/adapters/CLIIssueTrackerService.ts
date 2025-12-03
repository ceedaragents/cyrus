/**
 * CLI/in-memory implementation of IIssueTrackerService.
 *
 * This adapter provides an in-memory mock of Linear's issue tracking platform
 * for testing purposes. It implements all methods from IIssueTrackerService
 * while storing data in memory using Maps for O(1) lookups.
 *
 * Unlike Linear's async properties, this implementation uses synchronous properties
 * for immediate access to related entities.
 *
 * @module issue-tracker/adapters/CLIIssueTrackerService
 */

import { EventEmitter } from "node:events";
import type {
	AgentSession,
	AgentSessionPayload,
	LinearFetch,
} from "@linear/sdk";
import type {
	AgentEventTransportConfig,
	IAgentEventTransport,
} from "../IAgentEventTransport.js";
import type { IIssueTrackerService } from "../IIssueTrackerService.js";
import type {
	AgentActivityCreateInput,
	AgentActivityPayload,
	AgentSessionCreateOnCommentInput,
	AgentSessionCreateOnIssueInput,
	Comment,
	CommentCreateInput,
	CommentWithAttachments,
	Connection,
	FetchChildrenOptions,
	FileUploadRequest,
	FileUploadResponse,
	Issue,
	IssueUpdateInput,
	IssueWithChildren,
	Label,
	PaginationOptions,
	Team,
	User,
	WorkflowState,
} from "../types.js";
import { CLIEventTransport } from "./CLIEventTransport.js";

/**
 * In-memory state for the CLI issue tracker.
 */
export interface CLIIssueTrackerState {
	issues: Map<string, Issue>;
	comments: Map<string, Comment>;
	teams: Map<string, Team>;
	labels: Map<string, Label>;
	workflowStates: Map<string, WorkflowState>;
	users: Map<string, User>;
	agentSessions: Map<string, AgentSession>;
	currentUserId: string;
	issueCounter: number;
	commentCounter: number;
	sessionCounter: number;
}

/**
 * CLI implementation of IIssueTrackerService.
 *
 * This class provides an in-memory implementation of the issue tracker service
 * for testing purposes. All data is stored in Maps with synchronous property access.
 *
 * @example
 * ```typescript
 * const service = new CLIIssueTrackerService();
 *
 * // Fetch an issue
 * const issue = await service.fetchIssue('issue-1');
 *
 * // Create a comment
 * const comment = await service.createComment(issue.id, {
 *   body: 'This is a comment'
 * });
 * ```
 */
export class CLIIssueTrackerService
	extends EventEmitter
	implements IIssueTrackerService
{
	private state: CLIIssueTrackerState;

	/**
	 * Create a new CLIIssueTrackerService.
	 *
	 * @param initialState - Optional initial state (useful for testing)
	 */
	constructor(initialState?: Partial<CLIIssueTrackerState>) {
		super();
		this.state = {
			issues: initialState?.issues ?? new Map(),
			comments: initialState?.comments ?? new Map(),
			teams: initialState?.teams ?? new Map(),
			labels: initialState?.labels ?? new Map(),
			workflowStates: initialState?.workflowStates ?? new Map(),
			users: initialState?.users ?? new Map(),
			agentSessions: initialState?.agentSessions ?? new Map(),
			currentUserId: initialState?.currentUserId ?? "user-1",
			issueCounter: initialState?.issueCounter ?? 1,
			commentCounter: initialState?.commentCounter ?? 1,
			sessionCounter: initialState?.sessionCounter ?? 1,
		};
	}

	// ========================================================================
	// ISSUE OPERATIONS
	// ========================================================================

	/**
	 * Fetch a single issue by ID or identifier.
	 */
	async fetchIssue(idOrIdentifier: string): Promise<Issue> {
		// Try to find by ID first
		let issue = this.state.issues.get(idOrIdentifier);

		// If not found, try to find by identifier
		if (!issue) {
			for (const [, candidateIssue] of this.state.issues) {
				if (candidateIssue.identifier === idOrIdentifier) {
					issue = candidateIssue;
					break;
				}
			}
		}

		if (!issue) {
			throw new Error(`Issue ${idOrIdentifier} not found`);
		}

		return issue;
	}

	/**
	 * Fetch child issues (sub-issues) for a parent issue.
	 */
	async fetchIssueChildren(
		issueId: string,
		options?: FetchChildrenOptions,
	): Promise<IssueWithChildren> {
		const parentIssue = await this.fetchIssue(issueId);

		// Find all child issues
		const allChildren: Issue[] = [];
		for (const [, issue] of this.state.issues) {
			// Check if this issue has the parent we're looking for
			const parent = issue.parent as Issue | undefined;
			if (parent?.id === parentIssue.id) {
				allChildren.push(issue);
			}
		}

		// Apply filters
		let filteredChildren = allChildren;

		if (options?.includeCompleted === false) {
			filteredChildren = filteredChildren.filter((child) => {
				const state = child.state as WorkflowState | undefined;
				return state?.type !== "completed";
			});
		}

		if (options?.includeArchived === false) {
			filteredChildren = filteredChildren.filter((child) => !child.archivedAt);
		}

		// Apply limit
		if (options?.limit) {
			filteredChildren = filteredChildren.slice(0, options.limit);
		}

		// Return issue with children array
		return Object.assign({}, parentIssue, {
			children: filteredChildren,
			childCount: filteredChildren.length,
		}) as IssueWithChildren;
	}

	/**
	 * Update an issue's properties.
	 */
	async updateIssue(
		issueId: string,
		updates: IssueUpdateInput,
	): Promise<Issue> {
		const issue = await this.fetchIssue(issueId);

		// Create updated issue by spreading original
		const updatedIssue = { ...issue } as unknown as Record<string, unknown>;

		if (updates.stateId !== undefined) {
			const state = this.state.workflowStates.get(updates.stateId);
			if (!state) {
				throw new Error(`Workflow state ${updates.stateId} not found`);
			}
			updatedIssue.state = state;
		}

		if (updates.assigneeId !== undefined) {
			const assignee = this.state.users.get(updates.assigneeId);
			if (!assignee) {
				throw new Error(`User ${updates.assigneeId} not found`);
			}
			updatedIssue.assignee = assignee;
		}

		if (updates.title !== undefined) {
			updatedIssue.title = updates.title;
		}

		if (updates.description !== undefined) {
			updatedIssue.description = updates.description;
		}

		if (updates.priority !== undefined) {
			updatedIssue.priority = updates.priority;
		}

		if (updates.parentId !== undefined) {
			const parent = await this.fetchIssue(updates.parentId);
			updatedIssue.parent = parent;
		}

		if (updates.labelIds !== undefined) {
			const labels: Label[] = [];
			for (const labelId of updates.labelIds) {
				const label = this.state.labels.get(labelId);
				if (!label) {
					throw new Error(`Label ${labelId} not found`);
				}
				labels.push(label);
			}
			// Store labels as a getter function that returns a promise
			updatedIssue.labels = () => Promise.resolve({ nodes: labels });
		}

		// Update timestamp
		updatedIssue.updatedAt = new Date();

		// Cast back to Issue and save to state
		const finalIssue = updatedIssue as unknown as Issue;
		this.state.issues.set(issue.id, finalIssue);

		// Emit state change event
		this.emit("issue:updated", { issue: finalIssue });

		return finalIssue;
	}

	/**
	 * Fetch attachments for an issue.
	 */
	async fetchIssueAttachments(
		issueId: string,
	): Promise<Array<{ title: string; url: string }>> {
		const issue = await this.fetchIssue(issueId);

		// Get attachments from the issue
		const attachmentsConnection = await issue.attachments();
		return attachmentsConnection.nodes.map(
			(attachment: { title?: string; url: string }) => ({
				title: attachment.title || "Untitled attachment",
				url: attachment.url,
			}),
		);
	}

	// ========================================================================
	// COMMENT OPERATIONS
	// ========================================================================

	/**
	 * Fetch comments for an issue with optional pagination.
	 */
	async fetchComments(
		issueId: string,
		options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		const issue = await this.fetchIssue(issueId);

		// Find all comments for this issue
		const allComments: Comment[] = [];
		for (const [, comment] of this.state.comments) {
			const commentIssue = comment.issue as Issue | undefined;
			if (commentIssue?.id === issue.id) {
				allComments.push(comment);
			}
		}

		// Sort by creation date
		allComments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

		// Apply pagination
		const first = options?.first ?? 50;
		const paginatedComments = allComments.slice(0, first);

		return {
			nodes: paginatedComments,
			pageInfo: {
				hasNextPage: allComments.length > first,
				hasPreviousPage: false,
				startCursor: paginatedComments[0]?.id,
				endCursor: paginatedComments[paginatedComments.length - 1]?.id,
			},
		};
	}

	/**
	 * Fetch a single comment by ID.
	 */
	async fetchComment(commentId: string): Promise<Comment> {
		const comment = this.state.comments.get(commentId);
		if (!comment) {
			throw new Error(`Comment ${commentId} not found`);
		}
		return comment;
	}

	/**
	 * Fetch a comment with attachments.
	 */
	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		const comment = await this.fetchComment(commentId);

		// Return comment with empty attachments array (matching Linear's behavior)
		return Object.assign({}, comment, {
			attachments: [],
		}) as CommentWithAttachments;
	}

	/**
	 * Create a comment on an issue.
	 */
	async createComment(
		issueId: string,
		input: CommentCreateInput,
	): Promise<Comment> {
		const issue = await this.fetchIssue(issueId);
		const currentUser = await this.fetchCurrentUser();

		// Build the comment body with attachments if provided
		let finalBody = input.body;
		if (input.attachmentUrls && input.attachmentUrls.length > 0) {
			const attachmentMarkdown = input.attachmentUrls
				.map((url) => {
					const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp)(\?|#|$)/i.test(
						url,
					);
					if (isImage) {
						return `![attachment](${url})`;
					}
					return `[attachment](${url})`;
				})
				.join("\n");

			finalBody = input.body
				? `${input.body}\n\n${attachmentMarkdown}`
				: attachmentMarkdown;
		}

		// Generate comment ID
		const commentId = `comment-${this.state.commentCounter++}`;

		// Create the comment object
		const comment = {
			id: commentId,
			body: finalBody,
			createdAt: new Date(),
			updatedAt: new Date(),
			user: currentUser,
			issue,
			parent: input.parentId
				? this.state.comments.get(input.parentId)
				: undefined,
			archivedAt: undefined,
			editedAt: undefined,
			botActor: undefined,
			children: () =>
				Promise.resolve({
					nodes: [],
					pageInfo: {
						hasNextPage: false,
						hasPreviousPage: false,
						startCursor: undefined,
						endCursor: undefined,
					},
				}),
			reactions: () =>
				Promise.resolve({
					nodes: [],
					pageInfo: {
						hasNextPage: false,
						hasPreviousPage: false,
						startCursor: undefined,
						endCursor: undefined,
					},
				}),
			resolvingUser: undefined,
			resolvedAt: undefined,
			reactionData: [],
			url: `https://linear.app/test/issue/${issue.identifier}#comment-${commentId}`,
		} as unknown as Comment;

		// Save to state
		this.state.comments.set(commentId, comment);

		// Emit state change event
		this.emit("comment:created", { comment });

		return comment;
	}

	// ========================================================================
	// TEAM OPERATIONS
	// ========================================================================

	/**
	 * Fetch all teams in the workspace/organization.
	 */
	async fetchTeams(options?: PaginationOptions): Promise<Connection<Team>> {
		const allTeams = Array.from(this.state.teams.values());

		// Apply pagination
		const first = options?.first ?? 50;
		const paginatedTeams = allTeams.slice(0, first);

		return {
			nodes: paginatedTeams,
			pageInfo: {
				hasNextPage: allTeams.length > first,
				hasPreviousPage: false,
				startCursor: paginatedTeams[0]?.id,
				endCursor: paginatedTeams[paginatedTeams.length - 1]?.id,
			},
		};
	}

	/**
	 * Fetch a single team by ID or key.
	 */
	async fetchTeam(idOrKey: string): Promise<Team> {
		// Try to find by ID first
		let team = this.state.teams.get(idOrKey);

		// If not found, try to find by key
		if (!team) {
			for (const [, candidateTeam] of this.state.teams) {
				if (candidateTeam.key === idOrKey) {
					team = candidateTeam;
					break;
				}
			}
		}

		if (!team) {
			throw new Error(`Team ${idOrKey} not found`);
		}

		return team;
	}

	// ========================================================================
	// LABEL OPERATIONS
	// ========================================================================

	/**
	 * Fetch all issue labels in the workspace/organization.
	 */
	async fetchLabels(options?: PaginationOptions): Promise<Connection<Label>> {
		const allLabels = Array.from(this.state.labels.values());

		// Apply pagination
		const first = options?.first ?? 50;
		const paginatedLabels = allLabels.slice(0, first);

		return {
			nodes: paginatedLabels,
			pageInfo: {
				hasNextPage: allLabels.length > first,
				hasPreviousPage: false,
				startCursor: paginatedLabels[0]?.id,
				endCursor: paginatedLabels[paginatedLabels.length - 1]?.id,
			},
		};
	}

	/**
	 * Fetch a single label by ID or name.
	 */
	async fetchLabel(idOrName: string): Promise<Label> {
		// Try to find by ID first
		let label = this.state.labels.get(idOrName);

		// If not found, try to find by name
		if (!label) {
			for (const [, candidateLabel] of this.state.labels) {
				if (candidateLabel.name === idOrName) {
					label = candidateLabel;
					break;
				}
			}
		}

		if (!label) {
			throw new Error(`Label ${idOrName} not found`);
		}

		return label;
	}

	/**
	 * Fetch label names for a specific issue.
	 */
	async getIssueLabels(issueId: string): Promise<string[]> {
		const issue = await this.fetchIssue(issueId);
		const labelsConnection = await issue.labels();
		return labelsConnection.nodes.map((label: { name: string }) => label.name);
	}

	// ========================================================================
	// WORKFLOW STATE OPERATIONS
	// ========================================================================

	/**
	 * Fetch workflow states for a team.
	 */
	async fetchWorkflowStates(
		teamId: string,
		options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		const team = await this.fetchTeam(teamId);

		// Find all workflow states for this team
		const allStates: WorkflowState[] = [];
		for (const [, state] of this.state.workflowStates) {
			const stateTeam = state.team as Team | undefined;
			if (stateTeam?.id === team.id) {
				allStates.push(state);
			}
		}

		// Apply pagination
		const first = options?.first ?? 50;
		const paginatedStates = allStates.slice(0, first);

		return {
			nodes: paginatedStates,
			pageInfo: {
				hasNextPage: allStates.length > first,
				hasPreviousPage: false,
				startCursor: paginatedStates[0]?.id,
				endCursor: paginatedStates[paginatedStates.length - 1]?.id,
			},
		};
	}

	/**
	 * Fetch a single workflow state by ID.
	 */
	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		const state = this.state.workflowStates.get(stateId);
		if (!state) {
			throw new Error(`Workflow state ${stateId} not found`);
		}
		return state;
	}

	// ========================================================================
	// USER OPERATIONS
	// ========================================================================

	/**
	 * Fetch a user by ID.
	 */
	async fetchUser(userId: string): Promise<User> {
		const user = this.state.users.get(userId);
		if (!user) {
			throw new Error(`User ${userId} not found`);
		}
		return user;
	}

	/**
	 * Fetch the current authenticated user.
	 */
	async fetchCurrentUser(): Promise<User> {
		return await this.fetchUser(this.state.currentUserId);
	}

	// ========================================================================
	// AGENT SESSION OPERATIONS
	// ========================================================================

	/**
	 * Create an agent session on an issue.
	 */
	createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): LinearFetch<AgentSessionPayload> {
		return this.createAgentSessionInternal(input.issueId, undefined, input);
	}

	/**
	 * Create an agent session on a comment thread.
	 */
	createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): LinearFetch<AgentSessionPayload> {
		return this.createAgentSessionInternal(undefined, input.commentId, input);
	}

	/**
	 * Internal helper to create agent sessions.
	 */
	private async createAgentSessionInternal(
		issueId: string | undefined,
		commentId: string | undefined,
		input: AgentSessionCreateOnIssueInput | AgentSessionCreateOnCommentInput,
	): Promise<AgentSessionPayload> {
		// Validate input
		if (issueId) {
			await this.fetchIssue(issueId);
		}
		if (commentId) {
			await this.fetchComment(commentId);
		}

		// Generate session ID
		const sessionId = `session-${this.state.sessionCounter++}`;
		const lastSyncId = Date.now();

		// Create minimal agent session object
		const agentSession = {
			id: sessionId,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			archivedAt: undefined,
			status: "active",
			type: issueId ? "issueDescription" : "commentThread",
			externalLink: input.externalLink,
		} as unknown as AgentSession;

		// Save to state
		this.state.agentSessions.set(sessionId, agentSession);

		// Emit state change event
		this.emit("agentSession:created", { agentSession });

		// Return payload matching Linear SDK structure
		return {
			success: true,
			lastSyncId,
			agentSessionId: sessionId,
			agentSession: {
				id: sessionId,
			},
		} as unknown as AgentSessionPayload;
	}

	/**
	 * Fetch an agent session by ID.
	 */
	fetchAgentSession(sessionId: string): LinearFetch<AgentSession> {
		return (async () => {
			const session = this.state.agentSessions.get(sessionId);
			if (!session) {
				throw new Error(`Agent session ${sessionId} not found`);
			}
			return session;
		})();
	}

	// ========================================================================
	// AGENT ACTIVITY OPERATIONS
	// ========================================================================

	/**
	 * Post an agent activity to an agent session.
	 */
	async createAgentActivity(
		input: AgentActivityCreateInput,
	): Promise<AgentActivityPayload> {
		// Validate session exists
		await this.fetchAgentSession(input.agentSessionId);

		// Emit state change event
		this.emit("agentActivity:created", { input });

		// Return success payload
		return {
			success: true,
			lastSyncId: Date.now(),
		} as unknown as AgentActivityPayload;
	}

	// ========================================================================
	// FILE OPERATIONS
	// ========================================================================

	/**
	 * Request a file upload URL from the platform.
	 */
	async requestFileUpload(
		request: FileUploadRequest,
	): Promise<FileUploadResponse> {
		// Generate mock upload URLs
		const uploadUrl = `https://mock-upload.linear.app/${Date.now()}/${request.filename}`;
		const assetUrl = `https://mock-assets.linear.app/${Date.now()}/${request.filename}`;

		return {
			uploadUrl,
			headers: {
				"Content-Type": request.contentType,
				"x-amz-acl": request.makePublic ? "public-read" : "private",
			},
			assetUrl,
		};
	}

	// ========================================================================
	// PLATFORM METADATA
	// ========================================================================

	/**
	 * Get the platform type identifier.
	 */
	getPlatformType(): string {
		return "cli";
	}

	/**
	 * Get the platform's API version or other metadata.
	 */
	getPlatformMetadata(): Record<string, unknown> {
		return {
			platform: "cli",
			implementation: "in-memory",
			version: "1.0.0",
		};
	}

	// ========================================================================
	// EVENT TRANSPORT
	// ========================================================================

	/**
	 * Create an event transport for receiving webhook events.
	 *
	 * @param config - Transport configuration
	 * @returns CLI event transport implementation
	 */
	createEventTransport(
		config: AgentEventTransportConfig,
	): IAgentEventTransport {
		// Type narrow to CLI config
		if (config.platform !== "cli") {
			throw new Error(
				`Invalid platform "${config.platform}" for CLIIssueTrackerService. Expected "cli".`,
			);
		}

		return new CLIEventTransport(config);
	}

	// ========================================================================
	// TESTING/DEBUGGING UTILITIES
	// ========================================================================

	/**
	 * Get the current in-memory state (for testing/debugging).
	 */
	getState(): CLIIssueTrackerState {
		return this.state;
	}
}
