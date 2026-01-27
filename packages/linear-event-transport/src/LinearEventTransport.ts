import { EventEmitter } from "node:events";
import {
	LinearWebhookClient,
	type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import type { IAgentEventTransport } from "cyrus-core";
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
 * This class implements IAgentEventTransport to provide a platform-agnostic
 * interface for handling Linear webhooks with Linear-specific verification.
 *
 * It registers a POST /webhook endpoint with a Fastify server
 * and verifies incoming webhooks using either:
 * 1. "direct" mode: Verifies Linear's webhook signature
 * 2. "proxy" mode: Verifies Bearer token authentication
 *
 * The class emits "event" events with AgentEvent (LinearWebhookPayload) data.
 */
export class LinearEventTransport
	extends EventEmitter
	implements IAgentEventTransport
{
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
				console.log(
					`[LinearEventTransport] 📡 Webhook received: ${request.method} ${request.url}`,
				);

				try {
					// Verify based on mode
					if (this.config.verificationMode === "direct") {
						await this.handleDirectWebhook(request, reply);
					} else {
						await this.handleProxyWebhook(request, reply);
					}
				} catch (error) {
					const err = new Error("[LinearEventTransport] Webhook error");
					if (error instanceof Error) {
						err.cause = error;
					}
					console.error(err);
					this.emit("error", err);
					console.log(
						"[LinearEventTransport] ❌ Responding with 500 Internal Server Error",
					);
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
		console.log(
			"[LinearEventTransport] Processing webhook in DIRECT mode (Linear signature verification)",
		);

		if (!this.linearWebhookClient) {
			console.log(
				"[LinearEventTransport] ❌ Linear webhook client not initialized - responding with 500",
			);
			reply.code(500).send({ error: "Linear webhook client not initialized" });
			return;
		}

		// Get Linear signature from headers
		const signature = request.headers["linear-signature"] as string;
		if (!signature) {
			console.log(
				"[LinearEventTransport] ❌ Missing linear-signature header - responding with 401",
			);
			reply.code(401).send({ error: "Missing linear-signature header" });
			return;
		}

		try {
			// Verify the webhook signature using Linear's client
			const bodyBuffer = Buffer.from(JSON.stringify(request.body));
			const isValid = this.linearWebhookClient.verify(bodyBuffer, signature);

			if (!isValid) {
				console.log(
					"[LinearEventTransport] ❌ Invalid webhook signature - responding with 401",
				);
				reply.code(401).send({ error: "Invalid webhook signature" });
				return;
			}

			console.log(
				"[LinearEventTransport] ✅ Webhook signature verified successfully",
			);

			// Emit "event" for IAgentEventTransport compatibility
			this.emit("event", request.body as LinearWebhookPayload);

			console.log(
				"[LinearEventTransport] ✅ Webhook event emitted - responding with 200 OK",
			);

			// Send success response
			reply.code(200).send({ success: true });
		} catch (error) {
			const err = new Error(
				"[LinearEventTransport] Direct webhook verification failed",
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			console.error(err);
			console.log(
				"[LinearEventTransport] ❌ Exception during verification - responding with 401",
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
		console.log(
			"[LinearEventTransport] Processing webhook in PROXY mode (Bearer token verification)",
		);

		// Get Authorization header
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			console.log(
				"[LinearEventTransport] ❌ Missing Authorization header - responding with 401",
			);
			reply.code(401).send({ error: "Missing Authorization header" });
			return;
		}

		// Verify Bearer token
		const expectedAuth = `Bearer ${this.config.secret}`;
		if (authHeader !== expectedAuth) {
			console.log(
				"[LinearEventTransport] ❌ Invalid authorization token - responding with 401",
			);
			reply.code(401).send({ error: "Invalid authorization token" });
			return;
		}

		console.log("[LinearEventTransport] ✅ Bearer token verified successfully");

		try {
			// Emit "event" for IAgentEventTransport compatibility
			this.emit("event", request.body as LinearWebhookPayload);

			console.log(
				"[LinearEventTransport] ✅ Webhook event emitted - responding with 200 OK",
			);

			// Send success response
			reply.code(200).send({ success: true });
		} catch (error) {
			const err = new Error(
				"[LinearEventTransport] Proxy webhook processing failed",
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			console.error(err);
			console.log(
				"[LinearEventTransport] ❌ Exception during processing - responding with 500",
			);
			reply.code(500).send({ error: "Failed to process webhook" });
		}
	}
}
