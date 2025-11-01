/**
 * Abstraction layer for platform-agnostic Linear operations
 * This module defines interfaces for all Linear operations used in the codebase
 * Implementations (Linear SDK, mocks, etc.) must implement these interfaces
 */

import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

/**
 * AgentEvent is a platform-agnostic type alias for webhook payloads
 * Replaces direct references to LinearWebhookPayload throughout the codebase
 */
export type AgentEvent = LinearWebhookPayload;

/**
 * Minimal issue data needed by the application
 */
export interface IssueData {
	id: string;
	identifier: string;
	title: string;
	teamId: string;
	team: {
		id: string;
		key: string;
		name: string;
	};
	url: string;
}

/**
 * Comment data
 */
export interface CommentData {
	id: string;
	body: string;
	userId: string;
	issueId: string;
}

/**
 * File upload result
 */
export interface FileUploadResult {
	success: boolean;
	assetUrl?: string;
	filename?: string;
	size?: number;
	contentType?: string;
	error?: string;
}

/**
 * Agent session creation result
 */
export interface AgentSessionCreateResult {
	success: boolean;
	agentSessionId?: string;
	lastSyncId?: string;
	error?: string;
}

/**
 * Child issue data
 */
export interface ChildIssueData {
	id: string;
	identifier: string;
	title: string;
	state: string;
	stateType: string | null;
	assignee: string | null;
	assigneeId: string | null;
	priority: number;
	priorityLabel: string;
	createdAt: string;
	updatedAt: string;
	url: string;
	archivedAt: string | null;
}

/**
 * Options for getting child issues
 */
export interface GetChildIssuesOptions {
	limit?: number;
	includeCompleted?: boolean;
	includeArchived?: boolean;
}

/**
 * Abstract interface for issue operations
 * Implementations must handle actual Linear SDK calls
 */
export interface IIssueAdapter {
	/**
	 * Fetch an issue by ID or identifier
	 */
	getIssue(issueId: string): Promise<IssueData | null>;

	/**
	 * Get child issues (sub-issues) of a parent issue
	 */
	getChildIssues(
		issueId: string,
		options?: GetChildIssuesOptions,
	): Promise<ChildIssueData[]>;
}

/**
 * Abstract interface for comment operations
 */
export interface ICommentAdapter {
	/**
	 * Fetch a comment by ID
	 */
	getComment(commentId: string): Promise<CommentData | null>;
}

/**
 * Agent session status type - platform agnostic
 */
export type AgentSessionStatus =
	| "pending"
	| "active"
	| "error"
	| "awaiting-input"
	| "complete";

/**
 * Abstract interface for agent session operations
 * Handles all agent session lifecycle operations with Linear
 */
export interface IAgentSessionAdapter {
	/**
	 * Create an agent session on an issue
	 */
	createSessionOnIssue(
		issueId: string,
		externalLink?: string,
	): Promise<AgentSessionCreateResult>;

	/**
	 * Create an agent session on a comment
	 */
	createSessionOnComment(
		commentId: string,
		externalLink?: string,
	): Promise<AgentSessionCreateResult>;

	/**
	 * Update agent session status
	 */
	updateSessionStatus(
		sessionId: string,
		status: string,
		metadata?: Record<string, any>,
	): Promise<void>;

	/**
	 * Post agent activity to a session
	 */
	postAgentActivity(
		sessionId: string,
		content: string,
		contentType:
			| "prompt"
			| "observation"
			| "action"
			| "error"
			| "elicitation"
			| "response",
	): Promise<void>;

	/**
	 * Upload a file for use in Linear
	 */
	uploadFile(
		filePath: string,
		filename?: string,
		contentType?: string,
		makePublic?: boolean,
	): Promise<FileUploadResult>;

	/**
	 * Give feedback to a child agent session
	 */
	giveFeedback(sessionId: string, message: string): Promise<void>;
}

/**
 * Combined adapter interface that includes all operations
 */
export interface IAgentPlatformAdapter
	extends IIssueAdapter,
		ICommentAdapter,
		IAgentSessionAdapter {}

/**
 * Configuration for creating adapters
 */
export interface AdapterConfig {
	apiToken: string;
	[key: string]: any;
}
