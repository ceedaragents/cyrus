import { randomUUID } from "node:crypto";
import { DEFAULT_PROXY_URL, type OAuthCallbackHandler } from "cyrus-core";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

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
 * Approval callback state for tracking approval workflows
 */
export interface ApprovalCallback {
	resolve: (approved: boolean, feedback?: string) => void;
	reject: (error: Error) => void;
	sessionId: string;
	createdAt: number;
}

/**
 * Shared application server that handles both webhooks and OAuth callbacks on a single port
 * Uses Fastify for improved endpoint and handler management
 */
export class SharedApplicationServer {
	private fastify: ReturnType<typeof Fastify> | null = null;
	private webhookHandlers = new Map<
		string,
		{
			secret: string;
			handler: (body: string, signature: string, timestamp?: string) => boolean;
		}
	>();
	// Separate handlers for LinearEventTransport that handle raw request/reply
	private linearWebhookHandlers = new Map<
		string,
		(req: FastifyRequest, reply: FastifyReply) => Promise<void>
	>();
	private oauthCallbacks = new Map<string, OAuthCallback>();
	private oauthCallbackHandler: OAuthCallbackHandler | null = null;
	private oauthStates = new Map<
		string,
		{ createdAt: number; redirectUri?: string }
	>();
	private pendingApprovals = new Map<string, ApprovalCallback>();
	private port: number;
	private host: string;
	private isListening = false;
	private cloudflareToken: string | null = null;
	private proxyUrl: string;

	constructor(
		port: number = 3456,
		host: string = "localhost",
		_ngrokAuthToken?: string, // Kept for backwards compatibility but ignored
		proxyUrl?: string,
	) {
		this.port = port;
		this.host = host;
		// NGROK is no longer supported
		this.proxyUrl = proxyUrl || process.env.PROXY_URL || DEFAULT_PROXY_URL;
		this.cloudflareToken = process.env.CLOUDFLARE_TOKEN || null;
	}

	/**
	 * Start the shared application server
	 */
	async start(): Promise<void> {
		if (this.isListening) {
			return; // Already listening
		}

		try {
			// Create Fastify instance
			this.fastify = Fastify({ logger: false });

			// Register routes
			this.fastify.post(
				"/webhook",
				async (request: FastifyRequest, reply: FastifyReply) => {
					await this.handleWebhookRequest(request, reply);
				},
			);

			this.fastify.get(
				"/callback",
				async (request: FastifyRequest, reply: FastifyReply) => {
					await this.handleOAuthCallback(request, reply);
				},
			);

			this.fastify.get(
				"/oauth/authorize",
				async (request: FastifyRequest, reply: FastifyReply) => {
					await this.handleOAuthAuthorize(request, reply);
				},
			);

			this.fastify.get(
				"/approval",
				async (request: FastifyRequest, reply: FastifyReply) => {
					await this.handleApprovalRequest(request, reply);
				},
			);

			// Catch-all for undefined routes
			this.fastify.all(
				"*",
				async (_request: FastifyRequest, reply: FastifyReply) => {
					reply.code(404).send({ error: "Not Found" });
				},
			);

			// Start listening
			await this.fastify.listen({ port: this.port, host: this.host });

			this.isListening = true;
			console.log(
				`🔗 Shared application server listening on http://${this.host}:${this.port}`,
			);

			// Note about Cloudflare tunnel
			if (this.cloudflareToken) {
				console.log("🔗 Cloudflare tunnel is configured via CLOUDFLARE_TOKEN");
				console.log(
					"   Note: Tunnel must be managed separately via cloudflared",
				);
			}
		} catch (error) {
			this.isListening = false;
			console.error("🔴 Failed to start shared application server:", error);
			throw error;
		}
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

		if (this.fastify && this.isListening) {
			try {
				await this.fastify.close();
				this.isListening = false;
				console.log("🔗 Shared application server stopped");
			} catch (error) {
				console.error("🔴 Failed to stop shared application server:", error);
			}
		}
	}

	/**
	 * Get the port number the server is listening on
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Get the base URL for the server
	 */
	getBaseUrl(): string {
		return process.env.CYRUS_BASE_URL || `http://${this.host}:${this.port}`;
	}

	/**
	 * Register a webhook handler for a specific token
	 * Supports two signatures:
	 * 1. For NDJSON proxy: (token, secret, handler)
	 * 2. For linear-event-transport: (token, handler) where handler takes (req, reply)
	 */
	registerWebhookHandler(
		token: string,
		secretOrHandler:
			| string
			| ((req: FastifyRequest, reply: FastifyReply) => Promise<void>),
		handler?: (body: string, signature: string, timestamp?: string) => boolean,
	): void {
		if (typeof secretOrHandler === "string" && handler) {
			// Proxy-style registration (deprecated)
			this.webhookHandlers.set(token, { secret: secretOrHandler, handler });
			console.log(
				`🔗 Registered webhook handler (proxy-style) for token ending in ...${token.slice(-4)}`,
			);
		} else if (typeof secretOrHandler === "function") {
			// Linear event transport registration
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

			// Check if we should use direct Linear OAuth (when self-hosting)
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const useDirectOAuth = isExternalHost && process.env.LINEAR_CLIENT_ID;

			const callbackBaseUrl = this.getBaseUrl();
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
	 * Get the webhook URL for registration
	 */
	getWebhookUrl(): string {
		return `${this.getBaseUrl()}/webhook`;
	}

	/**
	 * Get the OAuth callback URL
	 */
	getOAuthCallbackUrl(): string {
		return `${this.getBaseUrl()}/callback`;
	}

	/**
	 * Handle incoming webhook requests
	 */
	private async handleWebhookRequest(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		try {
			console.log(
				`🔗 Incoming webhook request: ${request.method} ${request.url}`,
			);

			// Check if this is a direct Linear webhook (has linear-signature header)
			const linearSignature = request.headers["linear-signature"] as string;
			const isDirectWebhook = !!linearSignature;

			if (isDirectWebhook && this.linearWebhookHandlers.size > 0) {
				// For direct Linear webhooks, pass the request to handler
				console.log(
					`🔗 Direct Linear webhook received, trying ${this.linearWebhookHandlers.size} direct handlers`,
				);

				// Try each direct handler
				for (const [token, handler] of this.linearWebhookHandlers) {
					try {
						// The handler will manage the response
						await handler(request, reply);
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
				reply.code(401).send({ error: "Unauthorized" });
				return;
			}

			// Otherwise, handle as proxy-style webhook
			const body = JSON.stringify(request.body);
			const signature = request.headers["x-webhook-signature"] as string;
			const timestamp = request.headers["x-webhook-timestamp"] as string;

			console.log(
				`🔗 Proxy webhook received with ${body.length} bytes, ${this.webhookHandlers.size} registered handlers`,
			);

			if (!signature) {
				console.log("🔗 Webhook rejected: Missing signature header");
				reply.code(400).send({ error: "Missing signature" });
				return;
			}

			// Try each registered handler until one verifies the signature
			let handlerAttempts = 0;
			for (const [token, { handler }] of this.webhookHandlers) {
				handlerAttempts++;
				try {
					if (handler(body, signature, timestamp)) {
						// Handler verified signature and processed webhook
						reply.code(200).send({ success: true });
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
			reply.code(401).send({ error: "Unauthorized" });
		} catch (error) {
			console.error("🔗 Webhook request error:", error);
			reply.code(500).send({ error: "Internal Server Error" });
		}
	}

	/**
	 * Handle OAuth callback requests
	 */
	private async handleOAuthCallback(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		try {
			const query = request.query as Record<string, any>;
			const code = query.code as string | undefined;
			const state = query.state as string | undefined;
			const token = query.token as string | undefined;
			const workspaceId = query.workspaceId as string | undefined;
			const workspaceName = query.workspaceName as string | undefined;

			// Check if this is a direct Linear callback (has code and state)
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const isDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase().trim() === "true";

			// Handle direct callback if both external host and direct webhooks are enabled
			if (code && state && isExternalHost && isDirectWebhooks) {
				await this.handleDirectLinearCallback(request, reply);
				return;
			}

			// Otherwise handle as proxy callback
			if (token && workspaceId && workspaceName) {
				// Success! Return the Linear credentials
				const linearCredentials = {
					linearToken: token,
					linearWorkspaceId: workspaceId,
					linearWorkspaceName: workspaceName,
				};

				// Send success response
				reply.type("text/html; charset=utf-8").send(`
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
                <a href="${this.proxyUrl}/oauth/authorize?callback=${this.getBaseUrl()}/callback"
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
				reply
					.type("text/html")
					.code(400)
					.send("<h1>Error: No token received</h1>");

				// Reject any waiting promises
				for (const [id, callback] of this.oauthCallbacks) {
					callback.reject(new Error("No token received"));
					this.oauthCallbacks.delete(id);
				}
			}
		} catch (error) {
			console.error("🔐 OAuth callback error:", error);
			reply.code(500).send({ error: "Internal Server Error" });
		}
	}

	/**
	 * Handle OAuth authorization requests for direct Linear OAuth
	 */
	private async handleOAuthAuthorize(
		_request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		try {
			// Check if we're in external host mode with direct webhooks
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const isDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase().trim() === "true";

			// Only handle OAuth locally if both external host AND direct webhooks are enabled
			if (!isExternalHost || !isDirectWebhooks) {
				// Redirect to proxy OAuth endpoint
				const callbackBaseUrl = this.getBaseUrl();
				const proxyAuthUrl = `${this.proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;
				reply.redirect(proxyAuthUrl);
				return;
			}

			// Check for LINEAR_CLIENT_ID
			const clientId = process.env.LINEAR_CLIENT_ID;
			if (!clientId) {
				reply
					.code(400)
					.send(
						"LINEAR_CLIENT_ID environment variable is required for direct OAuth",
					);
				return;
			}

			// Generate state for CSRF protection
			const state = randomUUID();

			// Store state with expiration (10 minutes)
			this.oauthStates.set(state, {
				createdAt: Date.now(),
				redirectUri: `${this.getBaseUrl()}/callback`,
			});

			// Clean up expired states (older than 10 minutes)
			const now = Date.now();
			for (const [stateKey, stateData] of this.oauthStates) {
				if (now - stateData.createdAt > 10 * 60 * 1000) {
					this.oauthStates.delete(stateKey);
				}
			}

			// Build Linear OAuth URL
			const authUrl = new URL("https://linear.app/oauth/authorize");
			authUrl.searchParams.set("client_id", clientId);
			authUrl.searchParams.set("redirect_uri", `${this.getBaseUrl()}/callback`);
			authUrl.searchParams.set("response_type", "code");
			authUrl.searchParams.set("state", state);
			authUrl.searchParams.set(
				"scope",
				"read,write,app:assignable,app:mentionable",
			);
			authUrl.searchParams.set("actor", "app");
			authUrl.searchParams.set("prompt", "consent");

			console.log(`🔐 Redirecting to Linear OAuth: ${authUrl.toString()}`);

			// Redirect to Linear OAuth
			reply.redirect(authUrl.toString());
		} catch (error) {
			console.error("🔐 OAuth authorize error:", error);
			reply.code(500).send({ error: "Internal Server Error" });
		}
	}

	/**
	 * Handle direct Linear OAuth callback (exchange code for token)
	 */
	private async handleDirectLinearCallback(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		try {
			const query = request.query as Record<string, any>;
			const code = query.code as string | undefined;
			const state = query.state as string | undefined;

			if (!code || !state) {
				reply.code(400).send("Missing code or state parameter");
				return;
			}

			// Validate state
			const stateData = this.oauthStates.get(state);
			if (!stateData) {
				reply.code(400).send("Invalid or expired state");
				return;
			}

			// Delete state after use
			this.oauthStates.delete(state);

			// Exchange code for token
			const tokenResponse = await this.exchangeCodeForToken(code);

			// Get workspace info using the token
			const workspaceInfo = await this.getWorkspaceInfo(
				tokenResponse.access_token,
			);

			// Success! Return the Linear credentials
			const linearCredentials = {
				linearToken: tokenResponse.access_token,
				linearWorkspaceId: workspaceInfo.organization.id,
				linearWorkspaceName: workspaceInfo.organization.name,
			};

			// Send success response
			reply.type("text/html; charset=utf-8").send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Authorization Successful</title>
          </head>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1>✅ Authorization Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
            <p>Your Linear workspace <strong>${workspaceInfo.organization.name}</strong> has been connected.</p>
            <p style="margin-top: 30px;">
              <a href="${this.getBaseUrl()}/oauth/authorize"
                 style="padding: 10px 20px; background: #5E6AD2; color: white; text-decoration: none; border-radius: 5px;">
                Connect Another Workspace
              </a>
            </p>
            <script>setTimeout(() => window.close(), 10000)</script>
          </body>
        </html>
      `);

			console.log(
				`🔐 Direct OAuth callback received for workspace: ${workspaceInfo.organization.name}`,
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
					await this.oauthCallbackHandler(
						tokenResponse.access_token,
						workspaceInfo.organization.id,
						workspaceInfo.organization.name,
					);
				} catch (error) {
					console.error("🔐 Error in OAuth callback handler:", error);
				}
			}
		} catch (error) {
			console.error("🔐 Direct Linear callback error:", error);
			reply
				.code(500)
				.send({ error: `OAuth failed: ${(error as Error).message}` });

			// Reject any waiting promises
			for (const [id, callback] of this.oauthCallbacks) {
				callback.reject(error as Error);
				this.oauthCallbacks.delete(id);
			}
		}
	}

	/**
	 * Exchange authorization code for access token
	 */
	private async exchangeCodeForToken(code: string): Promise<any> {
		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			throw new Error("LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET are required");
		}

		const response = await fetch("https://api.linear.app/oauth/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: `${this.getBaseUrl()}/callback`,
				code: code,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Token exchange failed: ${error}`);
		}

		return await response.json();
	}

	/**
	 * Get workspace information using access token
	 */
	private async getWorkspaceInfo(accessToken: string): Promise<any> {
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({
				query: `
          query {
            viewer {
              id
              name
              email
              organization {
                id
                name
                urlKey
                teams {
                  nodes {
                    id
                    key
                    name
                  }
                }
              }
            }
          }
        `,
			}),
		});

		if (!response.ok) {
			throw new Error("Failed to get workspace info");
		}

		const data = (await response.json()) as any;

		if (data.errors) {
			throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
		}

		return {
			userId: data.data.viewer.id,
			userEmail: data.data.viewer.email,
			organization: data.data.viewer.organization,
		};
	}

	/**
	 * Escape HTML special characters to prevent XSS attacks
	 */
	private escapeHtml(unsafe: string): string {
		return unsafe
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
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
		const url = `${this.getBaseUrl()}/approval?session=${encodeURIComponent(sessionId)}`;

		console.log(
			`🔐 Registered approval request for session ${sessionId}: ${url}`,
		);

		return { promise, url };
	}

	/**
	 * Handle approval requests
	 */
	private async handleApprovalRequest(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		try {
			const query = request.query as Record<string, any>;
			const sessionId = query.session as string | undefined;
			const action = query.action as string | undefined; // "approve" or "reject"
			const feedback = query.feedback as string | undefined;

			if (!sessionId) {
				reply
					.type("text/html; charset=utf-8")
					.code(400)
					.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Invalid Request</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>❌ Invalid Request</h1>
              <p>Missing session parameter.</p>
            </body>
          </html>
        `);
				return;
			}

			const approval = this.pendingApprovals.get(sessionId);

			// If no action specified, show approval UI
			if (!action) {
				const approvalExists = !!approval;
				reply.type("text/html; charset=utf-8").send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Approval Required</title>
              <style>
                body {
                  font-family: system-ui, -apple-system, sans-serif;
                  max-width: 700px;
                  margin: 50px auto;
                  padding: 20px;
                  background: #f5f5f5;
                }
                .card {
                  background: white;
                  padding: 30px;
                  border-radius: 8px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                h1 {
                  margin-top: 0;
                  color: #333;
                }
                .status {
                  padding: 15px;
                  border-radius: 5px;
                  margin: 20px 0;
                }
                .status.pending {
                  background: #fff3cd;
                  border-left: 4px solid #ffc107;
                }
                .status.resolved {
                  background: #d4edda;
                  border-left: 4px solid #28a745;
                }
                .buttons {
                  display: flex;
                  gap: 10px;
                  margin-top: 20px;
                }
                button {
                  padding: 12px 24px;
                  font-size: 16px;
                  border: none;
                  border-radius: 5px;
                  cursor: pointer;
                  transition: opacity 0.2s;
                }
                button:hover:not(:disabled) {
                  opacity: 0.9;
                }
                button:disabled {
                  opacity: 0.5;
                  cursor: not-allowed;
                }
                .approve-btn {
                  background: #28a745;
                  color: white;
                  flex: 1;
                }
                .reject-btn {
                  background: #dc3545;
                  color: white;
                  flex: 1;
                }
                textarea {
                  width: 100%;
                  padding: 10px;
                  border: 1px solid #ddd;
                  border-radius: 5px;
                  font-family: inherit;
                  margin-top: 10px;
                  resize: vertical;
                }
                label {
                  display: block;
                  margin-top: 15px;
                  color: #666;
                  font-size: 14px;
                }
              </style>
            </head>
            <body>
              <div class="card">
                ${
									approvalExists
										? `
                  <h1>🔔 Approval Required</h1>
                  <div class="status pending">
                    <strong>Status:</strong> Waiting for your decision
                  </div>
                  <p>The agent is requesting your approval to proceed with the next step of the workflow.</p>

                  <label for="feedback">Optional feedback or instructions:</label>
                  <textarea id="feedback" rows="3" placeholder="Enter any feedback or additional instructions..."></textarea>

                  <div class="buttons">
                    <button class="approve-btn" onclick="handleAction('approve')">
                      ✅ Approve
                    </button>
                    <button class="reject-btn" onclick="handleAction('reject')">
                      ❌ Reject
                    </button>
                  </div>
                `
										: `
                  <h1>ℹ️ Approval Already Processed</h1>
                  <div class="status resolved">
                    This approval request has already been processed or has expired.
                  </div>
                  <p>You can close this window.</p>
                `
								}
              </div>

              <script>
                async function handleAction(action) {
                  const feedback = document.getElementById('feedback')?.value || '';
                  const url = new URL(window.location.href);
                  url.searchParams.set('action', action);
                  if (feedback) {
                    url.searchParams.set('feedback', feedback);
                  }

                  // Disable buttons
                  document.querySelectorAll('button').forEach(btn => btn.disabled = true);

                  // Navigate to confirmation
                  window.location.href = url.toString();
                }
              </script>
            </body>
          </html>
        `);
				return;
			}

			// Handle approval/rejection
			if (!approval) {
				reply
					.code(410)
					.type("text/html; charset=utf-8")
					.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Approval Expired</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>⏰ Approval Expired</h1>
              <p>This approval request has already been processed or has expired.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
				return;
			}

			// Process the approval/rejection
			const approved = action === "approve";
			approval.resolve(approved, feedback || undefined);
			this.pendingApprovals.delete(sessionId);

			console.log(
				`🔐 Approval ${approved ? "granted" : "rejected"} for session ${sessionId}${feedback ? ` with feedback: ${feedback}` : ""}`,
			);

			// Send success response
			reply.type("text/html; charset=utf-8").send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Approval ${approved ? "Granted" : "Rejected"}</title>
          </head>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1>${approved ? "✅ Approval Granted" : "❌ Approval Rejected"}</h1>
            <p>Your decision has been recorded. The agent will ${approved ? "proceed with the next step" : "stop the current workflow"}.</p>
            ${feedback ? `<p><strong>Feedback provided:</strong> ${this.escapeHtml(feedback)}</p>` : ""}
            <p style="margin-top: 30px; color: #666;">You can close this window and return to Linear.</p>
            <script>setTimeout(() => window.close(), 5000)</script>
          </body>
        </html>
      `);
		} catch (error) {
			console.error("🔐 Approval request error:", error);
			reply.code(500).send({ error: "Internal Server Error" });
		}
	}
}
