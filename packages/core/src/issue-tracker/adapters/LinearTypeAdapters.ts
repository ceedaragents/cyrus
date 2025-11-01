/**
 * Type adapters for transforming Linear SDK types to platform-agnostic types.
 *
 * This module provides utilities to convert Linear-specific types from @linear/sdk
 * into the platform-agnostic types defined in ../types.ts. This allows the rest of
 * the codebase to work with a consistent interface regardless of the underlying
 * issue tracking platform.
 *
 * @module issue-tracker/adapters/LinearTypeAdapters
 */

import type {
	Comment as LinearComment,
	Issue as LinearIssue,
	IssueLabel as LinearLabel,
	Team as LinearTeam,
	User as LinearUser,
	WorkflowState as LinearWorkflowState,
} from "@linear/sdk";
import { LinearDocument } from "@linear/sdk";
import type {
	AgentActivity,
	AgentActivityContent,
	AgentActivityContentType,
	AgentSession,
	Comment,
	Issue,
	IssueWithChildren,
	Label,
	Team,
	User,
	WorkflowState,
} from "../types.js";
import {
	AgentSessionStatus,
	AgentSessionType,
	IssuePriority,
	type WorkflowStateType,
} from "../types.js";

/**
 * Convert Linear AgentSessionStatus to platform-agnostic AgentSessionStatus.
 */
export function adaptLinearAgentSessionStatus(
	status: LinearDocument.AgentSessionStatus,
): AgentSessionStatus {
	// Map Linear status to our platform-agnostic status
	switch (status) {
		case LinearDocument.AgentSessionStatus.Pending:
			return AgentSessionStatus.Pending;
		case LinearDocument.AgentSessionStatus.Active:
			return AgentSessionStatus.Active;
		case LinearDocument.AgentSessionStatus.Error:
			return AgentSessionStatus.Error;
		case LinearDocument.AgentSessionStatus.AwaitingInput:
			return AgentSessionStatus.AwaitingInput;
		case LinearDocument.AgentSessionStatus.Complete:
			return AgentSessionStatus.Complete;
		default:
			// Fallback for unknown status
			return AgentSessionStatus.Pending;
	}
}

/**
 * Convert Linear AgentSessionType to platform-agnostic AgentSessionType.
 */
export function adaptLinearAgentSessionType(
	type: LinearDocument.AgentSessionType,
): AgentSessionType {
	// Map Linear type to our platform-agnostic type
	switch (type) {
		case LinearDocument.AgentSessionType.CommentThread:
			return AgentSessionType.CommentThread;
		default:
			// Fallback for unknown type
			return AgentSessionType.CommentThread;
	}
}

/**
 * Convert Linear WorkflowState to platform-agnostic WorkflowState.
 */
export function adaptLinearWorkflowState(
	state: LinearWorkflowState,
): WorkflowState {
	return {
		id: state.id,
		name: state.name,
		type: state.type as WorkflowStateType,
		color: state.color,
		position: state.position,
		metadata: {
			description: state.description,
		},
	};
}

/**
 * Convert Linear Team to platform-agnostic Team.
 */
export function adaptLinearTeam(team: LinearTeam): Team {
	return {
		id: team.id,
		key: team.key,
		name: team.name,
		metadata: {
			description: team.description,
			icon: team.icon,
			color: team.color,
		},
	};
}

/**
 * Convert Linear User to platform-agnostic User.
 */
export function adaptLinearUser(user: LinearUser): User {
	return {
		id: user.id,
		name: user.displayName || user.name,
		email: user.email,
		url: user.url,
		avatarUrl: user.avatarUrl,
		metadata: {
			admin: user.admin,
			active: user.active,
			guest: user.guest,
		},
	};
}

/**
 * Convert Linear IssueLabel to platform-agnostic Label.
 */
export function adaptLinearLabel(label: LinearLabel): Label {
	return {
		id: label.id,
		name: label.name,
		color: label.color,
		description: label.description,
		parentId: label.parentId,
		isGroup: label.isGroup,
		metadata: {},
	};
}

/**
 * Convert Linear Issue priority to platform-agnostic IssuePriority.
 */
export function adaptLinearPriority(priority: number): IssuePriority {
	// Linear uses 0-4 scale, same as our platform-agnostic enum
	switch (priority) {
		case 0:
			return IssuePriority.NoPriority;
		case 1:
			return IssuePriority.Urgent;
		case 2:
			return IssuePriority.High;
		case 3:
			return IssuePriority.Normal;
		case 4:
			return IssuePriority.Low;
		default:
			return IssuePriority.NoPriority;
	}
}

/**
 * Convert Linear Issue to platform-agnostic Issue.
 *
 * @remarks
 * Linear SDK uses async properties for relations (state, assignee, team).
 * This adapter preserves these as Promise values in the returned Issue object.
 * Callers must use `await issue.state` to access these properties.
 */
export async function adaptLinearIssue(issue: LinearIssue): Promise<Issue> {
	// Fetch async properties
	const state = await issue.state;
	const assignee = await issue.assignee;
	const team = await issue.team;
	const labels = await issue.labels?.();

	return {
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		description: issue.description ?? undefined,
		url: issue.url,
		teamId: issue.teamId ?? "",
		team: team ? adaptLinearTeam(team) : undefined,
		state: state ? adaptLinearWorkflowState(state) : undefined,
		assigneeId: issue.assigneeId,
		assignee: assignee ? adaptLinearUser(assignee) : undefined,
		labels: labels?.nodes ? labels.nodes.map(adaptLinearLabel) : undefined,
		priority: adaptLinearPriority(issue.priority),
		parentId: issue.parentId,
		createdAt: issue.createdAt.toISOString(),
		updatedAt: issue.updatedAt.toISOString(),
		archivedAt: issue.archivedAt?.toISOString() ?? null,
		metadata: {
			linearId: issue.id,
			branchName: issue.branchName,
			number: issue.number,
			estimate: issue.estimate,
			sortOrder: issue.sortOrder,
		},
	};
}

/**
 * Convert Linear Issue to platform-agnostic IssueWithChildren.
 *
 * @param issue - Linear issue object
 * @param children - Array of child Linear issues
 */
export async function adaptLinearIssueWithChildren(
	issue: LinearIssue,
	children: LinearIssue[],
): Promise<IssueWithChildren> {
	const baseIssue = await adaptLinearIssue(issue);
	const adaptedChildren = await Promise.all(children.map(adaptLinearIssue));

	return {
		...baseIssue,
		children: adaptedChildren,
		childCount: adaptedChildren.length,
	};
}

/**
 * Convert Linear Comment to platform-agnostic Comment.
 *
 * @remarks
 * Linear SDK uses async properties for relations (user, parent).
 * This adapter fetches these properties immediately.
 */
export async function adaptLinearComment(
	comment: LinearComment,
): Promise<Comment> {
	// Fetch async properties
	const user = await comment.user;
	const parent = await comment.parent;

	return {
		id: comment.id,
		body: comment.body ?? "",
		userId: comment.userId ?? "",
		user: user ? adaptLinearUser(user) : undefined,
		issueId: comment.issueId ?? "",
		parentId: parent?.id,
		parent: parent ? await adaptLinearComment(parent) : undefined,
		createdAt: comment.createdAt.toISOString(),
		updatedAt: comment.updatedAt.toISOString(),
		archivedAt: comment.archivedAt?.toISOString() ?? null,
		metadata: {
			linearId: comment.id,
			botActor: comment.botActor,
		},
	};
}

/**
 * Convert platform-agnostic AgentActivityContentType to Linear activity content type.
 */
export function toLinearActivityContentType(
	type: AgentActivityContentType,
): string {
	// Linear uses the same type names
	return type;
}

/**
 * Convert platform-agnostic AgentActivityContent to Linear activity content format.
 */
export function toLinearActivityContent(content: AgentActivityContent): {
	type: string;
	body: string;
} {
	return {
		type: toLinearActivityContentType(content.type),
		body: content.body,
	};
}

/**
 * Convert Linear agent session data to platform-agnostic AgentSession.
 *
 * @param sessionData - Raw agent session data from Linear GraphQL response
 */
export function adaptLinearAgentSession(sessionData: any): AgentSession {
	return {
		id: sessionData.id,
		issueId: sessionData.issueId,
		commentId: sessionData.commentId,
		status: adaptLinearAgentSessionStatus(sessionData.status),
		type: adaptLinearAgentSessionType(sessionData.type),
		creatorId: sessionData.creatorId,
		creator: sessionData.creator
			? {
					id: sessionData.creator.id,
					name: sessionData.creator.name,
					email: sessionData.creator.email,
					url: sessionData.creator.url,
					avatarUrl: sessionData.creator.avatarUrl,
				}
			: undefined,
		appUserId: sessionData.appUserId,
		organizationId: sessionData.organizationId,
		summary: sessionData.summary ?? null,
		startedAt: sessionData.startedAt ?? null,
		endedAt: sessionData.endedAt ?? null,
		createdAt: sessionData.createdAt,
		updatedAt: sessionData.updatedAt,
		archivedAt: sessionData.archivedAt ?? null,
		sourceMetadata: sessionData.sourceMetadata,
		metadata: {
			linearSessionId: sessionData.id,
		},
	};
}

/**
 * Convert Linear agent activity data to platform-agnostic AgentActivity.
 *
 * @param activityData - Raw agent activity data from Linear GraphQL response
 */
export function adaptLinearAgentActivity(activityData: any): AgentActivity {
	return {
		id: activityData.id,
		agentSessionId: activityData.agentSessionId,
		agentContextId: activityData.agentContextId ?? null,
		sourceCommentId: activityData.sourceCommentId,
		content: {
			type: activityData.content.type as AgentActivityContentType,
			body: activityData.content.body,
		},
		signal: activityData.signal,
		createdAt: activityData.createdAt,
		updatedAt: activityData.updatedAt,
		archivedAt: activityData.archivedAt ?? null,
		metadata: {
			linearActivityId: activityData.id,
		},
	};
}
