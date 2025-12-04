import type { IncomingMessage, ServerResponse } from "node:http";
import { LinearClient } from "@linear/sdk";
import { CloudflareTunnelClient } from "cyrus-cloudflare-tunnel-client";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * OAuth callback state for tracking flows
 */
export interface OAuthCallback {
	resolve: (credentials: {
		linearToken: string;
		linearRefreshToken?: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}) => void;
	reject: (error: Error) => void;
	id: string;
}

/**
 * Approval callback state for tracking approval workflows
 */
export interface ApprovalCallback {
	resolve: (approved: boolean, feedback?: string) => void;
	reject: (error: Error) => void;
	sessionId: string;
	createdAt: number;
}

/**
 * Configuration save callback for OAuth token persistence
 */
export type ConfigSaveCallback = (credentials: {
	linearToken: string;
	linearRefreshToken?: string;
	linearWorkspaceId: string;
	linearWorkspaceName: string;
}) => Promise<void>;

/**
 * Shared application server that handles both webhooks and OAuth callbacks on a single port
 * Consolidates functionality from SharedWebhookServer and CLI OAuth server
 */
export class SharedApplicationServer {
	private app: FastifyInstance | null = null;
	private webhookHandlers = new Map<
		string,
		{
			secret: string;
			handler: (body: string, signature: string, timestamp?: string) => boolean;
		}
	>();
	// Legacy handlers for direct Linear webhook registration (deprecated)
	private linearWebhookHandlers = new Map<
		string,
		(req: IncomingMessage, res: ServerResponse) => Promise<void>
	>();
	private oauthCallbacks = new Map<string, OAuthCallback>();
	private pendingApprovals = new Map<string, ApprovalCallback>();
	private port: number;
	private host: string;
	private isListening = false;
	private tunnelClient: CloudflareTunnelClient | null = null;
	private configSaveCallback?: ConfigSaveCallback;

	constructor(
		port: number = 3456,
		host: string = "localhost",
		configSaveCallback?: ConfigSaveCallback,
	) {
		this.port = port;
		this.host = host;
		this.configSaveCallback = configSaveCallback;
	}

	/**
	 * Initialize the Fastify app instance (must be called before registering routes)
	 */
	initializeFastify(): void {
		if (this.app) {
			return; // Already initialized
		}

		this.app = Fastify({
			logger: false,
		});

		// Register OAuth callback route
		this.registerOAuthCallbackRoute();
	}

	/**
	 * Register the OAuth callback route handler
	 */
	private registerOAuthCallbackRoute(): void {
		if (!this.app) {
			throw new Error("Fastify instance not initialized");
		}

		this.app.get("/callback", async (request, reply) => {
			try {
				// Extract authorization code from query parameters
				const { code } = request.query as { code?: string };

				if (!code) {
					console.error("❌ OAuth callback missing authorization code");
					return reply
						.type("text/html; charset=utf-8")
						.code(400)
						.send(`
						<html>
							<head><meta charset="UTF-8"></head>
							<body style="font-family: system-ui; padding: 40px; text-align: center;">
								<h2>❌ Authorization failed</h2>
								<p>Missing authorization code</p>
							</body>
						</html>
					`);
				}

				// Validate required environment variables
				const clientId = process.env.LINEAR_CLIENT_ID;
				const clientSecret = process.env.LINEAR_CLIENT_SECRET;
				const baseUrl = process.env.CYRUS_BASE_URL;

				if (!clientId || !clientSecret || !baseUrl) {
					console.error(
						"❌ OAuth callback missing required environment variables",
					);
					return reply
						.type("text/html; charset=utf-8")
						.code(500)
						.send(`
						<html>
							<head><meta charset="UTF-8"></head>
							<body style="font-family: system-ui; padding: 40px; text-align: center;">
								<h2>❌ Configuration error</h2>
								<p>Server is missing required OAuth configuration</p>
							</body>
						</html>
					`);
				}

				// Exchange authorization code for tokens
				const redirectUri = `${baseUrl}/callback`;
				const tokenResponse = await fetch(
					"https://api.linear.app/oauth/token",
					{
						method: "POST",
						headers: {
							"Content-Type": "application/x-www-form-urlencoded",
						},
						body: new URLSearchParams({
							code,
							redirect_uri: redirectUri,
							client_id: clientId,
							client_secret: clientSecret,
							grant_type: "authorization_code",
						}).toString(),
					},
				);

				if (!tokenResponse.ok) {
					const errorText = await tokenResponse.text();
					console.error(`❌ Token exchange failed: ${errorText}`);
					return reply
						.type("text/html; charset=utf-8")
						.code(500)
						.send(`
						<html>
							<head><meta charset="UTF-8"></head>
							<body style="font-family: system-ui; padding: 40px; text-align: center;">
								<h2>❌ Authorization failed</h2>
								<p>Failed to exchange authorization code for tokens</p>
							</body>
						</html>
					`);
				}

				const tokenData = (await tokenResponse.json()) as {
					access_token: string;
					refresh_token?: string;
					expires_in: number;
					token_type: string;
				};

				const accessToken = tokenData.access_token;
				const refreshToken = tokenData.refresh_token;

				if (!accessToken || !accessToken.startsWith("lin_oauth_")) {
					console.error("❌ Invalid access token received");
					return reply
						.type("text/html; charset=utf-8")
						.code(500)
						.send(`
						<html>
							<head><meta charset="UTF-8"></head>
							<body style="font-family: system-ui; padding: 40px; text-align: center;">
								<h2>❌ Authorization failed</h2>
								<p>Invalid token received from Linear</p>
							</body>
						</html>
					`);
				}

				// Fetch workspace information using Linear SDK
				const linearClient = new LinearClient({ accessToken });
				const viewer = await linearClient.viewer;
				const organization = await viewer.organization;
				const workspaceId = organization?.id;
				const workspaceName = organization?.name;

				if (!workspaceId) {
					console.error("❌ Failed to fetch workspace information");
					return reply
						.type("text/html; charset=utf-8")
						.code(500)
						.send(`
						<html>
							<head><meta charset="UTF-8"></head>
							<body style="font-family: system-ui; padding: 40px; text-align: center;">
								<h2>❌ Authorization failed</h2>
								<p>Failed to fetch workspace information</p>
							</body>
						</html>
					`);
				}

				console.log(
					`✅ OAuth successful for workspace: ${workspaceName || workspaceId}`,
				);

				// Save configuration if callback is provided
				if (this.configSaveCallback) {
					try {
						await this.configSaveCallback({
							linearToken: accessToken,
							linearRefreshToken: refreshToken,
							linearWorkspaceId: workspaceId,
							linearWorkspaceName: workspaceName || workspaceId,
						});
						console.log("✅ Tokens saved to configuration");
					} catch (saveError) {
						console.error(
							"❌ Failed to save tokens to configuration:",
							saveError,
						);
						// Continue anyway - the in-memory callback resolution will still work
					}
				}

				// Resolve any pending OAuth callbacks
				for (const [flowId, callback] of this.oauthCallbacks) {
					callback.resolve({
						linearToken: accessToken,
						linearRefreshToken: refreshToken,
						linearWorkspaceId: workspaceId,
						linearWorkspaceName: workspaceName || workspaceId,
					});
					this.oauthCallbacks.delete(flowId);
				}

				// Return success HTML
				return reply
					.type("text/html; charset=utf-8")
					.code(200)
					.send(`
					<html>
						<head><meta charset="UTF-8"></head>
						<body style="font-family: system-ui; padding: 40px; text-align: center;">
							<h2>✅ Authorization successful!</h2>
							<p>You can close this window and return to your terminal.</p>
							<script>setTimeout(() => window.close(), 2000);</script>
						</body>
					</html>
				`);
			} catch (error) {
				console.error("❌ OAuth callback error:", error);
				return reply
					.type("text/html; charset=utf-8")
					.code(500)
					.send(`
					<html>
						<head><meta charset="UTF-8"></head>
						<body style="font-family: system-ui; padding: 40px; text-align: center;">
							<h2>❌ Authorization failed</h2>
							<p>${error instanceof Error ? error.message : "Unknown error"}</p>
						</body>
					</html>
				`);
			}
		});

		console.log("🔗 Registered OAuth callback route: GET /callback");
	}

	/**
	 * Start the shared application server
	 */
	async start(): Promise<void> {
		if (this.isListening) {
			return; // Already listening
		}

		// Initialize Fastify if not already done
		this.initializeFastify();

		try {
			await this.app!.listen({
				port: this.port,
				host: this.host,
			});

			this.isListening = true;
			console.log(
				`🔗 Shared application server listening on http://${this.host}:${this.port}`,
			);

			// Start Cloudflare tunnel if CLOUDFLARE_TOKEN is set
			if (process.env.CLOUDFLARE_TOKEN) {
				await this.startCloudflareTunnel(process.env.CLOUDFLARE_TOKEN);
			}
		} catch (error) {
			this.isListening = false;
			throw error;
		}
	}

	/**
	 * Start Cloudflare tunnel and wait for 4 'connected' events
	 */
	private async startCloudflareTunnel(cloudflareToken: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let connectionCount = 0;
			const requiredConnections = 4;

			this.tunnelClient = new CloudflareTunnelClient(
				cloudflareToken,
				this.port,
			);

			// Listen for connection events (Cloudflare establishes 4 connections per tunnel)
			this.tunnelClient.on("connected", () => {
				connectionCount++;
				console.log(
					`🔗 Cloudflare tunnel connection ${connectionCount}/${requiredConnections} established`,
				);

				if (connectionCount === requiredConnections) {
					console.log("✅ Cloudflare tunnel fully connected and ready");
					resolve();
				}
			});

			// Listen for ready event to get tunnel URL
			this.tunnelClient.on("ready", (tunnelUrl: string) => {
				console.log(`🔗 Cloudflare tunnel URL: ${tunnelUrl}`);
			});

			// Listen for error events
			this.tunnelClient.on("error", (error: Error) => {
				console.error("❌ Cloudflare tunnel error:", error);
				reject(error);
			});

			// Listen for disconnect events
			this.tunnelClient.on("disconnect", (reason: string) => {
				console.log(`🔗 Cloudflare tunnel disconnected: ${reason}`);
			});

			// Start the tunnel
			this.tunnelClient.startTunnel().catch(reject);

			// Timeout after 30 seconds
			setTimeout(() => {
				if (connectionCount < requiredConnections) {
					reject(
						new Error(
							`Timeout waiting for Cloudflare tunnel (${connectionCount}/${requiredConnections} connections)`,
						),
					);
				}
			}, 30000);
		});
	}

	/**
	 * Stop the shared application server
	 */
	async stop(): Promise<void> {
		// Reject all pending approvals before shutdown
		for (const [sessionId, approval] of this.pendingApprovals) {
			approval.reject(new Error("Server shutting down"));
			console.log(
				`🔐 Rejected pending approval for session ${sessionId} due to shutdown`,
			);
		}
		this.pendingApprovals.clear();

		// Stop Cloudflare tunnel if running
		if (this.tunnelClient) {
			this.tunnelClient.disconnect();
			this.tunnelClient = null;
			console.log("🔗 Cloudflare tunnel stopped");
		}

		if (this.app && this.isListening) {
			await this.app.close();
			this.isListening = false;
			console.log("🔗 Shared application server stopped");
		}
	}

	/**
	 * Get the port number the server is listening on
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Get the Fastify instance for registering routes
	 * Initializes Fastify if not already done
	 */
	getFastifyInstance(): FastifyInstance {
		this.initializeFastify();
		return this.app!;
	}

	/**
	 * Register a webhook handler for a specific token (LEGACY - deprecated)
	 * Supports two signatures:
	 * 1. For ndjson-client: (token, secret, handler)
	 * 2. For legacy direct registration: (token, handler) where handler takes (req, res)
	 *
	 * NOTE: New code should use LinearEventTransport which registers routes directly with Fastify
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
			// Legacy direct registration
			this.linearWebhookHandlers.set(token, secretOrHandler);
			console.log(
				`🔗 Registered webhook handler (legacy direct-style) for token ending in ...${token.slice(-4)}`,
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
	 * Start OAuth flow and return promise that resolves when callback is received
	 */
	async startOAuthFlow(proxyUrl: string): Promise<{
		linearToken: string;
		linearRefreshToken?: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}> {
		return new Promise<{
			linearToken: string;
			linearRefreshToken?: string;
			linearWorkspaceId: string;
			linearWorkspaceName: string;
		}>((resolve, reject) => {
			// Generate unique ID for this flow
			const flowId = Date.now().toString();

			// Store callback for this flow
			this.oauthCallbacks.set(flowId, { resolve, reject, id: flowId });

			// Check if we should use direct Linear OAuth (when self-hosting)
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const useDirectOAuth = isExternalHost && process.env.LINEAR_CLIENT_ID;

			const callbackBaseUrl = `http://${this.host}:${this.port}`;
			let authUrl: string;

			if (useDirectOAuth) {
				// Use local OAuth authorize endpoint
				authUrl = `${callbackBaseUrl}/oauth/authorize?callback=${encodeURIComponent(`${callbackBaseUrl}/callback`)}`;
				console.log(`\n🔐 Using direct OAuth mode (CYRUS_HOST_EXTERNAL=true)`);
			} else {
				// Use proxy OAuth endpoint
				authUrl = `${proxyUrl}/oauth/authorize?callback=${encodeURIComponent(`${callbackBaseUrl}/callback`)}`;
			}

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
	 * Get the webhook URL
	 */
	getWebhookUrl(): string {
		return `http://${this.host}:${this.port}/webhook`;
	}

	/**
	 * Get the OAuth callback URL for registration with proxy
	 */
	getOAuthCallbackUrl(): string {
		return `http://${this.host}:${this.port}/callback`;
	}

	/**
	 * Register an approval request and get approval URL
	 */
	registerApprovalRequest(sessionId: string): {
		promise: Promise<{ approved: boolean; feedback?: string }>;
		url: string;
	} {
		// Clean up expired approvals (older than 30 minutes)
		const now = Date.now();
		for (const [key, approval] of this.pendingApprovals) {
			if (now - approval.createdAt > 30 * 60 * 1000) {
				approval.reject(new Error("Approval request expired"));
				this.pendingApprovals.delete(key);
			}
		}

		// Create promise for this approval request
		const promise = new Promise<{ approved: boolean; feedback?: string }>(
			(resolve, reject) => {
				this.pendingApprovals.set(sessionId, {
					resolve: (approved, feedback) => resolve({ approved, feedback }),
					reject,
					sessionId,
					createdAt: now,
				});
			},
		);

		// Generate approval URL
		const url = `http://${this.host}:${this.port}/approval?session=${encodeURIComponent(sessionId)}`;

		console.log(
			`🔐 Registered approval request for session ${sessionId}: ${url}`,
		);

		return { promise, url };
	}
}
