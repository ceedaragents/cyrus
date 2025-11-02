/**
 * Platform-agnostic types for issue tracking platforms.
 *
 * These types abstract away platform-specific details (Linear, GitHub, etc.)
 * to provide a unified interface for issue tracking operations.
 *
 * @module issue-tracker/types
 */

/**
 * Filter options for querying entities.
 */
export interface FilterOptions {
	/** Filter by state type */
	state?: {
		type?: {
			eq?: string;
			neq?: string;
			in?: string[];
			nin?: string[];
		};
	};
	/** Filter by archived status */
	archivedAt?: {
		null?: boolean;
	};
	/** Additional platform-specific filters */
	[key: string]: any;
}

/**
 * Pagination options for list operations.
 */
export interface PaginationOptions {
	/** Number of items to fetch */
	first?: number;
	/** Cursor for pagination */
	after?: string;
	/** Cursor for reverse pagination */
	before?: string;
	/** Filter criteria */
	filter?: FilterOptions;
}

/**
 * Platform-agnostic team representation.
 */
export interface Team {
	/** Unique team identifier */
	id: string;
	/** Short team key (e.g., "CEA") */
	key: string;
	/** Human-readable team name */
	name: string;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Platform-agnostic user/actor representation.
 */
export interface User {
	/** Unique user identifier */
	id: string;
	/** User's display name */
	name: string;
	/** User's email address */
	email: string;
	/** Profile URL */
	url: string;
	/** Avatar/profile picture URL */
	avatarUrl?: string;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Standard workflow state types across platforms.
 */
export enum WorkflowStateType {
	Triage = "triage",
	Backlog = "backlog",
	Unstarted = "unstarted",
	Started = "started",
	Completed = "completed",
	Canceled = "canceled",
}

/**
 * Platform-agnostic workflow state/status representation.
 */
export interface WorkflowState {
	/** Unique state identifier */
	id: string;
	/** Human-readable state name */
	name: string;
	/** Standardized state type */
	type: WorkflowStateType | string;
	/** State color (hex format) */
	color?: string;
	/** State position/order */
	position?: number;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Platform-agnostic label representation.
 */
export interface Label {
	/** Unique label identifier */
	id: string;
	/** Label name */
	name: string;
	/** Label color (hex format) */
	color?: string;
	/** Label description */
	description?: string;
	/** Parent label ID (for hierarchical labels) */
	parentId?: string;
	/** Whether this is a label group */
	isGroup?: boolean;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Issue priority levels (0 = no priority, 1 = urgent, 2 = high, 3 = normal, 4 = low).
 */
export enum IssuePriority {
	NoPriority = 0,
	Urgent = 1,
	High = 2,
	Normal = 3,
	Low = 4,
}

/**
 * Platform-agnostic issue representation.
 */
export interface Issue {
	/** Unique issue identifier */
	id: string;
	/** Human-readable identifier (e.g., "CEA-123") */
	identifier: string;
	/** Issue title */
	title: string;
	/** Issue description/body */
	description?: string;
	/** Issue URL */
	url: string;
	/** Team ID */
	teamId: string;
	/** Team object (may require async access) */
	team?: Team | Promise<Team>;
	/** Current state/status */
	state?: WorkflowState | Promise<WorkflowState>;
	/** Assignee ID */
	assigneeId?: string;
	/** Assignee object (may require async access) */
	assignee?: User | Promise<User>;
	/** Issue labels */
	labels?: Label[] | Promise<Label[]>;
	/** Issue priority */
	priority?: IssuePriority;
	/** Parent issue ID (for sub-issues) */
	parentId?: string;
	/** Creation timestamp (ISO 8601) */
	createdAt: string;
	/** Last update timestamp (ISO 8601) */
	updatedAt: string;
	/** Archive timestamp (ISO 8601), null if not archived */
	archivedAt?: string | null;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Minimal issue representation for lightweight operations.
 */
export interface IssueMinimal {
	/** Unique issue identifier */
	id: string;
	/** Human-readable identifier */
	identifier: string;
	/** Issue title */
	title: string;
	/** Issue URL */
	url: string;
}

/**
 * Issue with child issues included.
 */
export interface IssueWithChildren extends Issue {
	/** Child/sub-issues */
	children: Issue[];
	/** Total count of children */
	childCount: number;
}

/**
 * Platform-agnostic comment representation.
 */
export interface Comment {
	/** Unique comment identifier */
	id: string;
	/** Comment body/content */
	body: string;
	/** Author user ID */
	userId: string;
	/** Author user object (may require async access) */
	user?: User | Promise<User>;
	/** Issue ID this comment belongs to */
	issueId: string;
	/** Parent comment ID (for threaded comments) */
	parentId?: string;
	/** Parent comment object (may require async access) */
	parent?: Comment | Promise<Comment>;
	/** Creation timestamp (ISO 8601) */
	createdAt: string;
	/** Last update timestamp (ISO 8601) */
	updatedAt: string;
	/** Archive timestamp (ISO 8601), null if not archived */
	archivedAt?: string | null;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Comment with attachments metadata.
 */
export interface CommentWithAttachments extends Comment {
	/** Attachment information */
	attachments?: Array<{
		id: string;
		url: string;
		filename: string;
		contentType?: string;
		size?: number;
	}>;
}

/**
 * Agent session status enumeration.
 */
export enum AgentSessionStatus {
	Pending = "pending",
	Active = "active",
	Error = "error",
	AwaitingInput = "awaiting-input",
	Complete = "complete",
}

/**
 * Agent session type/context enumeration.
 */
export enum AgentSessionType {
	CommentThread = "commentThread",
	Issue = "issue",
	Document = "document",
}

/**
 * Platform-agnostic agent session representation.
 */
export interface AgentSession {
	/** Unique agent session identifier */
	id: string;
	/** Issue ID this session belongs to */
	issueId: string;
	/** Comment ID this session is associated with */
	commentId?: string;
	/** Session status */
	status: AgentSessionStatus;
	/** Session type/context */
	type: AgentSessionType;
	/** Creator user ID */
	creatorId: string;
	/** Creator user object (may require async access) */
	creator?: User | Promise<User>;
	/** App/bot user ID */
	appUserId: string;
	/** Organization ID */
	organizationId: string;
	/** Session summary */
	summary?: string | null;
	/** Session start timestamp (ISO 8601) */
	startedAt?: string | null;
	/** Session end timestamp (ISO 8601) */
	endedAt?: string | null;
	/** Creation timestamp (ISO 8601) */
	createdAt: string;
	/** Last update timestamp (ISO 8601) */
	updatedAt: string;
	/** Archive timestamp (ISO 8601), null if not archived */
	archivedAt?: string | null;
	/** Source metadata (platform-specific) */
	sourceMetadata?: any;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Agent activity content type enumeration.
 */
export enum AgentActivityContentType {
	Prompt = "prompt",
	Observation = "observation",
	Action = "action",
	Error = "error",
	Elicitation = "elicitation",
	Response = "response",
	Thought = "thought",
}

/**
 * Agent activity content structure.
 * Matches Linear SDK's agentActivity.content structure with full expressiveness.
 */
export interface AgentActivityContent {
	/** Content type */
	type: AgentActivityContentType;
	/** Content body */
	body: string;
	/** Action name (for Action type activities) */
	action?: string;
	/** Action parameter (for Action type activities) */
	parameter?: any;
	/** Action result (for Action type activities) */
	result?: any;
}

/**
 * Agent activity signal enumeration.
 * Matches Linear SDK's AgentActivitySignal enum.
 */
export enum AgentActivitySignal {
	Auth = "auth",
	Continue = "continue",
	Select = "select",
	Stop = "stop",
}

/**
 * Platform-agnostic agent activity representation.
 */
export interface AgentActivity {
	/** Unique activity identifier */
	id: string;
	/** Agent session ID this activity belongs to */
	agentSessionId: string;
	/** Agent context ID (if applicable) */
	agentContextId?: string | null;
	/** Source comment ID (if applicable) */
	sourceCommentId?: string;
	/** Activity content */
	content: AgentActivityContent;
	/** Optional signal modifier (auth, continue, select, stop) */
	signal?: AgentActivitySignal;
	/** Signal metadata (additional context for the signal) */
	signalMetadata?: Record<string, any>;
	/** Whether this activity is ephemeral and should disappear after the next activity */
	ephemeral?: boolean;
	/** Creation timestamp (ISO 8601) */
	createdAt: string;
	/** Last update timestamp (ISO 8601) */
	updatedAt: string;
	/** Archive timestamp (ISO 8601), null if not archived */
	archivedAt?: string | null;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * File upload request parameters.
 */
export interface FileUploadRequest {
	/** MIME type of the file */
	contentType: string;
	/** File name */
	filename: string;
	/** File size in bytes */
	size: number;
	/** Whether to make the file publicly accessible */
	makePublic?: boolean;
}

/**
 * File upload response with URLs and headers.
 */
export interface FileUploadResponse {
	/** URL to upload the file to */
	uploadUrl: string;
	/** Headers to include in the upload request */
	headers: Record<string, string>;
	/** Asset URL to use in content after upload */
	assetUrl: string;
}

/**
 * Agent session creation input for issue-based sessions.
 */
export interface AgentSessionCreateOnIssueInput {
	/** Issue ID or identifier */
	issueId: string;
	/** Optional external link */
	externalLink?: string;
}

/**
 * Agent session creation input for comment-based sessions.
 */
export interface AgentSessionCreateOnCommentInput {
	/** Comment ID */
	commentId: string;
	/** Optional external link */
	externalLink?: string;
}

/**
 * Agent session creation response.
 */
export interface AgentSessionCreateResponse {
	/** Whether the creation was successful */
	success: boolean;
	/** Created agent session ID */
	agentSessionId: string;
	/** Last sync ID */
	lastSyncId: number;
}

/**
 * Issue update parameters.
 */
export interface IssueUpdateInput {
	/** New issue state ID */
	stateId?: string;
	/** New assignee ID */
	assigneeId?: string;
	/** New title */
	title?: string;
	/** New description */
	description?: string;
	/** New priority */
	priority?: IssuePriority;
	/** New parent ID */
	parentId?: string;
	/** Label IDs to set */
	labelIds?: string[];
	/** Additional platform-specific fields */
	[key: string]: any;
}

/**
 * Comment creation parameters.
 */
export interface CommentCreateInput {
	/** Comment body/content */
	body: string;
	/** Parent comment ID (for threaded comments) */
	parentId?: string;
	/** Additional platform-specific fields */
	[key: string]: any;
}

/**
 * Options for fetching child issues.
 */
export interface FetchChildrenOptions {
	/** Maximum number of children to fetch */
	limit?: number;
	/** Whether to include completed children */
	includeCompleted?: boolean;
	/** Whether to include archived children */
	includeArchived?: boolean;
	/** Additional filter options */
	filter?: FilterOptions;
}

/**
 * Platform configuration for authentication.
 */
export interface PlatformConfig {
	/** Platform type identifier */
	type: "linear" | "github" | string;
	/** Authentication token/API key */
	apiToken: string;
	/** User ID on the platform */
	userId?: string;
	/** User email on the platform */
	userEmail?: string;
	/** Organization/workspace ID */
	organizationId?: string;
	/** Additional platform-specific config */
	metadata?: Record<string, any>;
}

/**
 * Routing configuration for repository-based routing.
 */
export interface RoutingConfig {
	/** Team keys to route on */
	teamKeys?: string[];
	/** Project keys to route on */
	projectKeys?: string[];
	/** Label names to route on */
	routingLabels?: string[];
	/** Additional platform-specific routing */
	metadata?: Record<string, any>;
}

/**
 * Webhook verification mode.
 */
export enum WebhookVerificationMode {
	/** Verify using HMAC signature */
	Signature = "signature",
	/** Verify using Bearer token */
	BearerToken = "bearer-token",
}

/**
 * Webhook configuration.
 */
export interface WebhookConfig {
	/** Verification mode */
	verificationMode: WebhookVerificationMode;
	/** Webhook secret (for signature verification) */
	secret?: string;
	/** API key (for bearer token verification) */
	apiKey?: string;
	/** Webhook endpoint URL */
	endpointUrl?: string;
	/** Additional platform-specific config */
	metadata?: Record<string, any>;
}

/**
 * Guidance rule for agent behavior.
 */
export interface GuidanceRule {
	/** Rule identifier */
	id: string;
	/** Rule content */
	content: string;
	/** Rule scope (organization, team, etc.) */
	scope: "organization" | "team" | string;
	/** Additional platform-specific metadata */
	metadata?: Record<string, any>;
}

/**
 * Pagination connection for list results.
 */
export interface Connection<T> {
	/** Array of items */
	nodes: T[];
	/** Page info for cursor-based pagination */
	pageInfo?: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
		startCursor?: string;
		endCursor?: string;
	};
	/** Total count (if available) */
	totalCount?: number;
}

/**
 * Generic result type for operations.
 */
export interface OperationResult<T = any> {
	/** Whether the operation was successful */
	success: boolean;
	/** Result data */
	data?: T;
	/** Error message if operation failed */
	error?: string;
	/** Additional metadata */
	metadata?: Record<string, any>;
}
