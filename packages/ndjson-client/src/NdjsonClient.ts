import { EventEmitter } from "node:events";
import type { BaseTransport } from "./transports/BaseTransport.js";
import { WebhookTransport } from "./transports/WebhookTransport.js";
import type {
	NdjsonClientConfig,
	NdjsonClientEvents,
	StatusUpdate,
} from "./types.js";

export declare interface NdjsonClient {
	on<K extends keyof NdjsonClientEvents>(
		event: K,
		listener: NdjsonClientEvents[K],
	): this;
	emit<K extends keyof NdjsonClientEvents>(
		event: K,
		...args: Parameters<NdjsonClientEvents[K]>
	): boolean;
}

/**
 * NDJSON streaming client for proxy communication
 */
export class NdjsonClient extends EventEmitter {
	private transport: BaseTransport;

	constructor(config: NdjsonClientConfig) {
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
		this.transport.on("event", (event) => this.emit("event", event));
		this.transport.on("webhook", (data) => this.emit("webhook", data));
		this.transport.on("heartbeat", () => this.emit("heartbeat"));
		this.transport.on("error", (error) => this.emit("error", error));

		// Forward config callbacks to events
		if (config.onEvent) this.on("event", config.onEvent);
		if (config.onConnect) this.on("connect", config.onConnect);
		if (config.onDisconnect) this.on("disconnect", config.onDisconnect);
		if (config.onError) this.on("error", config.onError);
	}

	/**
	 * Connect to the proxy and start receiving events
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
	 * Disconnect from the proxy
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
