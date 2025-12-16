import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import open from "open";
import { BaseCommand } from "./ICommand.js";

/**
 * Self-auth command - authenticate with Linear OAuth directly from CLI
 * Handles the complete OAuth flow without requiring EdgeWorker
 */
export class SelfAuthCommand extends BaseCommand {
	private server: Server | null = null;
	private callbackPort = parseInt(process.env.CYRUS_SERVER_PORT || "3456", 10);

	async execute(_args: string[]): Promise<void> {
		console.log("\nCyrus Linear Self-Authentication");
		this.logDivider();

		// Check required environment variables
		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;
		const baseUrl = process.env.CYRUS_BASE_URL;

		if (!clientId || !clientSecret || !baseUrl) {
			this.logError("Missing required environment variables:");
			if (!clientId) console.log("   - LINEAR_CLIENT_ID");
			if (!clientSecret) console.log("   - LINEAR_CLIENT_SECRET");
			if (!baseUrl) console.log("   - CYRUS_BASE_URL");
			console.log("\nSet these in your shell profile (.zshrc):");
			console.log("  export LINEAR_CLIENT_ID='your-client-id'");
			console.log("  export LINEAR_CLIENT_SECRET='your-client-secret'");
			console.log("  export CYRUS_BASE_URL='https://your-tunnel-domain.com'");
			process.exit(1);
		}

		// Check config file exists
		const configPath = resolve(this.app.cyrusHome, "config.json");
		let config: any;
		try {
			config = JSON.parse(readFileSync(configPath, "utf-8"));
		} catch {
			this.logError(`Config file not found: ${configPath}`);
			console.log("Run 'cyrus' first to create initial configuration.");
			process.exit(1);
		}

		console.log("Configuration:");
		console.log(`   Client ID: ${clientId.substring(0, 20)}...`);
		console.log(`   Base URL: ${baseUrl}`);
		console.log(`   Config: ${configPath}`);
		console.log(`   Callback port: ${this.callbackPort}`);
		console.log();

		try {
			// Start temporary server to receive OAuth callback
			const authCode = await this.waitForCallback(clientId);

			// Exchange code for tokens
			console.log("Exchanging code for tokens...");
			const tokens = await this.exchangeCodeForTokens(
				authCode,
				clientId,
				clientSecret,
			);
			this.logSuccess(
				`Got access token: ${tokens.accessToken.substring(0, 30)}...`,
			);

			// Fetch workspace info
			console.log("Fetching workspace info...");
			const workspace = await this.fetchWorkspaceInfo(tokens.accessToken);
			this.logSuccess(`Workspace: ${workspace.name} (${workspace.id})`);

			// Update config.json
			console.log("Saving tokens to config.json...");
			this.updateConfig(config, configPath, tokens, workspace);

			const updatedCount = config.repositories.filter(
				(r: any) => r.linearWorkspaceId === workspace.id,
			).length;
			this.logSuccess(`Updated ${updatedCount} repository/repositories`);

			console.log();
			this.logSuccess(
				"Authentication complete! Restart cyrus to use the new tokens.",
			);
			process.exit(0);
		} catch (error) {
			this.logError(`Authentication failed: ${(error as Error).message}`);
			process.exit(1);
		} finally {
			this.cleanup();
		}
	}

	private async waitForCallback(clientId: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const baseUrl = process.env.CYRUS_BASE_URL;
			if (!baseUrl) {
				reject(new Error("CYRUS_BASE_URL environment variable is required"));
				return;
			}
			const redirectUri = `${baseUrl}/callback`;
			const oauthUrl = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,write,comments:create,app:assignable,app:mentionable&actor=app`;

			this.server = createServer((req, res) => {
				const url = new URL(
					req.url || "",
					`http://localhost:${this.callbackPort}`,
				);

				if (url.pathname === "/callback") {
					const code = url.searchParams.get("code");
					const error = url.searchParams.get("error");

					if (error) {
						res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
						res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
<h2>Authorization failed</h2>
<p>${error}</p>
</body></html>`);
						reject(new Error(`OAuth error: ${error}`));
						return;
					}

					if (code) {
						res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
						res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
<h2>Cyrus authorized successfully</h2>
<p>You can close this window and return to the terminal.</p>
</body></html>`);
						resolve(code);
						return;
					}

					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
<h2>Missing authorization code</h2>
</body></html>`);
					reject(new Error("Missing authorization code"));
				} else {
					res.writeHead(404);
					res.end("Not found");
				}
			});

			this.server.listen(this.callbackPort, () => {
				console.log(
					`Waiting for authorization on port ${this.callbackPort}...`,
				);
				console.log();
				console.log("Opening browser for Linear authorization...");
				console.log();
				console.log("If browser doesn't open, visit:");
				console.log(oauthUrl);
				console.log();

				open(oauthUrl).catch(() => {
					console.log("Could not open browser automatically.");
				});
			});

			this.server.on("error", (err) => {
				reject(new Error(`Server error: ${err.message}`));
			});
		});
	}

	private async exchangeCodeForTokens(
		code: string,
		clientId: string,
		clientSecret: string,
	): Promise<{ accessToken: string; refreshToken?: string }> {
		const baseUrl = process.env.CYRUS_BASE_URL;
		const redirectUri = `${baseUrl}/callback`;

		const response = await fetch("https://api.linear.app/oauth/token", {
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
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Token exchange failed: ${errorText}`);
		}

		const data = (await response.json()) as {
			access_token: string;
			refresh_token?: string;
		};

		if (!data.access_token || !data.access_token.startsWith("lin_oauth_")) {
			throw new Error("Invalid access token received");
		}

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
		};
	}

	private async fetchWorkspaceInfo(
		accessToken: string,
	): Promise<{ id: string; name: string }> {
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: "{ viewer { organization { id name } } }",
			}),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch workspace info: ${response.statusText}`);
		}

		const data = (await response.json()) as {
			data?: { viewer?: { organization?: { id: string; name: string } } };
		};

		const org = data.data?.viewer?.organization;
		if (!org?.id) {
			throw new Error("Failed to get workspace info from Linear");
		}

		return { id: org.id, name: org.name || org.id };
	}

	private updateConfig(
		config: any,
		configPath: string,
		tokens: { accessToken: string; refreshToken?: string },
		workspace: { id: string; name: string },
	): void {
		// Update all repositories matching this workspace (or unset workspace)
		for (const repo of config.repositories) {
			if (
				repo.linearWorkspaceId === workspace.id ||
				!repo.linearWorkspaceId ||
				repo.linearWorkspaceId === ""
			) {
				repo.linearToken = tokens.accessToken;
				repo.linearRefreshToken = tokens.refreshToken;
				repo.linearWorkspaceId = workspace.id;
				repo.linearWorkspaceName = workspace.name;
			}
		}

		writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8");
	}

	private cleanup(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}
}
