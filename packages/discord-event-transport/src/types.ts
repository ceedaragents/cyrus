/**
 * Types for Discord event transport
 */

import type { InternalMessage } from "cyrus-core";

// ============================================================================
// Gateway Event Types
// ============================================================================

/**
 * Discord Gateway opcodes
 * @see https://docs.discord.com/developers/topics/opcodes-and-status-codes#gateway-opcodes
 */
export enum GatewayOpcode {
	/** Server → Client: An event was dispatched */
	Dispatch = 0,
	/** Client → Server: Heartbeat */
	Heartbeat = 1,
	/** Client → Server: Identify */
	Identify = 2,
	/** Client → Server: Presence Update */
	PresenceUpdate = 3,
	/** Client → Server: Voice State Update */
	VoiceStateUpdate = 4,
	/** Client → Server: Resume */
	Resume = 6,
	/** Server → Client: Reconnect */
	Reconnect = 7,
	/** Client → Server: Request Guild Members */
	RequestGuildMembers = 8,
	/** Server → Client: Invalid Session */
	InvalidSession = 9,
	/** Server → Client: Hello */
	Hello = 10,
	/** Server → Client: Heartbeat ACK */
	HeartbeatAck = 11,
}

/**
 * Gateway intents for filtering events
 * @see https://docs.discord.com/developers/topics/gateway#gateway-intents
 */
export enum GatewayIntent {
	Guilds = 1 << 0,
	GuildMessages = 1 << 9,
	MessageContent = 1 << 15,
}

/**
 * Raw Gateway payload from Discord
 */
export interface GatewayPayload {
	/** Opcode */
	op: GatewayOpcode;
	/** Event data */
	d: unknown;
	/** Sequence number (for Dispatch events) */
	s: number | null;
	/** Event name (for Dispatch events) */
	t: string | null;
}

/**
 * Hello payload (opcode 10)
 */
export interface GatewayHelloData {
	heartbeat_interval: number;
}

/**
 * Ready event data
 */
export interface GatewayReadyData {
	v: number;
	user: DiscordUser;
	guilds: Array<{ id: string; unavailable?: boolean }>;
	session_id: string;
	resume_gateway_url: string;
	application: { id: string };
}

// ============================================================================
// Discord API Types
// ============================================================================

/**
 * Discord user object
 */
export interface DiscordUser {
	id: string;
	username: string;
	discriminator: string;
	global_name?: string | null;
	avatar?: string | null;
	bot?: boolean;
}

/**
 * Discord guild (server) object (partial)
 */
export interface DiscordGuild {
	id: string;
	name: string;
}

/**
 * Discord channel object (partial)
 */
export interface DiscordChannel {
	id: string;
	type: number;
	name?: string;
	guild_id?: string;
	parent_id?: string | null;
}

/**
 * Discord message object
 * @see https://docs.discord.com/developers/resources/message
 */
export interface DiscordMessage {
	id: string;
	channel_id: string;
	guild_id?: string;
	author: DiscordUser;
	content: string;
	timestamp: string;
	/** Users specifically mentioned in the message */
	mentions: DiscordUser[];
	/** Message type (0 = default, 19 = reply, etc.) */
	type: number;
	/** Reference to parent message (for thread replies) */
	message_reference?: {
		message_id?: string;
		channel_id?: string;
		guild_id?: string;
	};
}

/**
 * Thread channel types
 */
export const THREAD_CHANNEL_TYPES = {
	PUBLIC_THREAD: 11,
	PRIVATE_THREAD: 12,
} as const;

// ============================================================================
// Transport Types
// ============================================================================

/**
 * Configuration for DiscordGatewayClient
 */
export interface DiscordGatewayConfig {
	/** Discord bot token */
	botToken: string;
	/** Gateway intents bitfield */
	intents: number;
	/** Guild IDs to filter events for (if empty, all guilds are accepted) */
	guildFilter?: string[];
}

/**
 * Processed Discord event that is emitted to listeners
 */
export interface DiscordWebhookEvent {
	/** The Discord event type */
	eventType: DiscordEventType;
	/** Unique message ID (Discord snowflake) */
	eventId: string;
	/** The full Discord message payload */
	payload: DiscordMessage;
	/** Discord Bot token for API access */
	discordBotToken?: string;
	/** Guild ID */
	guildId: string;
}

/**
 * Supported Discord event types
 */
export type DiscordEventType = "message_create";

/**
 * Events emitted by DiscordGatewayClient
 */
export interface DiscordEventTransportEvents {
	/** Emitted when a Discord message event is received (filtered for bot mentions) */
	event: (event: DiscordWebhookEvent) => void;
	/** Emitted when a unified internal message is available */
	message: (message: InternalMessage) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
	/** Emitted when the Gateway connection is ready */
	ready: () => void;
	/** Emitted when the Gateway connection is closed */
	close: (code: number, reason: string) => void;
}
