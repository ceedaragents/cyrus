/**
 * CLI Platform Type Definitions for F1 Testing Framework
 *
 * This module provides synchronous, in-memory type definitions that mirror Linear SDK types
 * but are compatible with CLI/testing environments. These types are designed for use with
 * the IIssueTrackerService interface in testing scenarios where async properties and
 * network calls are not desirable.
 *
 * Key Differences from Linear SDK Types:
 * - All properties are synchronous (no Promise-returning properties)
 * - Methods like labels(), children() are replaced with array properties
 * - All IDs are string-based with predictable prefixes
 * - Designed for in-memory state management
 *
 * @module issue-tracker/adapters/cli-types
 * @see {@link https://linear.app/docs/graphql/api|Linear GraphQL API Documentation}
 */

import type { LinearDocument } from "@linear/sdk";
import {
	type AgentActivitySignal,
	AgentActivityType,
	AgentSessionStatus,
	AgentSessionType,
	IssuePriority,
	WorkflowStateType,
} from "../types.js";

// ============================================================================
// ID GENERATION UTILITIES
// ============================================================================

/**
 * ID prefix mapping for different entity types.
 * Mirrors Linear's UUID-based ID system with predictable prefixes for testing.
 */
export const CLI_ID_PREFIXES = {
	issue: "cli-issue-",
	comment: "cli-comment-",
	user: "cli-user-",
	team: "cli-team-",
	state: "cli-state-",
	label: "cli-label-",
	session: "cli-session-",
	activity: "cli-activity-",
	project: "cli-project-",
	organization: "cli-org-",
} as const;

/**
 * Counter for generating sequential IDs in tests.
 * Reset this between tests for consistent IDs.
 */
let idCounter = 0;

/**
 * Reset the ID counter to 0.
 * Call this in test setup to ensure consistent IDs across test runs.
 */
export function resetIdCounter(): void {
	idCounter = 0;
}

/**
 * Generate a unique ID with the specified prefix.
 *
 * @param prefix - The ID prefix (e.g., "cli-issue-")
 * @returns A unique ID string
 *
 * @example
 * ```typescript
 * const issueId = generateId(CLI_ID_PREFIXES.issue); // "cli-issue-1"
 * const commentId = generateId(CLI_ID_PREFIXES.comment); // "cli-comment-2"
 * ```
 */
export function generateId(prefix: string): string {
	return `${prefix}${++idCounter}`;
}

/**
 * Generate a unique issue ID.
 */
export function generateIssueId(): string {
	return generateId(CLI_ID_PREFIXES.issue);
}

/**
 * Generate a unique comment ID.
 */
export function generateCommentId(): string {
	return generateId(CLI_ID_PREFIXES.comment);
}

/**
 * Generate a unique user ID.
 */
export function generateUserId(): string {
	return generateId(CLI_ID_PREFIXES.user);
}

/**
 * Generate a unique team ID.
 */
export function generateTeamId(): string {
	return generateId(CLI_ID_PREFIXES.team);
}

/**
 * Generate a unique workflow state ID.
 */
export function generateStateId(): string {
	return generateId(CLI_ID_PREFIXES.state);
}

/**
 * Generate a unique label ID.
 */
export function generateLabelId(): string {
	return generateId(CLI_ID_PREFIXES.label);
}

/**
 * Generate a unique agent session ID.
 */
export function generateSessionId(): string {
	return generateId(CLI_ID_PREFIXES.session);
}

/**
 * Generate a unique agent activity ID.
 */
export function generateActivityId(): string {
	return generateId(CLI_ID_PREFIXES.activity);
}

// ============================================================================
// CORE TYPE DEFINITIONS
// ============================================================================

/**
 * CLI User type - synchronous equivalent of Linear SDK's User type.
 *
 * This type mirrors Linear SDK's User but with all properties synchronously accessible.
 * Suitable for in-memory testing scenarios.
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/User|Linear SDK User}
 */
export interface CLIUser {
	/** Unique user identifier */
	id: string;
	/** User's display name */
	name: string;
	/** User's email address */
	email: string;
	/** User's avatar URL (optional) */
	avatarUrl?: string;
	/** Whether the user is active */
	active: boolean;
	/** User creation timestamp */
	createdAt: Date;
	/** User last update timestamp */
	updatedAt: Date;
}

/**
 * CLI Team type - synchronous equivalent of Linear SDK's Team type.
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/Team|Linear SDK Team}
 */
export interface CLITeam {
	/** Unique team identifier */
	id: string;
	/** Team key (e.g., "ENG" for team identifier "ENG-123") */
	key: string;
	/** Team display name */
	name: string;
	/** Team description */
	description?: string;
	/** Team creation timestamp */
	createdAt: Date;
	/** Team last update timestamp */
	updatedAt: Date;
}

/**
 * CLI WorkflowState type - synchronous equivalent of Linear SDK's WorkflowState type.
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/WorkflowState|Linear SDK WorkflowState}
 */
export interface CLIWorkflowState {
	/** Unique workflow state identifier */
	id: string;
	/** State name (e.g., "In Progress", "Done") */
	name: string;
	/** State type (standardized across platforms) */
	type: WorkflowStateType;
	/** State color (hex format) */
	color: string;
	/** Display order position */
	position: number;
	/** Team this state belongs to */
	teamId: string;
	/** State creation timestamp */
	createdAt: Date;
	/** State last update timestamp */
	updatedAt: Date;
}

/**
 * CLI Label type - synchronous equivalent of Linear SDK's IssueLabel type.
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/IssueLabel|Linear SDK IssueLabel}
 */
export interface CLILabel {
	/** Unique label identifier */
	id: string;
	/** Label name */
	name: string;
	/** Label description */
	description?: string;
	/** Label color (hex format) */
	color: string;
	/** Team this label belongs to (optional for workspace labels) */
	teamId?: string;
	/** Label creation timestamp */
	createdAt: Date;
	/** Label last update timestamp */
	updatedAt: Date;
}

/**
 * CLI Comment type - synchronous equivalent of Linear SDK's Comment type.
 *
 * Key differences from Linear SDK:
 * - `user` is a direct value, not a Promise
 * - `issue` is a direct value, not a Promise
 * - `parent` is a direct value, not a Promise
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/Comment|Linear SDK Comment}
 */
export interface CLIComment {
	/** Unique comment identifier */
	id: string;
	/** Comment body/content (Markdown) */
	body: string;
	/** Issue this comment belongs to */
	issueId: string;
	/** User who created the comment */
	user: CLIUser;
	/** Parent comment ID (for threaded comments) */
	parentId?: string;
	/** Comment creation timestamp */
	createdAt: Date;
	/** Comment last update timestamp */
	updatedAt: Date;
	/** Comment URL */
	url: string;
	/** Whether comment has been edited */
	edited: boolean;
}

/**
 * CLI Issue type - synchronous equivalent of Linear SDK's Issue type.
 *
 * Key differences from Linear SDK:
 * - All relationship properties (state, assignee, team, labels, children) are direct values
 * - Methods like `labels()`, `children()` are replaced with array properties
 * - All properties are synchronously accessible
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/Issue|Linear SDK Issue}
 */
export interface CLIIssue {
	/** Unique issue identifier */
	id: string;
	/** Human-readable identifier (e.g., "ENG-123") */
	identifier: string;
	/** Issue title */
	title: string;
	/** Issue description (Markdown) */
	description?: string;
	/** Issue priority (0-4) */
	priority: IssuePriority;
	/** Current workflow state */
	state: CLIWorkflowState;
	/** Assigned user */
	assignee?: CLIUser;
	/** Team this issue belongs to */
	team: CLITeam;
	/** Labels applied to this issue */
	labels: CLILabel[];
	/** Child/sub-issues */
	children: CLIIssue[];
	/** Parent issue ID (if this is a sub-issue) */
	parentId?: string;
	/** Issue number (sequential within team) */
	number: number;
	/** Issue URL */
	url: string;
	/** Git branch name */
	branchName: string;
	/** Estimate (story points or time) */
	estimate?: number;
	/** Display order */
	sortOrder: number;
	/** Issue creation timestamp */
	createdAt: Date;
	/** Issue last update timestamp */
	updatedAt: Date;
	/** Archived timestamp (null if not archived) */
	archivedAt?: Date;
}

/**
 * CLI AgentSession type - synchronous equivalent of Linear SDK's AgentSession.
 *
 * This type represents an agent session for tracking AI/bot activity on issues or comments.
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/AgentSession|Linear SDK AgentSession}
 */
export interface CLIAgentSession {
	/** Unique agent session identifier */
	id: string;
	/** Session status */
	status: AgentSessionStatus;
	/** Session type/context */
	type: AgentSessionType;
	/** Issue this session is associated with */
	issueId: string;
	/** Comment this session is associated with (optional) */
	commentId?: string;
	/** External link for agent-hosted page (optional) */
	externalLink?: string;
	/** Last sync ID for tracking changes */
	lastSyncId: number;
	/** Session creation timestamp */
	createdAt: Date;
	/** Session last update timestamp */
	updatedAt: Date;
}

/**
 * CLI AgentActivity type - synchronous equivalent of Linear SDK's AgentActivity.
 *
 * This type represents individual activities within an agent session.
 *
 * @see {@link https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/AgentActivity|Linear SDK AgentActivity}
 */
export interface CLIAgentActivity {
	/** Unique agent activity identifier */
	id: string;
	/** Agent session this activity belongs to */
	agentSessionId: string;
	/** Activity content (discriminated union based on type) */
	content: LinearDocument.AgentActivityContent;
	/** Activity type */
	type: AgentActivityType;
	/** Activity signal (for signaling state changes) */
	signal?: AgentActivitySignal;
	/** Activity creation timestamp */
	createdAt: Date;
	/** Activity last update timestamp */
	updatedAt: Date;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * In-memory state container for CLI platform.
 *
 * This interface defines the structure for storing all entities in memory
 * for testing and CLI-based issue tracking implementations.
 */
export interface CLIState {
	/** All issues indexed by ID */
	issues: Map<string, CLIIssue>;
	/** All comments indexed by ID */
	comments: Map<string, CLIComment>;
	/** All users indexed by ID */
	users: Map<string, CLIUser>;
	/** All teams indexed by ID */
	teams: Map<string, CLITeam>;
	/** All workflow states indexed by ID */
	states: Map<string, CLIWorkflowState>;
	/** All labels indexed by ID */
	labels: Map<string, CLILabel>;
	/** All agent sessions indexed by ID */
	sessions: Map<string, CLIAgentSession>;
	/** All agent activities indexed by ID */
	activities: Map<string, CLIAgentActivity>;
	/** Issue identifier to ID mapping (e.g., "ENG-123" -> "cli-issue-1") */
	issueIdentifiers: Map<string, string>;
	/** Team key to ID mapping (e.g., "ENG" -> "cli-team-1") */
	teamKeys: Map<string, string>;
}

/**
 * Create an empty CLI state container.
 *
 * @returns A new, empty CLIState instance
 *
 * @example
 * ```typescript
 * const state = createCLIState();
 * ```
 */
export function createCLIState(): CLIState {
	return {
		issues: new Map(),
		comments: new Map(),
		users: new Map(),
		teams: new Map(),
		states: new Map(),
		labels: new Map(),
		sessions: new Map(),
		activities: new Map(),
		issueIdentifiers: new Map(),
		teamKeys: new Map(),
	};
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a CLI User with default values.
 *
 * @param partial - Partial user data to override defaults
 * @returns A complete CLIUser instance
 *
 * @example
 * ```typescript
 * const user = createCLIUser({
 *   name: "John Doe",
 *   email: "john@example.com"
 * });
 * ```
 */
export function createCLIUser(partial: Partial<CLIUser> = {}): CLIUser {
	const now = new Date();
	return {
		id: partial.id ?? generateUserId(),
		name: partial.name ?? "Test User",
		email: partial.email ?? "test@example.com",
		avatarUrl: partial.avatarUrl,
		active: partial.active ?? true,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
	};
}

/**
 * Create a CLI Team with default values.
 *
 * @param partial - Partial team data to override defaults
 * @returns A complete CLITeam instance
 *
 * @example
 * ```typescript
 * const team = createCLITeam({
 *   key: "ENG",
 *   name: "Engineering"
 * });
 * ```
 */
export function createCLITeam(partial: Partial<CLITeam> = {}): CLITeam {
	const now = new Date();
	return {
		id: partial.id ?? generateTeamId(),
		key: partial.key ?? "TEST",
		name: partial.name ?? "Test Team",
		description: partial.description,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
	};
}

/**
 * Create a CLI WorkflowState with default values.
 *
 * @param partial - Partial workflow state data to override defaults
 * @returns A complete CLIWorkflowState instance
 *
 * @example
 * ```typescript
 * const state = createCLIWorkflowState({
 *   name: "In Progress",
 *   type: WorkflowStateType.Started,
 *   teamId: "cli-team-1"
 * });
 * ```
 */
export function createCLIWorkflowState(
	partial: Partial<CLIWorkflowState> = {},
): CLIWorkflowState {
	const now = new Date();
	return {
		id: partial.id ?? generateStateId(),
		name: partial.name ?? "Todo",
		type: partial.type ?? WorkflowStateType.Unstarted,
		color: partial.color ?? "#e2e2e2",
		position: partial.position ?? 0,
		teamId: partial.teamId ?? generateTeamId(),
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
	};
}

/**
 * Create a CLI Label with default values.
 *
 * @param partial - Partial label data to override defaults
 * @returns A complete CLILabel instance
 *
 * @example
 * ```typescript
 * const label = createCLILabel({
 *   name: "bug",
 *   color: "#ff0000"
 * });
 * ```
 */
export function createCLILabel(partial: Partial<CLILabel> = {}): CLILabel {
	const now = new Date();
	return {
		id: partial.id ?? generateLabelId(),
		name: partial.name ?? "test-label",
		description: partial.description,
		color: partial.color ?? "#cccccc",
		teamId: partial.teamId,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
	};
}

/**
 * Create a CLI Comment with default values.
 *
 * @param partial - Partial comment data to override defaults
 * @returns A complete CLIComment instance
 *
 * @example
 * ```typescript
 * const comment = createCLIComment({
 *   body: "This is a test comment",
 *   issueId: "cli-issue-1",
 *   user: createCLIUser({ name: "John Doe" })
 * });
 * ```
 */
export function createCLIComment(
	partial: Partial<CLIComment> & { user?: CLIUser } = {},
): CLIComment {
	const now = new Date();
	const commentId = partial.id ?? generateCommentId();
	return {
		id: commentId,
		body: partial.body ?? "Test comment",
		issueId: partial.issueId ?? generateIssueId(),
		user: partial.user ?? createCLIUser(),
		parentId: partial.parentId,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
		url: partial.url ?? `https://linear.app/test/comment/${commentId}`,
		edited: partial.edited ?? false,
	};
}

/**
 * Create a CLI Issue with default values.
 *
 * @param partial - Partial issue data to override defaults
 * @returns A complete CLIIssue instance
 *
 * @example
 * ```typescript
 * const issue = createCLIIssue({
 *   title: "Test Issue",
 *   identifier: "ENG-123",
 *   team: createCLITeam({ key: "ENG" }),
 *   state: createCLIWorkflowState({ type: WorkflowStateType.Started })
 * });
 * ```
 */
export function createCLIIssue(
	partial: Partial<CLIIssue> & {
		team?: CLITeam;
		state?: CLIWorkflowState;
		assignee?: CLIUser;
		labels?: CLILabel[];
		children?: CLIIssue[];
	} = {},
): CLIIssue {
	const now = new Date();
	const team = partial.team ?? createCLITeam();
	const number = partial.number ?? 1;
	const identifier = partial.identifier ?? `${team.key}-${number}`;
	const issueId = partial.id ?? generateIssueId();

	return {
		id: issueId,
		identifier,
		title: partial.title ?? "Test Issue",
		description: partial.description,
		priority: partial.priority ?? IssuePriority.NoPriority,
		state: partial.state ?? createCLIWorkflowState({ teamId: team.id }),
		assignee: partial.assignee,
		team,
		labels: partial.labels ?? [],
		children: partial.children ?? [],
		parentId: partial.parentId,
		number,
		url: partial.url ?? `https://linear.app/test/issue/${identifier}`,
		branchName: partial.branchName ?? `${identifier.toLowerCase()}-test-issue`,
		estimate: partial.estimate,
		sortOrder: partial.sortOrder ?? 0,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
		archivedAt: partial.archivedAt,
	};
}

/**
 * Create a CLI AgentSession with default values.
 *
 * @param partial - Partial agent session data to override defaults
 * @returns A complete CLIAgentSession instance
 *
 * @example
 * ```typescript
 * const session = createCLIAgentSession({
 *   issueId: "cli-issue-1",
 *   status: AgentSessionStatus.Active,
 *   type: AgentSessionType.CommentThread
 * });
 * ```
 */
export function createCLIAgentSession(
	partial: Partial<CLIAgentSession> = {},
): CLIAgentSession {
	const now = new Date();
	return {
		id: partial.id ?? generateSessionId(),
		status: partial.status ?? AgentSessionStatus.Active,
		type: partial.type ?? AgentSessionType.CommentThread,
		issueId: partial.issueId ?? generateIssueId(),
		commentId: partial.commentId,
		externalLink: partial.externalLink,
		lastSyncId: partial.lastSyncId ?? 0,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
	};
}

/**
 * Create a CLI AgentActivity with default values.
 *
 * @param partial - Partial agent activity data to override defaults
 * @returns A complete CLIAgentActivity instance
 *
 * @example
 * ```typescript
 * const activity = createCLIAgentActivity({
 *   agentSessionId: "cli-session-1",
 *   type: AgentActivityType.Thought,
 *   content: {
 *     type: AgentActivityType.Thought,
 *     body: "Processing issue..."
 *   }
 * });
 * ```
 */
export function createCLIAgentActivity(
	partial: Partial<CLIAgentActivity> = {},
): CLIAgentActivity {
	const now = new Date();
	const type = partial.type ?? AgentActivityType.Thought;

	// Create default content based on type
	// All AgentActivityContent types have a 'body' field except 'action' which has 'action' and 'parameter'
	const defaultContent: LinearDocument.AgentActivityContent =
		type === AgentActivityType.Action
			? {
					__typename: "AgentActivityActionContent" as const,
					type: AgentActivityType.Action,
					action: "default-action",
					parameter: "default-parameter",
				}
			: {
					__typename: "AgentActivityThoughtContent" as const,
					type,
					body: "Default activity content",
				};

	return {
		id: partial.id ?? generateActivityId(),
		agentSessionId: partial.agentSessionId ?? generateSessionId(),
		content: partial.content ?? defaultContent,
		type,
		signal: partial.signal,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now,
	};
}
