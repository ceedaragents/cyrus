import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import {
	LinearWebhookClient,
	type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import type { LinearWebhookClientConfig, StatusUpdate } from "../types.js";
import { BaseTransport } from "./BaseTransport.js";

/**
 * Webhook transport for receiving events via HTTP webhooks
 * Uses the Linear SDK webhook client for signature verification and handling
 */
export class WebhookTransport extends BaseTransport {
	private server: ReturnType<typeof createServer> | null = null;
	private webhookClient: LinearWebhookClient | null = null;
	private webhookUrl: string;

	constructor(config: LinearWebhookClientConfig) {
		super(config);

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
				// Get webhook secret from environment variable
				const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
				if (!webhookSecret) {
					throw new Error(
						"LINEAR_WEBHOOK_SECRET environment variable is not set",
					);
				}

				// Create Linear webhook client
				this.webhookClient = new LinearWebhookClient(webhookSecret);
				const webhookHandler = this.webhookClient.createHandler();

				// Register handler for all webhook events
				webhookHandler.on("*", (payload: LinearWebhookPayload) => {
					// Pass the Linear webhook payload directly
					this.handleWebhook(payload);
				});

				if (
					this.config.useExternalWebhookServer &&
					this.config.externalWebhookServer
				) {
					// Use external webhook server
					this.connected = true;
					this.emit("connect");

					// Register with external server
					this.registerWithExternalServer(webhookHandler)
						.then(() => resolve())
						.catch(reject);
				} else {
					// Create HTTP server to receive webhooks
					this.server = createServer(async (req, res) => {
						try {
							// Use Linear SDK webhook handler
							await webhookHandler(req, res);
						} catch (error) {
							console.error("Error handling webhook:", error);
							res.writeHead(500, { "Content-Type": "text/plain" });
							res.end("Internal Server Error");
						}
					});

					const port = this.config.webhookPort || 3000;
					const host = this.config.webhookHost || "localhost";

					this.server.listen(port, host, () => {
						this.connected = true;
						this.emit("connect");
						console.log(`📡 Webhook server listening on ${this.webhookUrl}`);
						console.log(`   Expecting webhooks to be forwarded to this URL`);
						resolve();
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
		this.webhookClient = null;
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

	/**
	 * Register with external webhook server for shared webhook handling
	 */
	async registerWithExternalServer(webhookHandler: any): Promise<void> {
		if (!this.config.externalWebhookServer) {
			throw new Error("External webhook server not available");
		}

		// Register this transport instance with the external server
		if (
			typeof this.config.externalWebhookServer.registerWebhookHandler ===
			"function"
		) {
			// Use the Linear SDK webhook handler directly
			this.config.externalWebhookServer.registerWebhookHandler(
				this.config.token,
				async (req: IncomingMessage, res: ServerResponse) => {
					await webhookHandler(req, res);
				},
			);
		}
	}

	/**
	 * Get webhook URL for external registration
	 */
	getWebhookUrl(): string {
		if (
			this.config.useExternalWebhookServer &&
			this.config.externalWebhookServer &&
			typeof this.config.externalWebhookServer.getWebhookUrl === "function"
		) {
			return this.config.externalWebhookServer.getWebhookUrl();
		}
		return this.webhookUrl;
	}
}
