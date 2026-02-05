/**
 * Types for Discord bot integration with Cyrus.
 *
 * This module defines the types needed to integrate Discord as an event source
 * for Cyrus agent sessions. Discord messages and interactions are translated
 * into agent events that the EdgeWorker can process.
 *
 * @module discord-bot/types
 */

import type { FastifyInstance } from "fastify";

/**
 * Configuration for the Discord bot.
 */
export interface DiscordBotConfig {
	/** Discord bot token (from Discord Developer Portal) */
	botToken: string;

	/** Discord application ID */
	applicationId: string;

	/**
	 * Guild IDs where the bot should operate.
	 * If empty, the bot will respond in all guilds it's a member of.
	 */
	guildIds?: string[];

	/**
	 * Channel IDs where the bot should listen for messages.
	 * If empty, the bot will listen in all channels it has access to.
	 */
	channelIds?: string[];

	/**
	 * Prefix for slash commands (e.g., "/cyrus").
	 * @default "cyrus"
	 */
	commandPrefix?: string;

	/**
	 * Whether to respond to direct mentions (@Cyrus).
	 * @default true
	 */
	respondToMentions?: boolean;

	/**
	 * Whether to create threads for each conversation.
	 * @default true
	 */
	useThreads?: boolean;
}

/**
 * Configuration for Discord event transport.
 */
export interface DiscordEventTransportConfig {
	/** Fastify server instance to register optional HTTP endpoints */
	fastifyServer?: FastifyInstance;

	/** Discord bot configuration */
	botConfig: DiscordBotConfig;
}

/**
 * Events emitted by Discord event transport.
 */
export interface DiscordEventTransportEvents {
	/** Emitted when an agent session should be created (new conversation) */
	sessionCreate: (event: DiscordSessionCreateEvent) => void;

	/** Emitted when a user sends a message to an existing session */
	sessionPrompt: (event: DiscordSessionPromptEvent) => void;

	/** Emitted when a session should be ended (user ends conversation) */
	sessionEnd: (event: DiscordSessionEndEvent) => void;

	/** Emitted when an error occurs */
	error: (error: Error) => void;

	/** Emitted when the bot is ready */
	ready: () => void;
}

/**
 * Discord-specific session creation event.
 * Contains information needed to start a new Cyrus session.
 */
export interface DiscordSessionCreateEvent {
	/** Type identifier */
	type: "discord_session_create";

	/** Unique session identifier (Discord message or thread ID) */
	sessionId: string;

	/** Discord guild (server) ID */
	guildId: string;

	/** Discord channel ID */
	channelId: string;

	/** Discord thread ID (if conversation is in a thread) */
	threadId?: string;

	/** Discord user who initiated the session */
	user: DiscordUser;

	/** Initial message content */
	content: string;

	/** Message attachments (images, files) */
	attachments?: DiscordAttachment[];

	/** Timestamp of the message */
	timestamp: Date;

	/** Original Discord message ID */
	messageId: string;
}

/**
 * Discord-specific session prompt event.
 * Contains a follow-up message in an existing session.
 */
export interface DiscordSessionPromptEvent {
	/** Type identifier */
	type: "discord_session_prompt";

	/** Session identifier this prompt belongs to */
	sessionId: string;

	/** Discord guild ID */
	guildId: string;

	/** Discord channel ID */
	channelId: string;

	/** Discord thread ID */
	threadId?: string;

	/** Discord user who sent the prompt */
	user: DiscordUser;

	/** Message content */
	content: string;

	/** Message attachments */
	attachments?: DiscordAttachment[];

	/** Timestamp of the message */
	timestamp: Date;

	/** Original Discord message ID */
	messageId: string;
}

/**
 * Discord-specific session end event.
 */
export interface DiscordSessionEndEvent {
	/** Type identifier */
	type: "discord_session_end";

	/** Session identifier being ended */
	sessionId: string;

	/** Reason for ending the session */
	reason: "user_request" | "timeout" | "error" | "channel_deleted";

	/** Discord user who ended the session (if applicable) */
	user?: DiscordUser;

	/** Timestamp */
	timestamp: Date;
}

/**
 * Discord user information.
 */
export interface DiscordUser {
	/** Discord user ID */
	id: string;

	/** Username */
	username: string;

	/** Display name (nickname in guild or global display name) */
	displayName: string;

	/** Discriminator (legacy, usually "0" now) */
	discriminator: string;

	/** Avatar URL */
	avatarUrl?: string;

	/** Whether the user is a bot */
	isBot: boolean;
}

/**
 * Discord message attachment.
 */
export interface DiscordAttachment {
	/** Attachment ID */
	id: string;

	/** File name */
	filename: string;

	/** File URL */
	url: string;

	/** Proxy URL (for caching) */
	proxyUrl: string;

	/** File size in bytes */
	size: number;

	/** MIME content type */
	contentType?: string;

	/** Width (for images) */
	width?: number;

	/** Height (for images) */
	height?: number;
}

/**
 * Response to be sent back to Discord.
 */
export interface DiscordResponse {
	/** Content to send */
	content: string;

	/** Whether this is a "thinking" indicator */
	isThinking?: boolean;

	/** Whether to send as an embed */
	asEmbed?: boolean;

	/** Embed color (hex) */
	embedColor?: string;

	/** Files to attach */
	files?: Array<{
		name: string;
		data: Buffer | string;
		contentType?: string;
	}>;
}

/**
 * Session state tracked by the Discord bot.
 */
export interface DiscordSessionState {
	/** Session ID */
	sessionId: string;

	/** Guild ID */
	guildId: string;

	/** Channel ID */
	channelId: string;

	/** Thread ID (if using threads) */
	threadId?: string;

	/** User who created the session */
	creatorId: string;

	/** When the session was created */
	createdAt: Date;

	/** When the session was last active */
	lastActivityAt: Date;

	/** Whether the session is active */
	isActive: boolean;

	/** Last message ID for reference */
	lastMessageId?: string;
}
