import { EventEmitter } from "node:events";
import type { TranslationContext } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import WebSocket from "ws";
import { DiscordMessageTranslator } from "./DiscordMessageTranslator.js";
import {
	type DiscordEventTransportEvents,
	type DiscordGatewayConfig,
	type DiscordMessage,
	type DiscordWebhookEvent,
	type GatewayHelloData,
	GatewayOpcode,
	type GatewayPayload,
	type GatewayReadyData,
} from "./types.js";

export declare interface DiscordGatewayClient {
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
 * DiscordGatewayClient - Manages a WebSocket connection to the Discord Gateway.
 *
 * Handles the full Gateway lifecycle: HELLO → IDENTIFY → READY → heartbeat loop.
 * Automatically reconnects with RESUME on disconnection.
 *
 * Filters MESSAGE_CREATE events for bot @mentions and emits them as events.
 */
export class DiscordGatewayClient extends EventEmitter {
	private config: DiscordGatewayConfig;
	private logger: ILogger;
	private messageTranslator: DiscordMessageTranslator;
	private translationContext: TranslationContext;

	private ws: WebSocket | null = null;
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private heartbeatAckReceived = true;
	private lastSequence: number | null = null;
	private sessionId: string | null = null;
	private resumeGatewayUrl: string | null = null;
	private botUserId: string | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private isDestroyed = false;

	private static GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

	constructor(config: DiscordGatewayConfig, logger?: ILogger) {
		super();
		this.config = config;
		this.logger = logger ?? createLogger({ component: "DiscordGatewayClient" });
		this.messageTranslator = new DiscordMessageTranslator();
		this.translationContext = {};
	}

	/**
	 * Set the translation context for message translation.
	 */
	setTranslationContext(context: TranslationContext): void {
		this.translationContext = { ...this.translationContext, ...context };
	}

	/**
	 * Connect to the Discord Gateway.
	 */
	connect(): void {
		if (this.isDestroyed) {
			this.logger.warn("Cannot connect: client has been destroyed");
			return;
		}

		const url = this.resumeGatewayUrl ?? DiscordGatewayClient.GATEWAY_URL;
		this.logger.info(`Connecting to Discord Gateway: ${url}`);

		this.ws = new WebSocket(url);

		this.ws.on("open", () => {
			this.logger.info("Gateway WebSocket connection opened");
			this.reconnectAttempts = 0;
		});

		this.ws.on("message", (data: WebSocket.Data) => {
			try {
				const payload: GatewayPayload = JSON.parse(data.toString());
				this.handleGatewayPayload(payload);
			} catch (error) {
				this.logger.error(
					"Failed to parse Gateway payload",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		});

		this.ws.on("close", (code: number, reason: Buffer) => {
			const reasonStr = reason.toString();
			this.logger.info(
				`Gateway WebSocket closed: code=${code}, reason=${reasonStr}`,
			);
			this.stopHeartbeat();
			this.emit("close", code, reasonStr);
			this.handleDisconnect(code);
		});

		this.ws.on("error", (error: Error) => {
			this.logger.error("Gateway WebSocket error", error);
			this.emit("error", error);
		});
	}

	/**
	 * Gracefully disconnect from the Gateway.
	 */
	disconnect(): void {
		this.isDestroyed = true;
		this.stopHeartbeat();
		if (this.ws) {
			this.ws.close(1000, "Client disconnect");
			this.ws = null;
		}
	}

	/**
	 * Get the bot's own user ID (available after READY event).
	 */
	getBotUserId(): string | null {
		return this.botUserId;
	}

	// ============================================================================
	// Gateway Payload Handling
	// ============================================================================

	private handleGatewayPayload(payload: GatewayPayload): void {
		// Update sequence number for heartbeat/resume
		if (payload.s !== null) {
			this.lastSequence = payload.s;
		}

		switch (payload.op) {
			case GatewayOpcode.Hello:
				this.handleHello(payload.d as GatewayHelloData);
				break;
			case GatewayOpcode.HeartbeatAck:
				this.heartbeatAckReceived = true;
				break;
			case GatewayOpcode.Dispatch:
				this.handleDispatch(payload.t!, payload.d);
				break;
			case GatewayOpcode.Reconnect:
				this.logger.info("Gateway requested reconnect");
				this.ws?.close(4000, "Server requested reconnect");
				break;
			case GatewayOpcode.InvalidSession: {
				const resumable = payload.d as boolean;
				this.logger.info(`Invalid session received (resumable: ${resumable})`);
				if (!resumable) {
					this.sessionId = null;
					this.lastSequence = null;
				}
				// Wait 1-5 seconds then re-identify
				const delay = 1000 + Math.random() * 4000;
				setTimeout(() => {
					if (this.sessionId) {
						this.sendResume();
					} else {
						this.sendIdentify();
					}
				}, delay);
				break;
			}
			case GatewayOpcode.Heartbeat:
				// Server requested an immediate heartbeat
				this.sendHeartbeat();
				break;
		}
	}

	private handleHello(data: GatewayHelloData): void {
		this.logger.info(
			`Received HELLO, heartbeat interval: ${data.heartbeat_interval}ms`,
		);
		this.startHeartbeat(data.heartbeat_interval);

		if (this.sessionId && this.lastSequence !== null) {
			this.sendResume();
		} else {
			this.sendIdentify();
		}
	}

	private handleDispatch(eventName: string, data: unknown): void {
		switch (eventName) {
			case "READY": {
				const readyData = data as GatewayReadyData;
				this.sessionId = readyData.session_id;
				this.resumeGatewayUrl = readyData.resume_gateway_url;
				this.botUserId = readyData.user.id;
				this.logger.info(
					`Gateway READY: session=${this.sessionId}, bot_user=${this.botUserId}, guilds=${readyData.guilds.length}`,
				);
				this.emit("ready");
				break;
			}
			case "RESUMED":
				this.logger.info("Gateway session resumed successfully");
				this.emit("ready");
				break;
			case "MESSAGE_CREATE":
				this.handleMessageCreate(data as DiscordMessage);
				break;
		}
	}

	// ============================================================================
	// Message Handling
	// ============================================================================

	private handleMessageCreate(message: DiscordMessage): void {
		// Ignore messages from bots (including ourselves)
		if (message.author.bot) {
			return;
		}

		// Filter by guild if configured
		if (
			this.config.guildFilter?.length &&
			message.guild_id &&
			!this.config.guildFilter.includes(message.guild_id)
		) {
			return;
		}

		// Check if the bot is mentioned
		const isMentioned = message.mentions.some(
			(user) => user.id === this.botUserId,
		);
		if (!isMentioned) {
			return;
		}

		const guildId = message.guild_id ?? "";

		const webhookEvent: DiscordWebhookEvent = {
			eventType: "message_create",
			eventId: message.id,
			payload: message,
			discordBotToken: this.config.botToken,
			guildId,
		};

		this.logger.info(
			`Received @mention in channel ${message.channel_id} (guild: ${guildId}, message: ${message.id})`,
		);

		// Emit "event" for transport-level listeners
		this.emit("event", webhookEvent);

		// Emit "message" with translated internal message
		this.emitMessage(webhookEvent);
	}

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

	// ============================================================================
	// Gateway Protocol
	// ============================================================================

	private sendIdentify(): void {
		this.send({
			op: GatewayOpcode.Identify,
			d: {
				token: this.config.botToken,
				intents: this.config.intents,
				properties: {
					os: process.platform,
					browser: "cyrus",
					device: "cyrus",
				},
			},
			s: null,
			t: null,
		});
		this.logger.info("Sent IDENTIFY");
	}

	private sendResume(): void {
		this.send({
			op: GatewayOpcode.Resume,
			d: {
				token: this.config.botToken,
				session_id: this.sessionId,
				seq: this.lastSequence,
			},
			s: null,
			t: null,
		});
		this.logger.info(`Sent RESUME (session: ${this.sessionId})`);
	}

	private sendHeartbeat(): void {
		this.send({
			op: GatewayOpcode.Heartbeat,
			d: this.lastSequence,
			s: null,
			t: null,
		});
	}

	private send(payload: GatewayPayload): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(payload));
		}
	}

	// ============================================================================
	// Heartbeat Management
	// ============================================================================

	private startHeartbeat(intervalMs: number): void {
		this.stopHeartbeat();
		this.heartbeatAckReceived = true;

		// Send first heartbeat after jitter
		const jitter = Math.random() * intervalMs;
		setTimeout(() => {
			this.sendHeartbeat();
			this.heartbeatInterval = setInterval(() => {
				if (!this.heartbeatAckReceived) {
					this.logger.warn("No heartbeat ACK received, reconnecting");
					this.ws?.close(4009, "Heartbeat timeout");
					return;
				}
				this.heartbeatAckReceived = false;
				this.sendHeartbeat();
			}, intervalMs);
		}, jitter);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	// ============================================================================
	// Reconnection
	// ============================================================================

	private handleDisconnect(code: number): void {
		if (this.isDestroyed) {
			return;
		}

		// Non-recoverable close codes
		const nonRecoverable = [4004, 4010, 4011, 4012, 4013, 4014];
		if (nonRecoverable.includes(code)) {
			this.logger.error(
				`Non-recoverable Gateway close code: ${code}. Not reconnecting.`,
			);
			return;
		}

		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			this.logger.error(
				`Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`,
			);
			return;
		}

		const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
		this.reconnectAttempts++;

		this.logger.info(
			`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
		);

		setTimeout(() => {
			this.connect();
		}, delay);
	}
}
