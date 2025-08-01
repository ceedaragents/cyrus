import { EventEmitter } from "node:events";
import type { EdgeEvent, NdjsonClientConfig, StatusUpdate } from "../types.js";

/**
 * Base transport class for NDJSON client communication
 */
export abstract class BaseTransport extends EventEmitter {
	protected config: NdjsonClientConfig;
	protected connected = false;

	constructor(config: NdjsonClientConfig) {
		super();
		this.config = config;
	}

	/**
	 * Connect to the proxy and start receiving events
	 */
	abstract connect(): Promise<void>;

	/**
	 * Disconnect from the proxy
	 */
	abstract disconnect(): void;

	/**
	 * Send status update to proxy
	 */
	abstract sendStatus(update: StatusUpdate): Promise<void>;

	/**
	 * Check if transport is connected
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Handle events from the transport
	 */
	protected handleEvent(event: EdgeEvent): void {
		this.emit("event", event);

		switch (event.type) {
			case "connection":
				break;
			case "heartbeat":
				this.emit("heartbeat");
				break;
			case "webhook":
				this.emit("webhook", event.data);
				break;
			case "error":
				this.emit("error", new Error(event.data?.message || "Unknown error"));
				break;
		}
	}
}
