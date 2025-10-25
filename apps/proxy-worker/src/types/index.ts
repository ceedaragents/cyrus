export interface Env {
	// KV Namespaces
	OAUTH_TOKENS: KVNamespace;
	OAUTH_STATE: KVNamespace;
	EDGE_TOKENS: KVNamespace;
	WORKSPACE_METADATA: KVNamespace;

	// Durable Objects
	EVENT_STREAM: DurableObjectNamespace;

	// Secrets (use wrangler secret put)
	LINEAR_CLIENT_ID: string;
	LINEAR_CLIENT_SECRET: string;
	LINEAR_WEBHOOK_SECRET: string;
	ENCRYPTION_KEY: string;

	// Environment variables
	PROXY_URL: string;
	SIMULATE_DISCONNECT?: string;
	DISCONNECT_AFTER_MS?: string;
}

export interface OAuthToken {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	obtainedAt: number;
	scope: string[];
	tokenType: string;
	userId: string;
	userEmail?: string;
	workspaceName?: string;
}

export interface EncryptedOAuthToken
	extends Omit<OAuthToken, "accessToken" | "refreshToken"> {
	accessToken: string; // encrypted
	refreshToken?: string; // encrypted
	iv: string;
}

export interface OAuthState {
	createdAt: number;
	redirectUri: string;
	metadata?: any;
}

export interface EdgeToken {
	workspaceIds: string[];
	createdAt: number;
	lastUsed: number;
	name?: string;
	permissions: string[];
}

export interface WorkspaceMetadata {
	id: string;
	name: string;
	urlKey: string;
	organizationId: string;
	teams: Array<{
		id: string;
		name: string;
		key: string;
	}>;
}

/**
 * Linear webhook notification types
 */
export type LinearNotificationType =
	| "issueAssignedToYou"
	| "issueCommentMention"
	| "issueNewComment"
	| "issueUnassignedFromYou"
	| "issueCommentReply";

/**
 * Linear webhook action types (top-level action field)
 */
export type LinearWebhookAction =
	| "issueAssignedToYou"
	| "issueCommentMention"
	| "issueNewComment"
	| "issueUnassignedFromYou"
	| "issueCommentReply";

/**
 * Linear team data from webhooks
 */
export interface LinearWebhookTeam {
	id: string;
	key: string;
	name: string;
}

/**
 * Linear issue data from webhooks (NOT the full Linear SDK Issue object)
 */
export interface LinearWebhookIssue {
	id: string;
	title: string;
	teamId: string;
	team: LinearWebhookTeam;
	identifier: string;
	url: string;
}

/**
 * Linear comment data from webhooks (NOT the full Linear SDK Comment object)
 */
export interface LinearWebhookComment {
	id: string;
	body: string;
	userId: string;
	issueId: string;
}

/**
 * Linear actor (user) data from webhooks
 */
export interface LinearWebhookActor {
	id: string;
	name: string;
	email: string;
	url: string;
}

/**
 * Base Linear notification structure
 */
export interface LinearWebhookNotificationBase {
	id: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
	type: LinearNotificationType;
	actorId: string;
	externalUserActorId: string | null;
	userId: string;
	issueId: string;
	issue: LinearWebhookIssue;
	actor: LinearWebhookActor;
}

/**
 * Issue assignment notification
 */
export interface LinearIssueAssignedNotification
	extends LinearWebhookNotificationBase {
	type: "issueAssignedToYou";
}

/**
 * Issue comment mention notification
 */
export interface LinearIssueCommentMentionNotification
	extends LinearWebhookNotificationBase {
	type: "issueCommentMention";
	commentId: string;
	comment: LinearWebhookComment;
}

/**
 * Issue new comment notification (can have parent comment for replies)
 */
export interface LinearIssueNewCommentNotification
	extends LinearWebhookNotificationBase {
	type: "issueNewComment";
	commentId: string;
	comment: LinearWebhookComment;
	parentCommentId?: string;
	parentComment?: LinearWebhookComment;
}

/**
 * Union of all notification types
 */
export type LinearWebhookNotification =
	| LinearIssueAssignedNotification
	| LinearIssueCommentMentionNotification
	| LinearIssueNewCommentNotification;

/**
 * Complete Linear webhook payload structure
 */
export interface LinearWebhook {
	type: "AppUserNotification";
	action: LinearWebhookAction;
	createdAt: string;
	organizationId: string;
	oauthClientId: string;
	appUserId: string;
	notification: LinearWebhookNotification;
	webhookTimestamp: number;
	webhookId: string;
}

export interface EdgeEvent {
	id: string;
	type: "webhook" | "connection" | "heartbeat" | "error";
	timestamp: string;
	data?: any;
	status?: string;
	reason?: string;
	error?: string;
}
