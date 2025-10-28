import { createHmac } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { EdgeEvent, NdjsonClientConfig, StatusUpdate } from "../types.js";
import { BaseTransport } from "./BaseTransport.js";

/**
 * Webhook transport for receiving events via HTTP webhooks
 */
export class WebhookTransport extends BaseTransport {
	private server: ReturnType<typeof createServer> | null = null;
	private webhookSecret: string | null = null;
	private webhookUrl: string;

	constructor(config: NdjsonClientConfig) {
		super(config);
		// Webhook secret will be obtained from registration response

		// Build webhook URL using webhookBaseUrl if provided, otherwise construct from parts
		if (config.webhookBaseUrl) {
			const baseUrl = config.webhookBaseUrl.replace(/\/$/, ""); // Remove trailing slash
			const path = (config.webhookPath || "/webhook").replace(/^\//, ""); // Remove leading slash
			this.webhookUrl = `${baseUrl}/${path}`;
		} else {
			const host = config.webhookHost || "localhost";
			const port = config.webhookPort || 3000;
			const path = config.webhookPath || "/webhook";
			this.webhookUrl = `http://${host}:${port}${path}`;
		}
	}

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				if (
					this.config.useExternalWebhookServer &&
					this.config.externalWebhookServer
				) {
					// Use external webhook server - register with proxy then with external server
					this.connected = true;
					this.emit("connect");

					this.registerWebhook()
						.then(() => this.registerWithExternalServer())
						.then(() => resolve())
						.catch(reject);
				} else {
					// Create HTTP server to receive webhooks
					this.server = createServer((req, res) => {
						this.handleWebhookRequest(req, res);
					});

					const port = this.config.webhookPort || 3000;
					const host = this.config.webhookHost || "localhost";

					this.server.listen(port, host, () => {
						this.connected = true;
						this.emit("connect");

						// Register webhook with proxy
						this.registerWebhook()
							.then(() => resolve())
							.catch(reject);
					});

					this.server.on("error", (error) => {
						this.connected = false;
						this.emit("error", error);
						reject(error);
					});
				}
			} catch (error) {
				this.connected = false;
				this.emit("error", error as Error);
				reject(error);
			}
		});
	}

	disconnect(): void {
		if (this.server) {
			this.server.removeAllListeners();
			this.server.close();
			this.server = null;
		}
		this.connected = false;
		this.emit("disconnect", "Transport disconnected");
	}

	async sendStatus(update: StatusUpdate): Promise<void> {
		try {
			const response = await fetch(`${this.config.proxyUrl}/events/status`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.config.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(update),
			});

			if (!response.ok) {
				throw new Error(`Failed to send status: ${response.status}`);
			}
		} catch (error) {
			this.emit("error", error as Error);
		}
	}

	private async registerWebhook(): Promise<void> {
		try {
			// Get webhook URL from external server if available, otherwise use configured URL
			let webhookUrl = this.webhookUrl;
			if (
				this.config.useExternalWebhookServer &&
				this.config.externalWebhookServer
			) {
				// Check if external server has getWebhookUrl method
				if (
					typeof this.config.externalWebhookServer.getWebhookUrl === "function"
				) {
					webhookUrl = this.config.externalWebhookServer.getWebhookUrl();
					console.log(`📡 Registering webhook URL: ${webhookUrl}`);
				}
			}

			const response = await fetch(`${this.config.proxyUrl}/edge/register`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.config.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					webhookUrl: webhookUrl,
					linearToken: this.config.token,
					name: this.config.name || "Unknown Edge Worker",
					capabilities: this.config.capabilities || ["linear-processing"],
				}),
			});

			if (!response.ok) {
				let errorMessage = `Failed to register webhook: ${response.status} ${response.statusText}`;

				// Try to get more detailed error message from response
				try {
					const errorData = (await response.json()) as { error?: string };
					if (errorData.error) {
						errorMessage = errorData.error;
					}
				} catch {
					// Ignore JSON parsing errors
				}

				// Create a more specific error for authentication failures
				if (
					response.status === 400 &&
					(errorMessage.includes("Authentication required") ||
						errorMessage.includes("Invalid token or no workspace access"))
				) {
					const authError = new Error(
						`Linear authentication failed for ${this.config.name}. The Linear OAuth token may have expired or been revoked. Please re-authenticate with Linear to obtain a new token.`,
					);
					(authError as any).code = "LINEAR_AUTH_FAILED";
					(authError as any).isAuthError = true;
					throw authError;
				}

				throw new Error(errorMessage);
			}

			const result = (await response.json()) as { webhookSecret: string };
			this.webhookSecret = result.webhookSecret;

			if (!this.webhookSecret) {
				throw new Error("Registration did not return webhook secret");
			}
		} catch (error) {
			this.emit("error", error as Error);
			throw error;
		}
	}

	private async handleWebhookRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			if (req.method !== "POST") {
				res.writeHead(405, { "Content-Type": "text/plain" });
				res.end("Method Not Allowed");
				return;
			}

			// Read request body
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});

			req.on("end", () => {
				try {
					// Verify webhook signature
					const signature = req.headers["x-webhook-signature"] as string;
					const timestamp = req.headers["x-webhook-timestamp"] as string;
					if (!this.verifySignature(body, signature, timestamp)) {
						res.writeHead(401, { "Content-Type": "text/plain" });
						res.end("Unauthorized");
						return;
					}

					// Parse and handle event
					const event = JSON.parse(body) as EdgeEvent;
					this.handleEvent(event);

					res.writeHead(200, { "Content-Type": "text/plain" });
					res.end("OK");
				} catch (error) {
					this.emit("error", error as Error);
					res.writeHead(400, { "Content-Type": "text/plain" });
					res.end("Bad Request");
				}
			});

			req.on("error", (error) => {
				this.emit("error", error);
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("Internal Server Error");
			});
		} catch (error) {
			this.emit("error", error as Error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	private verifySignature(
		body: string,
		signature: string,
		timestamp?: string,
	): boolean {
		if (!signature || !this.webhookSecret) return false;

		// Include timestamp in signature verification to match proxy format
		const payload = timestamp ? `${timestamp}.${body}` : body;
		const expectedSignature = createHmac("sha256", this.webhookSecret)
			.update(payload)
			.digest("hex");

		return signature === `sha256=${expectedSignature}`;
	}

	/**
	 * Register with external webhook server for shared webhook handling
	 */
	async registerWithExternalServer(): Promise<void> {
		if (!this.config.externalWebhookServer || !this.webhookSecret) {
			throw new Error(
				"External webhook server or webhook secret not available",
			);
		}

		// Check if server supports new event-based registration (recommended)
		if (
			typeof this.config.externalWebhookServer.registerWebhookEventHandler ===
			"function"
		) {
			// New event-based registration: receives pre-verified payloads
			// No need to verify signatures - verification strategies handle that
			this.config.externalWebhookServer.registerWebhookEventHandler(
				this.config.token,
				(payload: any) => {
					this.handleEvent(payload);
				},
			);
		} else if (
			typeof this.config.externalWebhookServer.registerWebhookHandler ===
			"function"
		) {
			// Legacy registration: verify signatures for proxy-style webhooks
			this.config.externalWebhookServer.registerWebhookHandler(
				this.config.token,
				this.webhookSecret,
				(body: string, signature: string, timestamp?: string) => {
					if (this.verifySignature(body, signature, timestamp)) {
						const event = JSON.parse(body);
						this.handleEvent(event);
						return true; // Signature verified and handled
					}
					return false; // Signature not verified
				},
			);
		}
	}

	/**
	 * Get webhook secret for external registration
	 */
	getWebhookSecret(): string | null {
		return this.webhookSecret;
	}
}
