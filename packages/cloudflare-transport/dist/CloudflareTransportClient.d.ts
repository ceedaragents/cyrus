import { EventEmitter } from "node:events";
import type {
	CloudflareTransportConfig,
	CloudflareTransportEvents,
} from "./types.js";
export declare interface CloudflareTransportClient {
	on<K extends keyof CloudflareTransportEvents>(
		event: K,
		listener: CloudflareTransportEvents[K],
	): this;
	emit<K extends keyof CloudflareTransportEvents>(
		event: K,
		...args: Parameters<CloudflareTransportEvents[K]>
	): boolean;
}
/**
 * Cloudflare tunnel-based transport client for Cyrus
 * Receives webhook payloads and configuration updates from cyrus-hosted
 */
export declare class CloudflareTransportClient extends EventEmitter {
	private config;
	private configManager;
	private authManager;
	private tunnel?;
	private httpServer?;
	private isRunning;
	constructor(config: CloudflareTransportConfig);
	/**
	 * Start the transport client
	 */
	start(): Promise<void>;
	/**
	 * Start the HTTP server
	 */
	private startHttpServer;
	/**
	 * Start the Cloudflare tunnel
	 */
	private startTunnel;
	/**
	 * Validate customer ID with cyrus-hosted
	 */
	private validateCustomer;
	/**
	 * Register tunnel URL with cyrus-hosted
	 */
	private registerTunnelUrl;
	/**
	 * Stop the transport client
	 */
	stop(): Promise<void>;
	/**
	 * Check if transport is running
	 */
	isConnected(): boolean;
	/**
	 * Get current configuration
	 */
	getConfig(): any;
	/**
	 * Get tunnel status
	 */
	getTunnelStatus(): any;
	/**
	 * Update customer ID
	 */
	setCustomerId(customerId: string): void;
}
//# sourceMappingURL=CloudflareTransportClient.d.ts.map
