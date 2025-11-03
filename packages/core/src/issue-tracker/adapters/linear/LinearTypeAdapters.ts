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

import { LinearDocument } from "@linear/sdk";
import type {
	AgentActivity,
	AgentActivityContent,
	AgentActivityContentType,
	AgentSession,
} from "../../types.js";
import {
	type AgentActivitySignal,
	AgentSessionStatus,
	AgentSessionType,
} from "../../types.js";

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
 * Raw Linear GraphQL agent session data structure.
 */
export interface LinearAgentSessionData {
	id: string;
	issueId: string;
	commentId?: string | null;
	status: LinearDocument.AgentSessionStatus;
	type: LinearDocument.AgentSessionType;
	creatorId: string;
	creator?: {
		id: string;
		name: string;
		email: string;
		url: string;
		avatarUrl?: string | null;
	} | null;
	appUserId: string;
	organizationId: string;
	summary?: string | null;
	startedAt?: string | null;
	endedAt?: string | null;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string | null;
	sourceMetadata?: Record<string, unknown> | null;
}

/**
 * Raw Linear GraphQL agent activity content structure.
 */
export interface LinearAgentActivityContentData {
	type: string;
	body: string;
}

/**
 * Raw Linear GraphQL agent activity data structure.
 */
export interface LinearAgentActivityData {
	id: string;
	agentSessionId: string;
	agentContextId?: string | null;
	sourceCommentId?: string;
	content: LinearAgentActivityContentData;
	signal?: AgentActivitySignal;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string | null;
}

/**
 * Convert Linear agent session data to platform-agnostic AgentSession.
 *
 * @param sessionData - Raw agent session data from Linear GraphQL response
 */
export function adaptLinearAgentSession(
	sessionData: LinearAgentSessionData,
): AgentSession {
	return {
		id: sessionData.id,
		issueId: sessionData.issueId,
		commentId: sessionData.commentId ?? undefined,
		status: adaptLinearAgentSessionStatus(sessionData.status),
		type: adaptLinearAgentSessionType(sessionData.type),
		creatorId: sessionData.creatorId,
		// Note: creator field omitted - would need to fetch full User from Linear SDK
		// if needed. The creatorId is sufficient for most use cases.
		appUserId: sessionData.appUserId,
		organizationId: sessionData.organizationId,
		summary: sessionData.summary ?? null,
		startedAt: sessionData.startedAt ?? null,
		endedAt: sessionData.endedAt ?? null,
		createdAt: sessionData.createdAt,
		updatedAt: sessionData.updatedAt,
		archivedAt: sessionData.archivedAt ?? null,
		sourceMetadata: sessionData.sourceMetadata ?? undefined,
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
export function adaptLinearAgentActivity(
	activityData: LinearAgentActivityData,
): AgentActivity {
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
