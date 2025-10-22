import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
import { install } from "cloudflared";
import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig, readCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import { handleGitHubCredentials } from "./handlers/githubCredentials.js";
import { handleRepository } from "./handlers/repository.js";
import { handleTestMcp } from "./handlers/testMcp.js";
import { SubscriptionValidator } from "./SubscriptionValidator.js";
import type {
	ApiResponse,
	CloudflareTunnelClientConfig,
	CloudflareTunnelClientEvents,
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	GitHubCredentialsPayload,
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
 */
export class CloudflareTunnelClient extends EventEmitter {
	private config: CloudflareTunnelClientConfig;
	private server: Server | null = null;
	private tunnelProcess: ChildProcess | null = null;
	private tunnelUrl: string | null = null;
	private apiKey: string | null = null;
	private connected = false;

	constructor(config: CloudflareTunnelClientConfig) {
		super();
		this.config = config;

		// Forward config callbacks to events
		if (config.onWebhook) this.on("webhook", config.onWebhook);
		if (config.onConfigUpdate) this.on("configUpdate", config.onConfigUpdate);
		if (config.onError) this.on("error", config.onError);
		if (config.onReady) this.on("ready", config.onReady);
	}

	/**
	 * Authenticate with customer ID and start the tunnel
	 */
	async authenticate(): Promise<void> {
		try {
			const subscriptionStatus = await SubscriptionValidator.validate(
				this.config.customerId,
			);

			// Check if subscription is valid
			if (!SubscriptionValidator.isValid(subscriptionStatus)) {
				if (!subscriptionStatus.hasActiveSubscription) {
					throw new Error(
						"No active subscription found. Please subscribe at https://www.atcyrus.com",
					);
				}

				if (subscriptionStatus.requiresPayment) {
					throw new Error(
						"Payment required. Please update your payment method at https://www.atcyrus.com",
					);
				}

				throw new Error("Authentication failed: Missing required credentials");
			}

			// Store API key for authentication
			this.apiKey = subscriptionStatus.apiKey!;

			// Store API key in config for persistence
			await this.storeApiKey(this.apiKey);

			// Start Cloudflare tunnel
			await this.startTunnel(subscriptionStatus.cloudflareToken!);
		} catch (error) {
			this.emit("error", error as Error);
			throw error;
		}
	}

	/**
	 * Start the Cloudflare tunnel
	 */
	private async startTunnel(cloudflareToken: string): Promise<void> {
		try {
			// Ensure cloudflared binary is installed
			const bin = await install(cloudflareToken);

			// Create HTTP server first
			this.server = createServer((req, res) => {
				this.handleRequest(req, res);
			});

			// Start server on a local port
			const port = await this.startLocalServer();

			// Start cloudflared tunnel pointing to our local server
			const { spawn } = await import("node:child_process");

			this.tunnelProcess = spawn(bin, [
				"tunnel",
				"--url",
				`http://localhost:${port}`,
			]);

			// Capture tunnel URL from cloudflared output
			this.tunnelProcess.stdout?.on("data", (data: Buffer) => {
				const output = data.toString();

				// Look for the tunnel URL in the output
				const urlMatch = output.match(
					/https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
				);
				if (urlMatch && !this.tunnelUrl) {
					this.tunnelUrl = urlMatch[0];
					this.connected = true;
					this.emit("connect");
					this.emit("ready", this.tunnelUrl);
				}
			});

			this.tunnelProcess.stderr?.on("data", (data: Buffer) => {
				const errorMessage = data.toString();
				this.emit("error", new Error(`Tunnel error: ${errorMessage}`));
			});

			this.tunnelProcess.on("exit", (code: number) => {
				this.connected = false;
				this.emit("disconnect", `Tunnel process exited with code ${code}`);
			});

			// Wait for tunnel URL to be available (with timeout)
			await this.waitForTunnelUrl(30000); // 30 second timeout
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
			this.server.listen(0, "localhost", () => {
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
	private async waitForTunnelUrl(timeout: number): Promise<void> {
		const startTime = Date.now();

		while (!this.tunnelUrl) {
			if (Date.now() - startTime > timeout) {
				throw new Error("Timeout waiting for tunnel URL");
			}

			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	/**
	 * Handle incoming HTTP requests
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
			let response: ApiResponse;

			// Parse JSON body safely
			let parsedBody: any;
			try {
				parsedBody = JSON.parse(body);
			} catch (error) {
				response = {
					success: false,
					error: "Invalid JSON in request body",
					details: error instanceof Error ? error.message : String(error),
				};
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify(response));
				return;
			}

			if (url === "/api/github-credential" && req.method === "POST") {
				response = await handleGitHubCredentials(
					parsedBody as GitHubCredentialsPayload,
				);
			} else if (url === "/api/cyrus-config" && req.method === "POST") {
				response = await handleCyrusConfig(
					parsedBody as CyrusConfigPayload,
					this.config.cyrusHome,
				);
				if (response.success) {
					this.emit("configUpdate");
				}
			} else if (url === "/api/cyrus-env" && req.method === "POST") {
				response = await handleCyrusEnv(
					parsedBody as CyrusEnvPayload,
					this.config.cyrusHome,
				);
			} else if (url === "/api/repository" && req.method === "POST") {
				response = await handleRepository(parsedBody as RepositoryPayload);
			} else if (url === "/api/test-mcp" && req.method === "POST") {
				response = await handleTestMcp(parsedBody as TestMcpPayload);
			} else if (url === "/api/configure-mcp" && req.method === "POST") {
				response = await handleConfigureMcp(
					parsedBody as ConfigureMcpPayload,
					this.config.cyrusHome,
				);
			} else if (url === "/webhook" && req.method === "POST") {
				// Handle Linear webhook
				this.emit("webhook", parsedBody as LinearWebhookPayload);
				response = { success: true, message: "Webhook received" };
			} else {
				response = {
					success: false,
					error: `Unknown endpoint: ${url}`,
				};
			}

			// Send response
			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.emit("error", error as Error);

			const response: ApiResponse = {
				success: false,
				error: "Internal server error",
				details: error instanceof Error ? error.message : String(error),
			};

			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify(response));
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
	 * Store API key in config for persistence
	 */
	private async storeApiKey(apiKey: string): Promise<void> {
		try {
			const config = readCyrusConfig(this.config.cyrusHome);
			config.apiKey = apiKey;
			config.stripeCustomerId = this.config.customerId;

			// Write back to config
			const { writeFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			const configPath = join(this.config.cyrusHome, "config.json");

			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
		} catch {
			// Don't throw - this is not critical
		}
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
