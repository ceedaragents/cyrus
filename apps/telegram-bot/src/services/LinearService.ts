import { LinearClient } from "@linear/sdk";

export interface CreateIssueParams {
	teamId: string;
	title: string;
	description: string;
	assigneeId?: string;
}

export interface CreatedIssue {
	id: string;
	identifier: string;
	url: string;
	title: string;
}

export interface IssueStatus {
	stateType: string;
	stateName: string;
}

export interface ActivityItem {
	id: string;
	body: string;
	createdAt: Date;
	authorName: string;
}

export class LinearService {
	private client: LinearClient;

	constructor(apiToken: string) {
		this.client = new LinearClient({ accessToken: apiToken });
	}

	/** Create a new issue and optionally assign to Cyrus. */
	async createIssue(params: CreateIssueParams): Promise<CreatedIssue> {
		const payload = await this.client.createIssue({
			teamId: params.teamId,
			title: params.title,
			description: params.description,
			assigneeId: params.assigneeId,
		});
		const issue = await payload.issue;
		if (!issue) {
			throw new Error("Failed to create issue");
		}
		return {
			id: issue.id,
			identifier: issue.identifier,
			url: issue.url,
			title: issue.title,
		};
	}

	/** Add a comment to an existing issue. */
	async addComment(issueId: string, body: string): Promise<void> {
		await this.client.createComment({ issueId, body });
	}

	/** Fetch issue state to check if completed/canceled. */
	async getIssueStatus(issueId: string): Promise<IssueStatus> {
		const issue = await this.client.issue(issueId);
		const state = await issue.state;
		return {
			stateType: state?.type ?? "unknown",
			stateName: state?.name ?? "Unknown",
		};
	}

	/** Fetch recent comments on an issue since a given timestamp. */
	async getRecentComments(
		issueId: string,
		afterTimestamp: number,
		excludeUserId?: string,
	): Promise<ActivityItem[]> {
		const issue = await this.client.issue(issueId);
		const comments = await issue.comments({ first: 10 });

		const results: ActivityItem[] = [];
		for (const comment of comments.nodes) {
			if (new Date(comment.createdAt).getTime() <= afterTimestamp) {
				continue;
			}
			const user = await comment.user;
			// Skip comments from the user who is chatting via Telegram
			// (their follow-ups are already visible to them)
			if (excludeUserId && user?.id === excludeUserId) {
				continue;
			}
			results.push({
				id: comment.id,
				body: comment.body,
				createdAt: new Date(comment.createdAt),
				authorName: user?.name ?? "Unknown",
			});
		}
		return results;
	}

	/** Detect the current user's ID from the API token. */
	async detectCurrentUserId(): Promise<string> {
		const viewer = await this.client.viewer;
		return viewer.id;
	}
}
