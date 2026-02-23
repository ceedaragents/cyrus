import { createRequire } from "node:module";

/**
 * Minimal interface for a Mixpanel-compatible track client.
 * Exported for dependency injection in tests.
 */
export interface TrackClient {
	track(
		event: string,
		properties?: Record<string, unknown>,
		callback?: (err: Error | undefined) => void,
	): void;
}

/**
 * Create a Mixpanel client from a token.
 * Isolated so the service can be constructed with a mock client in tests.
 */
function createMixpanelClient(token: string): TrackClient {
	const require = createRequire(import.meta.url);
	const Mixpanel: { init(token: string): TrackClient } = require("mixpanel");
	return Mixpanel.init(token);
}

/**
 * Properties for the "Agent Assigned to Issue" event.
 * Fired when a user assigns an agent to a Linear issue.
 */
export interface AgentAssignedProperties {
	/** Linear organization/workspace ID */
	organizationId: string;
	/** Linear issue ID */
	issueId: string;
	/** Linear issue identifier (e.g., "CYPACK-123") */
	issueIdentifier: string;
	/** Issue title */
	issueTitle: string;
	/** Linear team ID */
	teamId: string;
	/** User ID who assigned the agent */
	userId: string;
	/** User name who assigned the agent */
	userName?: string;
	/** User email who assigned the agent */
	userEmail?: string;
	/** Repository ID routed to */
	repositoryId?: string;
	/** Repository name routed to */
	repositoryName?: string;
}

/**
 * Properties for the "PR Merged" event.
 * Fired when a PR created by the agent is merged.
 */
export interface PRMergedProperties {
	/** GitHub repository full name (e.g., "owner/repo") */
	repositoryFullName: string;
	/** PR number */
	prNumber: number;
	/** PR title */
	prTitle: string;
	/** Branch name that was merged */
	branchName: string;
	/** The user who merged the PR */
	mergedBy?: string;
	/** Linear organization/workspace ID (if known) */
	organizationId?: string;
	/** Cyrus repository config ID (if matched) */
	repositoryId?: string;
}

/**
 * Analytics event names tracked by Cyrus.
 */
export const AnalyticsEvents = {
	AGENT_ASSIGNED: "Agent Assigned to Issue",
	PR_MERGED: "PR Merged",
} as const;

/**
 * AnalyticsService - Tracks product analytics events via Mixpanel.
 *
 * Requires the MIXPANEL_TOKEN environment variable to be set.
 * When the token is not set, all tracking calls are silently no-ops,
 * so it's safe to use in development without Mixpanel configured.
 */
export class AnalyticsService {
	private client: TrackClient | null = null;

	constructor(options?: { token?: string; client?: TrackClient }) {
		if (options?.client) {
			this.client = options.client;
			return;
		}
		const mixpanelToken = options?.token ?? process.env.MIXPANEL_TOKEN;
		if (mixpanelToken) {
			this.client = createMixpanelClient(mixpanelToken);
		}
	}

	/**
	 * Whether analytics tracking is enabled (Mixpanel token is configured).
	 */
	get enabled(): boolean {
		return this.client !== null;
	}

	/**
	 * Track when a user assigns an agent to a Linear issue.
	 * The distinct_id is the Linear organization ID, enabling per-workspace funnels.
	 */
	trackAgentAssigned(properties: AgentAssignedProperties): void {
		if (!this.client) return;

		this.client.track(AnalyticsEvents.AGENT_ASSIGNED, {
			distinct_id: properties.organizationId,
			issue_id: properties.issueId,
			issue_identifier: properties.issueIdentifier,
			issue_title: properties.issueTitle,
			team_id: properties.teamId,
			user_id: properties.userId,
			user_name: properties.userName,
			user_email: properties.userEmail,
			repository_id: properties.repositoryId,
			repository_name: properties.repositoryName,
		});
	}

	/**
	 * Track when a PR created by the agent is merged.
	 * The distinct_id is the organization ID if available, otherwise the repository full name.
	 */
	trackPRMerged(properties: PRMergedProperties): void {
		if (!this.client) return;

		this.client.track(AnalyticsEvents.PR_MERGED, {
			distinct_id: properties.organizationId ?? properties.repositoryFullName,
			repository_full_name: properties.repositoryFullName,
			pr_number: properties.prNumber,
			pr_title: properties.prTitle,
			branch_name: properties.branchName,
			merged_by: properties.mergedBy,
			organization_id: properties.organizationId,
			repository_id: properties.repositoryId,
		});
	}
}
