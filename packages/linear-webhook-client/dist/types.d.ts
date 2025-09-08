/**
 * Types for Linear webhook client
 */
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
export interface StatusUpdate {
	eventId: string;
	status: "processing" | "completed" | "failed";
	error?: string;
	metadata?: Record<string, any>;
}
export interface LinearWebhookClientConfig {
	proxyUrl: string;
	token: string;
	transport: "webhook";
	webhookPort?: number;
	webhookPath?: string;
	webhookHost?: string;
	webhookBaseUrl?: string;
	name?: string;
	capabilities?: string[];
	maxReconnectAttempts?: number;
	reconnectBaseDelay?: number;
	reconnectOnStreamEnd?: boolean;
	externalWebhookServer?: any;
	useExternalWebhookServer?: boolean;
	onWebhook?: (payload: LinearWebhookPayload) => void;
	onConnect?: () => void;
	onDisconnect?: (reason?: string) => void;
	onError?: (error: Error) => void;
}
export interface LinearWebhookClientEvents {
	connect: () => void;
	disconnect: (reason?: string) => void;
	webhook: (payload: LinearWebhookPayload) => void;
	error: (error: Error) => void;
}
//# sourceMappingURL=types.d.ts.map
