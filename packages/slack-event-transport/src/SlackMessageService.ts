/**
 * Service for posting messages to Slack channels.
 *
 * Uses the Slack Web API with a bot token to post messages,
 * typically used to reply to @mention webhooks in a thread.
 */

/**
 * Parameters for posting a message to Slack
 */
export interface SlackPostMessageParams {
	/** Slack Bot OAuth token */
	token: string;
	/** Channel ID to post the message in */
	channel: string;
	/** Message text */
	text: string;
	/** Thread timestamp to reply in a thread */
	thread_ts?: string;
}

export class SlackMessageService {
	private apiBaseUrl: string;

	constructor(apiBaseUrl?: string) {
		this.apiBaseUrl = apiBaseUrl ?? "https://slack.com/api";
	}

	/**
	 * Post a message to a Slack channel.
	 *
	 * @see https://api.slack.com/methods/chat.postMessage
	 */
	async postMessage(params: SlackPostMessageParams): Promise<void> {
		const { token, channel, text, thread_ts } = params;

		const url = `${this.apiBaseUrl}/chat.postMessage`;

		const body: Record<string, string> = { channel, text };
		if (thread_ts) {
			body.thread_ts = thread_ts;
		}

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[SlackMessageService] Failed to post message: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		// Slack API returns HTTP 200 even for errors — check the response body
		const responseBody = (await response.json()) as {
			ok: boolean;
			error?: string;
		};
		if (!responseBody.ok) {
			throw new Error(
				`[SlackMessageService] Slack API error: ${responseBody.error ?? "unknown"}`,
			);
		}
	}
}
