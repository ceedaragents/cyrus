import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

/**
 * Configuration for the Cloudflare tunnel client
 */
export interface CloudflareTunnelClientConfig {
	onWebhook?: (payload: LinearWebhookPayload) => void; // Callback for webhooks
	onError?: (error: Error) => void; // Error callback
	onReady?: (tunnelUrl: string) => void; // Called when tunnel is ready
}

/**
 * Event emitted by CloudflareTunnelClient
 */
export interface CloudflareTunnelClientEvents {
	connect: () => void;
	disconnect: (reason: string) => void;
	webhook: (payload: LinearWebhookPayload) => void;
	error: (error: Error) => void;
	ready: (tunnelUrl: string) => void;
}

/**
 * Error response to send back to cyrus-hosted
 */
export interface ErrorResponse {
	success: false;
	error: string;
	details?: string;
}

/**
 * Success response to send back to cyrus-hosted
 */
export interface SuccessResponse {
	success: true;
	message: string;
	data?: any;
}

export type ApiResponse = SuccessResponse | ErrorResponse;
