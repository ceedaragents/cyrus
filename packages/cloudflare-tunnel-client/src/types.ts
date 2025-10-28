import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

/**
 * Configuration for the Cloudflare tunnel client
 */
export interface CloudflareTunnelClientConfig {
	cyrusHome: string; // ~/.cyrus directory path
	onWebhook?: (payload: LinearWebhookPayload) => void; // Callback for webhooks
	onConfigUpdate?: () => void; // Callback when config is updated
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
	configUpdate: () => void;
	error: (error: Error) => void;
	ready: (tunnelUrl: string) => void;
	restart: (reason: "config" | "env") => void;
}
