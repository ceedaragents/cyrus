import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
import { bin, install, Tunnel } from "cloudflared";
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
 * Cloudflare tunnel client for receiving webhooks from cyrus-hosted
 */
export class CloudflareTunnelClient extends EventEmitter {
	private server: Server | null = null;
	private tunnelProcess: ChildProcess | null = null;
	private tunnelUrl: string | null = null;
	private apiKey: string | null = null;
	private connected = false;
	private connectionCount = 0;

	constructor(config: CloudflareTunnelClientConfig = {}) {
		super();

		// Forward config callbacks to events
		if (config.onWebhook) this.on("webhook", config.onWebhook);
		if (config.onError) this.on("error", config.onError);
		if (config.onReady) this.on("ready", config.onReady);
	}

	/**
	 * Start the Cloudflare tunnel with the provided token and API key
	 */
	async startTunnel(cloudflareToken: string, apiKey: string): Promise<void> {
		// Store API key for authentication
		this.apiKey = apiKey;
		try {
			// Ensure cloudflared binary is installed
			if (!existsSync(bin)) {
				await install(bin);
			}

			// Create HTTP server first
			this.server = createServer((req, res) => {
				this.handleRequest(req, res);
			});

			// Start server on a local port
			const port = await this.startLocalServer();
			console.log(`Started server on localhost:${port}`);

			// Create tunnel with token-based authentication (no URL needed for remotely-managed tunnels)
			const tunnel = Tunnel.withToken(cloudflareToken);

			// Listen for URL event (from ConfigHandler for token-based tunnels)
			tunnel.on("url", (url: string) => {
				// Ensure URL has protocol for token-based tunnels
				if (!url.startsWith("http")) {
					url = `https://${url}`;
				}
				if (!this.tunnelUrl) {
					this.tunnelUrl = url;
					this.emit("ready", this.tunnelUrl);
				}
			});

			// Listen for connection event (Cloudflare establishes 4 connections per tunnel)
			tunnel.on("connected", (connection: any) => {
				this.connectionCount++;
				console.log(
					`Cloudflare tunnel connection ${this.connectionCount}/4 established:`,
					connection,
				);

				// Mark as connected on first connection, but log all 4
				if (!this.connected) {
					this.connected = true;
					this.emit("connect");
				}
			});

			// Listen for error event
			tunnel.on("error", (error: Error) => {
				this.emit("error", error);
			});

			// Listen for exit event
			tunnel.on("exit", (code: number | null) => {
				this.connected = false;
				this.emit("disconnect", `Tunnel process exited with code ${code}`);
			});

			// Wait for tunnel URL to be available (with timeout)
			await this.waitForTunnelToConnect(30000); // 30 second timeout
		} catch (error) {
			this.emit("error", error as Error);
			throw error;
		}
	}

	/**
	 * Start the local HTTP server
	 */
	private async startLocalServer(): Promise<number> {
		return new Promise((resolve, reject) => {
			if (!this.server) {
				reject(new Error("Server not initialized"));
				return;
			}

			// Use port 0 to let the OS assign an available port
			this.server.listen(3456, "localhost", () => {
				const address = this.server?.address();
				if (address && typeof address === "object") {
					resolve(address.port);
				} else {
					reject(new Error("Failed to get server port"));
				}
			});

			this.server.on("error", (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Wait for tunnel URL to be available
	 */
	private async waitForTunnelToConnect(timeout: number): Promise<void> {
		const startTime = Date.now();

		while (!this.connected) {
			if (Date.now() - startTime > timeout) {
				throw new Error("Timeout waiting for tunnel URL");
			}

			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	/**
	 * Handle incoming HTTP requests
	 * Note: This only handles webhook events. Config updates are handled by ConfigUpdater module.
	 */
	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			// Verify authentication
			const authHeader = req.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}

			// Read request body
			const body = await this.readBody(req);

			// Route request based on URL
			const url = req.url || "/";

			// Parse JSON body safely
			let parsedBody: any;
			try {
				parsedBody = JSON.parse(body);
			} catch (error) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						success: false,
						error: "Invalid JSON in request body",
						details: error instanceof Error ? error.message : String(error),
					}),
				);
				return;
			}

			if (url === "/webhook" && req.method === "POST") {
				// Handle Linear webhook
				this.emit("webhook", parsedBody as LinearWebhookPayload);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: true, message: "Webhook received" }));
			} else {
				// All other endpoints should be handled by ConfigUpdater or other modules
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						success: false,
						error: `Unknown endpoint: ${url}`,
					}),
				);
			}
		} catch (error) {
			this.emit("error", error as Error);

			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}

	/**
	 * Verify authentication header
	 */
	private verifyAuth(authHeader: string | undefined): boolean {
		if (!authHeader || !this.apiKey) {
			return false;
		}

		const expectedAuth = `Bearer ${this.apiKey}`;
		return authHeader === expectedAuth;
	}

	/**
	 * Read request body
	 */
	private async readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = "";

			req.on("data", (chunk) => {
				body += chunk.toString();
			});

			req.on("end", () => {
				resolve(body);
			});

			req.on("error", (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Get the tunnel URL
	 */
	getTunnelUrl(): string | null {
		return this.tunnelUrl;
	}

	/**
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Disconnect and cleanup
	 */
	disconnect(): void {
		if (this.tunnelProcess) {
			this.tunnelProcess.kill();
			this.tunnelProcess = null;
		}

		if (this.server) {
			this.server.close();
			this.server = null;
		}

		this.connected = false;
		this.emit("disconnect", "Client disconnected");
	}
}
