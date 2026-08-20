import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LinearClient } from "@linear/sdk";
import {
	createLogger,
	DEFAULT_BASE_BRANCH,
	DEFAULT_CONFIG_FILENAME,
	type EdgeConfig,
	getDefaultReposDir,
	getDefaultWorktreesDir,
	type ILogger,
	migrateEdgeConfig,
} from "cyrus-core";
import type { FastifyInstance } from "fastify";

/**
 * Registers a self-hosted, direct Linear OAuth flow ("GET /oauth/authorize" +
 * "GET /callback") on the SAME long-running Fastify server the EdgeWorker
 * already uses for webhooks — so completing OAuth against a headless,
 * always-on deployment (e.g. Railway) never requires a separate process to
 * briefly steal the listening port.
 *
 * This mirrors the working logic in `apps/cli/src/commands/SelfAuthCommand.ts`
 * and `SelfAddRepoCommand.ts`, adapted to run inline in an HTTP handler
 * instead of a one-shot CLI process. It is intentionally self-contained
 * (does not touch `SharedApplicationServer.startOAuthFlow`, whose "direct
 * OAuth mode" branch targets a `/oauth/authorize` route that was never
 * implemented — see CYRUS-railway-deploy investigation).
 *
 * Only registered when self-hosted direct OAuth is possible, i.e.
 * `CYRUS_HOST_EXTERNAL=true` and `LINEAR_CLIENT_ID`/`LINEAR_CLIENT_SECRET`
 * are set. Gated by `CYRUS_API_KEY` (the same shared secret already used to
 * authenticate `cyrus-config-updater`'s `/api/update/*` routes) passed as a
 * `?key=` query param, since a browser navigation can't carry a bearer
 * header.
 */
export interface DirectLinearOAuthOptions {
	cyrusHome: string;
	getApiKey: () => string;
	getBaseUrl: () => string | undefined;
	/** Optional: repo to auto-add on first successful auth, e.g. for self-hosting Cyrus against its own repo. */
	autoAddRepository?: {
		url: string;
		routingLabels?: string[];
	};
	logger?: ILogger;
}

function htmlPage(title: string, body: string, statusColor = "#111"): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui; padding: 40px; max-width: 640px; margin: 0 auto;">
<h2 style="color:${statusColor}">${title}</h2>
${body}
</body></html>`;
}

function loadConfig(configPath: string): EdgeConfig {
	if (!existsSync(configPath)) {
		return { repositories: [] } as EdgeConfig;
	}
	try {
		return migrateEdgeConfig(
			JSON.parse(readFileSync(configPath, "utf-8")),
		) as EdgeConfig;
	} catch {
		return { repositories: [] } as EdgeConfig;
	}
}

function saveConfig(configPath: string, config: EdgeConfig): void {
	writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8");
}

function detectDefaultBranch(repositoryPath: string): string {
	try {
		const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
			cwd: repositoryPath,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		const branch = ref.replace("refs/remotes/origin/", "");
		if (branch) return branch;
	} catch {
		// fall through
	}
	return DEFAULT_BASE_BRANCH;
}

async function fetchWorkspaceInfo(
	accessToken: string,
): Promise<{ id: string; name: string; slug: string }> {
	const linearClient = new LinearClient({ accessToken });
	const viewer = await linearClient.viewer;
	const organization = await viewer.organization;
	if (!organization?.id) {
		throw new Error("Failed to get workspace info from Linear");
	}
	return {
		id: organization.id,
		name: organization.name || organization.id,
		slug: organization.urlKey,
	};
}

async function exchangeCodeForTokens(
	code: string,
	redirectUri: string,
	clientId: string,
	clientSecret: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
	const response = await fetch("https://api.linear.app/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

	if (!data.access_token?.startsWith("lin_oauth_")) {
		throw new Error("Invalid access token received from Linear");
	}

	return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

function addRepositoryIfMissing(
	config: EdgeConfig,
	cyrusHome: string,
	linearWorkspaceId: string,
	repoUrl: string,
	routingLabels: string[] | undefined,
	logger: ILogger,
): void {
	if (!config.repositories) config.repositories = [];

	const repoName = repoUrl
		.split("/")
		.pop()
		?.replace(/\.git$/, "");
	if (!repoName) return;

	if (config.repositories.some((r) => r.name === repoName)) {
		logger.info(
			`Repository '${repoName}' already configured — skipping auto-add`,
		);
		return;
	}

	const repositoryPath = resolve(getDefaultReposDir(cyrusHome), repoName);

	try {
		if (!existsSync(repositoryPath)) {
			logger.info(`Cloning ${repoUrl} to ${repositoryPath}...`);
			execSync(`git clone ${repoUrl} ${repositoryPath}`, { stdio: "pipe" });
		}
	} catch (error) {
		logger.error(
			`Failed to clone ${repoUrl}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return;
	}

	const baseBranch = detectDefaultBranch(repositoryPath);

	const repoConfig: EdgeConfig["repositories"][number] = {
		id: randomUUID(),
		name: repoName,
		repositoryPath,
		baseBranch,
		workspaceBaseDir: getDefaultWorktreesDir(cyrusHome),
		linearWorkspaceId,
		isActive: true,
		routingLabels: routingLabels ?? [repoName],
	};

	if (repoUrl.includes("gitlab.com") || repoUrl.includes("gitlab.")) {
		repoConfig.gitlabUrl = repoUrl.replace(/\.git$/, "");
	} else if (repoUrl.includes("github.com")) {
		repoConfig.githubUrl = repoUrl.replace(/\.git$/, "");
	}

	config.repositories.push(repoConfig);
	logger.info(
		`Added repository '${repoName}' routed to workspace ${linearWorkspaceId}`,
	);
}

export function registerDirectLinearOAuthRoutes(
	fastify: FastifyInstance,
	options: DirectLinearOAuthOptions,
): void {
	const logger =
		options.logger ?? createLogger({ component: "DirectLinearOAuth" });
	const configPath = join(options.cyrusHome, DEFAULT_CONFIG_FILENAME);

	fastify.get("/oauth/authorize", async (request, reply) => {
		const apiKey = options.getApiKey();
		const providedKey = (request.query as Record<string, string>)?.key;

		if (!apiKey) {
			return reply
				.code(503)
				.type("text/html; charset=utf-8")
				.send(
					htmlPage(
						"Direct OAuth not configured",
						"<p>Set <code>CYRUS_API_KEY</code> on this deployment to enable the self-hosted Linear authorize link.</p>",
						"#b91c1c",
					),
				);
		}

		if (!providedKey || providedKey !== apiKey) {
			return reply
				.code(401)
				.type("text/html; charset=utf-8")
				.send(
					htmlPage(
						"Unauthorized",
						"<p>Missing or invalid <code>key</code> query parameter.</p>",
						"#b91c1c",
					),
				);
		}

		const clientId = process.env.LINEAR_CLIENT_ID;
		const baseUrl = options.getBaseUrl();
		if (!clientId || !baseUrl) {
			return reply
				.code(503)
				.type("text/html; charset=utf-8")
				.send(
					htmlPage(
						"Direct OAuth not configured",
						"<p>Missing <code>LINEAR_CLIENT_ID</code> or base URL on this deployment.</p>",
						"#b91c1c",
					),
				);
		}

		const redirectUri = `${baseUrl.replace(/\/+$/, "")}/callback`;
		const oauthUrl = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=write,app:assignable,app:mentionable&actor=app`;

		return reply.redirect(oauthUrl, 302);
	});

	fastify.get("/callback", async (request, reply) => {
		const query = request.query as { code?: string; error?: string };

		if (query.error) {
			return reply
				.code(400)
				.type("text/html; charset=utf-8")
				.send(
					htmlPage("Authorization failed", `<p>${query.error}</p>`, "#b91c1c"),
				);
		}

		if (!query.code) {
			return reply
				.code(400)
				.type("text/html; charset=utf-8")
				.send(htmlPage("Missing authorization code", "", "#b91c1c"));
		}

		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;
		const baseUrl = options.getBaseUrl();

		if (!clientId || !clientSecret || !baseUrl) {
			return reply
				.code(503)
				.type("text/html; charset=utf-8")
				.send(
					htmlPage(
						"Direct OAuth not configured",
						"<p>Missing Linear OAuth credentials or base URL on this deployment.</p>",
						"#b91c1c",
					),
				);
		}

		try {
			const redirectUri = `${baseUrl.replace(/\/+$/, "")}/callback`;
			const tokens = await exchangeCodeForTokens(
				query.code,
				redirectUri,
				clientId,
				clientSecret,
			);
			const workspace = await fetchWorkspaceInfo(tokens.accessToken);

			const config = loadConfig(configPath);
			if (!config.linearWorkspaces) config.linearWorkspaces = {};
			config.linearWorkspaces[workspace.id] = {
				linearToken: tokens.accessToken,
				...(tokens.refreshToken
					? { linearRefreshToken: tokens.refreshToken }
					: {}),
				linearWorkspaceName: workspace.name,
				linearWorkspaceSlug: workspace.slug,
			};

			let repoNote = "No repository was auto-configured.";
			if (options.autoAddRepository) {
				addRepositoryIfMissing(
					config,
					options.cyrusHome,
					workspace.id,
					options.autoAddRepository.url,
					options.autoAddRepository.routingLabels,
					logger,
				);
				repoNote = `Repository <code>${options.autoAddRepository.url}</code> is configured for this workspace.`;
			}

			saveConfig(configPath, config);
			logger.info(
				`✅ Linear workspace authorized via direct OAuth: ${workspace.name} (${workspace.id})`,
			);

			return reply
				.code(200)
				.type("text/html; charset=utf-8")
				.send(
					htmlPage(
						"Cyrus authorized successfully",
						`<p>Connected to Linear workspace <strong>${workspace.name}</strong>.</p><p>${repoNote}</p><p>You can close this window.</p>`,
						"#15803d",
					),
				);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Direct OAuth callback failed: ${message}`);
			return reply
				.code(500)
				.type("text/html; charset=utf-8")
				.send(htmlPage("Authorization failed", `<p>${message}</p>`, "#b91c1c"));
		}
	});
}
