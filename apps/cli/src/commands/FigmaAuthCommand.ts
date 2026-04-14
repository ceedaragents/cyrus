import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	DEFAULT_CONFIG_FILENAME,
	type EdgeConfig,
	migrateEdgeConfig,
} from "cyrus-core";
import Fastify, { type FastifyInstance } from "fastify";
import open from "open";
import { BaseCommand } from "./ICommand.js";

/**
 * Self-auth-figma command - authenticate with Figma OAuth directly from CLI.
 * Handles the complete OAuth flow and stores the token in config.json.
 */
export class FigmaAuthCommand extends BaseCommand {
	private server: FastifyInstance | null = null;
	private callbackPort = parseInt(process.env.CYRUS_SERVER_PORT || "3456", 10);

	async execute(_args: string[]): Promise<void> {
		console.log("\nCyrus Figma Authentication");
		this.logDivider();

		const clientId = process.env.FIGMA_CLIENT_ID;
		const clientSecret = process.env.FIGMA_CLIENT_SECRET;
		const baseUrl = process.env.CYRUS_BASE_URL;

		if (!clientId || !clientSecret || !baseUrl) {
			this.logError("Missing required environment variables:");
			if (!clientId) console.log("   - FIGMA_CLIENT_ID");
			if (!clientSecret) console.log("   - FIGMA_CLIENT_SECRET");
			if (!baseUrl) console.log("   - CYRUS_BASE_URL");
			console.log(`\nAdd these to your env file (${this.app.cyrusHome}/.env):`);
			console.log("  FIGMA_CLIENT_ID=your-figma-client-id");
			console.log("  FIGMA_CLIENT_SECRET=your-figma-client-secret");
			console.log("  CYRUS_BASE_URL=https://your-tunnel-domain.com");
			process.exit(1);
		}

		const configPath = resolve(this.app.cyrusHome, DEFAULT_CONFIG_FILENAME);
		let config: EdgeConfig;
		try {
			config = migrateEdgeConfig(
				JSON.parse(readFileSync(configPath, "utf-8")),
			) as EdgeConfig;
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
			if (process.env.CLOUDFLARE_TOKEN) {
				this.logger.info("Starting cloudflare tunnel...");

				const { SharedApplicationServer } = await import("cyrus-edge-worker");
				const sharedApplicationServer = new SharedApplicationServer(
					this.callbackPort,
					baseUrl,
					false,
				);
				await sharedApplicationServer.startCloudflareTunnel(
					process.env.CLOUDFLARE_TOKEN,
				);
			}

			const authCode = await this.waitForCallback(clientId);

			console.log("Exchanging code for tokens...");
			const accessToken = await this.exchangeCodeForToken(
				authCode,
				clientId,
				clientSecret,
			);
			this.logSuccess(`Got access token: ${accessToken.substring(0, 20)}...`);

			// Save Figma token to config.json
			console.log("Saving token to config.json...");
			(config as Record<string, unknown>).figmaToken = accessToken;
			writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8");

			this.logSuccess("Figma token saved to config.json");
			console.log();
			this.logSuccess(
				"Authentication complete! Restart cyrus to enable the Figma MCP integration.",
			);
			process.exit(0);
		} catch (error) {
			this.logError(`Authentication failed: ${(error as Error).message}`);
			process.exit(1);
		} finally {
			await this.cleanup();
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
			// https://www.figma.com/developers/api#oauth2
			const oauthUrl = `https://www.figma.com/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=files:read&state=figma&response_type=code`;

			this.server = Fastify({ logger: false });

			this.server.get("/callback", async (request, reply) => {
				const query = request.query as {
					code?: string;
					error?: string;
					state?: string;
				};
				const code = query.code;
				const error = query.error;

				if (error) {
					reply
						.type("text/html; charset=utf-8")
						.code(400)
						.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
<h2>Authorization failed</h2>
<p>${error}</p>
</body></html>`);
					reject(new Error(`OAuth error: ${error}`));
					return;
				}

				if (code) {
					reply
						.type("text/html; charset=utf-8")
						.code(200)
						.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
<h2>Figma authorized successfully</h2>
<p>You can close this window and return to the terminal.</p>
</body></html>`);
					resolve(code);
					return;
				}

				reply
					.type("text/html; charset=utf-8")
					.code(400)
					.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
<h2>Missing authorization code</h2>
</body></html>`);
				reject(new Error("Missing authorization code"));
			});

			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const listenHost = isExternalHost ? "0.0.0.0" : "localhost";

			this.server
				.listen({ port: this.callbackPort, host: listenHost })
				.then(() => {
					console.log(
						`Waiting for authorization on port ${this.callbackPort}...`,
					);
					console.log();
					console.log("Opening browser for Figma authorization...");
					console.log();
					console.log("If browser doesn't open, visit:");
					console.log(oauthUrl);
					console.log();

					open(oauthUrl).catch(() => {
						console.log("Could not open browser automatically.");
					});
				})
				.catch((err) => {
					reject(new Error(`Server error: ${err.message}`));
				});
		});
	}

	private async exchangeCodeForToken(
		code: string,
		clientId: string,
		clientSecret: string,
	): Promise<string> {
		const baseUrl = process.env.CYRUS_BASE_URL;
		const redirectUri = `${baseUrl}/callback`;

		// https://www.figma.com/developers/api#oauth2
		const response = await fetch("https://api.figma.com/v1/oauth/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: redirectUri,
				code,
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
			expires_in?: number;
		};

		if (!data.access_token) {
			throw new Error("Invalid access token received from Figma");
		}

		return data.access_token;
	}

	private async cleanup(): Promise<void> {
		if (this.server) {
			await this.server.close();
			this.server = null;
		}
	}
}
