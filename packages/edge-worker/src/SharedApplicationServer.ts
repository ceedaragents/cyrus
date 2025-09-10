import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { URL } from "node:url";
import { execSync } from "node:child_process";
import { forward } from "@ngrok/ngrok";

/**
 * OAuth callback handler interface
 */
export type OAuthCallbackHandler = (
	token: string,
	workspaceId: string,
	workspaceName: string,
) => Promise<void>;

/**
 * OAuth callback state for tracking flows
 */
export interface OAuthCallback {
	resolve: (credentials: {
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}) => void;
	reject: (error: Error) => void;
	id: string;
}

/**
 * Shared application server that handles both webhooks and OAuth callbacks on a single port
 * Consolidates functionality from SharedWebhookServer and CLI OAuth server
 */
export class SharedApplicationServer {
	private server: ReturnType<typeof createServer> | null = null;
	private webhookHandlers = new Map<
		string,
		{
			secret: string;
			handler: (body: string, signature: string, timestamp?: string) => boolean;
		}
	>();
	// Separate handlers for LinearWebhookClient that handle raw req/res
	private linearWebhookHandlers = new Map<
		string,
		(req: IncomingMessage, res: ServerResponse) => Promise<void>
	>();
	private oauthCallbacks = new Map<string, OAuthCallback>();
	private oauthCallbackHandler: OAuthCallbackHandler | null = null;
	private port: number;
	private host: string;
	private isListening = false;
	private ngrokListener: any = null;
	private ngrokAuthToken: string | null = null;
	private ngrokUrl: string | null = null;
	private proxyUrl: string;

	constructor(
		port: number = 3456,
		host: string = "localhost",
		ngrokAuthToken?: string,
		proxyUrl?: string,
	) {
		this.port = port;
		this.host = host;
		this.ngrokAuthToken = ngrokAuthToken || null;
		this.proxyUrl =
			proxyUrl ||
			process.env.PROXY_URL ||
			"https://cyrus-proxy.ceedar.workers.dev";
	}

	/**
	 * Start the shared application server
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
				
				// Log GitHub token endpoint status
				if (process.env.MANAGE_GH_AUTH === "true") {
					console.log(
						`🔐 GitHub token endpoint enabled at http://${this.host}:${this.port}/github-token`,
					);
				}

				// Start ngrok tunnel if auth token is provided and not external host
				if (this.ngrokAuthToken && process.env.CYRUS_HOST_EXTERNAL !== "true") {
					try {
						await this.startNgrokTunnel();
					} catch (error) {
						console.error("🔴 Failed to start ngrok tunnel:", error);
						// Don't reject here - server can still work without ngrok
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
		// Stop ngrok tunnel first
		if (this.ngrokListener) {
			try {
				await this.ngrokListener.close();
				this.ngrokListener = null;
				this.ngrokUrl = null;
				console.log("🔗 Ngrok tunnel stopped");
			} catch (error) {
				console.error("🔴 Failed to stop ngrok tunnel:", error);
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
	 * Get the base URL for the server (ngrok URL if available, otherwise local URL)
	 */
	getBaseUrl(): string {
		if (this.ngrokUrl) {
			return this.ngrokUrl;
		}
		return process.env.CYRUS_BASE_URL || `http://${this.host}:${this.port}`;
	}

	/**
	 * Start ngrok tunnel for the server
	 */
	private async startNgrokTunnel(): Promise<void> {
		if (!this.ngrokAuthToken) {
			return;
		}

		try {
			console.log("🔗 Starting ngrok tunnel...");
			this.ngrokListener = await forward({
				addr: this.port,
				authtoken: this.ngrokAuthToken,
			});

			this.ngrokUrl = this.ngrokListener.url();
			console.log(`🌐 Ngrok tunnel active: ${this.ngrokUrl}`);

			// Override CYRUS_BASE_URL with ngrok URL
			process.env.CYRUS_BASE_URL = this.ngrokUrl || undefined;
		} catch (error) {
			console.error("🔴 Failed to start ngrok tunnel:", error);
			throw error;
		}
	}

	/**
	 * Register a webhook handler for a specific token
	 * Supports two signatures:
	 * 1. For ndjson-client: (token, secret, handler)
	 * 2. For linear-webhook-client: (token, handler) where handler takes (req, res)
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
			// linear-webhook-client style registration
			this.linearWebhookHandlers.set(token, secretOrHandler);
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
		const hadDirectHandler = this.linearWebhookHandlers.delete(token);
		if (hadProxyHandler || hadDirectHandler) {
			console.log(
				`🔗 Unregistered webhook handler for token ending in ...${token.slice(-4)}`,
			);
		}
	}

	/**
	 * Register an OAuth callback handler
	 */
	registerOAuthCallbackHandler(handler: OAuthCallbackHandler): void {
		this.oauthCallbackHandler = handler;
		console.log("🔐 Registered OAuth callback handler");
	}

	/**
	 * Start OAuth flow and return promise that resolves when callback is received
	 */
	async startOAuthFlow(proxyUrl: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}> {
		return new Promise<{
			linearToken: string;
			linearWorkspaceId: string;
			linearWorkspaceName: string;
		}>((resolve, reject) => {
			// Generate unique ID for this flow
			const flowId = Date.now().toString();

			// Store callback for this flow
			this.oauthCallbacks.set(flowId, { resolve, reject, id: flowId });

			// Construct OAuth URL with callback
			const callbackBaseUrl = this.getBaseUrl();
			const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

			console.log(`\n👉 Opening your browser to authorize with Linear...`);
			console.log(`If the browser doesn't open, visit: ${authUrl}`);

			// Timeout after 5 minutes
			setTimeout(
				() => {
					if (this.oauthCallbacks.has(flowId)) {
						this.oauthCallbacks.delete(flowId);
						reject(new Error("OAuth timeout"));
					}
				},
				5 * 60 * 1000,
			);
		});
	}

	/**
	 * Get the public URL (ngrok URL if available, otherwise base URL)
	 */
	getPublicUrl(): string {
		// Use ngrok URL if available
		if (this.ngrokUrl) {
			return this.ngrokUrl;
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
	 * Handle incoming requests (both webhooks and OAuth callbacks)
	 */
	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			const url = new URL(req.url!, `http://${this.host}:${this.port}`);

			if (url.pathname === "/webhook") {
				await this.handleWebhookRequest(req, res);
			} else if (url.pathname === "/callback") {
				await this.handleOAuthCallback(req, res, url);
			} else if (url.pathname === "/github-token" && process.env.MANAGE_GH_AUTH === "true") {
				await this.handleGitHubTokenRequest(req, res);
			} else {
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found");
			}
		} catch (error) {
			console.error("🔗 Request handling error:", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle incoming webhook requests
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

			if (isDirectWebhook && this.linearWebhookHandlers.size > 0) {
				// For direct Linear webhooks, pass the raw request to the handler
				// The LinearWebhookClient will handle its own signature verification
				console.log(
					`🔗 Direct Linear webhook received, trying ${this.linearWebhookHandlers.size} direct handlers`,
				);

				// Try each direct handler
				for (const [token, handler] of this.linearWebhookHandlers) {
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
					`🔗 Direct webhook processing failed for all ${this.linearWebhookHandlers.size} handlers`,
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

	/**
	 * Handle OAuth callback requests
	 */
	private async handleOAuthCallback(
		_req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void> {
		try {
			const token = url.searchParams.get("token");
			const workspaceId = url.searchParams.get("workspaceId");
			const workspaceName = url.searchParams.get("workspaceName");

			if (token && workspaceId && workspaceName) {
				// Success! Return the Linear credentials
				const linearCredentials = {
					linearToken: token,
					linearWorkspaceId: workspaceId,
					linearWorkspaceName: workspaceName,
				};

				// Send success response
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Authorization Successful</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>✅ Authorization Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
              <p>Your Linear workspace <strong>${workspaceName}</strong> has been connected.</p>
              <p style="margin-top: 30px;">
                <a href="${this.proxyUrl}/oauth/authorize?callback=${process.env.CYRUS_BASE_URL || `http://${this.host}:${this.port}`}/callback" 
                   style="padding: 10px 20px; background: #5E6AD2; color: white; text-decoration: none; border-radius: 5px;">
                  Connect Another Workspace
                </a>
              </p>
              <script>setTimeout(() => window.close(), 10000)</script>
            </body>
          </html>
        `);

				console.log(
					`🔐 OAuth callback received for workspace: ${workspaceName}`,
				);

				// Resolve any waiting promises
				if (this.oauthCallbacks.size > 0) {
					const callback = this.oauthCallbacks.values().next().value;
					if (callback) {
						callback.resolve(linearCredentials);
						this.oauthCallbacks.delete(callback.id);
					}
				}

				// Call the registered OAuth callback handler
				if (this.oauthCallbackHandler) {
					try {
						await this.oauthCallbackHandler(token, workspaceId, workspaceName);
					} catch (error) {
						console.error("🔐 Error in OAuth callback handler:", error);
					}
				}
			} else {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end("<h1>Error: No token received</h1>");

				// Reject any waiting promises
				for (const [id, callback] of this.oauthCallbacks) {
					callback.reject(new Error("No token received"));
					this.oauthCallbacks.delete(id);
				}
			}
		} catch (error) {
			console.error("🔐 OAuth callback error:", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle GitHub token requests when MANAGE_GH_AUTH is enabled
	 */
	private async handleGitHubTokenRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			console.log(`🔗 Incoming GitHub token request: ${req.method} ${req.url}`);

			if (req.method !== "POST") {
				console.log(`🔗 Rejected non-POST request: ${req.method}`);
				res.writeHead(405, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Method Not Allowed" }));
				return;
			}

			// Read request body
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});

			req.on("end", () => {
				try {
					// Parse JSON body
					const data = JSON.parse(body);
					const githubToken = data.token;

					if (!githubToken) {
						console.log("🔗 GitHub token request rejected: Missing token in body");
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Missing token in request body" }));
						return;
					}

					// Update gh auth credentials
					try {
						console.log("🔐 Updating GitHub auth credentials...");
						
						// First, log out any existing session
						try {
							execSync("gh auth logout --hostname github.com", {
								stdio: "pipe",
								encoding: "utf-8",
							});
						} catch (e) {
							// Ignore logout errors - might not be logged in
						}

						// Login with the new token using stdin
						execSync(`echo "${githubToken}" | gh auth login --with-token`, {
							stdio: "pipe",
							encoding: "utf-8",
						});

						// Verify the login was successful
						const status = execSync("gh auth status", {
							encoding: "utf-8",
						});

						console.log("✅ GitHub auth credentials updated successfully");
						console.log("🔐 Auth status:", status);

						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ 
							success: true, 
							message: "GitHub auth credentials updated successfully" 
						}));
					} catch (error) {
						console.error("❌ Failed to update GitHub auth credentials:", error);
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ 
							error: "Failed to update GitHub auth credentials",
							details: (error as Error).message
						}));
					}
				} catch (error) {
					console.error("🔗 Error processing GitHub token request:", error);
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Invalid request body" }));
				}
			});

			req.on("error", (error) => {
				console.error("🔗 Request error:", error);
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Internal Server Error" }));
			});
		} catch (error) {
			console.error("🔗 GitHub token request error:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Internal Server Error" }));
		}
	}
}
