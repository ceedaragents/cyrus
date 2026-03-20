/**
 * DiscordEventTransport - Handles forwarded Discord webhook event delivery
 *
 * This class provides a typed EventEmitter-based transport for handling
 * Discord events forwarded from CYHOST (or received directly via Gateway).
 *
 * It registers a POST /discord-webhook endpoint with a Fastify server
 * and verifies incoming webhooks using Bearer token authentication.
 *
 * Supported Discord event types:
 * - message_create: When a message is created in a channel the bot has access to
 */

import { EventEmitter } from "node:events";
import type { TranslationContext } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DiscordMessageTranslator } from "./DiscordMessageTranslator.js";
import type {
	DiscordEventTransportEvents,
	DiscordMessage,
	DiscordWebhookEvent,
} from "./types.js";

/**
 * Configuration for DiscordEventTransport
 */
export interface DiscordEventTransportConfig {
	/** Fastify server to register the webhook endpoint on */
	fastifyServer: FastifyInstance;
	/** Secret for Bearer token verification (CYRUS_API_KEY) */
	secret: string;
}

export declare interface DiscordEventTransport {
	on<K extends keyof DiscordEventTransportEvents>(
		event: K,
		listener: DiscordEventTransportEvents[K],
	): this;
	emit<K extends keyof DiscordEventTransportEvents>(
		event: K,
		...args: Parameters<DiscordEventTransportEvents[K]>
	): boolean;
}

/**
 * Handles forwarded Discord webhook events from CYHOST.
 *
 * Unlike Slack which has its own webhook system, Discord events come via
 * the Gateway WebSocket. CYHOST maintains the Gateway connection and
 * forwards events to this endpoint via HTTP.
 */
export class DiscordEventTransport extends EventEmitter {
	private config: DiscordEventTransportConfig;
	private logger: ILogger;
	private messageTranslator: DiscordMessageTranslator;
	private translationContext: TranslationContext;

	constructor(
		config: DiscordEventTransportConfig,
		logger?: ILogger,
		translationContext?: TranslationContext,
	) {
		super();
		this.config = config;
		this.logger =
			logger ?? createLogger({ component: "DiscordEventTransport" });
		this.messageTranslator = new DiscordMessageTranslator();
		this.translationContext = translationContext ?? {};
	}

	/**
	 * Set the translation context for message translation.
	 */
	setTranslationContext(context: TranslationContext): void {
		this.translationContext = { ...this.translationContext, ...context };
	}

	/**
	 * Get Discord bot token from the DISCORD_BOT_TOKEN environment variable.
	 */
	private getDiscordBotToken(): string | undefined {
		return process.env.DISCORD_BOT_TOKEN;
	}

	/**
	 * Register the /discord-webhook endpoint with the Fastify server
	 */
	register(): void {
		this.config.fastifyServer.post(
			"/discord-webhook",
			async (request: FastifyRequest, reply: FastifyReply) => {
				try {
					await this.handleProxyWebhook(request, reply);
				} catch (error) {
					const err = new Error("Discord webhook error");
					if (error instanceof Error) {
						err.cause = error;
					}
					this.logger.error("Discord webhook error", err);
					this.emit("error", err);
					reply.code(500).send({ error: "Internal server error" });
				}
			},
		);

		this.logger.info("Registered POST /discord-webhook endpoint");
	}

	/**
	 * Handle webhook using Bearer token authentication (forwarded from CYHOST)
	 */
	private async handleProxyWebhook(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			reply.code(401).send({ error: "Missing Authorization header" });
			return;
		}

		const expectedAuth = `Bearer ${this.config.secret}`;
		if (authHeader !== expectedAuth) {
			reply.code(401).send({ error: "Invalid authorization token" });
			return;
		}

		try {
			this.processAndEmitEvent(request, reply);
		} catch (error) {
			const err = new Error("Discord proxy webhook processing failed");
			if (error instanceof Error) {
				err.cause = error;
			}
			this.logger.error("Discord proxy webhook processing failed", err);
			reply.code(500).send({ error: "Failed to process webhook" });
		}
	}

	/**
	 * Process the webhook request and emit the appropriate event.
	 *
	 * Expected request body format (sent by CYHOST):
	 * {
	 *   eventType: "message_create",
	 *   eventId: "snowflake_id",
	 *   guildId: "guild_id",
	 *   payload: { ...DiscordMessage }
	 * }
	 */
	private processAndEmitEvent(
		request: FastifyRequest,
		reply: FastifyReply,
	): void {
		const body = request.body as Record<string, unknown>;

		if (!body || typeof body !== "object") {
			reply.code(400).send({ error: "Invalid request body" });
			return;
		}

		const eventType = body.eventType as string;
		if (eventType !== "message_create") {
			this.logger.debug(
				`Ignoring unsupported Discord event type: ${eventType}`,
			);
			reply.code(200).send({ success: true, ignored: true });
			return;
		}

		const payload = body.payload as DiscordMessage;
		if (!payload || !payload.id) {
			reply.code(400).send({ error: "Invalid payload" });
			return;
		}

		const discordBotToken = this.getDiscordBotToken();

		const webhookEvent: DiscordWebhookEvent = {
			eventType: "message_create",
			eventId: payload.id,
			payload,
			discordBotToken,
			guildId: (body.guildId as string) || payload.guild_id || "",
		};

		this.logger.info(
			`Received message_create webhook (message: ${payload.id}, channel: ${payload.channel_id})`,
		);

		// Emit "event" for transport-level listeners
		this.emit("event", webhookEvent);

		// Emit "message" with translated internal message
		this.emitMessage(webhookEvent);

		reply.code(200).send({ success: true });
	}

	/**
	 * Translate and emit an internal message from a webhook event.
	 */
	private emitMessage(event: DiscordWebhookEvent): void {
		const result = this.messageTranslator.translate(
			event,
			this.translationContext,
		);

		if (result.success) {
			this.emit("message", result.message);
		} else {
			this.logger.debug(`Message translation skipped: ${result.reason}`);
		}
	}
}
