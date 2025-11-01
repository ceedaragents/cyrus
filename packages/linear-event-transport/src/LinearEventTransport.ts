import { EventEmitter } from "node:events";
import {
	LinearWebhookClient,
	type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
	LinearEventTransportConfig,
	LinearEventTransportEvents,
} from "./types.js";

export declare interface LinearEventTransport {
	on<K extends keyof LinearEventTransportEvents>(
		event: K,
		listener: LinearEventTransportEvents[K],
	): this;
	emit<K extends keyof LinearEventTransportEvents>(
		event: K,
		...args: Parameters<LinearEventTransportEvents[K]>
	): boolean;
}

/**
 * LinearEventTransport - Handles Linear webhook event delivery
 *
 * This class provides a platform-agnostic interface for handling Linear webhooks
 * while managing Linear-specific webhook verification.
 *
 * It registers a POST /webhook endpoint with a Fastify server
 * and verifies incoming webhooks using either:
 * 1. LINEAR_DIRECT_WEBHOOKS mode: Verifies Linear's webhook signature
 * 2. Proxy mode: Verifies Bearer token authentication
 *
 * The class emits both legacy "webhook" events and new "event" events for
 * backward compatibility during migration.
 */
export class LinearEventTransport extends EventEmitter {
	private config: LinearEventTransportConfig;
	private linearWebhookClient: LinearWebhookClient | null = null;

	constructor(config: LinearEventTransportConfig) {
		super();
		this.config = config;

		// Initialize Linear webhook client for direct mode
		if (config.verificationMode === "direct") {
			this.linearWebhookClient = new LinearWebhookClient(config.secret);
		}
	}

	/**
	 * Register the /webhook endpoint with the Fastify server
	 */
	register(): void {
		this.config.fastifyServer.post(
			"/webhook",
			async (request: FastifyRequest, reply: FastifyReply) => {
				try {
					// Verify based on mode
					if (this.config.verificationMode === "direct") {
						await this.handleDirectWebhook(request, reply);
					} else {
						await this.handleProxyWebhook(request, reply);
					}
				} catch (error) {
					console.error("[LinearEventTransport] Webhook error:", error);
					this.emit("error", error as Error);
					reply.code(500).send({ error: "Internal server error" });
				}
			},
		);

		console.log(
			`[LinearEventTransport] Registered POST /webhook endpoint (${this.config.verificationMode} mode)`,
		);
	}

	/**
	 * Handle webhook in direct mode using Linear's signature verification
	 */
	private async handleDirectWebhook(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		if (!this.linearWebhookClient) {
			reply.code(500).send({ error: "Linear webhook client not initialized" });
			return;
		}

		// Get Linear signature from headers
		const signature = request.headers["linear-signature"] as string;
		if (!signature) {
			reply.code(401).send({ error: "Missing linear-signature header" });
			return;
		}

		try {
			// Verify the webhook signature using Linear's client
			const bodyBuffer = Buffer.from(JSON.stringify(request.body));
			const isValid = this.linearWebhookClient.verify(bodyBuffer, signature);

			if (!isValid) {
				reply.code(401).send({ error: "Invalid webhook signature" });
				return;
			}

			this.emit("webhook", request.body as LinearWebhookPayload);

			// Send success response
			reply.code(200).send({ success: true });
		} catch (error) {
			console.error(
				"[LinearEventTransport] Direct webhook verification failed:",
				error,
			);
			reply.code(401).send({ error: "Invalid webhook signature" });
		}
	}

	/**
	 * Handle webhook in proxy mode using Bearer token authentication
	 */
	private async handleProxyWebhook(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		// Get Authorization header
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			reply.code(401).send({ error: "Missing Authorization header" });
			return;
		}

		// Verify Bearer token
		const expectedAuth = `Bearer ${this.config.secret}`;
		if (authHeader !== expectedAuth) {
			reply.code(401).send({ error: "Invalid authorization token" });
			return;
		}

		try {
			this.emit("webhook", request.body as LinearWebhookPayload);

			// Send success response
			reply.code(200).send({ success: true });
		} catch (error) {
			console.error(
				"[LinearEventTransport] Proxy webhook processing failed:",
				error,
			);
			reply.code(500).send({ error: "Failed to process webhook" });
		}
	}
}
