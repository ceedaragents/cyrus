import { createHmac, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import type { TranslationContext } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SlackMessageTranslator } from "./SlackMessageTranslator.js";
import type {
	SlackEventEnvelope,
	SlackEventTransportConfig,
	SlackEventTransportEvents,
	SlackWebhookEvent,
} from "./types.js";

export declare interface SlackEventTransport {
	on<K extends keyof SlackEventTransportEvents>(
		event: K,
		listener: SlackEventTransportEvents[K],
	): this;
	emit<K extends keyof SlackEventTransportEvents>(
		event: K,
		...args: Parameters<SlackEventTransportEvents[K]>
	): boolean;
}

/**
 * SlackEventTransport - Handles forwarded Slack webhook event delivery
 *
 * This class provides a typed EventEmitter-based transport
 * for handling Slack webhooks forwarded from CYHOST.
 *
 * It registers a POST /slack-webhook endpoint with a Fastify server
 * and verifies incoming webhooks using Bearer token authentication.
 *
 * Supported Slack event types:
 * - app_mention: When the bot is mentioned with @ in a channel or thread
 */
export class SlackEventTransport extends EventEmitter {
	private config: SlackEventTransportConfig;
	private logger: ILogger;
	private messageTranslator: SlackMessageTranslator;
	private translationContext: TranslationContext;

	constructor(
		config: SlackEventTransportConfig,
		logger?: ILogger,
		translationContext?: TranslationContext,
	) {
		super();
		this.config = config;
		this.logger = logger ?? createLogger({ component: "SlackEventTransport" });
		this.messageTranslator = new SlackMessageTranslator();
		this.translationContext = translationContext ?? {};
	}

	/**
	 * Set the translation context for message translation.
	 */
	setTranslationContext(context: TranslationContext): void {
		this.translationContext = { ...this.translationContext, ...context };
	}

	/**
	 * Get Slack bot token from the SLACK_BOT_TOKEN environment variable.
	 */
	private getSlackBotToken(): string | undefined {
		return process.env.SLACK_BOT_TOKEN;
	}

	/**
	 * Register the /slack-webhook endpoint with the Fastify server
	 */
	register(): void {
		this.config.fastifyServer.post(
			"/slack-webhook",
			{
				config: {
					rawBody: true,
				},
			},
			async (request: FastifyRequest, reply: FastifyReply) => {
				try {
					if (this.config.verificationMode === "direct") {
						await this.handleDirectWebhook(request, reply);
					} else {
						await this.handleProxyWebhook(request, reply);
					}
				} catch (error) {
					const err = new Error("Webhook error");
					if (error instanceof Error) {
						err.cause = error;
					}
					this.logger.error("Webhook error", err);
					this.emit("error", err);
					reply.code(500).send({ error: "Internal server error" });
				}
			},
		);

		this.logger.info(
			`Registered POST /slack-webhook endpoint (${this.config.verificationMode} mode)`,
		);
	}

	/**
	 * Handle webhook using Slack signing secret (direct from Slack)
	 */
	private async handleDirectWebhook(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		const timestamp = request.headers["x-slack-request-timestamp"] as string;
		const signature = request.headers["x-slack-signature"] as string;

		if (!timestamp || !signature) {
			reply.code(401).send({ error: "Missing Slack signature headers" });
			return;
		}

		// Reject requests older than 5 minutes (replay attack prevention)
		const requestAge = Math.abs(
			Math.floor(Date.now() / 1000) - parseInt(timestamp, 10),
		);
		if (requestAge > 60 * 5) {
			reply.code(401).send({ error: "Request timestamp too old" });
			return;
		}

		try {
			const body = (request as FastifyRequest & { rawBody: string }).rawBody;
			const isValid = this.verifySlackSignature(
				body,
				timestamp,
				signature,
				this.config.secret,
			);

			if (!isValid) {
				reply.code(401).send({ error: "Invalid webhook signature" });
				return;
			}

			this.processAndEmitEvent(request, reply);
		} catch (error) {
			const err = new Error("Slack signature verification failed");
			if (error instanceof Error) {
				err.cause = error;
			}
			this.logger.error("Slack signature verification failed", err);
			reply.code(401).send({ error: "Invalid webhook signature" });
		}
	}

	/**
	 * Verify Slack request signature using HMAC-SHA256
	 * @see https://api.slack.com/authentication/verifying-requests-from-slack
	 */
	private verifySlackSignature(
		body: string,
		timestamp: string,
		signature: string,
		secret: string,
	): boolean {
		const sigBaseString = `v0:${timestamp}:${body}`;
		const expectedSignature = `v0=${createHmac("sha256", secret)
			.update(sigBaseString)
			.digest("hex")}`;

		if (signature.length !== expectedSignature.length) {
			return false;
		}

		return timingSafeEqual(
			Buffer.from(signature),
			Buffer.from(expectedSignature),
		);
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
			const err = new Error("Proxy webhook processing failed");
			if (error instanceof Error) {
				err.cause = error;
			}
			this.logger.error("Proxy webhook processing failed", err);
			reply.code(500).send({ error: "Failed to process webhook" });
		}
	}

	/**
	 * Process the webhook request and emit the appropriate event
	 */
	private processAndEmitEvent(
		request: FastifyRequest,
		reply: FastifyReply,
	): void {
		const envelope = request.body as SlackEventEnvelope;

		// Handle Slack URL verification challenge
		if (envelope.type === "url_verification") {
			this.logger.info("Responding to Slack URL verification challenge");
			reply.code(200).send({ challenge: envelope.challenge });
			return;
		}

		if (envelope.type !== "event_callback") {
			this.logger.debug(`Ignoring unsupported envelope type: ${envelope.type}`);
			reply.code(200).send({ success: true, ignored: true });
			return;
		}

		const event = envelope.event;

		if (!event || event.type !== "app_mention") {
			this.logger.debug(
				`Ignoring unsupported event type: ${event?.type ?? "unknown"}`,
			);
			reply.code(200).send({ success: true, ignored: true });
			return;
		}

		const slackBotToken = this.getSlackBotToken();

		const webhookEvent: SlackWebhookEvent = {
			eventType: "app_mention",
			eventId: envelope.event_id,
			payload: event,
			slackBotToken,
			teamId: envelope.team_id,
		};

		this.logger.info(
			`Received app_mention webhook (event: ${envelope.event_id}, channel: ${event.channel})`,
		);

		// Emit "event" for transport-level listeners
		this.emit("event", webhookEvent);

		// Emit "message" with translated internal message
		this.emitMessage(webhookEvent);

		reply.code(200).send({ success: true });
	}

	/**
	 * Translate and emit an internal message from a webhook event.
	 * Only emits if translation succeeds; logs debug message on failure.
	 */
	private emitMessage(event: SlackWebhookEvent): void {
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
