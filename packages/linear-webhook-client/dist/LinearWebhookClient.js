import { EventEmitter } from "node:events";
import { WebhookTransport } from "./transports/WebhookTransport.js";
/**
 * Linear webhook client for handling Linear webhooks
 */
export class LinearWebhookClient extends EventEmitter {
	transport;
	constructor(config) {
		super();
		// Validate transport
		if (config.transport !== "webhook") {
			throw new Error(
				`Unsupported transport: ${config.transport}. Only 'webhook' is supported.`,
			);
		}
		// Create transport
		this.transport = new WebhookTransport(config);
		// Forward transport events
		this.transport.on("connect", () => this.emit("connect"));
		this.transport.on("disconnect", (reason) =>
			this.emit("disconnect", reason),
		);
		this.transport.on("webhook", (payload) => this.emit("webhook", payload));
		this.transport.on("error", (error) => this.emit("error", error));
		// Forward config callbacks to events
		if (config.onWebhook) this.on("webhook", config.onWebhook);
		if (config.onConnect) this.on("connect", config.onConnect);
		if (config.onDisconnect) this.on("disconnect", config.onDisconnect);
		if (config.onError) this.on("error", config.onError);
	}
	/**
	 * Connect to the webhook server and start receiving events
	 */
	async connect() {
		return this.transport.connect();
	}
	/**
	 * Send status update to proxy
	 */
	async sendStatus(update) {
		return this.transport.sendStatus(update);
	}
	/**
	 * Disconnect from the webhook server
	 */
	disconnect() {
		this.transport.disconnect();
	}
	/**
	 * Check if client is connected
	 */
	isConnected() {
		return this.transport.isConnected();
	}
}
//# sourceMappingURL=LinearWebhookClient.js.map
