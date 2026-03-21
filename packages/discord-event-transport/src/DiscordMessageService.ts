/**
 * Service for posting messages to Discord channels.
 *
 * Uses the Discord REST API with a bot token to post messages,
 * create threads, and fetch channel messages.
 *
 * @see https://docs.discord.com/developers/resources/message
 */

/**
 * A single message from a Discord channel/thread
 */
export interface DiscordThreadMessage {
	/** Message snowflake ID */
	id: string;
	/** Author user ID */
	author_id: string;
	/** Author username */
	author_username: string;
	/** Whether the author is a bot */
	author_bot?: boolean;
	/** Message text content */
	content: string;
	/** ISO 8601 timestamp */
	timestamp: string;
}

/**
 * Parameters for fetching messages from a Discord channel
 */
export interface DiscordFetchMessagesParams {
	/** Discord Bot token */
	token: string;
	/** Channel ID to fetch messages from */
	channelId: string;
	/** Fetch messages after this message ID */
	after?: string;
	/** Fetch messages before this message ID */
	before?: string;
	/** Maximum number of messages to fetch (1-100, default 50) */
	limit?: number;
}

/**
 * Parameters for posting a message to Discord
 */
export interface DiscordPostMessageParams {
	/** Discord Bot token */
	token: string;
	/** Channel ID to post the message in */
	channelId: string;
	/** Message text content (max 2000 chars) */
	content: string;
	/** Message ID to reply to */
	messageReference?: string;
}

/**
 * Parameters for creating a thread in Discord
 */
export interface DiscordCreateThreadParams {
	/** Discord Bot token */
	token: string;
	/** Channel ID containing the message */
	channelId: string;
	/** Message ID to create thread from */
	messageId: string;
	/** Thread name */
	name: string;
}

/** Discord's maximum message content length */
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export class DiscordMessageService {
	private apiBaseUrl: string;

	constructor(apiBaseUrl?: string) {
		this.apiBaseUrl = apiBaseUrl ?? "https://discord.com/api/v10";
	}

	/**
	 * Post a message to a Discord channel.
	 *
	 * If content exceeds 2000 chars, it is split into multiple messages.
	 *
	 * @see https://docs.discord.com/developers/resources/message#create-message
	 */
	async postMessage(params: DiscordPostMessageParams): Promise<void> {
		const { token, channelId, content, messageReference } = params;

		const chunks = this.splitMessage(content);

		for (let i = 0; i < chunks.length; i++) {
			const body: Record<string, unknown> = { content: chunks[i] };

			// Only set message_reference on the first chunk
			if (i === 0 && messageReference) {
				body.message_reference = { message_id: messageReference };
			}

			const url = `${this.apiBaseUrl}/channels/${channelId}/messages`;

			const response = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bot ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(
					`[DiscordMessageService] Failed to post message: ${response.status} ${response.statusText} - ${errorBody}`,
				);
			}
		}
	}

	/**
	 * Create a thread from a message.
	 *
	 * @see https://docs.discord.com/developers/resources/channel#start-thread-from-message
	 */
	async createThread(
		params: DiscordCreateThreadParams,
	): Promise<{ id: string }> {
		const { token, channelId, messageId, name } = params;

		const url = `${this.apiBaseUrl}/channels/${channelId}/messages/${messageId}/threads`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bot ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: name.slice(0, 100) }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[DiscordMessageService] Failed to create thread: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		const responseBody = (await response.json()) as { id: string };
		return { id: responseBody.id };
	}

	/**
	 * Fetch messages from a Discord channel (for thread history).
	 *
	 * @see https://docs.discord.com/developers/resources/message#get-channel-messages
	 */
	async fetchMessages(
		params: DiscordFetchMessagesParams,
	): Promise<DiscordThreadMessage[]> {
		const { token, channelId, after, before, limit = 50 } = params;

		const queryParams = new URLSearchParams({
			limit: String(Math.min(limit, 100)),
		});
		if (after) queryParams.set("after", after);
		if (before) queryParams.set("before", before);

		const url = `${this.apiBaseUrl}/channels/${channelId}/messages?${queryParams.toString()}`;

		const response = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bot ${token}`,
			},
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[DiscordMessageService] Failed to fetch messages: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		const messages = (await response.json()) as Array<{
			id: string;
			author: { id: string; username: string; bot?: boolean };
			content: string;
			timestamp: string;
		}>;

		return messages.map((m) => ({
			id: m.id,
			author_id: m.author.id,
			author_username: m.author.username,
			author_bot: m.author.bot,
			content: m.content,
			timestamp: m.timestamp,
		}));
	}

	/**
	 * Get the bot's own user info.
	 *
	 * @see https://docs.discord.com/developers/resources/user#get-current-user
	 */
	async getIdentity(token: string): Promise<{ id: string; username: string }> {
		const url = `${this.apiBaseUrl}/users/@me`;

		const response = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bot ${token}`,
			},
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[DiscordMessageService] Failed to get identity: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		const user = (await response.json()) as { id: string; username: string };
		return { id: user.id, username: user.username };
	}

	/**
	 * Split a message into chunks that fit within Discord's 2000 char limit.
	 * Tries to split at newlines, then at spaces, then hard-cuts.
	 */
	private splitMessage(content: string): string[] {
		if (content.length <= DISCORD_MAX_MESSAGE_LENGTH) {
			return [content];
		}

		const chunks: string[] = [];
		let remaining = content;

		while (remaining.length > 0) {
			if (remaining.length <= DISCORD_MAX_MESSAGE_LENGTH) {
				chunks.push(remaining);
				break;
			}

			// Try to find a good split point
			let splitIndex = remaining.lastIndexOf("\n", DISCORD_MAX_MESSAGE_LENGTH);
			if (splitIndex <= 0) {
				splitIndex = remaining.lastIndexOf(" ", DISCORD_MAX_MESSAGE_LENGTH);
			}
			if (splitIndex <= 0) {
				splitIndex = DISCORD_MAX_MESSAGE_LENGTH;
			}

			chunks.push(remaining.slice(0, splitIndex));
			remaining = remaining.slice(splitIndex).trimStart();
		}

		return chunks;
	}
}
