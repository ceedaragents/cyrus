/**
 * Service for adding emoji reactions to Slack messages.
 *
 * Uses the Slack Web API `reactions.add` method.
 */

/**
 * Parameters for adding a reaction to a Slack message.
 */
export interface SlackAddReactionParams {
	/** Slack Bot OAuth token */
	token: string;
	/** Channel ID containing the target message */
	channel: string;
	/** Message timestamp to react to */
	timestamp: string;
	/** Emoji name without colons (e.g. "eyes") */
	name: string;
}

export class SlackReactionService {
	private apiBaseUrl: string;

	constructor(apiBaseUrl?: string) {
		this.apiBaseUrl = apiBaseUrl ?? "https://slack.com/api";
	}

	/**
	 * Add an emoji reaction to a Slack message.
	 *
	 * @see https://api.slack.com/methods/reactions.add
	 */
	async addReaction(params: SlackAddReactionParams): Promise<void> {
		const { token, channel, timestamp, name } = params;
		const url = `${this.apiBaseUrl}/reactions.add`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				channel,
				timestamp,
				name,
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[SlackReactionService] Failed to add reaction: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		// Slack API returns HTTP 200 for logical errors; validate body.
		const responseBody = (await response.json()) as {
			ok: boolean;
			error?: string;
		};

		// Adding the same reaction twice can legitimately return already_reacted.
		if (!responseBody.ok && responseBody.error !== "already_reacted") {
			throw new Error(
				`[SlackReactionService] Slack API error: ${responseBody.error ?? "unknown"}`,
			);
		}
	}
}
