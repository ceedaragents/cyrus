/**
 * Linear webhook types based on actual webhook payloads
 * These are the exact structures Linear sends in webhooks
 */
/**
 * Type guards for webhook discrimination
 */
export function isIssueAssignedWebhook(webhook) {
	return webhook.action === "issueAssignedToYou";
}
export function isIssueCommentMentionWebhook(webhook) {
	return webhook.action === "issueCommentMention";
}
export function isIssueNewCommentWebhook(webhook) {
	return webhook.action === "issueNewComment";
}
export function isIssueUnassignedWebhook(webhook) {
	return webhook.action === "issueUnassignedFromYou";
}
export function isAgentSessionCreatedWebhook(webhook) {
	return webhook.type === "AgentSessionEvent" && webhook.action === "created";
}
export function isAgentSessionPromptedWebhook(webhook) {
	return webhook.type === "AgentSessionEvent" && webhook.action === "prompted";
}
//# sourceMappingURL=webhook-types.js.map
