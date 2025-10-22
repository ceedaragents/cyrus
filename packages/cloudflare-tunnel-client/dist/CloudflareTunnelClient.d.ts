import { EventEmitter } from "node:events";
import type {
	CloudflareTunnelClientConfig,
	CloudflareTunnelClientEvents,
} from "./types.js";
export declare interface CloudflareTunnelClient {
	on<K extends keyof CloudflareTunnelClientEvents>(
		event: K,
		listener: CloudflareTunnelClientEvents[K],
	): this;
	emit<K extends keyof CloudflareTunnelClientEvents>(
		event: K,
		...args: Parameters<CloudflareTunnelClientEvents[K]>
	): boolean;
}
/**
 * Cloudflare tunnel client for receiving config updates and webhooks from cyrus-hosted
 */
export declare class CloudflareTunnelClient extends EventEmitter {
	private config;
	private server;
	private tunnelProcess;
	private tunnelUrl;
	private apiKey;
	private connected;
	constructor(config: CloudflareTunnelClientConfig);
	/**
	 * Authenticate with customer ID and start the tunnel
	 */
	authenticate(): Promise<void>;
	/**
	 * Start the Cloudflare tunnel
	 */
	private startTunnel;
	/**
	 * Start the local HTTP server
	 */
	private startLocalServer;
	/**
	 * Wait for tunnel URL to be available
	 */
	private waitForTunnelUrl;
	/**
	 * Handle incoming HTTP requests
	 */
	private handleRequest;
	/**
	 * Verify authentication header
	 */
	private verifyAuth;
	/**
	 * Read request body
	 */
	private readBody;
	/**
	 * Store API key in config for persistence
	 */
	private storeApiKey;
	/**
	 * Get the tunnel URL
	 */
	getTunnelUrl(): string | null;
	/**
	 * Check if client is connected
	 */
	isConnected(): boolean;
	/**
	 * Disconnect and cleanup
	 */
	disconnect(): void;
}
//# sourceMappingURL=CloudflareTunnelClient.d.ts.map
