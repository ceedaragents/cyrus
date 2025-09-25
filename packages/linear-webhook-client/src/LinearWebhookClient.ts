import { EventEmitter } from "node:events";
import type { BaseTransport } from "./transports/BaseTransport.js";
import { WebhookTransport } from "./transports/WebhookTransport.js";
import type {
	LinearWebhookClientConfig,
	LinearWebhookClientEvents,
	StatusUpdate,
} from "./types.js";

export declare interface LinearWebhookClient {
	on<K extends keyof LinearWebhookClientEvents>(
		event: K,
		listener: LinearWebhookClientEvents[K],
	): this;
	emit<K extends keyof LinearWebhookClientEvents>(
		event: K,
		...args: Parameters<LinearWebhookClientEvents[K]>
	): boolean;
}

/**
 * Linear webhook client for handling Linear webhooks
 */
export class LinearWebhookClient extends EventEmitter {
	private transport: BaseTransport;

	constructor(config: LinearWebhookClientConfig) {
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
	async connect(): Promise<void> {
		return this.transport.connect();
	}

	/**
	 * Send status update to proxy
	 */
	async sendStatus(update: StatusUpdate): Promise<void> {
		return this.transport.sendStatus(update);
	}

	/**
	 * Disconnect from the webhook server
	 */
	disconnect(): void {
		this.transport.disconnect();
	}

	/**
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.transport.isConnected();
	}
}
