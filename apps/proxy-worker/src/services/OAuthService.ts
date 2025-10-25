import type { Env, OAuthState, OAuthToken, WorkspaceMetadata } from "../types";
import { KVOAuthStorage } from "./KVOAuthStorage";

export class OAuthService {
	private tokenStorage: KVOAuthStorage;
	private readonly OAUTH_CALLBACK_PATH = "/oauth/callback";

	constructor(
		private env: Env,
		private onAuthSuccess?: (
			tokenInfo: OAuthToken,
			workspaceInfo: WorkspaceMetadata,
		) => Promise<void>,
	) {
		this.tokenStorage = new KVOAuthStorage(
			env.OAUTH_TOKENS,
			env.ENCRYPTION_KEY,
		);
	}

	/**
	 * Get the OAuth redirect URI for this proxy instance
	 */
	private getRedirectUri(): string {
		return `${this.env.PROXY_URL}${this.OAUTH_CALLBACK_PATH}`;
	}

	/**
	 * Handle OAuth authorization request
	 */
	async handleAuthorize(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const callbackParam = url.searchParams.get("callback");

		// Generate state for CSRF protection
		const state = crypto.randomUUID();

		// Build redirect URI with callback if provided
		let redirectUri = this.getRedirectUri();
		if (callbackParam) {
			const redirectUrl = new URL(redirectUri);
			redirectUrl.searchParams.set("callback", callbackParam);
			redirectUri = redirectUrl.toString();
		}

		// Store state in KV with TTL
		await this.env.OAUTH_STATE.put(
			`oauth:state:${state}`,
			JSON.stringify({
				createdAt: Date.now(),
				redirectUri: redirectUri,
			} satisfies OAuthState),
			{ expirationTtl: 600 }, // 10 minutes
		);

		// Build Linear OAuth URL
		const authUrl = new URL("https://linear.app/oauth/authorize");
		authUrl.searchParams.set("client_id", this.env.LINEAR_CLIENT_ID);
		authUrl.searchParams.set("redirect_uri", this.getRedirectUri());
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("state", state);
		authUrl.searchParams.set(
			"scope",
			"read,write,app:assignable,app:mentionable",
		);
		authUrl.searchParams.set("actor", "app");
		authUrl.searchParams.set("prompt", "consent");

		return Response.redirect(authUrl.toString(), 302);
	}

	/**
	 * Handle OAuth callback
	 */
	async handleCallback(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");

		if (!code || !state) {
			return new Response("Missing code or state", { status: 400 });
		}

		// Validate state
		const stateData = await this.env.OAUTH_STATE.get(`oauth:state:${state}`);
		if (!stateData) {
			return new Response("Invalid or expired state", { status: 400 });
		}

		// Delete state after use
		await this.env.OAUTH_STATE.delete(`oauth:state:${state}`);

		try {
			// Exchange code for token
			const tokenResponse = await this.exchangeCodeForToken(code);

			// Get workspace info from token
			const workspaceInfo = await this.getWorkspaceInfo(
				tokenResponse.access_token,
			);

			// Create token object
			const token: OAuthToken = {
				accessToken: tokenResponse.access_token,
				refreshToken: tokenResponse.refresh_token,
				expiresAt: Date.now() + tokenResponse.expires_in * 1000,
				obtainedAt: Date.now(),
				scope: tokenResponse.scope.split(" "),
				tokenType: tokenResponse.token_type,
				userId: workspaceInfo.userId,
				userEmail: workspaceInfo.userEmail,
				workspaceName: workspaceInfo.organization.name,
			};

			// Store token in KV
			await this.tokenStorage.saveToken(workspaceInfo.organization.id, token);

			// Store workspace metadata
			await this.storeWorkspaceMetadata(workspaceInfo);

			// Call success handler if provided
			if (this.onAuthSuccess) {
				await this.onAuthSuccess(token, {
					id: workspaceInfo.organization.id,
					name: workspaceInfo.organization.name,
					urlKey: workspaceInfo.organization.urlKey,
					organizationId: workspaceInfo.organization.id,
					teams: workspaceInfo.organization.teams?.nodes || [],
				});
			}

			// Parse the original state to get the callback URL
			const stateInfo: OAuthState = JSON.parse(stateData);

			// Check if there's a callback parameter in the original redirect URI
			const callbackMatch = stateInfo.redirectUri?.match(/\?callback=([^&]+)/);
			if (callbackMatch) {
				// If callback exists, redirect to it with tokens (for CLI)
				const callbackUrlStr = decodeURIComponent(callbackMatch[1]);
				const callbackUrl = new URL(callbackUrlStr);
				callbackUrl.searchParams.set("token", token.accessToken);
				callbackUrl.searchParams.set(
					"workspaceId",
					workspaceInfo.organization.id,
				);
				callbackUrl.searchParams.set(
					"workspaceName",
					workspaceInfo.organization.name,
				);

				return Response.redirect(callbackUrl.toString(), 302);
			}

			// No callback - assume it's from browser, redirect to cyrus:// for Electron
			const cyrusUrl = new URL("cyrus://setup");
			cyrusUrl.searchParams.set("proxyUrl", url.origin);
			cyrusUrl.searchParams.set("linearToken", token.accessToken);
			cyrusUrl.searchParams.set("workspaceId", workspaceInfo.organization.id);
			cyrusUrl.searchParams.set(
				"workspaceName",
				workspaceInfo.organization.name,
			);
			cyrusUrl.searchParams.set("timestamp", Date.now().toString());

			// Return HTML that tries to redirect to cyrus:// URL
			return new Response(
				`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Authentication Successful</title>
          <meta http-equiv="refresh" content="0;url=${cyrusUrl.toString()}" />
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
            .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
            .manual { display: none; margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
            .code { font-family: monospace; background: #282c34; color: #abb2bf; padding: 10px; border-radius: 3px; word-break: break-all; }
            .btn { display: inline-block; padding: 10px 20px; background-color: #3b82f6; color: white; 
                   text-decoration: none; border-radius: 6px; font-weight: bold; }
            .btn:hover { background-color: #2563eb; }
          </style>
          <script>
            window.location.href = '${cyrusUrl.toString()}';
            setTimeout(() => {
              document.getElementById('manual').style.display = 'block';
            }, 2000);
          </script>
        </head>
        <body>
          <div class="success">
            <h1>✅ Authentication Successful!</h1>
            <p>Opening Cyrus app...</p>
            <div id="manual" class="manual">
              <p>If Cyrus doesn't open automatically:</p>
              <a href="${cyrusUrl.toString()}" class="btn">Click here to open Cyrus</a>
            </div>
          </div>
        </body>
        </html>
      `,
				{
					status: 200,
					headers: {
						"Content-Type": "text/html; charset=UTF-8",
					},
				},
			);
		} catch (error) {
			console.error("OAuth callback error:", error);
			return new Response(`OAuth failed: ${(error as Error).message}`, {
				status: 500,
			});
		}
	}

	/**
	 * Exchange authorization code for access token
	 */
	private async exchangeCodeForToken(code: string): Promise<any> {
		const response = await fetch("https://api.linear.app/oauth/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: this.env.LINEAR_CLIENT_ID,
				client_secret: this.env.LINEAR_CLIENT_SECRET,
				redirect_uri: this.getRedirectUri(),
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
	 * Store workspace metadata in KV
	 */
	private async storeWorkspaceMetadata(workspaceInfo: any): Promise<void> {
		const metadata: WorkspaceMetadata = {
			id: workspaceInfo.organization.id,
			name: workspaceInfo.organization.name,
			urlKey: workspaceInfo.organization.urlKey,
			organizationId: workspaceInfo.organization.id,
			teams: workspaceInfo.organization.teams?.nodes || [],
		};

		await this.env.WORKSPACE_METADATA.put(
			`workspace:meta:${metadata.id}`,
			JSON.stringify(metadata),
			{ expirationTtl: 86400 }, // 24 hours
		);
	}
}
