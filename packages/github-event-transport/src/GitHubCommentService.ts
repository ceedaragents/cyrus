/**
 * Service for posting comments back to GitHub PR conversations.
 *
 * Uses the GitHub REST API with an installation access token
 * to post replies on PR issue comments and PR review comments.
 */

export interface GitHubCommentServiceConfig {
	/** GitHub API base URL (default: https://api.github.com) */
	apiBaseUrl?: string;
}

/**
 * Parameters for posting a reply to a GitHub PR comment
 */
export interface PostCommentParams {
	/** GitHub installation access token */
	token: string;
	/** Repository owner */
	owner: string;
	/** Repository name */
	repo: string;
	/** PR/Issue number */
	issueNumber: number;
	/** Comment body (markdown) */
	body: string;
}

/**
 * Parameters for posting a reply to a PR review comment
 */
export interface PostReviewCommentReplyParams {
	/** GitHub installation access token */
	token: string;
	/** Repository owner */
	owner: string;
	/** Repository name */
	repo: string;
	/** Pull request number */
	pullNumber: number;
	/** The ID of the review comment to reply to */
	commentId: number;
	/** Reply body (markdown) */
	body: string;
}

/**
 * Response from GitHub API after creating a comment
 */
export interface GitHubCommentResponse {
	id: number;
	html_url: string;
	body: string;
}

/**
 * Parameters for adding a reaction to a GitHub comment
 */
export interface AddReactionParams {
	/** GitHub installation access token */
	token: string;
	/** Repository owner */
	owner: string;
	/** Repository name */
	repo: string;
	/** The ID of the comment to react to */
	commentId: number;
	/** Whether this is a PR review comment (vs an issue comment) */
	isPullRequestReviewComment: boolean;
	/** Reaction content (e.g. "eyes", "+1", "heart") */
	content: string;
}

/** The hidden HTML comment used to identify Cyrus-authored PRs */
export const CYRUS_PR_MARKER = "<!-- generated-by-cyrus -->";

export class GitHubCommentService {
	private apiBaseUrl: string;

	constructor(config?: GitHubCommentServiceConfig) {
		this.apiBaseUrl = config?.apiBaseUrl ?? "https://api.github.com";
	}

	/**
	 * Post a comment on a PR/Issue (top-level comment).
	 * Used for replying to issue_comment webhooks.
	 *
	 * @see https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
	 */
	async postIssueComment(
		params: PostCommentParams,
	): Promise<GitHubCommentResponse> {
		const { token, owner, repo, issueNumber, body } = params;
		const url = `${this.apiBaseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({ body }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitHubCommentService] Failed to post issue comment: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return (await response.json()) as GitHubCommentResponse;
	}

	/**
	 * Post a reply to a PR review comment (inline reply).
	 * Used for replying to pull_request_review_comment webhooks.
	 *
	 * @see https://docs.github.com/en/rest/pulls/comments#create-a-reply-for-a-review-comment
	 */
	async postReviewCommentReply(
		params: PostReviewCommentReplyParams,
	): Promise<GitHubCommentResponse> {
		const { token, owner, repo, pullNumber, commentId, body } = params;
		const url = `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/${pullNumber}/comments/${commentId}/replies`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({ body }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitHubCommentService] Failed to post review comment reply: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return (await response.json()) as GitHubCommentResponse;
	}

	/**
	 * Add a reaction to a comment.
	 *
	 * @see https://docs.github.com/en/rest/reactions/reactions#create-reaction-for-an-issue-comment
	 * @see https://docs.github.com/en/rest/reactions/reactions#create-reaction-for-a-pull-request-review-comment
	 */
	async addReaction(params: AddReactionParams): Promise<void> {
		const {
			token,
			owner,
			repo,
			commentId,
			isPullRequestReviewComment,
			content,
		} = params;

		const segment = isPullRequestReviewComment ? "pulls" : "issues";
		const url = `${this.apiBaseUrl}/repos/${owner}/${repo}/${segment}/comments/${commentId}/reactions`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({ content }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitHubCommentService] Failed to add reaction: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
	}

	/**
	 * Find an open pull request for a given head branch.
	 *
	 * @see https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
	 */
	async findPullRequestByBranch(params: {
		token: string;
		owner: string;
		repo: string;
		branch: string;
	}): Promise<{ number: number; body: string | null } | null> {
		const { token, owner, repo, branch } = params;
		const url = `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open&per_page=1`;

		const response = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitHubCommentService] Failed to list PRs: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		const prs = (await response.json()) as Array<{
			number: number;
			body: string | null;
		}>;
		return prs[0] ?? null;
	}

	/**
	 * Update a pull request body.
	 *
	 * @see https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request
	 */
	async updatePullRequestBody(params: {
		token: string;
		owner: string;
		repo: string;
		pullNumber: number;
		body: string;
	}): Promise<void> {
		const { token, owner, repo, pullNumber, body } = params;
		const url = `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/${pullNumber}`;

		const response = await fetch(url, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({ body }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitHubCommentService] Failed to update PR body: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
	}

	/**
	 * Ensure the Cyrus attribution marker is present in a PR body.
	 * If the PR exists and the marker is missing, appends it.
	 *
	 * @returns true if the marker was added, false if already present or no PR found
	 */
	async ensureCyrusMarker(params: {
		token: string;
		owner: string;
		repo: string;
		branch: string;
	}): Promise<boolean> {
		const pr = await this.findPullRequestByBranch(params);
		if (!pr) return false;

		const body = pr.body ?? "";
		if (body.includes(CYRUS_PR_MARKER)) return false;

		const updatedBody = body.trim()
			? `${body}\n\n${CYRUS_PR_MARKER}`
			: CYRUS_PR_MARKER;

		await this.updatePullRequestBody({
			token: params.token,
			owner: params.owner,
			repo: params.repo,
			pullNumber: pr.number,
			body: updatedBody,
		});

		return true;
	}
}
