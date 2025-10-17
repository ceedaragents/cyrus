import { EventEmitter } from "node:events";
import type { TunnelStatus } from "./types.js";
export interface CloudflareTunnelConfig {
	token: string;
	port: number;
	retryAttempts?: number;
	retryDelay?: number;
}
/**
 * Manages Cloudflare tunnel lifecycle
 */
export declare class CloudflareTunnel extends EventEmitter {
	private config;
	private tunnelProcess?;
	private tunnelUrl?;
	private status;
	private retryCount;
	private isShuttingDown;
	constructor(config: CloudflareTunnelConfig);
	/**
	 * Start the Cloudflare tunnel
	 */
	start(): Promise<void>;
	/**
	 * Start the cloudflared process
	 */
	private startTunnelProcess;
	/**
	 * Wait for tunnel URL to be available
	 */
	private waitForTunnelUrl;
	/**
	 * Stop the Cloudflare tunnel
	 */
	stop(): Promise<void>;
	/**
	 * Get the tunnel URL
	 */
	getUrl(): string | undefined;
	/**
	 * Get tunnel status
	 */
	getStatus(): TunnelStatus;
	/**
	 * Check if tunnel is active
	 */
	isActive(): boolean;
	/**
	 * Utility delay function
	 */
	private delay;
}
//# sourceMappingURL=CloudflareTunnel.d.ts.map
