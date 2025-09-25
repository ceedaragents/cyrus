/**
 * Types for NDJSON client communication with proxy
 */
export interface EdgeEvent {
	id: string;
	type: "connection" | "heartbeat" | "webhook" | "error";
	timestamp: string;
	data?: any;
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
	data: {
		type: string;
		action?: string;
		createdAt: string;
		data?: any;
		notification?: any;
		issue?: any;
		comment?: any;
		[key: string]: any;
	};
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
	externalWebhookServer?: any;
	useExternalWebhookServer?: boolean;
	onEvent?: (event: EdgeEvent) => void;
	onConnect?: () => void;
	onDisconnect?: (reason?: string) => void;
	onError?: (error: Error) => void;
}
export interface NdjsonClientEvents {
	connect: () => void;
	disconnect: (reason?: string) => void;
	event: (event: EdgeEvent) => void;
	webhook: (data: WebhookEvent["data"]) => void;
	heartbeat: () => void;
	error: (error: Error) => void;
}
//# sourceMappingURL=types.d.ts.map
