import { LinearWebhookClient } from "@linear/sdk/webhooks";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { EdgeEvent, NdjsonClientConfig, StatusUpdate } from "../types.js";
import { BaseTransport } from "./BaseTransport.js";

/**
 * Webhook transport using the Linear SDK for webhook handling
 * This implementation leverages the official Linear SDK for signature verification
 * and provides better type safety and automatic updates.
 */
export class WebhookTransportSDK extends BaseTransport {
	private server: ReturnType<typeof createServer> | null = null;
	private webhookSecret: string | null = null;
	private webhookUrl: string;
	private linearWebhookClient: LinearWebhookClient | null = null;
	private handler: ReturnType<LinearWebhookClient["createHandler"]> | null = null;

	constructor(config: NdjsonClientConfig) {
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
					this.server = createServer(async (req, res) => {
						await this.handleWebhookRequest(req, res);
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
		if (this.handler) {
			// Remove all event listeners from the SDK handler
			this.handler.removeAllListeners();
			this.handler = null;
		}
		this.linearWebhookClient = null;
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

			// Initialize the Linear SDK webhook client with the secret
			this.linearWebhookClient = new LinearWebhookClient(this.webhookSecret);
			this.handler = this.linearWebhookClient.createHandler();

			// Register a wildcard handler to process all events
			this.handler.on("*", (payload: LinearWebhookPayload) => {
				this.handleWebhookPayload(payload);
			});
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
			if (!this.handler) {
				res.writeHead(503, { "Content-Type": "text/plain" });
				res.end("Service Unavailable - Handler not initialized");
				return;
			}

			if (req.method !== "POST") {
				res.writeHead(405, { "Content-Type": "text/plain" });
				res.end("Method Not Allowed");
				return;
			}

			// The Linear SDK's handler can work with Node.js IncomingMessage/ServerResponse
			// It will automatically verify the signature and handle the webhook
			await this.handler(req, res);
		} catch (error) {
			this.emit("error", error as Error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle webhook payload from the Linear SDK
	 */
	private handleWebhookPayload(payload: LinearWebhookPayload): void {
		try {
			// Transform the Linear SDK webhook payload to our EdgeEvent format
			// The payload is a union type, so we need to handle it generically
			const event: EdgeEvent = {
				id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				type: "webhook",
				timestamp: new Date().toISOString(),
				data: payload as any, // The payload structure varies by webhook type
			};

			// Emit the event to be handled by the transport listeners
			this.handleEvent(event);
		} catch (error) {
			this.emit("error", error as Error);
		}
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

		// Register this transport instance with the external server
		if (
			typeof this.config.externalWebhookServer.registerWebhookHandler ===
			"function"
		) {
			// Create a Linear SDK client for the external server to use
			const externalClient = new LinearWebhookClient(this.webhookSecret);
			const externalHandler = externalClient.createHandler();

			// Register our handler with the external server
			externalHandler.on("*", (payload: LinearWebhookPayload) => {
				this.handleWebhookPayload(payload);
			});

			// Register the handler function with the external server
			this.config.externalWebhookServer.registerWebhookHandler(
				this.config.token,
				this.webhookSecret,
				async (body: string, _signature: string, _timestamp?: string) => {
					// Parse and handle the webhook payload directly
					// The external server already verified the signature
					try {
						const payload = JSON.parse(body) as LinearWebhookPayload;
						this.handleWebhookPayload(payload);
						return true;
					} catch {
						return false;
					}
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