import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

/**
 * Module handler that processes HTTP requests for a specific path
 */
export interface ApplicationModule {
	initialize?(server: any): Promise<void>;
	handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void>;
	destroy?(): Promise<void>;
}

/**
 * Verification method for Linear webhooks
 */
export type WebhookVerificationMethod = "linear" | "api-key";

/**
 * Linear event transport configuration
 */
export interface LinearEventTransportConfig {
	path?: string; // Webhook path (default: /webhook)
	verificationMethod?: WebhookVerificationMethod; // Verification method (default: api-key)
	webhookPath?: string; // Alternative path property name
}

/**
 * Events emitted by LinearEventTransport
 */
export interface LinearEventTransportEvents {
	webhook: (payload: LinearWebhookPayload) => void;
	error: (error: Error) => void;
}

/**
 * Linear event transport module for handling Linear webhooks
 * Implements the ApplicationModule interface for registration with SharedApplicationServer
 */
export class LinearEventTransport
	extends EventEmitter
	implements ApplicationModule
{
	private webhookPath: string;
	private verificationMethod: WebhookVerificationMethod;

	constructor(config: LinearEventTransportConfig = {}) {
		super();
		this.webhookPath = config.path || config.webhookPath || "/webhook";

		// Determine verification method based on environment variables
		const isDirectWebhooks =
			process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase().trim() === "true";
		if (isDirectWebhooks && process.env.LINEAR_WEBHOOK_SECRET) {
			this.verificationMethod = "linear";
		} else if (process.env.CYRUS_API_KEY) {
			this.verificationMethod = "api-key";
		} else {
			this.verificationMethod = "api-key"; // Default to api-key verification
		}

		console.log(
			`🔐 Linear event transport initialized with ${this.verificationMethod} verification`,
		);
	}

	/**
	 * Handle incoming webhook requests
	 */
	async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
		_url: URL,
	): Promise<void> {
		// Only handle POST requests
		if (req.method !== "POST") {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("Method Not Allowed");
			return;
		}

		try {
			// Read request body
			let body = "";
			await new Promise<void>((resolve, reject) => {
				req.on("data", (chunk) => {
					body += chunk.toString();
				});

				req.on("end", () => {
					resolve();
				});

				req.on("error", reject);
			});

			// Verify webhook signature based on verification method
			const isValid = await this.verifyWebhookSignature(body, req.headers);

			if (!isValid) {
				console.log(`🔐 Webhook signature verification failed`);
				res.writeHead(401, { "Content-Type": "text/plain" });
				res.end("Unauthorized");
				return;
			}

			// Parse payload
			let payload: LinearWebhookPayload;
			try {
				payload = JSON.parse(body);
			} catch (error) {
				console.error(`🔐 Failed to parse webhook payload:`, error);
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Bad Request");
				return;
			}

			// Emit webhook event
			this.emit("webhook", payload);

			// Send success response
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: true }));

			console.log(`🔐 Linear webhook received and processed`);
		} catch (error) {
			console.error(`🔐 Error handling webhook request:`, error);
			this.emit("error", error as Error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Verify webhook signature based on the configured verification method
	 */
	private async verifyWebhookSignature(
		body: string,
		headers: IncomingMessage["headers"],
	): Promise<boolean> {
		if (this.verificationMethod === "linear") {
			return this.verifyLinearSignature(body, headers);
		} else {
			return this.verifyApiKeySignature(headers);
		}
	}

	/**
	 * Verify Linear webhook signature using LINEAR_WEBHOOK_SECRET
	 */
	private verifyLinearSignature(
		body: string,
		headers: IncomingMessage["headers"],
	): boolean {
		const secret = process.env.LINEAR_WEBHOOK_SECRET;
		if (!secret) {
			console.error("LINEAR_WEBHOOK_SECRET is not set");
			return false;
		}

		const signature = headers["linear-signature"] as string;
		if (!signature) {
			console.log("Missing linear-signature header");
			return false;
		}

		// Create HMAC
		const hmac = createHmac("sha256", secret);
		hmac.update(body);
		const computedSignature = hmac.digest("hex");

		// Compare signatures (constant-time comparison)
		return computedSignature === signature;
	}

	/**
	 * Verify API key from Authorization header
	 */
	private verifyApiKeySignature(headers: IncomingMessage["headers"]): boolean {
		const apiKey = process.env.CYRUS_API_KEY;
		if (!apiKey) {
			console.error("CYRUS_API_KEY is not set");
			return false;
		}

		const authHeader = headers.authorization as string;
		if (!authHeader) {
			console.log("Missing authorization header");
			return false;
		}

		// Expect "Bearer <api-key>" format
		const [scheme, token] = authHeader.split(" ");
		if (scheme !== "Bearer") {
			console.log("Invalid authorization scheme");
			return false;
		}

		// Compare tokens (constant-time comparison)
		return token === apiKey;
	}

	/**
	 * Get the webhook path
	 */
	getWebhookPath(): string {
		return this.webhookPath;
	}

	/**
	 * Get the verification method
	 */
	getVerificationMethod(): WebhookVerificationMethod {
		return this.verificationMethod;
	}
}
