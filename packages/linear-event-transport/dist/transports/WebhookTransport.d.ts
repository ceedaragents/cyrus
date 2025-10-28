import type { LinearWebhookClientConfig, StatusUpdate } from "../types.js";
import { BaseTransport } from "./BaseTransport.js";
/**
 * Webhook transport for receiving events via HTTP webhooks
 * Uses the Linear SDK webhook client for signature verification and handling
 */
export declare class WebhookTransport extends BaseTransport {
	private server;
	private webhookClient;
	private webhookUrl;
	constructor(config: LinearWebhookClientConfig);
	connect(): Promise<void>;
	disconnect(): void;
	sendStatus(update: StatusUpdate): Promise<void>;
	/**
	 * Register with external webhook server for shared webhook handling
	 */
	registerWithExternalServer(webhookHandler: any): Promise<void>;
	/**
	 * Get webhook URL for external registration
	 */
	getWebhookUrl(): string;
}
//# sourceMappingURL=WebhookTransport.d.ts.map
