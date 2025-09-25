import { EventEmitter } from "node:events";
/**
 * Base transport class for NDJSON client communication
 */
export class BaseTransport extends EventEmitter {
	config;
	connected = false;
	constructor(config) {
		super();
		this.config = config;
	}
	/**
	 * Check if transport is connected
	 */
	isConnected() {
		return this.connected;
	}
	/**
	 * Handle events from the transport
	 */
	handleEvent(event) {
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
//# sourceMappingURL=BaseTransport.js.map
