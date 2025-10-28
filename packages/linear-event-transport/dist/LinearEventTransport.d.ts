import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
/**
 * Module handler that processes HTTP requests for a specific path
 */
export interface ApplicationModule {
	initialize?(server: any): Promise<void>;
	handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void>;
	destroy?(): Promise<void>;
}
/**
 * Verification method for Linear webhooks
 */
export type WebhookVerificationMethod = "linear" | "api-key";
/**
 * Linear event transport configuration
 */
export interface LinearEventTransportConfig {
	path?: string;
	verificationMethod?: WebhookVerificationMethod;
	webhookPath?: string;
}
/**
 * Events emitted by LinearEventTransport
 */
export interface LinearEventTransportEvents {
	webhook: (payload: LinearWebhookPayload) => void;
	error: (error: Error) => void;
}
/**
 * Linear event transport module for handling Linear webhooks
 * Implements the ApplicationModule interface for registration with SharedApplicationServer
 */
export declare class LinearEventTransport
	extends EventEmitter
	implements ApplicationModule
{
	private webhookPath;
	private verificationMethod;
	constructor(config?: LinearEventTransportConfig);
	/**
	 * Handle incoming webhook requests
	 */
	handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
		_url: URL,
	): Promise<void>;
	/**
	 * Verify webhook signature based on the configured verification method
	 */
	private verifyWebhookSignature;
	/**
	 * Verify Linear webhook signature using LINEAR_WEBHOOK_SECRET
	 */
	private verifyLinearSignature;
	/**
	 * Verify API key from Authorization header
	 */
	private verifyApiKeySignature;
	/**
	 * Get the webhook path
	 */
	getWebhookPath(): string;
	/**
	 * Get the verification method
	 */
	getVerificationMethod(): WebhookVerificationMethod;
}
//# sourceMappingURL=LinearEventTransport.d.ts.map
