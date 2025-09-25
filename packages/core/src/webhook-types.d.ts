/**
 * Linear webhook types based on actual webhook payloads
 * These are the exact structures Linear sends in webhooks
 */
/**
 * Linear team data from webhooks
 */
export interface LinearWebhookTeam {
	id: string;
	key: string;
	name: string;
}
/**
 * Linear issue data from webhooks
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
 * Linear comment data from webhooks
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
 * Base notification structure common to all webhook notifications
 */
export interface LinearWebhookNotificationBase {
	id: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
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
 * Issue unassignment notification
 */
export interface LinearIssueUnassignedNotification
	extends LinearWebhookNotificationBase {
	type: "issueUnassignedFromYou";
	actorId: string;
	externalUserActorId: string | null;
	userId: string;
	issueId: string;
	issue: LinearWebhookIssue;
	actor: LinearWebhookActor;
}
/**
 * Union of all notification types
 */
export type LinearWebhookNotification =
	| LinearIssueAssignedNotification
	| LinearIssueCommentMentionNotification
	| LinearIssueNewCommentNotification
	| LinearIssueUnassignedNotification;
/**
 * Issue assignment webhook payload
 */
export interface LinearIssueAssignedWebhook {
	type: "AppUserNotification";
	action: "issueAssignedToYou";
	createdAt: string;
	organizationId: string;
	oauthClientId: string;
	appUserId: string;
	notification: LinearIssueAssignedNotification;
	webhookTimestamp: number;
	webhookId: string;
}
/**
 * Issue comment mention webhook payload
 */
export interface LinearIssueCommentMentionWebhook {
	type: "AppUserNotification";
	action: "issueCommentMention";
	createdAt: string;
	organizationId: string;
	oauthClientId: string;
	appUserId: string;
	notification: LinearIssueCommentMentionNotification;
	webhookTimestamp: number;
	webhookId: string;
}
/**
 * Issue new comment webhook payload
 */
export interface LinearIssueNewCommentWebhook {
	type: "AppUserNotification";
	action: "issueNewComment";
	createdAt: string;
	organizationId: string;
	oauthClientId: string;
	appUserId: string;
	notification: LinearIssueNewCommentNotification;
	webhookTimestamp: number;
	webhookId: string;
}
/**
 * Issue unassignment webhook payload
 */
export interface LinearIssueUnassignedWebhook {
	type: "AppUserNotification";
	action: "issueUnassignedFromYou";
	createdAt: string;
	organizationId: string;
	oauthClientId: string;
	appUserId: string;
	notification: LinearIssueUnassignedNotification;
	webhookTimestamp: number;
	webhookId: string;
}
/**
 * Creator data in agent session webhooks
 */
export interface LinearWebhookCreator {
	id: string;
	name: string;
	email: string;
	avatarUrl: string;
	url: string;
}
/**
 * Agent Session data from webhooks
 */
export interface LinearWebhookAgentSession {
	id: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
	creatorId: string;
	appUserId: string;
	commentId: string;
	issueId: string;
	status: "pending" | "active" | "error" | "awaiting-input" | "complete";
	startedAt: string | null;
	endedAt: string | null;
	type: "commentThread";
	summary: string | null;
	sourceMetadata: any | null;
	organizationId: string;
	creator: LinearWebhookCreator;
	comment: LinearWebhookComment;
	issue: LinearWebhookIssue;
}
/**
 * Agent Activity content types
 */
export interface LinearWebhookAgentActivityContent {
	type:
		| "prompt"
		| "observation"
		| "action"
		| "error"
		| "elicitation"
		| "response";
	body: string;
}
/**
 * Agent Activity data from webhooks
 */
export interface LinearWebhookAgentActivity {
	id: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
	agentContextId: string | null;
	agentSessionId: string;
	sourceCommentId: string;
	content: LinearWebhookAgentActivityContent;
	signal?: "stop";
}
/**
 * Agent Session created webhook payload
 */
export interface LinearAgentSessionCreatedWebhook {
	type: "AgentSessionEvent";
	action: "created";
	createdAt: string;
	organizationId: string;
	oauthClientId: string;
	appUserId: string;
	agentSession: LinearWebhookAgentSession;
	webhookTimestamp: string;
	webhookId: string;
}
/**
 * Agent Session prompted webhook payload
 */
export interface LinearAgentSessionPromptedWebhook {
	type: "AgentSessionEvent";
	action: "prompted";
	createdAt: string;
	organizationId: string;
	oauthClientId: string;
	appUserId: string;
	agentSession: LinearWebhookAgentSession;
	agentActivity: LinearWebhookAgentActivity;
	webhookTimestamp: string;
	webhookId: string;
}
/**
 * Union of all webhook types we handle
 */
export type LinearWebhook =
	| LinearIssueAssignedWebhook
	| LinearIssueCommentMentionWebhook
	| LinearIssueNewCommentWebhook
	| LinearIssueUnassignedWebhook
	| LinearAgentSessionCreatedWebhook
	| LinearAgentSessionPromptedWebhook;
/**
 * Type guards for webhook discrimination
 */
export declare function isIssueAssignedWebhook(
	webhook: LinearWebhook,
): webhook is LinearIssueAssignedWebhook;
export declare function isIssueCommentMentionWebhook(
	webhook: LinearWebhook,
): webhook is LinearIssueCommentMentionWebhook;
export declare function isIssueNewCommentWebhook(
	webhook: LinearWebhook,
): webhook is LinearIssueNewCommentWebhook;
export declare function isIssueUnassignedWebhook(
	webhook: LinearWebhook,
): webhook is LinearIssueUnassignedWebhook;
export declare function isAgentSessionCreatedWebhook(
	webhook: LinearWebhook,
): webhook is LinearAgentSessionCreatedWebhook;
export declare function isAgentSessionPromptedWebhook(
	webhook: LinearWebhook,
): webhook is LinearAgentSessionPromptedWebhook;
//# sourceMappingURL=webhook-types.d.ts.map
