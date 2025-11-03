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
} from "../../IAgentEventTransport.js";
import type { IIssueTrackerService } from "../../IIssueTrackerService.js";
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
} from "../../types.js";
import {
	AgentActivityContentType,
	AgentActivitySignal,
	WorkflowStateType,
} from "../../types.js";
import { CLIEventTransport } from "./CLIEventTransport.js";

// ============================================================================
// INTERNAL DATA INTERFACES
// ============================================================================

/**
 * Internal plain data representation of an issue.
 * This is what we store in memory - plain data, no methods.
 */
interface CLIIssueData {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	url: string;
	teamId: string;
	stateId?: string;
	assigneeId?: string;
	labelIds?: string[];
	parentId?: string;
	priority?: number;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string | null;
}

/**
 * Internal plain data representation of a comment.
 */
interface CLICommentData {
	id: string;
	body: string;
	userId: string;
	issueId: string;
	parentId?: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string | null;
	metadata?: Record<string, any>;
}

/**
 * Internal plain data representation of a user.
 */
interface CLIUserData {
	id: string;
	name: string;
	email: string;
	url: string;
	displayName?: string;
	avatarUrl?: string;
}

/**
 * Internal plain data representation of a team.
 */
interface CLITeamData {
	id: string;
	key: string;
	name: string;
	description?: string;
}

/**
 * Internal plain data representation of a workflow state.
 */
interface CLIWorkflowStateData {
	id: string;
	name: string;
	type: WorkflowStateType;
	color: string;
	position: number;
	description?: string;
}

/**
 * Internal plain data representation of a label.
 */
interface CLILabelData {
	id: string;
	name: string;
	color: string;
	description?: string;
}

/**
 * In-memory state storage for the CLI issue tracker.
 * Now stores plain data internally, converts to Linear SDK mocks when returning.
 */
interface CLIState {
	issues: Map<string, CLIIssueData>;
	comments: Map<string, CLICommentData>;
	agentSessions: Map<string, AgentSession>;
	agentActivities: Map<string, AgentActivity[]>;
	teams: Map<string, CLITeamData>;
	labels: Map<string, CLILabelData>;
	workflowStates: Map<string, CLIWorkflowStateData>;
	users: Map<string, CLIUserData>;
	currentUser: CLIUserData;
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

		// Initialize default user (plain data)
		const currentUserData: CLIUserData = {
			id: "cli-user-1",
			name: "CLI User",
			email: "cli@example.com",
			url: "https://example.com/cli-user",
		};

		// Initialize agent user (plain data)
		const agentUserData: CLIUserData = {
			id: config.agentUserId,
			name: config.agentHandle,
			email: "agent@example.com",
			url: "https://example.com/agent",
		};

		// Initialize default team (plain data)
		const defaultTeamData: CLITeamData = {
			id: "team-1",
			key: "CLI",
			name: "CLI Team",
		};

		// Initialize default workflow states (plain data)
		const defaultStatesData: CLIWorkflowStateData[] = [
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
			teams: new Map([[defaultTeamData.id, defaultTeamData]]),
			labels: new Map(),
			workflowStates: new Map(defaultStatesData.map((s) => [s.id, s])),
			users: new Map([
				[currentUserData.id, currentUserData],
				[agentUserData.id, agentUserData],
			]),
			currentUser: currentUserData,
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
	// MOCK FACTORY FUNCTIONS - Convert plain data to Linear SDK compatible mocks
	// ========================================================================

	/**
	 * Convert plain user data to Linear SDK compatible User mock.
	 */
	private toLinearUser(data: CLIUserData): User {
		return {
			id: data.id,
			name: data.name,
			displayName: data.displayName || data.name,
			email: data.email,
			url: data.url,
			avatarUrl: data.avatarUrl,
			// Stub out other required fields with sensible defaults
			active: true,
			admin: false,
			guest: false,
			createdAt: new Date(),
			updatedAt: new Date(),
			archivedAt: undefined,
		} as User;
	}

	/**
	 * Convert plain team data to Linear SDK compatible Team mock.
	 */
	private toLinearTeam(data: CLITeamData): Team {
		return {
			id: data.id,
			name: data.name,
			key: data.key,
			description: data.description,
			// Stub out other required fields
			private: false,
			createdAt: new Date(),
			updatedAt: new Date(),
			archivedAt: undefined,
		} as Team;
	}

	/**
	 * Convert plain workflow state data to Linear SDK compatible WorkflowState mock.
	 */
	private toLinearWorkflowState(data: CLIWorkflowStateData): WorkflowState {
		return {
			id: data.id,
			name: data.name,
			type: data.type,
			color: data.color,
			position: data.position,
			description: data.description,
			// Stub out other required fields
			createdAt: new Date(),
			updatedAt: new Date(),
			archivedAt: undefined,
		} as WorkflowState;
	}

	/**
	 * Convert plain label data to Linear SDK compatible Label mock.
	 */
	private toLinearLabel(data: CLILabelData): Label {
		return {
			id: data.id,
			name: data.name,
			color: data.color,
			description: data.description,
			// Stub out other required fields
			createdAt: new Date(),
			updatedAt: new Date(),
			archivedAt: undefined,
		} as Label;
	}

	/**
	 * Convert plain comment data to Linear SDK compatible Comment mock.
	 */
	private toLinearComment(data: CLICommentData): Comment {
		const self = this;
		const userData = this.state.users.get(data.userId);
		const parentData = data.parentId
			? this.state.comments.get(data.parentId)
			: undefined;

		return {
			id: data.id,
			body: data.body,
			createdAt: new Date(data.createdAt),
			updatedAt: new Date(data.updatedAt),
			archivedAt: data.archivedAt ? new Date(data.archivedAt) : undefined,
			editedAt: undefined,
			// Store IDs and metadata for backward compatibility with tests
			issueId: data.issueId,
			userId: data.userId,
			parentId: data.parentId,
			metadata: data.metadata,
			// Async getter for user
			get user(): Promise<User | undefined> {
				return Promise.resolve(
					userData ? self.toLinearUser(userData) : undefined,
				);
			},
			// Async getter for issue
			get issue(): Promise<Issue> {
				const issueData = self.state.issues.get(data.issueId);
				if (!issueData) {
					throw new Error(
						`Issue ${data.issueId} not found for comment ${data.id}`,
					);
				}
				return Promise.resolve(self.toLinearIssue(issueData));
			},
			// Async getter for parent comment
			get parent(): Promise<Comment | undefined> {
				return Promise.resolve(
					parentData ? self.toLinearComment(parentData) : undefined,
				);
			},
			// Stub out other fields
			url: `https://example.com/comment/${data.id}`,
		} as unknown as Comment;
	}

	/**
	 * Convert plain issue data to Linear SDK compatible Issue mock.
	 * This is the most complex mock as it needs to handle async properties and methods.
	 */
	private toLinearIssue(data: CLIIssueData): Issue {
		const self = this;

		return {
			id: data.id,
			identifier: data.identifier,
			title: data.title,
			description: data.description,
			url: data.url,
			priority: data.priority ?? 0,
			number: Number.parseInt(data.identifier.split("-")[1] || "0", 10),
			// Date objects (not strings!)
			createdAt: new Date(data.createdAt),
			updatedAt: new Date(data.updatedAt),
			archivedAt: data.archivedAt ? new Date(data.archivedAt) : undefined,
			// Store IDs as simple properties for backward compatibility with tests
			assigneeId: data.assigneeId,
			teamId: data.teamId,
			stateId: data.stateId,
			parentId: data.parentId,

			// Async getter properties for related entities
			get state(): Promise<WorkflowState | undefined> {
				const stateData = data.stateId
					? self.state.workflowStates.get(data.stateId)
					: undefined;
				return Promise.resolve(
					stateData ? self.toLinearWorkflowState(stateData) : undefined,
				);
			},

			get assignee(): Promise<User | undefined> {
				const userData = data.assigneeId
					? self.state.users.get(data.assigneeId)
					: undefined;
				return Promise.resolve(
					userData ? self.toLinearUser(userData) : undefined,
				);
			},

			get team(): Promise<Team> {
				const teamData = self.state.teams.get(data.teamId);
				if (!teamData) {
					throw new Error(`Team ${data.teamId} not found for issue ${data.id}`);
				}
				return Promise.resolve(self.toLinearTeam(teamData));
			},

			get parent(): Promise<Issue | undefined> {
				const parentData = data.parentId
					? self.state.issues.get(data.parentId)
					: undefined;
				return Promise.resolve(
					parentData ? self.toLinearIssue(parentData) : undefined,
				);
			},

			// Async methods that return collections
			labels: () => {
				const labels = (data.labelIds || [])
					.map((id) => self.state.labels.get(id))
					.filter((l): l is CLILabelData => l !== undefined)
					.map((l) => self.toLinearLabel(l));
				return Promise.resolve({ nodes: labels });
			},

			children: (options?: {
				first?: number;
				filter?: Record<string, any>;
			}) => {
				let children = Array.from(self.state.issues.values())
					.filter((i) => i.parentId === data.id)
					.map((i) => self.toLinearIssue(i));

				// Apply filters if provided
				if (options?.filter) {
					// Simple filter implementation for testing
					if (options.filter.archivedAt?.null === true) {
						children = children.filter((i) => !i.archivedAt);
					}
				}

				// Apply limit
				if (options?.first) {
					children = children.slice(0, options.first);
				}

				return Promise.resolve({ nodes: children });
			},

			comments: (options?: { first?: number }) => {
				const comments = Array.from(self.state.comments.values())
					.filter((c) => c.issueId === data.id)
					.map((c) => self.toLinearComment(c));

				const first = options?.first ?? 50;
				const nodes = comments.slice(0, first);

				return Promise.resolve({ nodes });
			},

			attachments: () => {
				// CLI has no attachments
				return Promise.resolve({ nodes: [] });
			},

			// Stub out other required fields with sensible defaults
			branchName: `cli/${data.identifier.toLowerCase()}`,
			customerTicketCount: 0,
			estimate: undefined,
			sortOrder: 0,
			subIssueSortOrder: 0,
		} as unknown as Issue;
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

		// Store plain data internally
		const issueData: CLIIssueData = {
			id: this.generateId("issue"),
			identifier: `CLI-${this.idCounter}`,
			title: input.title,
			description: input.description,
			url: `https://example.com/issue/CLI-${this.idCounter}`,
			teamId,
			stateId,
			assigneeId: input.assigneeId,
			labelIds: input.labelIds,
			parentId: input.parentId,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
		};

		this.state.issues.set(issueData.id, issueData);

		// Emit issue created event if assigned to agent
		if (input.assigneeId) {
			const assignee = this.state.users.get(input.assigneeId);
			if (assignee && assignee.name === this.state.agentHandle) {
				// Convert to Linear mock for event emission
				this.emit("issueAssigned", this.toLinearIssue(issueData));
			}
		}

		// Return Linear SDK compatible mock
		return this.toLinearIssue(issueData);
	}

	/**
	 * Create a label (CLI command: createLabel).
	 */
	async createLabel(input: {
		name: string;
		color?: string;
		description?: string;
	}): Promise<Label> {
		const labelData: CLILabelData = {
			id: this.generateId("label"),
			name: input.name,
			color: input.color || "#000000",
			description: input.description,
		};

		this.state.labels.set(labelData.id, labelData);
		return this.toLinearLabel(labelData);
	}

	/**
	 * Create a member/user (CLI command: createMember).
	 */
	async createMember(input: { name: string; email?: string }): Promise<User> {
		const userData: CLIUserData = {
			id: this.generateId("user"),
			name: input.name,
			email: input.email || `${input.name.toLowerCase()}@example.com`,
			url: `https://example.com/user/${input.name}`,
		};

		this.state.users.set(userData.id, userData);
		return this.toLinearUser(userData);
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
		let issueData = this.state.issues.get(idOrIdentifier);

		// Try by identifier if not found
		if (!issueData) {
			issueData = Array.from(this.state.issues.values()).find(
				(i) => i.identifier === idOrIdentifier,
			);
		}

		if (!issueData) {
			throw new Error(`Issue not found: ${idOrIdentifier}`);
		}

		return this.toLinearIssue(issueData);
	}

	async fetchIssueChildren(
		issueId: string,
		options?: FetchChildrenOptions,
	): Promise<IssueWithChildren> {
		const parent = await this.fetchIssue(issueId);

		// Find all children (work with plain data)
		let childrenData = Array.from(this.state.issues.values()).filter(
			(i) => i.parentId === issueId,
		);

		// Apply filters
		if (options?.includeCompleted === false) {
			childrenData = childrenData.filter((i) => {
				const stateData = i.stateId
					? this.state.workflowStates.get(i.stateId)
					: undefined;
				if (!stateData) return true;
				return stateData.type !== WorkflowStateType.Completed;
			});
		}

		if (options?.includeArchived === false) {
			childrenData = childrenData.filter((i) => !i.archivedAt);
		}

		// Apply limit
		if (options?.limit) {
			childrenData = childrenData.slice(0, options.limit);
		}

		// Convert to Linear mocks
		const children = childrenData.map((d) => this.toLinearIssue(d));

		return {
			...parent,
			children,
			childCount: children.length,
		} as IssueWithChildren;
	}

	async updateIssue(
		issueId: string,
		updates: IssueUpdateInput,
	): Promise<Issue> {
		// Fetch plain data
		const issueData = this.state.issues.get(issueId);
		if (!issueData) {
			throw new Error(`Issue not found: ${issueId}`);
		}

		const oldAssigneeId = issueData.assigneeId;

		// Apply updates to plain data
		if (updates.title !== undefined) issueData.title = updates.title;
		if (updates.description !== undefined)
			issueData.description = updates.description;
		if (updates.stateId !== undefined) {
			issueData.stateId = updates.stateId;
		}
		if (updates.assigneeId !== undefined) {
			issueData.assigneeId = updates.assigneeId;

			// Emit assignment event if assigned to agent
			if (updates.assigneeId && updates.assigneeId !== oldAssigneeId) {
				const assignee = this.state.users.get(updates.assigneeId);
				if (assignee && assignee.name === this.state.agentHandle) {
					this.emit("issueAssigned", this.toLinearIssue(issueData));
				}
			}
		}
		if (updates.priority !== undefined) issueData.priority = updates.priority;
		if (updates.parentId !== undefined) issueData.parentId = updates.parentId;
		if (updates.labelIds !== undefined) {
			issueData.labelIds = updates.labelIds;
		}

		issueData.updatedAt = this.now();

		return this.toLinearIssue(issueData);
	}

	/**
	 * Fetch attachments for an issue.
	 *
	 * CLI mode has no native attachments, so this returns an empty array.
	 */
	async fetchIssueAttachments(
		issueId: string,
	): Promise<Array<{ title: string; url: string }>> {
		// Ensure issue exists (throws if not found)
		await this.fetchIssue(issueId);

		// CLI has no native attachments
		return [];
	}

	// ========================================================================
	// COMMENT OPERATIONS
	// ========================================================================

	async fetchComments(
		issueId: string,
		options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		await this.fetchIssue(issueId); // Ensure issue exists

		const commentsData = Array.from(this.state.comments.values()).filter(
			(c) => c.issueId === issueId,
		);

		// Apply pagination
		const first = options?.first ?? 50;
		const nodesData = commentsData.slice(0, first);
		const nodes = nodesData.map((d) => this.toLinearComment(d));

		return {
			nodes,
			pageInfo: {
				hasNextPage: commentsData.length > first,
				hasPreviousPage: false,
				endCursor: nodes.length > 0 ? nodes[nodes.length - 1]!.id : undefined,
			},
		};
	}

	async fetchComment(commentId: string): Promise<Comment> {
		const commentData = this.state.comments.get(commentId);
		if (!commentData) {
			throw new Error(`Comment not found: ${commentId}`);
		}
		return this.toLinearComment(commentData);
	}

	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		const comment = await this.fetchComment(commentId);
		return {
			...comment,
			attachments: [], // No attachments in CLI mode
		} as unknown as CommentWithAttachments;
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

		const commentData: CLICommentData = {
			id: this.generateId("comment"),
			body: input.body,
			userId: this.state.currentUser.id,
			issueId,
			parentId: input.parentId,
			createdAt: now,
			updatedAt: now,
			archivedAt: null,
			metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
		};

		this.state.comments.set(commentData.id, commentData);

		// Check if comment mentions the agent
		if (input.body.includes(this.state.agentHandle)) {
			this.emit("commentMention", {
				comment: this.toLinearComment(commentData),
				issue: issueId,
			});
		}

		return this.toLinearComment(commentData);
	}

	// ========================================================================
	// TEAM OPERATIONS
	// ========================================================================

	async fetchTeams(options?: PaginationOptions): Promise<Connection<Team>> {
		const teamsData = Array.from(this.state.teams.values());
		const first = options?.first ?? 50;
		const nodesData = teamsData.slice(0, first);
		const nodes = nodesData.map((d) => this.toLinearTeam(d));

		return {
			nodes,
			pageInfo: {
				hasNextPage: teamsData.length > first,
				hasPreviousPage: false,
			},
		};
	}

	async fetchTeam(idOrKey: string): Promise<Team> {
		let teamData = this.state.teams.get(idOrKey);

		if (!teamData) {
			teamData = Array.from(this.state.teams.values()).find(
				(t) => t.key === idOrKey,
			);
		}

		if (!teamData) {
			throw new Error(`Team not found: ${idOrKey}`);
		}

		return this.toLinearTeam(teamData);
	}

	// ========================================================================
	// LABEL OPERATIONS
	// ========================================================================

	async fetchLabels(options?: PaginationOptions): Promise<Connection<Label>> {
		const labelsData = Array.from(this.state.labels.values());
		const first = options?.first ?? 50;
		const nodesData = labelsData.slice(0, first);
		const nodes = nodesData.map((d) => this.toLinearLabel(d));

		return {
			nodes,
			pageInfo: {
				hasNextPage: labelsData.length > first,
				hasPreviousPage: false,
			},
		};
	}

	async fetchLabel(idOrName: string): Promise<Label> {
		let labelData = this.state.labels.get(idOrName);

		if (!labelData) {
			labelData = Array.from(this.state.labels.values()).find(
				(l) => l.name === idOrName,
			);
		}

		if (!labelData) {
			throw new Error(`Label not found: ${idOrName}`);
		}

		return this.toLinearLabel(labelData);
	}

	// ========================================================================
	// WORKFLOW STATE OPERATIONS
	// ========================================================================

	async fetchWorkflowStates(
		teamId: string,
		options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		await this.fetchTeam(teamId); // Ensure team exists

		const statesData = Array.from(this.state.workflowStates.values());
		const first = options?.first ?? 50;
		const nodesData = statesData.slice(0, first);
		const nodes = nodesData.map((d) => this.toLinearWorkflowState(d));

		return {
			nodes,
			pageInfo: {
				hasNextPage: statesData.length > first,
				hasPreviousPage: false,
			},
		};
	}

	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		const stateData = this.state.workflowStates.get(stateId);
		if (!stateData) {
			throw new Error(`Workflow state not found: ${stateId}`);
		}
		return this.toLinearWorkflowState(stateData);
	}

	// ========================================================================
	// USER OPERATIONS
	// ========================================================================

	async fetchUser(userId: string): Promise<User> {
		const userData = this.state.users.get(userId);
		if (!userData) {
			throw new Error(`User not found: ${userId}`);
		}
		return this.toLinearUser(userData);
	}

	async fetchCurrentUser(): Promise<User> {
		return this.toLinearUser(this.state.currentUser);
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
			creator: this.toLinearUser(this.state.currentUser),
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
		const commentIssue = await comment.issue;
		if (!commentIssue) {
			throw new Error(`Issue not found for comment ${input.commentId}`);
		}
		const issue = await this.fetchIssue(commentIssue.id);
		const now = this.now();

		const session: AgentSession = {
			id: this.generateId("session"),
			issueId: issue.id,
			commentId: comment.id,
			status: "pending" as AgentSessionStatus,
			type: "commentThread" as AgentSessionType,
			creatorId: this.state.currentUser.id,
			creator: this.toLinearUser(this.state.currentUser),
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
	// PLATFORM METADATA
	// ========================================================================

	getPlatformType(): string {
		return "cli";
	}

	getPlatformMetadata(): Record<string, unknown> {
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
