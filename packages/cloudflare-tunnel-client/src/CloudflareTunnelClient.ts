import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { bin, install, Tunnel } from "cloudflared";
import {
	handleConfigureMcp,
	handleCyrusConfig,
	handleCyrusEnv,
	handleRepository,
	handleTestMcp,
} from "./handlers/index.js";
import type {
	ApiResponse,
	CloudflareTunnelClientConfig,
	CloudflareTunnelClientEvents,
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	RepositoryPayload,
	TestMcpPayload,
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
 * Now uses SharedApplicationServer for HTTP handling instead of creating its own server
 */
export class CloudflareTunnelClient extends EventEmitter {
	private config: CloudflareTunnelClientConfig;
	private server: any; // SharedApplicationServer instance
	private tunnelProcess: ChildProcess | null = null;
	private tunnelUrl: string | null = null;
	private apiKey: string | null = null;
	private connected = false;
	private connectionCount = 0;
	private handlersRegistered = false;

	constructor(
		config: CloudflareTunnelClientConfig,
		server?: any, // SharedApplicationServer (optional for backward compatibility)
	) {
		super();
		this.config = config;
		this.server = server;

		// Forward config callbacks to events
		if (config.onWebhook) this.on("webhook", config.onWebhook);
		if (config.onConfigUpdate) this.on("configUpdate", config.onConfigUpdate);
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

			// Register handlers with SharedApplicationServer if provided
			if (this.server && !this.handlersRegistered) {
				this.registerHandlers();
				this.handlersRegistered = true;
			}

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
	 * Register Cloudflare-specific handlers with SharedApplicationServer
	 */
	private registerHandlers(): void {
		if (!this.server) {
			console.warn(
				"⚠️  No SharedApplicationServer provided, handlers not registered",
			);
			return;
		}

		console.log(
			"🔗 Registering Cloudflare tunnel handlers with SharedApplicationServer",
		);

		// Register each endpoint handler
		this.server.registerCustomHandler(
			"/api/update/cyrus-config",
			"POST",
			async (req: IncomingMessage, res: ServerResponse) => {
				await this.handleCyrusConfigRequest(req, res);
			},
		);

		this.server.registerCustomHandler(
			"/api/update/cyrus-env",
			"POST",
			async (req: IncomingMessage, res: ServerResponse) => {
				await this.handleCyrusEnvRequest(req, res);
			},
		);

		this.server.registerCustomHandler(
			"/api/update/repository",
			"POST",
			async (req: IncomingMessage, res: ServerResponse) => {
				await this.handleRepositoryRequest(req, res);
			},
		);

		this.server.registerCustomHandler(
			"/api/test-mcp",
			"POST",
			async (req: IncomingMessage, res: ServerResponse) => {
				await this.handleTestMcpRequest(req, res);
			},
		);

		this.server.registerCustomHandler(
			"/api/configure-mcp",
			"POST",
			async (req: IncomingMessage, res: ServerResponse) => {
				await this.handleConfigureMcpRequest(req, res);
			},
		);

		// Register webhook verification strategy (uses unified /webhook endpoint)
		this.server.registerWebhookVerificationStrategy({
			name: "cloudflare-api-key",
			verify: async (req: IncomingMessage) => {
				return this.verifyWebhook(req);
			},
		});

		console.log("✅ Cloudflare tunnel handlers registered successfully");
	}

	/**
	 * Verify webhook request using CYRUS_API_KEY
	 * Used by the webhook verification strategy
	 *
	 * Note: This method only performs verification. The SharedApplicationServer
	 * will parse the payload and emit it to registered webhook event handlers.
	 */
	private async verifyWebhook(req: IncomingMessage): Promise<boolean> {
		try {
			// Verify authorization header
			if (!this.verifyAuth(req.headers.authorization)) {
				console.log(
					"🔐 Cloudflare webhook verification failed: Invalid API key",
				);
				return false;
			}

			console.log("🔐 Cloudflare webhook verified and processed successfully");
			return true;
		} catch (error) {
			console.error("🔐 Error verifying Cloudflare webhook:", error);
			return false;
		}
	}

	/**
	 * Handle /api/update/cyrus-config requests
	 */
	private async handleCyrusConfigRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			if (!this.verifyAuth(req.headers.authorization)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}

			const body = await this.readBody(req);
			const parsedBody = JSON.parse(body) as CyrusConfigPayload;

			const response = await handleCyrusConfig(
				parsedBody,
				this.config.cyrusHome,
			);

			if (response.success) {
				this.emit("configUpdate");
				if (response.data?.restartCyrus) {
					this.emit("restart", "config");
				}
			}

			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.handleError(error, res);
		}
	}

	/**
	 * Handle /api/update/cyrus-env requests
	 */
	private async handleCyrusEnvRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			if (!this.verifyAuth(req.headers.authorization)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}

			const body = await this.readBody(req);
			const parsedBody = JSON.parse(body) as CyrusEnvPayload;

			const response = await handleCyrusEnv(parsedBody, this.config.cyrusHome);

			if (response.success && response.data?.restartCyrus) {
				this.emit("restart", "env");
			}

			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.handleError(error, res);
		}
	}

	/**
	 * Handle /api/update/repository requests
	 */
	private async handleRepositoryRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			if (!this.verifyAuth(req.headers.authorization)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}

			const body = await this.readBody(req);
			const parsedBody = JSON.parse(body) as RepositoryPayload;

			const response = await handleRepository(
				parsedBody,
				this.config.cyrusHome,
			);

			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.handleError(error, res);
		}
	}

	/**
	 * Handle /api/test-mcp requests
	 */
	private async handleTestMcpRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			if (!this.verifyAuth(req.headers.authorization)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}

			const body = await this.readBody(req);
			const parsedBody = JSON.parse(body) as TestMcpPayload;

			const response = await handleTestMcp(parsedBody);

			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.handleError(error, res);
		}
	}

	/**
	 * Handle /api/configure-mcp requests
	 */
	private async handleConfigureMcpRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			if (!this.verifyAuth(req.headers.authorization)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}

			const body = await this.readBody(req);
			const parsedBody = JSON.parse(body) as ConfigureMcpPayload;

			const response = await handleConfigureMcp(
				parsedBody,
				this.config.cyrusHome,
			);

			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.handleError(error, res);
		}
	}

	/**
	 * Handle errors and send error response
	 */
	private handleError(error: unknown, res: ServerResponse): void {
		this.emit("error", error as Error);

		const response: ApiResponse = {
			success: false,
			error: "Internal server error",
			details: error instanceof Error ? error.message : String(error),
		};

		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify(response));
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

		// Note: We no longer close the server here since it's managed by SharedApplicationServer
		// The server is shared across multiple transport modes

		this.connected = false;
		this.emit("disconnect", "Client disconnected");
	}
}
