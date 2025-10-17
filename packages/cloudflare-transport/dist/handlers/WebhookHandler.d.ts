import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { AuthManager } from "../AuthManager.js";
import type { HandlerResult } from "../types.js";
export interface WebhookHandlerConfig {
	authManager: AuthManager;
	webhookSecret?: string;
}
/**
 * Handles Linear webhook payloads
 */
export declare class WebhookHandler extends EventEmitter {
	private config;
	constructor(config: WebhookHandlerConfig);
	/**
	 * Handle incoming webhook request
	 */
	handle(req: IncomingMessage, body: string): Promise<HandlerResult>;
	/**
	 * Validate webhook payload structure
	 */
	private validateWebhookPayload;
}
//# sourceMappingURL=WebhookHandler.d.ts.map
