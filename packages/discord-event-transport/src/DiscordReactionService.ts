/**
 * Service for adding reactions to Discord messages.
 *
 * Uses the Discord REST API with a bot token to add emoji reactions,
 * typically used to acknowledge receipt of @mention messages.
 *
 * @see https://docs.discord.com/developers/resources/message#create-reaction
 */

/**
 * Parameters for adding a reaction to a Discord message
 */
export interface DiscordAddReactionParams {
	/** Discord Bot token */
	token: string;
	/** Channel ID where the message is */
	channelId: string;
	/** Message ID to react to */
	messageId: string;
	/** Unicode emoji or custom emoji in format name:id */
	emoji: string;
}

export class DiscordReactionService {
	private apiBaseUrl: string;

	constructor(apiBaseUrl?: string) {
		this.apiBaseUrl = apiBaseUrl ?? "https://discord.com/api/v10";
	}

	/**
	 * Add a reaction to a Discord message.
	 *
	 * @see https://docs.discord.com/developers/resources/message#create-reaction
	 */
	async addReaction(params: DiscordAddReactionParams): Promise<void> {
		const { token, channelId, messageId, emoji } = params;

		// Encode the emoji for the URL path
		const encodedEmoji = encodeURIComponent(emoji);
		const url = `${this.apiBaseUrl}/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`;

		const response = await fetch(url, {
			method: "PUT",
			headers: {
				Authorization: `Bot ${token}`,
			},
		});

		if (!response.ok) {
			// 400 can happen if emoji is invalid — don't throw for reaction failures
			if (response.status === 400) {
				return;
			}
			const errorBody = await response.text();
			throw new Error(
				`[DiscordReactionService] Failed to add reaction: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
	}
}
