import { EventEmitter } from "node:events";
import { LinearWebhookClient } from "@linear/sdk/webhooks";
/**
 * LinearEventTransport - Handles Linear webhook event delivery
 *
 * This class registers a POST /webhook endpoint with a Fastify server
 * and verifies incoming webhooks using either:
 * 1. LINEAR_DIRECT_WEBHOOKS mode: Verifies Linear's webhook signature
 * 2. Proxy mode: Verifies Bearer token authentication
 */
export class LinearEventTransport extends EventEmitter {
	config;
	linearWebhookClient = null;
	constructor(config) {
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
	register() {
		this.config.fastifyServer.post("/webhook", async (request, reply) => {
			try {
				// Verify based on mode
				if (this.config.verificationMode === "direct") {
					await this.handleDirectWebhook(request, reply);
				} else {
					await this.handleProxyWebhook(request, reply);
				}
			} catch (error) {
				console.error("[LinearEventTransport] Webhook error:", error);
				this.emit("error", error);
				reply.code(500).send({ error: "Internal server error" });
			}
		});
		console.log(
			`[LinearEventTransport] Registered POST /webhook endpoint (${this.config.verificationMode} mode)`,
		);
	}
	/**
	 * Handle webhook in direct mode using Linear's signature verification
	 */
	async handleDirectWebhook(request, reply) {
		if (!this.linearWebhookClient) {
			reply.code(500).send({ error: "Linear webhook client not initialized" });
			return;
		}
		// Get Linear signature from headers
		const signature = request.headers["linear-signature"];
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
			// Emit webhook event with the validated payload
			this.emit("webhook", request.body);
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
	async handleProxyWebhook(request, reply) {
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
			// Emit webhook event with the payload
			this.emit("webhook", request.body);
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
//# sourceMappingURL=LinearEventTransport.js.map
