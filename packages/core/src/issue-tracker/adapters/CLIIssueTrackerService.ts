/**
 * CLI-based implementation of IIssueTrackerService for testing and development.
 *
 * This adapter provides an in-memory issue tracking system that can be controlled
 * via socket RPC commands. It's designed for command-line testing, development,
 * and debugging without requiring integration with external platforms like Linear.
 *
 * @module issue-tracker/adapters/CLIIssueTrackerService
 */

import { EventEmitter } from "node:events";
import type {
	AgentEventTransportConfig,
	IAgentEventTransport,
} from "../IAgentEventTransport.js";
import type { IIssueTrackerService } from "../IIssueTrackerService.js";
import type {
	AgentActivity,
	AgentActivityContent,
	AgentSession,
	AgentSessionCreateOnCommentInput,
	AgentSessionCreateOnIssueInput,
	AgentSessionCreateResponse,
	AgentSessionStatus,
	AgentSessionType,
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
import {
	AgentActivityContentType,
	AgentActivitySignal,
	WorkflowStateType,
} from "../types.js";
import { CLIEventTransport } from "./CLIEventTransport.js";

/**
 * In-memory state storage for the CLI issue tracker.
 */
interface CLIState {
	issues: Map<string, Issue>;
	comments: Map<string, Comment>;
	agentSessions: Map<string, AgentSession>;
	agentActivities: Map<string, AgentActivity[]>;
	teams: Map<string, Team>;
	labels: Map<string, Label>;
	workflowStates: Map<string, WorkflowState>;
	users: Map<string, User>;
	currentUser: User;
	agentHandle: string; // The name/handle the agent responds to (e.g., "@cyrus")
}

/**
 * CLI implementation of IIssueTrackerService.
 *
 * Maintains all state in memory and emits events when state changes occur.
 * Events can be listened to via the event transport to trigger agent sessions.
 *
 * @example
 * ```typescript
 * const service = new CLIIssueTrackerService({
 *   agentHandle: '@cyrus',
 *   agentUserId: 'agent-user-id'
 * });
 *
 * // Create an issue
 * const issue = await service.createIssue({
 *   title: 'Test issue',
 *   description: 'This is a test',
 *   teamId: 'team-1'
 * });
 *
 * // Create a comment that mentions the agent
 * await service.createComment(issue.id, {
 *   body: '@cyrus please fix this'
 * });
 * // This will trigger an agent session via the event transport
 * ```
 */
export class CLIIssueTrackerService
	extends EventEmitter
	implements IIssueTrackerService
{
	private state: CLIState;
	private idCounter: number = 0;

	constructor(config: { agentHandle: string; agentUserId: string }) {
		super();

		// Initialize default user
		const currentUser: User = {
			id: "cli-user-1",
			name: "CLI User",
			email: "cli@example.com",
			url: "https://example.com/cli-user",
		};

		// Initialize agent user
		const agentUser: User = {
			id: config.agentUserId,
			name: config.agentHandle,
			email: "agent@example.com",
			url: "https://example.com/agent",
		};

		// Initialize default team
		const defaultTeam: Team = {
			id: "team-1",
			key: "CLI",
			name: "CLI Team",
		};

		// Initialize default workflow states
		const defaultStates: WorkflowState[] = [
			{
				id: "state-triage",
				name: "Triage",
				type: WorkflowStateType.Triage,
				color: "#bec2c8",
				position: 0,
			},
			{
				id: "state-backlog",
				name: "Backlog",
				type: WorkflowStateType.Backlog,
				color: "#e2e2e2",
				position: 1,
			},
			{
				id: "state-todo",
				name: "Todo",
				type: WorkflowStateType.Unstarted,
				color: "#e2e2e2",
				position: 2,
			},
			{
				id: "state-in-progress",
				name: "In Progress",
				type: WorkflowStateType.Started,
				color: "#f2c94c",
				position: 3,
			},
			{
				id: "state-done",
				name: "Done",
				type: WorkflowStateType.Completed,
				color: "#5e6ad2",
				position: 4,
			},
			{
				id: "state-canceled",
				name: "Canceled",
				type: WorkflowStateType.Canceled,
				color: "#95a2b3",
				position: 5,
			},
		];

		this.state = {
			issues: new Map(),
			comments: new Map(),
			agentSessions: new Map(),
			agentActivities: new Map(),
			teams: new Map([[defaultTeam.id, defaultTeam]]),
			labels: new Map(),
			workflowStates: new Map(defaultStates.map((s) => [s.id, s])),
			users: new Map([
				[currentUser.id, currentUser],
				[agentUser.id, agentUser],
			]),
			currentUser,
			agentHandle: config.agentHandle,
		};
	}

	/**
	 * Generate a unique ID for entities.
	 */
	private generateId(prefix: string): string {
		return `${prefix}-${++this.idCounter}`;
	}

	/**
	 * Get current timestamp in ISO format.
	 */
	private now(): string {
		return new Date().toISOString();
	}

	// ========================================================================
	// PUBLIC API METHODS FOR CLI CONTROL
	// ========================================================================

	/**
	 * Create a new issue (CLI command: createIssue).
	 */
	async createIssue(input: {
		title: string;
		description?: string;
		teamId?: string;
		assigneeId?: string;
		stateId?: string;
		labelIds?: string[];
		parentId?: string;
	}): Promise<Issue> {
		const teamId = input.teamId || "team-1";
		const stateId = input.stateId || "state-todo";
		const now = this.now();

		const issue: Issue = {
			id: this.generateId("issue"),
			identifier: `CLI-${this.idCounter}`,
			title: input.title,
			description: input.description,
			url: `https://example.com/issue/CLI-${this.idCounter}`,
			teamId,
			team: this.state.teams.get(teamId),
			state: this.state.workflowStates.get(stateId),
			assigneeId: input.assigneeId,
			assignee: input.assigneeId
				? this.state.users.get(input.assigneeId)
				: undefined,
			labels: input.labelIds
				? input.labelIds
						.map((id) => this.state.labels.get(id))
						.filter((l): l is Label => l !== undefined)
				: [],
			parentId: input.parentId,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
		};

		this.state.issues.set(issue.id, issue);

		// Emit issue created event if assigned to agent
		if (input.assigneeId) {
			const assignee = this.state.users.get(input.assigneeId);
			if (assignee && assignee.name === this.state.agentHandle) {
				this.emit("issueAssigned", issue);
			}
		}

		return issue;
	}

	/**
	 * Create a label (CLI command: createLabel).
	 */
	async createLabel(input: {
		name: string;
		color?: string;
		description?: string;
	}): Promise<Label> {
		const label: Label = {
			id: this.generateId("label"),
			name: input.name,
			color: input.color || "#000000",
			description: input.description,
		};

		this.state.labels.set(label.id, label);
		return label;
	}

	/**
	 * Create a member/user (CLI command: createMember).
	 */
	async createMember(input: { name: string; email?: string }): Promise<User> {
		const user: User = {
			id: this.generateId("user"),
			name: input.name,
			email: input.email || `${input.name.toLowerCase()}@example.com`,
			url: `https://example.com/user/${input.name}`,
		};

		this.state.users.set(user.id, user);
		return user;
	}

	/**
	 * Get all current state (for debugging/inspection).
	 */
	getState(): CLIState {
		return this.state;
	}

	/**
	 * Get agent handle.
	 */
	getAgentHandle(): string {
		return this.state.agentHandle;
	}

	// ========================================================================
	// ISSUE OPERATIONS
	// ========================================================================

	async fetchIssue(idOrIdentifier: string): Promise<Issue> {
		// Try by ID first
		let issue = this.state.issues.get(idOrIdentifier);

		// Try by identifier if not found
		if (!issue) {
			issue = Array.from(this.state.issues.values()).find(
				(i) => i.identifier === idOrIdentifier,
			);
		}

		if (!issue) {
			throw new Error(`Issue not found: ${idOrIdentifier}`);
		}

		return issue;
	}

	async fetchIssueChildren(
		issueId: string,
		options?: FetchChildrenOptions,
	): Promise<IssueWithChildren> {
		const parent = await this.fetchIssue(issueId);

		// Find all children
		let children = Array.from(this.state.issues.values()).filter(
			(i) => i.parentId === issueId,
		);

		// Apply filters
		if (options?.includeCompleted === false) {
			children = children.filter((i) => {
				const state = i.state as
					| WorkflowState
					| Promise<WorkflowState>
					| undefined;
				if (!state || state instanceof Promise) return true;
				return state.type !== WorkflowStateType.Completed;
			});
		}

		if (options?.includeArchived === false) {
			children = children.filter((i) => !i.archivedAt);
		}

		// Apply limit
		if (options?.limit) {
			children = children.slice(0, options.limit);
		}

		return {
			...parent,
			children,
			childCount: children.length,
		};
	}

	async updateIssue(
		issueId: string,
		updates: IssueUpdateInput,
	): Promise<Issue> {
		const issue = await this.fetchIssue(issueId);

		// Apply updates
		if (updates.title !== undefined) issue.title = updates.title;
		if (updates.description !== undefined)
			issue.description = updates.description;
		if (updates.stateId !== undefined) {
			issue.state = this.state.workflowStates.get(updates.stateId);
		}
		if (updates.assigneeId !== undefined) {
			const oldAssigneeId = issue.assigneeId;
			issue.assigneeId = updates.assigneeId;
			issue.assignee = updates.assigneeId
				? this.state.users.get(updates.assigneeId)
				: undefined;

			// Emit assignment event if assigned to agent
			if (updates.assigneeId && updates.assigneeId !== oldAssigneeId) {
				const assignee = this.state.users.get(updates.assigneeId);
				if (assignee && assignee.name === this.state.agentHandle) {
					this.emit("issueAssigned", issue);
				}
			}
		}
		if (updates.priority !== undefined) issue.priority = updates.priority;
		if (updates.parentId !== undefined) issue.parentId = updates.parentId;
		if (updates.labelIds !== undefined) {
			issue.labels = updates.labelIds
				.map((id) => this.state.labels.get(id))
				.filter((l): l is Label => l !== undefined);
		}

		issue.updatedAt = this.now();

		return issue;
	}

	// ========================================================================
	// COMMENT OPERATIONS
	// ========================================================================

	async fetchComments(
		issueId: string,
		options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		await this.fetchIssue(issueId); // Ensure issue exists

		const comments = Array.from(this.state.comments.values()).filter(
			(c) => c.issueId === issueId,
		);

		// Apply pagination
		const first = options?.first ?? 50;
		const nodes = comments.slice(0, first);

		return {
			nodes,
			pageInfo: {
				hasNextPage: comments.length > first,
				hasPreviousPage: false,
				endCursor: nodes.length > 0 ? nodes[nodes.length - 1]!.id : undefined,
			},
		};
	}

	async fetchComment(commentId: string): Promise<Comment> {
		const comment = this.state.comments.get(commentId);
		if (!comment) {
			throw new Error(`Comment not found: ${commentId}`);
		}
		return comment;
	}

	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		const comment = await this.fetchComment(commentId);
		return {
			...comment,
			attachments: [], // No attachments in CLI mode
		};
	}

	async createComment(
		issueId: string,
		input: CommentCreateInput,
	): Promise<Comment> {
		await this.fetchIssue(issueId); // Ensure issue exists

		const now = this.now();

		// Store attachment URLs in metadata if provided
		const metadata: Record<string, any> = {};
		if (input.attachmentUrls && input.attachmentUrls.length > 0) {
			metadata.attachmentUrls = input.attachmentUrls;
		}

		const comment: Comment = {
			id: this.generateId("comment"),
			body: input.body,
			userId: this.state.currentUser.id,
			user: this.state.currentUser,
			issueId,
			parentId: input.parentId,
			parent: input.parentId
				? this.state.comments.get(input.parentId)
				: undefined,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
			metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
		};

		this.state.comments.set(comment.id, comment);

		// Check if comment mentions the agent
		if (input.body.includes(this.state.agentHandle)) {
			this.emit("commentMention", { comment, issue: issueId });
		}

		return comment;
	}

	// ========================================================================
	// TEAM OPERATIONS
	// ========================================================================

	async fetchTeams(options?: PaginationOptions): Promise<Connection<Team>> {
		const teams = Array.from(this.state.teams.values());
		const first = options?.first ?? 50;
		const nodes = teams.slice(0, first);

		return {
			nodes,
			pageInfo: {
				hasNextPage: teams.length > first,
				hasPreviousPage: false,
			},
		};
	}

	async fetchTeam(idOrKey: string): Promise<Team> {
		let team = this.state.teams.get(idOrKey);

		if (!team) {
			team = Array.from(this.state.teams.values()).find(
				(t) => t.key === idOrKey,
			);
		}

		if (!team) {
			throw new Error(`Team not found: ${idOrKey}`);
		}

		return team;
	}

	// ========================================================================
	// LABEL OPERATIONS
	// ========================================================================

	async fetchLabels(options?: PaginationOptions): Promise<Connection<Label>> {
		const labels = Array.from(this.state.labels.values());
		const first = options?.first ?? 50;
		const nodes = labels.slice(0, first);

		return {
			nodes,
			pageInfo: {
				hasNextPage: labels.length > first,
				hasPreviousPage: false,
			},
		};
	}

	async fetchLabel(idOrName: string): Promise<Label> {
		let label = this.state.labels.get(idOrName);

		if (!label) {
			label = Array.from(this.state.labels.values()).find(
				(l) => l.name === idOrName,
			);
		}

		if (!label) {
			throw new Error(`Label not found: ${idOrName}`);
		}

		return label;
	}

	// ========================================================================
	// WORKFLOW STATE OPERATIONS
	// ========================================================================

	async fetchWorkflowStates(
		teamId: string,
		options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		await this.fetchTeam(teamId); // Ensure team exists

		const states = Array.from(this.state.workflowStates.values());
		const first = options?.first ?? 50;
		const nodes = states.slice(0, first);

		return {
			nodes,
			pageInfo: {
				hasNextPage: states.length > first,
				hasPreviousPage: false,
			},
		};
	}

	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		const state = this.state.workflowStates.get(stateId);
		if (!state) {
			throw new Error(`Workflow state not found: ${stateId}`);
		}
		return state;
	}

	// ========================================================================
	// USER OPERATIONS
	// ========================================================================

	async fetchUser(userId: string): Promise<User> {
		const user = this.state.users.get(userId);
		if (!user) {
			throw new Error(`User not found: ${userId}`);
		}
		return user;
	}

	async fetchCurrentUser(): Promise<User> {
		return this.state.currentUser;
	}

	// ========================================================================
	// AGENT SESSION OPERATIONS
	// ========================================================================

	async createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): Promise<AgentSessionCreateResponse> {
		const issue = await this.fetchIssue(input.issueId);
		const now = this.now();

		const session: AgentSession = {
			id: this.generateId("session"),
			issueId: issue.id,
			status: "pending" as AgentSessionStatus,
			type: "issue" as AgentSessionType,
			creatorId: this.state.currentUser.id,
			creator: this.state.currentUser,
			appUserId: this.state.currentUser.id, // Use current user as app user in CLI mode
			organizationId: "cli-org",
			startedAt: now,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
		};

		this.state.agentSessions.set(session.id, session);
		this.state.agentActivities.set(session.id, []);

		// Emit session created event
		this.emit("agentSessionCreated", { session, issue });

		return {
			success: true,
			agentSessionId: session.id,
			lastSyncId: 0,
		};
	}

	async createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): Promise<AgentSessionCreateResponse> {
		const comment = await this.fetchComment(input.commentId);
		const issue = await this.fetchIssue(comment.issueId);
		const now = this.now();

		const session: AgentSession = {
			id: this.generateId("session"),
			issueId: issue.id,
			commentId: comment.id,
			status: "pending" as AgentSessionStatus,
			type: "commentThread" as AgentSessionType,
			creatorId: this.state.currentUser.id,
			creator: this.state.currentUser,
			appUserId: this.state.currentUser.id,
			organizationId: "cli-org",
			startedAt: now,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
		};

		this.state.agentSessions.set(session.id, session);
		this.state.agentActivities.set(session.id, []);

		// Emit session created event
		this.emit("agentSessionCreated", { session, issue, comment });

		return {
			success: true,
			agentSessionId: session.id,
			lastSyncId: 0,
		};
	}

	async fetchAgentSession(sessionId: string): Promise<AgentSession> {
		const session = this.state.agentSessions.get(sessionId);
		if (!session) {
			throw new Error(`Agent session not found: ${sessionId}`);
		}
		return session;
	}

	/**
	 * Update agent session status (for CLI control).
	 */
	async updateAgentSessionStatus(
		sessionId: string,
		status: AgentSessionStatus,
	): Promise<AgentSession> {
		const session = await this.fetchAgentSession(sessionId);
		session.status = status;
		session.updatedAt = this.now();
		return session;
	}

	// ========================================================================
	// AGENT ACTIVITY OPERATIONS
	// ========================================================================

	async createAgentActivity(
		sessionId: string,
		content: AgentActivityContent,
		options?: {
			ephemeral?: boolean;
			signal?: AgentActivitySignal;
			signalMetadata?: Record<string, any>;
		},
	): Promise<AgentActivity> {
		await this.fetchAgentSession(sessionId); // Ensure session exists

		const activities = this.state.agentActivities.get(sessionId) || [];

		// Ephemeral behavior: Remove the previous ephemeral activity if it exists
		if (activities.length > 0) {
			const lastActivity = activities[activities.length - 1];
			if (lastActivity?.ephemeral) {
				// Remove the last ephemeral activity
				activities.pop();
			}
		}

		const now = this.now();
		const activity: AgentActivity = {
			id: this.generateId("activity"),
			agentSessionId: sessionId,
			agentContextId: null,
			content,
			signal: options?.signal,
			signalMetadata: options?.signalMetadata,
			ephemeral: options?.ephemeral ?? false,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
		};

		activities.push(activity);
		this.state.agentActivities.set(sessionId, activities);

		// Emit activity created event
		this.emit("agentActivityCreated", { activity, sessionId });

		return activity;
	}

	/**
	 * Fetch all activities for a session (for debugging/inspection).
	 */
	async fetchAgentActivities(sessionId: string): Promise<AgentActivity[]> {
		await this.fetchAgentSession(sessionId); // Ensure session exists
		return this.state.agentActivities.get(sessionId) || [];
	}

	/**
	 * Send a prompt to an agent session (CLI command: promptAgentSession).
	 * This creates a prompt activity and emits an event.
	 */
	async promptAgentSession(
		sessionId: string,
		message: string,
	): Promise<AgentActivity> {
		const activity = await this.createAgentActivity(sessionId, {
			type: AgentActivityContentType.Prompt,
			body: message,
		});

		// Emit prompted event
		this.emit("agentSessionPrompted", { sessionId, activity });

		return activity;
	}

	/**
	 * Stop an agent session (CLI command: stopAgentSession).
	 * This creates a stop signal activity.
	 */
	async stopAgentSession(sessionId: string): Promise<AgentActivity> {
		const now = this.now();
		const activity: AgentActivity = {
			id: this.generateId("activity"),
			agentSessionId: sessionId,
			agentContextId: null,
			content: {
				type: AgentActivityContentType.Prompt,
				body: "STOP",
			},
			signal: AgentActivitySignal.Stop,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
		};

		const activities = this.state.agentActivities.get(sessionId) || [];
		activities.push(activity);
		this.state.agentActivities.set(sessionId, activities);

		// Update session status
		await this.updateAgentSessionStatus(
			sessionId,
			"complete" as AgentSessionStatus,
		);

		// Emit stop event
		this.emit("agentSessionStopped", { sessionId, activity });

		return activity;
	}

	// ========================================================================
	// FILE OPERATIONS
	// ========================================================================

	async requestFileUpload(
		request: FileUploadRequest,
	): Promise<FileUploadResponse> {
		// Mock file upload - return fake URLs
		return {
			uploadUrl: `https://example.com/upload/${request.filename}`,
			headers: {
				"Content-Type": request.contentType,
			},
			assetUrl: `https://example.com/assets/${request.filename}`,
		};
	}

	// ========================================================================
	// RAW API ACCESS
	// ========================================================================

	async rawGraphQLRequest<T = any>(
		_query: string,
		_variables?: Record<string, any>,
	): Promise<T> {
		throw new Error(
			"CLI issue tracker does not support GraphQL requests. Use the high-level API methods instead.",
		);
	}

	async rawRESTRequest<T = any>(
		_endpoint: string,
		_options?: {
			method?: string;
			headers?: Record<string, string>;
			body?: any;
		},
	): Promise<T> {
		throw new Error(
			"CLI issue tracker does not support REST requests. Use the high-level API methods instead.",
		);
	}

	// ========================================================================
	// PLATFORM METADATA
	// ========================================================================

	getPlatformType(): string {
		return "cli";
	}

	getPlatformMetadata(): Record<string, any> {
		return {
			platform: "cli",
			version: "1.0.0",
			mode: "in-memory",
		};
	}

	// ========================================================================
	// EVENT TRANSPORT
	// ========================================================================

	createEventTransport(
		config: AgentEventTransportConfig,
	): IAgentEventTransport {
		return new CLIEventTransport(this, config);
	}
}
