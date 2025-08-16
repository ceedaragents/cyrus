/**
 * Type guards for Linear SDK webhook types
 */

import type {
	LinearWebhookPayload,
	AgentSessionEventWebhookPayload,
	AppUserNotificationWebhookPayloadWithNotification,
	EntityWebhookPayloadWithIssueData,
	EntityWebhookPayloadWithCommentData,
} from "@linear/sdk/webhooks";

/**
 * Check if webhook is an AgentSessionEvent webhook
 */
export function isAgentSessionEventWebhook(
	webhook: LinearWebhookPayload,
): webhook is AgentSessionEventWebhookPayload {
	return webhook.type === "AgentSessionEvent";
}

/**
 * Check if webhook is an AgentSessionEvent with 'created' action
 */
export function isAgentSessionCreatedWebhook(
	webhook: LinearWebhookPayload,
): webhook is AgentSessionEventWebhookPayload {
	return webhook.type === "AgentSessionEvent" && webhook.action === "created";
}

/**
 * Check if webhook is an AgentSessionEvent with 'prompted' action
 */
export function isAgentSessionPromptedWebhook(
	webhook: LinearWebhookPayload,
): webhook is AgentSessionEventWebhookPayload {
	return webhook.type === "AgentSessionEvent" && webhook.action === "prompted";
}

/**
 * Check if webhook is an AppUserNotification webhook
 */
export function isAppUserNotificationWebhook(
	webhook: LinearWebhookPayload,
): webhook is AppUserNotificationWebhookPayloadWithNotification {
	return webhook.type === "AppUserNotification";
}

/**
 * Check if webhook is an Issue assigned notification
 */
export function isIssueAssignedWebhook(
	webhook: LinearWebhookPayload,
): webhook is AppUserNotificationWebhookPayloadWithNotification {
	return (
		webhook.type === "AppUserNotification" &&
		webhook.action === "issueAssignedToYou"
	);
}

/**
 * Check if webhook is an Issue unassigned notification
 */
export function isIssueUnassignedWebhook(
	webhook: LinearWebhookPayload,
): webhook is AppUserNotificationWebhookPayloadWithNotification {
	return (
		webhook.type === "AppUserNotification" &&
		webhook.action === "issueUnassignedFromYou"
	);
}

/**
 * Check if webhook is an Issue comment mention notification
 */
export function isIssueCommentMentionWebhook(
	webhook: LinearWebhookPayload,
): webhook is AppUserNotificationWebhookPayloadWithNotification {
	return (
		webhook.type === "AppUserNotification" &&
		webhook.action === "issueCommentMention"
	);
}

/**
 * Check if webhook is an Issue new comment notification
 */
export function isIssueNewCommentWebhook(
	webhook: LinearWebhookPayload,
): webhook is AppUserNotificationWebhookPayloadWithNotification {
	return (
		webhook.type === "AppUserNotification" &&
		webhook.action === "issueNewComment"
	);
}

/**
 * Check if webhook is an Issue status changed notification
 */
export function isIssueStatusChangedWebhook(
	webhook: LinearWebhookPayload,
): webhook is AppUserNotificationWebhookPayloadWithNotification {
	return (
		webhook.type === "AppUserNotification" &&
		webhook.action === "issueStatusChanged"
	);
}

/**
 * Check if webhook is an Issue entity webhook (create/update/remove)
 */
export function isIssueEntityWebhook(
	webhook: LinearWebhookPayload,
): webhook is EntityWebhookPayloadWithIssueData {
	return webhook.type === "Issue";
}

/**
 * Check if webhook is a Comment entity webhook (create/update/remove)
 */
export function isCommentEntityWebhook(
	webhook: LinearWebhookPayload,
): webhook is EntityWebhookPayloadWithCommentData {
	return webhook.type === "Comment";
}