import type { NdjsonClientConfig, StatusUpdate } from "../types.js";
import { BaseTransport } from "./BaseTransport.js";
/**
 * Webhook transport for receiving events via HTTP webhooks
 */
export declare class WebhookTransport extends BaseTransport {
	private server;
	private webhookSecret;
	private webhookUrl;
	constructor(config: NdjsonClientConfig);
	connect(): Promise<void>;
	disconnect(): void;
	sendStatus(update: StatusUpdate): Promise<void>;
	private registerWebhook;
	private handleWebhookRequest;
	private verifySignature;
	/**
	 * Register with external webhook server for shared webhook handling
	 */
	registerWithExternalServer(): Promise<void>;
	/**
	 * Get webhook secret for external registration
	 */
	getWebhookSecret(): string | null;
}
//# sourceMappingURL=WebhookTransport.d.ts.map
