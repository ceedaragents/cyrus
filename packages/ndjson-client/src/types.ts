/**
 * Types for NDJSON client communication with proxy
 */

import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

export interface EdgeEvent {
	id: string;
	type: "connection" | "heartbeat" | "webhook" | "error";
	timestamp: string;
	data?: LinearWebhookPayload | {
		message: string;
		edge_id?: string;
		code?: string;
	};
}

export interface ConnectionEvent extends EdgeEvent {
	type: "connection";
	data: {
		message: string;
		edge_id?: string;
	};
}

export interface HeartbeatEvent extends EdgeEvent {
	type: "heartbeat";
}

export interface WebhookEvent extends EdgeEvent {
	type: "webhook";
	data: LinearWebhookPayload;
}

export interface ErrorEvent extends EdgeEvent {
	type: "error";
	data: {
		message: string;
		code?: string;
	};
}

export interface StatusUpdate {
	eventId: string;
	status: "processing" | "completed" | "failed";
	error?: string;
	metadata?: Record<string, any>;
}

export interface NdjsonClientConfig {
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
	// External webhook server support
	externalWebhookServer?: any; // External server instance (like Express app or HTTP server)
	useExternalWebhookServer?: boolean; // Whether to use external server instead of creating own
	onEvent?: (event: EdgeEvent) => void;
	onConnect?: () => void;
	onDisconnect?: (reason?: string) => void;
	onError?: (error: Error) => void;
}

export interface NdjsonClientEvents {
	connect: () => void;
	disconnect: (reason?: string) => void;
	event: (event: EdgeEvent) => void;
	webhook: (data: LinearWebhookPayload) => void;
	heartbeat: () => void;
	error: (error: Error) => void;
}