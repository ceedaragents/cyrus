/**
 * Service for posting comments (notes) back to GitLab MR conversations.
 *
 * Uses the GitLab REST API v4 with a personal or project access token
 * to post notes on merge requests and reply to discussion threads.
 */

export interface GitLabCommentServiceConfig {
	/** GitLab API base URL (default: https://gitlab.com) */
	apiBaseUrl?: string;
	/** Optional function to scrub sensitive content before posting. */
	scrubContent?: (text: string) => string;
}

/**
 * Parameters for posting a note on a GitLab MR
 */
export interface PostMRNoteParams {
	/** GitLab access token */
	token: string;
	/** Project ID (numeric) */
	projectId: number;
	/** MR iid (project-scoped ID) */
	mrIid: number;
	/** Note body (markdown) */
	body: string;
}

/**
 * Parameters for posting a reply to a discussion thread
 */
export interface PostDiscussionReplyParams {
	/** GitLab access token */
	token: string;
	/** Project ID (numeric) */
	projectId: number;
	/** MR iid (project-scoped ID) */
	mrIid: number;
	/** Discussion ID to reply to */
	discussionId: string;
	/** Reply body (markdown) */
	body: string;
}

/**
 * Parameters for adding an award emoji (reaction) to a note
 */
export interface AddAwardEmojiParams {
	/** GitLab access token */
	token: string;
	/** Project ID (numeric) */
	projectId: number;
	/** MR iid (project-scoped ID) */
	mrIid: number;
	/** Note ID to react to */
	noteId: number;
	/** Emoji name (e.g., "eyes", "thumbsup", "heart") */
	name: string;
}

/**
 * Response from GitLab API after creating a note
 */
export interface GitLabNoteResponse {
	id: number;
	body: string;
	created_at: string;
	author: {
		id: number;
		username: string;
		name: string;
	};
}

export class GitLabCommentService {
	private apiBaseUrl: string;
	private scrubContent: ((text: string) => string) | undefined;

	constructor(config?: GitLabCommentServiceConfig) {
		this.apiBaseUrl = config?.apiBaseUrl ?? "https://gitlab.com";
		this.scrubContent = config?.scrubContent;
	}

	/**
	 * Post a note (comment) on a merge request.
	 *
	 * @see https://docs.gitlab.com/ee/api/notes.html#create-new-merge-request-note
	 */
	async postMRNote(params: PostMRNoteParams): Promise<GitLabNoteResponse> {
		const { token, projectId, mrIid, body } = params;
		const scrubbedBody = this.scrubContent ? this.scrubContent(body) : body;
		const url = `${this.apiBaseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"PRIVATE-TOKEN": token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ body: scrubbedBody }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitLabCommentService] Failed to post MR note: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return (await response.json()) as GitLabNoteResponse;
	}

	/**
	 * Post a reply to a discussion thread on a merge request.
	 *
	 * @see https://docs.gitlab.com/ee/api/discussions.html#add-note-to-existing-merge-request-thread
	 */
	async postDiscussionReply(
		params: PostDiscussionReplyParams,
	): Promise<GitLabNoteResponse> {
		const { token, projectId, mrIid, discussionId, body } = params;
		const scrubbedBody = this.scrubContent ? this.scrubContent(body) : body;
		const url = `${this.apiBaseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}/notes`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"PRIVATE-TOKEN": token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ body: scrubbedBody }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitLabCommentService] Failed to post discussion reply: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return (await response.json()) as GitLabNoteResponse;
	}

	/**
	 * Add an award emoji (reaction) to a note on a merge request.
	 *
	 * @see https://docs.gitlab.com/ee/api/award_emoji.html#award-a-new-emoji-on-a-note
	 */
	async addAwardEmoji(params: AddAwardEmojiParams): Promise<void> {
		const { token, projectId, mrIid, noteId, name } = params;
		const url = `${this.apiBaseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}/award_emoji`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"PRIVATE-TOKEN": token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitLabCommentService] Failed to add award emoji: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
	}
}
