import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG_FILENAME } from "cyrus-core";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * POST /api/admin/linear-oauth/initiate
 * Returns the Linear authorize URL for the dashboard to redirect the user.
 */
export function handleLinearOAuthInitiate(_cyrusHome: string) {
	return async (_request: FastifyRequest, reply: FastifyReply) => {
		const clientId = process.env.LINEAR_CLIENT_ID;
		const baseUrl = process.env.CYRUS_BASE_URL;

		if (!clientId) {
			return reply.status(400).send({
				success: false,
				error: "LINEAR_CLIENT_ID not configured",
			});
		}

		if (!baseUrl) {
			return reply.status(400).send({
				success: false,
				error: "CYRUS_BASE_URL not configured",
			});
		}

		const redirectUri = `${baseUrl}/api/admin/linear-oauth/callback`;
		const authorizeUrl = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=write,app:assignable,app:mentionable&actor=app`;

		return reply.send({
			success: true,
			data: { authorizeUrl },
		});
	};
}

/**
 * GET /api/admin/linear-oauth/callback
 * Handles the OAuth redirect from Linear — exchanges code for token, saves to config.
 * This endpoint does NOT require Bearer auth since it's a redirect from Linear.
 */
export function handleLinearOAuthCallback(cyrusHome: string) {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		const query = request.query as { code?: string; error?: string };

		if (query.error) {
			return reply
				.type("text/html; charset=utf-8")
				.status(400)
				.send(oauthResultPage("Authorization Failed", query.error, false));
		}

		if (!query.code) {
			return reply
				.type("text/html; charset=utf-8")
				.status(400)
				.send(
					oauthResultPage(
						"Missing Code",
						"No authorization code received",
						false,
					),
				);
		}

		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;
		const baseUrl = process.env.CYRUS_BASE_URL;

		if (!clientId || !clientSecret || !baseUrl) {
			return reply
				.type("text/html; charset=utf-8")
				.status(500)
				.send(
					oauthResultPage(
						"Configuration Error",
						"Missing LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, or CYRUS_BASE_URL",
						false,
					),
				);
		}

		try {
			const redirectUri = `${baseUrl}/api/admin/linear-oauth/callback`;

			// Exchange code for tokens
			const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					code: query.code,
					redirect_uri: redirectUri,
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: "authorization_code",
				}).toString(),
			});

			if (!tokenResponse.ok) {
				const errorText = await tokenResponse.text();
				throw new Error(`Token exchange failed: ${errorText}`);
			}

			const data = (await tokenResponse.json()) as {
				access_token: string;
				refresh_token?: string;
			};

			if (!data.access_token) {
				throw new Error("No access_token in response");
			}

			// Fetch workspace info using the Linear API directly
			const viewerResponse = await fetch("https://api.linear.app/graphql", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: data.access_token,
				},
				body: JSON.stringify({
					query: `{ viewer { organization { id name } } }`,
				}),
			});

			const viewerData = (await viewerResponse.json()) as {
				data?: {
					viewer?: { organization?: { id: string; name: string } };
				};
			};

			const org = viewerData.data?.viewer?.organization;
			if (!org?.id) {
				throw new Error("Failed to fetch workspace info from Linear");
			}

			// Save tokens to config.json
			const configPath = resolve(cyrusHome, DEFAULT_CONFIG_FILENAME);
			try {
				const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
					repositories: Array<Record<string, unknown>>;
				};
				for (const repo of config.repositories || []) {
					const wsId = repo.linearWorkspaceId;
					if (wsId === org.id || !wsId || wsId === "") {
						repo.linearToken = data.access_token;
						if (data.refresh_token) {
							repo.linearRefreshToken = data.refresh_token;
						}
						repo.linearWorkspaceId = org.id;
						repo.linearWorkspaceName = org.name;
					}
				}
				writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8");
			} catch {
				// Config file might not exist yet — that's okay
			}

			return reply
				.type("text/html; charset=utf-8")
				.status(200)
				.send(
					oauthResultPage(
						"Authorization Successful",
						`Workspace: ${org.name}. Tokens saved to config.json. You can close this tab.`,
						true,
					),
				);
		} catch (error) {
			return reply
				.type("text/html; charset=utf-8")
				.status(500)
				.send(
					oauthResultPage(
						"Authorization Error",
						error instanceof Error ? error.message : String(error),
						false,
					),
				);
		}
	};
}

function oauthResultPage(
	title: string,
	message: string,
	success: boolean,
): string {
	const color = success ? "#4ade80" : "#f87171";
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
<div style="text-align:center;max-width:500px;padding:40px;">
<h2 style="color:${color}">${title}</h2>
<p>${message}</p>
</div>
</body></html>`;
}
