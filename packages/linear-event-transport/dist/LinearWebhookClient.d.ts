import { EventEmitter } from "node:events";
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
export declare class LinearWebhookClient extends EventEmitter {
	private transport;
	constructor(config: LinearWebhookClientConfig);
	/**
	 * Connect to the webhook server and start receiving events
	 */
	connect(): Promise<void>;
	/**
	 * Send status update to proxy
	 */
	sendStatus(update: StatusUpdate): Promise<void>;
	/**
	 * Disconnect from the webhook server
	 */
	disconnect(): void;
	/**
	 * Check if client is connected
	 */
	isConnected(): boolean;
}
//# sourceMappingURL=LinearWebhookClient.d.ts.map
