/**
 * Type mappers to convert Linear SDK types to abstract IssueTracker types
 */

import type {
	Attachment as LinearAttachment,
	Comment as LinearComment,
	Issue as LinearIssue,
	IssueLabel as LinearLabel,
	User as LinearUser,
	WorkflowState as LinearWorkflowState,
} from "@linear/sdk";
import type {
	Comment,
	Issue,
	IssueAttachment,
	IssueState,
	Label,
	Member,
} from "cyrus-interfaces";

/**
 * Maps Linear WorkflowState to abstract IssueState
 */
export function mapLinearState(state: LinearWorkflowState): IssueState {
	return {
		type: state.type as IssueState["type"],
		name: state.name,
		id: state.id,
	};
}

/**
 * Maps Linear User to abstract Member
 */
export function mapLinearUser(user: LinearUser): Member {
	return {
		id: user.id,
		name: user.displayName || user.name,
		email: user.email,
		avatarUrl: user.avatarUrl,
	};
}

/**
 * Maps Linear IssueLabel to abstract Label
 */
export function mapLinearLabel(label: LinearLabel): Label {
	return {
		id: label.id,
		name: label.name,
		color: label.color,
		description: label.description,
	};
}

/**
 * Maps Linear Issue to abstract Issue
 * @param issue Linear issue object
 * @param state Fetched workflow state
 * @param assignee Fetched assignee (if any)
 * @param labels Fetched labels
 */
export async function mapLinearIssue(issue: LinearIssue): Promise<Issue> {
	// Fetch related data
	const state = await issue.state;
	const assignee = await issue.assignee;
	const labelsConnection = await issue.labels();
	const labels = labelsConnection?.nodes || [];
	const team = await issue.team;

	return {
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		description: issue.description || "",
		state: state
			? mapLinearState(state)
			: { type: "unstarted", name: "Unstarted" },
		priority: issue.priority,
		assignee: assignee ? mapLinearUser(assignee) : undefined,
		labels: labels.map(mapLinearLabel),
		url: issue.url,
		createdAt: issue.createdAt,
		updatedAt: issue.updatedAt,
		projectId: issue.projectId,
		teamId: team?.id,
	};
}

/**
 * Maps Linear Comment to abstract Comment
 */
export async function mapLinearComment(
	comment: LinearComment,
): Promise<Comment> {
	const user = await comment.user;
	const parent = comment.parent;
	const parentId = parent ? (await parent).id : undefined;

	return {
		id: comment.id,
		author: user ? mapLinearUser(user) : { id: "unknown", name: "Unknown" },
		content: comment.body,
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt,
		isRoot: !parent,
		parentId: parentId,
	};
}

/**
 * Maps Linear Attachment to abstract Attachment
 */
export function mapLinearAttachment(
	attachment: LinearAttachment,
): IssueAttachment {
	return {
		name: attachment.title || attachment.url,
		url: attachment.url,
		mimeType: attachment.metadata?.contentType,
		size: attachment.metadata?.size,
	};
}

/**
 * Converts abstract IssueState type to Linear workflow state type
 */
export function mapIssueStateType(stateType: IssueState["type"]): string {
	// Linear uses the same state types as our abstract interface
	return stateType;
}
