import { EventEmitter } from "node:events";
import type {
	LinearEventTransportConfig,
	LinearEventTransportEvents,
} from "./types.js";
export declare interface LinearEventTransport {
	on<K extends keyof LinearEventTransportEvents>(
		event: K,
		listener: LinearEventTransportEvents[K],
	): this;
	emit<K extends keyof LinearEventTransportEvents>(
		event: K,
		...args: Parameters<LinearEventTransportEvents[K]>
	): boolean;
}
/**
 * LinearEventTransport - Handles Linear webhook event delivery
 *
 * This class registers a POST /webhook endpoint with a Fastify server
 * and verifies incoming webhooks using either:
 * 1. LINEAR_DIRECT_WEBHOOKS mode: Verifies Linear's webhook signature
 * 2. Proxy mode: Verifies Bearer token authentication
 */
export declare class LinearEventTransport extends EventEmitter {
	private config;
	private linearWebhookClient;
	constructor(config: LinearEventTransportConfig);
	/**
	 * Register the /webhook endpoint with the Fastify server
	 */
	register(): void;
	/**
	 * Handle webhook in direct mode using Linear's signature verification
	 */
	private handleDirectWebhook;
	/**
	 * Handle webhook in proxy mode using Bearer token authentication
	 */
	private handleProxyWebhook;
}
//# sourceMappingURL=LinearEventTransport.d.ts.map
