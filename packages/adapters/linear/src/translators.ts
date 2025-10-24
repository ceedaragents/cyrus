import type { LinearDocument } from "@linear/sdk";
import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	LinearIssueAssignedWebhook,
	LinearIssueCommentMentionWebhook,
	LinearIssueNewCommentWebhook,
	LinearWebhook,
} from "cyrus-core";
import {
	isAgentSessionCreatedWebhook,
	isAgentSessionPromptedWebhook,
	isIssueAssignedWebhook,
	isIssueCommentMentionWebhook,
	isIssueNewCommentWebhook,
} from "cyrus-core";
import type {
	Activity,
	ActivityContent,
	WorkItem,
	WorkItemUpdate,
} from "cyrus-interfaces";

/**
 * Translates a Linear webhook payload to a WorkItem
 * Returns null if the webhook type is not supported or should be ignored
 */
export function translateWebhookToWorkItem(
	webhook: LinearWebhook,
): WorkItem | null {
	if (isIssueAssignedWebhook(webhook)) {
		return translateIssueAssignedWebhook(webhook);
	}

	if (isIssueCommentMentionWebhook(webhook)) {
		return translateIssueCommentMentionWebhook(webhook);
	}

	if (isIssueNewCommentWebhook(webhook)) {
		return translateIssueNewCommentWebhook(webhook);
	}

	if (isAgentSessionCreatedWebhook(webhook)) {
		return translateAgentSessionCreatedWebhook(webhook);
	}

	if (isAgentSessionPromptedWebhook(webhook)) {
		return translateAgentSessionPromptedWebhook(webhook);
	}

	// Unassignment and other webhook types are not translated to work items
	return null;
}

/**
 * Translates issue assignment webhook to task WorkItem
 */
function translateIssueAssignedWebhook(
	webhook: LinearIssueAssignedWebhook,
): WorkItem {
	const { notification } = webhook;
	const { issue, actor } = notification;

	return {
		id: issue.id,
		type: "task",
		title: issue.title,
		description: `Issue ${issue.identifier} assigned by ${actor.name}`,
		context: {
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			teamKey: issue.team.key,
			teamName: issue.team.name,
		},
		metadata: {
			source: "linear",
			assignee: actor.id,
			issueId: issue.id,
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			teamId: issue.teamId,
			teamKey: issue.team.key,
			organizationId: webhook.organizationId,
			oauthClientId: webhook.oauthClientId,
			webhookId: webhook.webhookId,
			webhookTimestamp: webhook.webhookTimestamp,
			notificationId: notification.id,
			actorId: actor.id,
			actorName: actor.name,
			actorEmail: actor.email,
		},
	};
}

/**
 * Translates comment mention webhook to command WorkItem
 */
function translateIssueCommentMentionWebhook(
	webhook: LinearIssueCommentMentionWebhook,
): WorkItem {
	const { notification } = webhook;
	const { issue, comment, actor } = notification;

	return {
		id: `${issue.id}-${comment.id}`,
		type: "command",
		title: `Mention in: ${issue.title}`,
		description: comment.body,
		context: {
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			commentId: comment.id,
			teamKey: issue.team.key,
			teamName: issue.team.name,
		},
		metadata: {
			source: "linear",
			assignee: actor.id,
			issueId: issue.id,
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			teamId: issue.teamId,
			teamKey: issue.team.key,
			commentId: comment.id,
			commentUserId: comment.userId,
			organizationId: webhook.organizationId,
			oauthClientId: webhook.oauthClientId,
			webhookId: webhook.webhookId,
			webhookTimestamp: webhook.webhookTimestamp,
			notificationId: notification.id,
			actorId: actor.id,
			actorName: actor.name,
			actorEmail: actor.email,
		},
	};
}

/**
 * Translates new comment webhook to conversation WorkItem
 */
function translateIssueNewCommentWebhook(
	webhook: LinearIssueNewCommentWebhook,
): WorkItem {
	const { notification } = webhook;
	const { issue, comment, actor, parentCommentId } = notification;

	return {
		id: `${issue.id}-${comment.id}`,
		type: "conversation",
		title: `Comment on: ${issue.title}`,
		description: comment.body,
		context: {
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			commentId: comment.id,
			parentCommentId: parentCommentId,
			teamKey: issue.team.key,
			teamName: issue.team.name,
		},
		metadata: {
			source: "linear",
			assignee: actor.id,
			issueId: issue.id,
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			teamId: issue.teamId,
			teamKey: issue.team.key,
			commentId: comment.id,
			commentUserId: comment.userId,
			parentCommentId: parentCommentId,
			organizationId: webhook.organizationId,
			oauthClientId: webhook.oauthClientId,
			webhookId: webhook.webhookId,
			webhookTimestamp: webhook.webhookTimestamp,
			notificationId: notification.id,
			actorId: actor.id,
			actorName: actor.name,
			actorEmail: actor.email,
		},
	};
}

/**
 * Translates agent session created webhook to conversation WorkItem
 */
function translateAgentSessionCreatedWebhook(
	webhook: LinearAgentSessionCreatedWebhook,
): WorkItem {
	const { agentSession } = webhook;
	const { issue, comment, creator } = agentSession;

	return {
		id: agentSession.id,
		type: "conversation",
		title: `Agent session: ${issue.title}`,
		description: comment.body,
		context: {
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			commentId: comment.id,
			agentSessionId: agentSession.id,
			agentSessionType: agentSession.type,
			agentSessionStatus: agentSession.status,
			teamKey: issue.team.key,
			teamName: issue.team.name,
			guidance: webhook.guidance,
		},
		metadata: {
			source: "linear",
			assignee: creator.id,
			issueId: issue.id,
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			teamId: issue.teamId,
			teamKey: issue.team.key,
			commentId: comment.id,
			agentSessionId: agentSession.id,
			organizationId: webhook.organizationId,
			oauthClientId: webhook.oauthClientId,
			webhookId: webhook.webhookId,
			webhookTimestamp: webhook.webhookTimestamp,
			creatorId: creator.id,
			creatorName: creator.name,
			creatorEmail: creator.email,
		},
	};
}

/**
 * Translates agent session prompted webhook to conversation WorkItem
 */
function translateAgentSessionPromptedWebhook(
	webhook: LinearAgentSessionPromptedWebhook,
): WorkItem {
	const { agentSession, agentActivity } = webhook;
	const { issue, comment, creator } = agentSession;

	return {
		id: `${agentSession.id}-${agentActivity.id}`,
		type: "conversation",
		title: `Feedback on: ${issue.title}`,
		description: agentActivity.content.body,
		context: {
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			commentId: comment.id,
			agentSessionId: agentSession.id,
			agentSessionType: agentSession.type,
			agentSessionStatus: agentSession.status,
			agentActivityId: agentActivity.id,
			agentActivityType: agentActivity.content.type,
			teamKey: issue.team.key,
			teamName: issue.team.name,
			guidance: webhook.guidance,
		},
		metadata: {
			source: "linear",
			assignee: creator.id,
			issueId: issue.id,
			issueIdentifier: issue.identifier,
			issueUrl: issue.url,
			teamId: issue.teamId,
			teamKey: issue.team.key,
			commentId: comment.id,
			agentSessionId: agentSession.id,
			agentActivityId: agentActivity.id,
			organizationId: webhook.organizationId,
			oauthClientId: webhook.oauthClientId,
			webhookId: webhook.webhookId,
			webhookTimestamp: webhook.webhookTimestamp,
			creatorId: creator.id,
			creatorName: creator.name,
			creatorEmail: creator.email,
		},
	};
}

/**
 * Translates a Cyrus Activity to Linear AgentActivityCreateInput
 */
export function translateActivityToLinear(
	activity: Activity,
	agentSessionId: string,
): LinearDocument.AgentActivityCreateInput {
	const content = translateActivityContent(activity);

	return {
		agentSessionId,
		content,
		ephemeral: false,
		// Include activity ID in metadata for tracking
		signalMetadata: {
			cyrusActivityId: activity.id,
			cyrusActivityTimestamp: activity.timestamp.toISOString(),
			...(activity.metadata || {}),
		},
	};
}

/**
 * Translates Activity content to Linear activity content format
 */
function translateActivityContent(
	activity: Activity,
): LinearDocument.AgentActivityCreateInput["content"] {
	const { type, content } = activity;

	switch (type) {
		case "thought":
			return {
				type: "thought",
				body: extractTextFromContent(content),
			};

		case "action":
			if (content.type === "tool_use") {
				return {
					type: "action",
					action: content.tool,
					parameter: JSON.stringify(content.input),
				};
			}
			return {
				type: "action",
				body: extractTextFromContent(content),
			};

		case "result":
			if (content.type === "tool_result") {
				return {
					type: "response",
					body: formatToolResult(content.tool, content.output),
				};
			}
			return {
				type: "response",
				body: extractTextFromContent(content),
			};

		case "error":
			if (content.type === "error") {
				const errorBody = content.stack
					? `${content.message}\n\nStack trace:\n${content.stack}`
					: content.message;
				return {
					type: "error",
					body: errorBody,
				};
			}
			return {
				type: "error",
				body: extractTextFromContent(content),
			};

		default:
			// Fallback: treat as thought
			return {
				type: "thought",
				body: extractTextFromContent(content),
			};
	}
}

/**
 * Extracts text content from various ActivityContent types
 */
function extractTextFromContent(content: ActivityContent): string {
	switch (content.type) {
		case "text":
			return content.text;
		case "code":
			return content.language
				? `\`\`\`${content.language}\n${content.code}\n\`\`\``
				: `\`\`\`\n${content.code}\n\`\`\``;
		case "tool_use":
			return `Tool: ${content.tool}\nInput: ${JSON.stringify(content.input, null, 2)}`;
		case "tool_result":
			return formatToolResult(content.tool, content.output);
		case "error":
			return content.stack
				? `${content.message}\n\nStack:\n${content.stack}`
				: content.message;
		default:
			return JSON.stringify(content);
	}
}

/**
 * Formats tool result for display
 */
function formatToolResult(tool: string, output: unknown): string {
	if (typeof output === "string") {
		return `Tool ${tool} result:\n${output}`;
	}
	return `Tool ${tool} result:\n${JSON.stringify(output, null, 2)}`;
}

/**
 * Translates WorkItemUpdate to Linear issue update operations
 * Returns update data that can be used with Linear SDK
 */
export function translateWorkItemUpdate(update: WorkItemUpdate): {
	stateUpdate?: { name: string };
	progressUpdate?: number;
	commentUpdate?: string;
} {
	const result: {
		stateUpdate?: { name: string };
		progressUpdate?: number;
		commentUpdate?: string;
	} = {};

	// Map status to Linear state names
	if (update.status) {
		const stateMap: Record<WorkItemUpdate["status"], string> = {
			active: "In Progress",
			paused: "Paused",
			completed: "Done",
			failed: "Canceled",
			cancelled: "Canceled",
		};
		const stateName = stateMap[update.status];
		if (stateName) result.stateUpdate = { name: stateName };
	}

	if (update.progress !== undefined) {
		result.progressUpdate = update.progress;
	}

	if (update.message) {
		result.commentUpdate = update.message;
	}

	return result;
}
