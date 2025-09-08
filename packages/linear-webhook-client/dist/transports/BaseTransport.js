import { EventEmitter } from "node:events";
/**
 * Base transport class for Linear webhook client communication
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
	 * Handle webhook payload from Linear
	 */
	handleWebhook(payload) {
		this.emit("webhook", payload);
	}
}
//# sourceMappingURL=BaseTransport.js.map
