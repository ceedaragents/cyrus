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

// ============================================================================
// TYPE ALIASES - Linear SDK is the source of truth
// ============================================================================

/**
 * Issue type - Direct alias to Linear SDK's Issue type.
 * Linear SDK is the source of truth for all issue tracking types.
 *
 * @see {@link LinearSDK.Issue} - Linear's complete Issue type
 */
export type Issue = LinearSDK.Issue;

/**
 * Comment type - Direct alias to Linear SDK's Comment type.
 *
 * @see {@link LinearSDK.Comment} - Linear's complete Comment type
 */
export type Comment = LinearSDK.Comment;

/**
 * Label type - Direct alias to Linear SDK's IssueLabel type.
 *
 * @see {@link LinearSDK.IssueLabel} - Linear's complete IssueLabel type
 */
export type Label = LinearSDK.IssueLabel;

/**
 * Team type - Direct alias to Linear SDK's Team type.
 *
 * @see {@link LinearSDK.Team} - Linear's complete Team type
 */
export type Team = LinearSDK.Team;

/**
 * User type - Direct alias to Linear SDK's User type.
 *
 * @see {@link LinearSDK.User} - Linear's complete User type
 */
export type User = LinearSDK.User;

/**
 * WorkflowState type - Direct alias to Linear SDK's WorkflowState type.
 *
 * @see {@link LinearSDK.WorkflowState} - Linear's complete WorkflowState type
 */
export type WorkflowState = LinearSDK.WorkflowState;

// ============================================================================
// FILTER AND PAGINATION OPTIONS
// ============================================================================

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
 * Note: This extends Issue but overrides the children property from a method to an array.
 */
export interface IssueWithChildren extends Omit<Issue, "children"> {
	/** Child/sub-issues */
	children: Issue[];
	/** Total count of children */
	childCount: number;
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
 * Agent session type - Direct alias to Linear SDK's AgentSession type.
 * Linear SDK is the source of truth for all agent session tracking types.
 *
 * @see {@link LinearSDK.LinearDocument.AgentSession} - Linear's complete AgentSession type
 */
export type AgentSession = LinearSDK.LinearDocument.AgentSession;

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
 * Agent activity content type - Direct alias to Linear SDK's AgentActivityContent type.
 * Linear SDK is the source of truth.
 *
 * @see {@link LinearSDK.LinearDocument.AgentActivityContent} - Linear's complete AgentActivityContent type
 */
export type AgentActivityContent =
	LinearSDK.LinearDocument.AgentActivityContent;

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
 * Agent activity type - Direct alias to Linear SDK's AgentActivity type.
 * Linear SDK is the source of truth for all agent activity tracking types.
 *
 * @see {@link LinearSDK.LinearDocument.AgentActivity} - Linear's complete AgentActivity type
 */
export type AgentActivity = LinearSDK.LinearDocument.AgentActivity;

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
 * Guidance rule type - Direct alias to Linear SDK's GuidanceRuleWebhookPayload type.
 * Linear SDK is the source of truth for guidance/agent behavior rules.
 *
 * @see {@link LinearSDK.LinearDocument.GuidanceRuleWebhookPayload} - Linear's complete GuidanceRuleWebhookPayload type
 */
export type GuidanceRule = LinearSDK.LinearDocument.GuidanceRuleWebhookPayload;

/**
 * Pagination connection for list results.
 * Based on Linear SDK's Connection pattern with PageInfo.
 * Linear SDK is the source of truth for pagination patterns.
 *
 * @see {@link LinearSDK.LinearDocument.PageInfo} - Linear's PageInfo type
 */
export interface Connection<T> {
	/** Array of items */
	nodes: T[];
	/** Page info for cursor-based pagination (from Linear SDK) */
	pageInfo?: LinearSDK.LinearDocument.PageInfo;
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
