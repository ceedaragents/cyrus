/**
 * Discord Event Transport for Cyrus.
 *
 * This module provides an event transport that adapts Discord bot events
 * into a format suitable for processing by a Cyrus worker. Unlike the
 * Linear integration which uses webhooks, Discord uses WebSocket connections
 * via discord.js.
 *
 * The transport emits DiscordAgentEvent objects which contain:
 * - Discord-specific metadata (guild, channel, thread, user info)
 * - Synthetic agentSession/issue fields for compatibility
 * - The original Discord event for reference
 *
 * Note: This transport provides a similar interface to IAgentEventTransport
 * but emits Discord-specific events. A dedicated Discord worker or adapter
 * can process these events and run Claude sessions accordingly.
 *
 * @module discord-bot/DiscordEventTransport
 */

import { EventEmitter } from "node:events";
import { DiscordBot } from "./DiscordBot.js";
import type {
	DiscordEventTransportConfig,
	DiscordResponse,
	DiscordSessionCreateEvent,
	DiscordSessionEndEvent,
	DiscordSessionPromptEvent,
} from "./types.js";

/**
 * Events emitted by DiscordEventTransport.
 */
export interface DiscordTransportEvents {
	/** Emitted when an event is received (matches IAgentEventTransport interface) */
	event: (event: DiscordAgentEvent) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
}

/**
 * Discord-specific agent event type.
 *
 * This is a synthetic event type that wraps Discord events in a format
 * similar to Linear webhooks, allowing the EdgeWorker to process them.
 */
export interface DiscordAgentEvent {
	/** Event type - matches Linear webhook patterns */
	type: "DiscordAgentSessionEvent" | "DiscordAppUserNotification";

	/** Event action */
	action: "created" | "prompted" | "ended";

	/** Timestamp of the event */
	createdAt: string;

	/** Discord-specific data */
	discord: {
		sessionId: string;
		guildId: string;
		channelId: string;
		threadId?: string;
		messageId: string;
		user: {
			id: string;
			username: string;
			displayName: string;
		};
		content: string;
		attachments?: Array<{
			id: string;
			filename: string;
			url: string;
			contentType?: string;
		}>;
	};

	/**
	 * Synthetic agentSession field for compatibility with EdgeWorker.
	 * Contains minimal data needed for session management.
	 */
	agentSession?: {
		id: string;
		issueId: string; // Maps to Discord sessionId
		status: string;
	};

	/**
	 * Synthetic agentActivity field for prompted events.
	 */
	agentActivity?: {
		id: string;
		content: {
			type: "prompt";
			body: string;
		};
	};

	/**
	 * Synthetic issue field for compatibility.
	 */
	issue?: {
		id: string;
		identifier: string;
		title: string;
		description: string;
		url: string;
	};

	/**
	 * Original Discord event for reference.
	 */
	originalEvent:
		| DiscordSessionCreateEvent
		| DiscordSessionPromptEvent
		| DiscordSessionEndEvent;
}

export declare interface DiscordEventTransport {
	on<K extends keyof DiscordTransportEvents>(
		event: K,
		listener: DiscordTransportEvents[K],
	): this;
	emit<K extends keyof DiscordTransportEvents>(
		event: K,
		...args: Parameters<DiscordTransportEvents[K]>
	): boolean;
}

/**
 * Discord event transport for Cyrus integration.
 *
 * This transport:
 * 1. Manages a DiscordBot instance
 * 2. Listens for Discord events (session create, prompt, end)
 * 3. Transforms them into DiscordAgentEvent format
 * 4. Emits events that can be processed by a Discord-specific worker
 * 5. Provides methods to send responses back to Discord
 */
export class DiscordEventTransport extends EventEmitter {
	private bot: DiscordBot;
	private isRegistered: boolean = false;

	constructor(config: DiscordEventTransportConfig) {
		super();
		this.bot = new DiscordBot(config.botConfig);
		this.setupBotEventHandlers();
	}

	/**
	 * Register the transport (starts the Discord bot).
	 * This is called by the EdgeWorker during initialization.
	 */
	register(): void {
		if (this.isRegistered) {
			console.warn("[DiscordEventTransport] Already registered");
			return;
		}

		console.log("[DiscordEventTransport] Registering Discord transport...");

		// Start the bot asynchronously
		this.bot
			.start()
			.then(() => {
				console.log(
					"[DiscordEventTransport] Discord bot started, listening for events",
				);
				this.isRegistered = true;
			})
			.catch((error) => {
				const err = new Error(
					"[DiscordEventTransport] Failed to start Discord bot",
				);
				if (error instanceof Error) {
					err.cause = error;
				}
				console.error(err);
				this.emit("error", err);
			});
	}

	/**
	 * Get the underlying Discord bot instance.
	 * Useful for sending responses back to Discord.
	 */
	getBot(): DiscordBot {
		return this.bot;
	}

	/**
	 * Send a response to a Discord session.
	 *
	 * @param sessionId - The session ID (Discord thread/channel ID)
	 * @param response - The response to send
	 */
	async sendResponse(
		sessionId: string,
		response: DiscordResponse,
	): Promise<string | null> {
		const session = this.bot.getSession(sessionId);
		if (!session) {
			console.warn(
				`[DiscordEventTransport] No session found for ID: ${sessionId}`,
			);
			return null;
		}

		return this.bot.sendResponse(session.channelId, response, session.threadId);
	}

	/**
	 * Send a typing indicator to a session.
	 */
	async sendTyping(sessionId: string): Promise<void> {
		const session = this.bot.getSession(sessionId);
		if (session) {
			await this.bot.sendTyping(session.channelId, session.threadId);
		}
	}

	/**
	 * End a session.
	 */
	endSession(sessionId: string): void {
		this.bot.endSession(sessionId, "user_request");
	}

	/**
	 * Check if the transport is connected and ready.
	 */
	isReady(): boolean {
		return this.isRegistered && this.bot.isConnected();
	}

	/**
	 * Stop the transport and disconnect the bot.
	 */
	async stop(): Promise<void> {
		console.log("[DiscordEventTransport] Stopping...");
		await this.bot.stop();
		this.isRegistered = false;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Setup event handlers for the Discord bot.
	 */
	private setupBotEventHandlers(): void {
		// Session creation events
		this.bot.on("sessionCreate", (event) => {
			const agentEvent = this.transformSessionCreateEvent(event);
			this.emit("event", agentEvent);
		});

		// Session prompt events
		this.bot.on("sessionPrompt", (event) => {
			const agentEvent = this.transformSessionPromptEvent(event);
			this.emit("event", agentEvent);
		});

		// Session end events
		this.bot.on("sessionEnd", (event) => {
			const agentEvent = this.transformSessionEndEvent(event);
			this.emit("event", agentEvent);
		});

		// Error events
		this.bot.on("error", (error) => {
			this.emit("error", error);
		});

		// Ready event
		this.bot.on("ready", () => {
			console.log("[DiscordEventTransport] Discord bot is ready");
		});
	}

	/**
	 * Transform a Discord session create event into an agent event.
	 */
	private transformSessionCreateEvent(
		event: DiscordSessionCreateEvent,
	): DiscordAgentEvent {
		const issueId = event.sessionId;
		const issueIdentifier = `DISCORD-${event.guildId.slice(-4)}-${event.sessionId.slice(-6)}`;

		return {
			type: "DiscordAgentSessionEvent",
			action: "created",
			createdAt: event.timestamp.toISOString(),
			discord: {
				sessionId: event.sessionId,
				guildId: event.guildId,
				channelId: event.channelId,
				threadId: event.threadId,
				messageId: event.messageId,
				user: {
					id: event.user.id,
					username: event.user.username,
					displayName: event.user.displayName,
				},
				content: event.content,
				attachments: event.attachments?.map((a) => ({
					id: a.id,
					filename: a.filename,
					url: a.url,
					contentType: a.contentType,
				})),
			},
			agentSession: {
				id: event.sessionId,
				issueId: issueId,
				status: "active",
			},
			issue: {
				id: issueId,
				identifier: issueIdentifier,
				title: event.content.substring(0, 100) || "Discord Conversation",
				description: event.content,
				url: `https://discord.com/channels/${event.guildId}/${event.threadId ?? event.channelId}`,
			},
			originalEvent: event,
		};
	}

	/**
	 * Transform a Discord session prompt event into an agent event.
	 */
	private transformSessionPromptEvent(
		event: DiscordSessionPromptEvent,
	): DiscordAgentEvent {
		const issueId = event.sessionId;
		const issueIdentifier = `DISCORD-${event.guildId.slice(-4)}-${event.sessionId.slice(-6)}`;

		return {
			type: "DiscordAgentSessionEvent",
			action: "prompted",
			createdAt: event.timestamp.toISOString(),
			discord: {
				sessionId: event.sessionId,
				guildId: event.guildId,
				channelId: event.channelId,
				threadId: event.threadId,
				messageId: event.messageId,
				user: {
					id: event.user.id,
					username: event.user.username,
					displayName: event.user.displayName,
				},
				content: event.content,
				attachments: event.attachments?.map((a) => ({
					id: a.id,
					filename: a.filename,
					url: a.url,
					contentType: a.contentType,
				})),
			},
			agentSession: {
				id: event.sessionId,
				issueId: issueId,
				status: "active",
			},
			agentActivity: {
				id: event.messageId,
				content: {
					type: "prompt",
					body: event.content,
				},
			},
			issue: {
				id: issueId,
				identifier: issueIdentifier,
				title: "Discord Conversation",
				description: event.content,
				url: `https://discord.com/channels/${event.guildId}/${event.threadId ?? event.channelId}`,
			},
			originalEvent: event,
		};
	}

	/**
	 * Transform a Discord session end event into an agent event.
	 */
	private transformSessionEndEvent(
		event: DiscordSessionEndEvent,
	): DiscordAgentEvent {
		return {
			type: "DiscordAppUserNotification",
			action: "ended",
			createdAt: event.timestamp.toISOString(),
			discord: {
				sessionId: event.sessionId,
				guildId: "",
				channelId: "",
				messageId: "",
				user: event.user
					? {
							id: event.user.id,
							username: event.user.username,
							displayName: event.user.displayName,
						}
					: {
							id: "system",
							username: "system",
							displayName: "System",
						},
				content: `Session ended: ${event.reason}`,
			},
			agentSession: {
				id: event.sessionId,
				issueId: event.sessionId,
				status: "ended",
			},
			originalEvent: event,
		};
	}
}

/**
 * Type guard to check if an event is a Discord agent event.
 */
export function isDiscordAgentEvent(
	event: unknown,
): event is DiscordAgentEvent {
	return (
		typeof event === "object" &&
		event !== null &&
		"type" in event &&
		(event.type === "DiscordAgentSessionEvent" ||
			event.type === "DiscordAppUserNotification") &&
		"discord" in event
	);
}

/**
 * Type guard to check if a Discord event is a session create event.
 */
export function isDiscordSessionCreatedEvent(
	event: DiscordAgentEvent,
): boolean {
	return (
		event.type === "DiscordAgentSessionEvent" && event.action === "created"
	);
}

/**
 * Type guard to check if a Discord event is a session prompt event.
 */
export function isDiscordSessionPromptedEvent(
	event: DiscordAgentEvent,
): boolean {
	return (
		event.type === "DiscordAgentSessionEvent" && event.action === "prompted"
	);
}

/**
 * Type guard to check if a Discord event is a session end event.
 */
export function isDiscordSessionEndedEvent(event: DiscordAgentEvent): boolean {
	return event.action === "ended";
}
