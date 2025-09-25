import { EventEmitter } from "node:events";
import { WebhookTransport } from "./transports/WebhookTransport.js";
/**
 * NDJSON streaming client for proxy communication
 */
export class NdjsonClient extends EventEmitter {
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
	 * Disconnect from the proxy
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
//# sourceMappingURL=NdjsonClient.js.map
