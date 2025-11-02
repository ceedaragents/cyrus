/**
 * Platform-agnostic types for issue tracking platforms.
 *
 * These types provide simplified interfaces that match Linear SDK GraphQL types structure.
 * Linear SDK is the source of truth - these types are designed to be compatible subsets
 * of Linear's types, omitting implementation-specific fields while maintaining core
 * data structure compatibility.
 *
 * Following the pattern from AgentEvent.ts, we reference Linear SDK types via JSDoc
 * and re-export Linear enums where they exist. This makes Linear the "source of truth"
 * while keeping interfaces manageable.
 *
 * @module issue-tracker/types
 * @see {@link https://linear.app/docs/graphql/api|Linear GraphQL API Documentation}
 */

import type * as LinearSDK from "@linear/sdk";

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
	[key: string]: unknown;
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
 *
 * This interface is a simplified subset of Linear's Team GraphQL type,
 * containing only the core fields needed for issue tracking operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.Team} - Linear's complete Team type
 */
export interface Team {
	/** Unique team identifier */
	id: string;
	/** Short team key (e.g., "CEA") */
	key: string;
	/** Human-readable team name */
	name: string;
	/** Additional platform-specific metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Platform-agnostic user/actor representation.
 *
 * This interface is a simplified subset of Linear's User GraphQL type,
 * containing only the core fields needed for issue tracking operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.User} - Linear's complete User type
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
	metadata?: Record<string, unknown>;
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
 *
 * This interface is a simplified subset of Linear's WorkflowState GraphQL type,
 * containing only the core fields needed for issue tracking operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.WorkflowState} - Linear's complete WorkflowState type
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
	metadata?: Record<string, unknown>;
}

/**
 * Platform-agnostic label representation.
 *
 * This interface is a simplified subset of Linear's IssueLabel GraphQL type,
 * containing only the core fields needed for issue tracking operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.IssueLabel} - Linear's complete IssueLabel type
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
	metadata?: Record<string, unknown>;
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
 *
 * This interface is a simplified subset of Linear's Issue GraphQL type,
 * containing only the core fields needed for issue tracking operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.Issue} - Linear's complete Issue type
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
	labels?: Label[];
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
	metadata?: Record<string, unknown>;
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
 *
 * This interface is a simplified subset of Linear's Comment GraphQL type,
 * containing only the core fields needed for issue tracking operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.Comment} - Linear's complete Comment type
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
	metadata?: Record<string, unknown>;
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
 *
 * Re-exported from Linear SDK. Linear SDK is the source of truth.
 * Note: Linear uses "awaitingInput" while we historically used "awaiting-input".
 * We now use Linear's enum directly for consistency.
 *
 * @see {@link LinearSDK.AgentSessionStatus} - Linear's AgentSessionStatus enum
 */
import { AgentSessionStatus } from "@linear/sdk";
export { AgentSessionStatus };
export type { AgentSessionStatus as AgentSessionStatusEnum } from "@linear/sdk";

/**
 * Agent session type/context enumeration.
 *
 * Re-exported from Linear SDK. Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.AgentSessionType} - Linear's AgentSessionType enum
 */
import { AgentSessionType } from "@linear/sdk";
export { AgentSessionType };
export type { AgentSessionType as AgentSessionTypeEnum } from "@linear/sdk";

/**
 * Platform-agnostic agent session representation.
 *
 * This interface is a simplified subset of Linear's AgentSession GraphQL type,
 * containing only the core fields needed for agent session operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.AgentSession} - Linear's complete AgentSession type
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
	sourceMetadata?: Record<string, unknown>;
	/** Additional platform-specific metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Agent activity type enumeration.
 *
 * Re-exported from Linear SDK. Linear SDK is the source of truth.
 * This is aliased as AgentActivityContentType for backward compatibility.
 *
 * @see {@link LinearSDK.AgentActivityType} - Linear's AgentActivityType enum
 */
import { AgentActivityType } from "@linear/sdk";
export { AgentActivityType };
export type { AgentActivityType as AgentActivityTypeEnum } from "@linear/sdk";

/**
 * Legacy alias for AgentActivityType.
 * @deprecated Use AgentActivityType instead
 */
export const AgentActivityContentType = AgentActivityType;
export type AgentActivityContentType = AgentActivityType;

/**
 * Agent activity content structure.
 *
 * This is a simplified structure matching Linear SDK's agentActivity.content.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.AgentActivityContent} - Linear's complete AgentActivityContent type
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
 *
 * Re-exported from Linear SDK. Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.AgentActivitySignal} - Linear's AgentActivitySignal enum
 */
import { AgentActivitySignal } from "@linear/sdk";
export { AgentActivitySignal };
export type { AgentActivitySignal as AgentActivitySignalEnum } from "@linear/sdk";

/**
 * Platform-agnostic agent activity representation.
 *
 * This interface is a simplified subset of Linear's AgentActivity GraphQL type,
 * containing only the core fields needed for agent activity operations.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.AgentActivity} - Linear's complete AgentActivity type
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
	metadata?: Record<string, unknown>;
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
	[key: string]: unknown;
}

/**
 * Comment creation parameters.
 */
export interface CommentCreateInput {
	/** Comment body/content */
	body: string;
	/** Parent comment ID (for threaded comments) */
	parentId?: string;
	/**
	 * Asset URLs to attach to the comment (Linear-specific).
	 * These URLs should be obtained from `requestFileUpload()` + upload workflow.
	 * The URLs will be automatically embedded in the comment body as markdown images/links.
	 */
	attachmentUrls?: string[];
	/** Additional platform-specific fields */
	[key: string]: unknown;
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
	metadata?: Record<string, unknown>;
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
	metadata?: Record<string, unknown>;
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
	metadata?: Record<string, unknown>;
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
	metadata?: Record<string, unknown>;
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
export interface OperationResult<T = unknown> {
	/** Whether the operation was successful */
	success: boolean;
	/** Result data */
	data?: T;
	/** Error message if operation failed */
	error?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}
