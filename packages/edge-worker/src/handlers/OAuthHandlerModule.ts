import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { DEFAULT_PROXY_URL, type OAuthCallbackHandler } from "cyrus-core";
import type { HandlerModule, RouteRegistrationFunction } from "./types.js";

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
 * OAuth handler module that manages OAuth authorization flows
 */
export class OAuthHandlerModule implements HandlerModule {
	private oauthCallbacks = new Map<string, OAuthCallback>();
	private oauthCallbackHandler: OAuthCallbackHandler | null = null;
	private oauthStates = new Map<
		string,
		{ createdAt: number; redirectUri?: string }
	>();
	private proxyUrl: string;
	private getBaseUrl: () => string;
	private host: string;
	private port: number;

	constructor(config: {
		proxyUrl?: string;
		getBaseUrl: () => string;
		host: string;
		port: number;
	}) {
		this.proxyUrl =
			config.proxyUrl || process.env.PROXY_URL || DEFAULT_PROXY_URL;
		this.getBaseUrl = config.getBaseUrl;
		this.host = config.host;
		this.port = config.port;
	}

	/**
	 * Register OAuth routes with the server
	 */
	register(registerFn: RouteRegistrationFunction): void {
		registerFn("GET", "/callback", (req, res) =>
			this.handleOAuthCallback(req, res),
		);
		registerFn("GET", "/oauth/authorize", (req, res) =>
			this.handleOAuthAuthorize(req, res),
		);
		console.log("🔐 Registered OAuth handler module");
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		// Reject all pending OAuth callbacks
		for (const [, callback] of this.oauthCallbacks) {
			callback.reject(new Error("OAuth module shutting down"));
		}
		this.oauthCallbacks.clear();
		this.oauthStates.clear();
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
	async startOAuthFlow(): Promise<{
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
				authUrl = `${this.proxyUrl}/oauth/authorize?callback=${encodeURIComponent(`${callbackBaseUrl}/callback`)}`;
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
	 * Handle OAuth callback requests
	 */
	private async handleOAuthCallback(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			const url = new URL(req.url!, `http://${this.host}:${this.port}`);
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");

			// Check if this is a direct Linear callback (has code and state)
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const isDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase().trim() === "true";

			// Handle direct callback if both external host and direct webhooks are enabled
			if (code && state && isExternalHost && isDirectWebhooks) {
				await this.handleDirectLinearCallback(req, res, url);
				return;
			}

			// Otherwise handle as proxy callback
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
	 * Handle OAuth authorization requests for direct Linear OAuth
	 */
	private async handleOAuthAuthorize(
		_req: IncomingMessage,
		res: ServerResponse,
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
				res.writeHead(302, { Location: proxyAuthUrl });
				res.end();
				return;
			}

			// Check for LINEAR_CLIENT_ID
			const clientId = process.env.LINEAR_CLIENT_ID;
			if (!clientId) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end(
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
			res.writeHead(302, { Location: authUrl.toString() });
			res.end();
		} catch (error) {
			console.error("🔐 OAuth authorize error:", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle direct Linear OAuth callback (exchange code for token)
	 */
	private async handleDirectLinearCallback(
		_req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void> {
		try {
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");

			if (!code || !state) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Missing code or state parameter");
				return;
			}

			// Validate state
			const stateData = this.oauthStates.get(state);
			if (!stateData) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Invalid or expired state");
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
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end(`OAuth failed: ${(error as Error).message}`);

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
}
