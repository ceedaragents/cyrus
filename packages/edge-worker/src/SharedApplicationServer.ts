import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { URL } from "node:url";
import type {
	HttpMethod,
	RequestHandler,
	RouteConfig,
} from "./handlers/types.js";

/**
 * Shared application server with modular handler registration
 * Provides a simple HTTP server with no default handlers
 */
export class SharedApplicationServer {
	private server: ReturnType<typeof createServer> | null = null;
	private routes = new Map<string, Map<HttpMethod, RequestHandler>>();
	private webhookHandlers = new Map<
		string,
		{
			secret: string;
			handler: (body: string, signature: string, timestamp?: string) => boolean;
		}
	>();
	// Separate handlers for LinearEventTransport that handle raw req/res
	private linearEventTransportHandlers = new Map<
		string,
		(req: IncomingMessage, res: ServerResponse) => Promise<void>
	>();
	private port: number;
	private host: string;
	private isListening = false;
	private cloudflareUrl: string | null = null;
	private cloudflared: any = null;

	constructor(port: number = 3456, host: string = "localhost") {
		this.port = port;
		this.host = host;
	}

	/**
	 * Register a route handler with the server
	 * @param method HTTP method (GET, POST, PUT, DELETE, PATCH)
	 * @param path Route path (e.g., "/oauth/authorize")
	 * @param handler Request handler function
	 */
	registerHandler(
		method: HttpMethod,
		path: string,
		handler: RequestHandler,
	): void {
		if (!this.routes.has(path)) {
			this.routes.set(path, new Map());
		}
		const methodMap = this.routes.get(path)!;
		methodMap.set(method, handler);
		console.log(`🔗 Registered ${method} ${path}`);
	}

	/**
	 * Register multiple routes at once
	 * @param routes Array of route configurations
	 */
	registerHandlers(routes: RouteConfig[]): void {
		for (const route of routes) {
			this.registerHandler(route.method, route.path, route.handler);
		}
	}

	/**
	 * Register a webhook handler for a specific token
	 * Supports two signatures:
	 * 1. For ndjson-client: (token, secret, handler)
	 * 2. For linear-event-transport: (token, handler) where handler takes (req, res)
	 */
	registerWebhookHandler(
		token: string,
		secretOrHandler:
			| string
			| ((req: IncomingMessage, res: ServerResponse) => Promise<void>),
		handler?: (body: string, signature: string, timestamp?: string) => boolean,
	): void {
		if (typeof secretOrHandler === "string" && handler) {
			// ndjson-client style registration
			this.webhookHandlers.set(token, { secret: secretOrHandler, handler });
			console.log(
				`🔗 Registered webhook handler (proxy-style) for token ending in ...${token.slice(-4)}`,
			);
		} else if (typeof secretOrHandler === "function") {
			// linear-event-transport style registration
			this.linearEventTransportHandlers.set(token, secretOrHandler);
			console.log(
				`🔗 Registered webhook handler (direct-style) for token ending in ...${token.slice(-4)}`,
			);
		} else {
			throw new Error("Invalid webhook handler registration parameters");
		}
	}

	/**
	 * Unregister a webhook handler
	 */
	unregisterWebhookHandler(token: string): void {
		const hadProxyHandler = this.webhookHandlers.delete(token);
		const hadDirectHandler = this.linearEventTransportHandlers.delete(token);
		if (hadProxyHandler || hadDirectHandler) {
			console.log(
				`🔗 Unregistered webhook handler for token ending in ...${token.slice(-4)}`,
			);
		}
	}

	/**
	 * Start the shared application server
	 * Optionally starts Cloudflare tunnel if CLOUDFLARE_TOKEN is set
	 */
	async start(): Promise<void> {
		if (this.isListening) {
			return; // Already listening
		}

		return new Promise((resolve, reject) => {
			this.server = createServer((req, res) => {
				this.handleRequest(req, res);
			});

			this.server.listen(this.port, this.host, async () => {
				this.isListening = true;
				console.log(
					`🔗 Shared application server listening on http://${this.host}:${this.port}`,
				);

				// Start Cloudflare tunnel if token is provided
				const cloudflareToken = process.env.CLOUDFLARE_TOKEN;
				if (cloudflareToken) {
					try {
						await this.startCloudflareTunnel(cloudflareToken);
					} catch (error) {
						console.error("🔴 Failed to start Cloudflare tunnel:", error);
						// Don't reject here - server can still work without tunnel
					}
				}

				resolve();
			});

			this.server.on("error", (error) => {
				this.isListening = false;
				reject(error);
			});
		});
	}

	/**
	 * Stop the shared application server
	 */
	async stop(): Promise<void> {
		// Stop Cloudflare tunnel first
		if (this.cloudflared) {
			try {
				await this.cloudflared.stop();
				this.cloudflared = null;
				this.cloudflareUrl = null;
				console.log("🔗 Cloudflare tunnel stopped");
			} catch (error) {
				console.error("🔴 Failed to stop Cloudflare tunnel:", error);
			}
		}

		if (this.server && this.isListening) {
			return new Promise((resolve) => {
				this.server!.close(() => {
					this.isListening = false;
					console.log("🔗 Shared application server stopped");
					resolve();
				});
			});
		}
	}

	/**
	 * Get the port number the server is listening on
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Get the base URL for the server (Cloudflare tunnel URL if available, otherwise local URL)
	 */
	getBaseUrl(): string {
		if (this.cloudflareUrl) {
			return this.cloudflareUrl;
		}
		return process.env.CYRUS_BASE_URL || `http://${this.host}:${this.port}`;
	}

	/**
	 * Get the public URL (Cloudflare tunnel URL if available, otherwise base URL)
	 */
	getPublicUrl(): string {
		// Use Cloudflare URL if available
		if (this.cloudflareUrl) {
			return this.cloudflareUrl;
		}
		// If CYRUS_BASE_URL is set (could be from external proxy), use that
		if (process.env.CYRUS_BASE_URL) {
			return process.env.CYRUS_BASE_URL;
		}
		// Default to local URL
		return `http://${this.host}:${this.port}`;
	}

	/**
	 * Get the webhook URL for registration with proxy
	 */
	getWebhookUrl(): string {
		return `${this.getPublicUrl()}/webhook`;
	}

	/**
	 * Get the OAuth callback URL for registration with proxy
	 */
	getOAuthCallbackUrl(): string {
		return `http://${this.host}:${this.port}/callback`;
	}

	/**
	 * Start Cloudflare tunnel for the server
	 */
	private async startCloudflareTunnel(token: string): Promise<void> {
		try {
			console.log("🔗 Starting Cloudflare tunnel...");

			// Dynamically import cloudflared
			const { Tunnel } = await import("cloudflared");

			// Create tunnel with token-based authentication
			const tunnel = Tunnel.withToken(token);

			// Listen for URL event
			tunnel.on("url", (url: string) => {
				if (!url.startsWith("http")) {
					url = `https://${url}`;
				}
				if (!this.cloudflareUrl) {
					this.cloudflareUrl = url;
					console.log(`🌐 Cloudflare tunnel active: ${this.cloudflareUrl}`);

					// Override CYRUS_BASE_URL with Cloudflare URL
					process.env.CYRUS_BASE_URL = this.cloudflareUrl;
				}
			});

			// Listen for connection event
			tunnel.on("connected", (connection: any) => {
				console.log("Cloudflare tunnel connection established:", connection);
			});

			// Listen for error and exit events
			tunnel.on("error", (error: Error) => {
				console.error("🔴 Cloudflare tunnel error:", error);
			});

			tunnel.on("exit", (code: number | null) => {
				console.log(`Cloudflare tunnel exited with code ${code}`);
			});

			// Store tunnel (connection happens automatically via event listeners)
			this.cloudflared = tunnel;
		} catch (error) {
			console.error("🔴 Failed to start Cloudflare tunnel:", error);
			throw error;
		}
	}

	/**
	 * Handle incoming requests by routing to registered handlers
	 */
	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			const url = new URL(req.url!, `http://${this.host}:${this.port}`);
			const method = req.method as HttpMethod;

			// Special handling for /webhook path (supports both proxy and direct webhooks)
			if (url.pathname === "/webhook") {
				await this.handleWebhookRequest(req, res);
				return;
			}

			// Check if we have a registered handler for this route
			const methodMap = this.routes.get(url.pathname);
			if (methodMap) {
				const handler = methodMap.get(method);
				if (handler) {
					await handler(req, res);
					return;
				}
			}

			// No handler found
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not Found");
		} catch (error) {
			console.error("🔗 Request handling error:", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle incoming webhook requests (supports both proxy and direct webhooks)
	 */
	private async handleWebhookRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			console.log(`🔗 Incoming webhook request: ${req.method} ${req.url}`);

			if (req.method !== "POST") {
				console.log(`🔗 Rejected non-POST request: ${req.method}`);
				res.writeHead(405, { "Content-Type": "text/plain" });
				res.end("Method Not Allowed");
				return;
			}

			// Check if this is a direct Linear webhook (has linear-signature header)
			const linearSignature = req.headers["linear-signature"] as string;
			const isDirectWebhook = !!linearSignature;

			if (isDirectWebhook && this.linearEventTransportHandlers.size > 0) {
				// For direct Linear webhooks, pass the raw request to the handler
				// The LinearEventTransport will handle its own signature verification
				console.log(
					`🔗 Direct Linear webhook received, trying ${this.linearEventTransportHandlers.size} direct handlers`,
				);

				// Try each direct handler
				for (const [token, handler] of this.linearEventTransportHandlers) {
					try {
						// The handler will manage the response
						await handler(req, res);
						console.log(
							`🔗 Direct webhook delivered to token ending in ...${token.slice(-4)}`,
						);
						return;
					} catch (error) {
						console.error(
							`🔗 Error in direct webhook handler for token ...${token.slice(-4)}:`,
							error,
						);
					}
				}

				// No direct handler could process it
				console.error(
					`🔗 Direct webhook processing failed for all ${this.linearEventTransportHandlers.size} handlers`,
				);
				res.writeHead(401, { "Content-Type": "text/plain" });
				res.end("Unauthorized");
				return;
			}

			// Otherwise, handle as proxy-style webhook
			// Read request body
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});

			req.on("end", () => {
				try {
					// For proxy-style webhooks, we need the signature header
					const signature = req.headers["x-webhook-signature"] as string;
					const timestamp = req.headers["x-webhook-timestamp"] as string;

					console.log(
						`🔗 Proxy webhook received with ${body.length} bytes, ${this.webhookHandlers.size} registered handlers`,
					);

					if (!signature) {
						console.log("🔗 Webhook rejected: Missing signature header");
						res.writeHead(400, { "Content-Type": "text/plain" });
						res.end("Missing signature");
						return;
					}

					// Try each registered handler until one verifies the signature
					let handlerAttempts = 0;
					for (const [token, { handler }] of this.webhookHandlers) {
						handlerAttempts++;
						try {
							if (handler(body, signature, timestamp)) {
								// Handler verified signature and processed webhook
								res.writeHead(200, { "Content-Type": "text/plain" });
								res.end("OK");
								console.log(
									`🔗 Webhook delivered to token ending in ...${token.slice(-4)} (attempt ${handlerAttempts}/${this.webhookHandlers.size})`,
								);
								return;
							}
						} catch (error) {
							console.error(
								`🔗 Error in webhook handler for token ...${token.slice(-4)}:`,
								error,
							);
						}
					}

					// No handler could verify the signature
					console.error(
						`🔗 Webhook signature verification failed for all ${this.webhookHandlers.size} registered handlers`,
					);
					res.writeHead(401, { "Content-Type": "text/plain" });
					res.end("Unauthorized");
				} catch (error) {
					console.error("🔗 Error processing webhook:", error);
					res.writeHead(400, { "Content-Type": "text/plain" });
					res.end("Bad Request");
				}
			});

			req.on("error", (error) => {
				console.error("🔗 Request error:", error);
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("Internal Server Error");
			});
		} catch (error) {
			console.error("🔗 Webhook request error:", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}
}
