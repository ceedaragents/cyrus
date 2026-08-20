import { join } from "node:path";
import {
	createLogger,
	DEFAULT_CONFIG_FILENAME,
	type ILogger,
} from "cyrus-core";
import type { FastifyInstance } from "fastify";
import {
	addRepositoryIfMissing,
	loadConfig,
	saveConfig,
} from "./DirectLinearOAuth.js";

/**
 * Registers a merge-safe endpoint for registering one or more repositories
 * into `config.json`'s `repositories` array on a headless, always-on
 * deployment (e.g. Railway), without needing to resend the entire config
 * the way `/api/update/cyrus-config` requires.
 *
 * Unlike `/api/update/repository` (which only clones/verifies a repo on
 * disk at `~/.cyrus/repos/<name>` and never touches `config.json`), this
 * route clones (if needed) AND registers each repo, optionally with
 * `projectKeys` so Linear-project-based routing
 * (`RepositoryRouter.findRepositoryByProject`) can route issues to it
 * immediately — falling back to fuzzy project-name matching for repos
 * added without explicit `projectKeys`.
 *
 * Auth: same shared secret as the rest of the config-updater routes
 * (`CYRUS_API_KEY`), passed as a Bearer token.
 */
export interface DirectRepositoryConfigOptions {
	cyrusHome: string;
	getApiKey: () => string;
	logger?: ILogger;
}

interface RepositoryInput {
	url?: string;
	projectKeys?: string[];
	routingLabels?: string[];
}

export function registerRepositoryConfigRoute(
	fastify: FastifyInstance,
	options: DirectRepositoryConfigOptions,
): void {
	const logger =
		options.logger ?? createLogger({ component: "DirectRepositoryConfig" });
	const configPath = join(options.cyrusHome, DEFAULT_CONFIG_FILENAME);

	fastify.post("/api/update/repositories", async (request, reply) => {
		const apiKey = options.getApiKey();
		const authHeader = request.headers.authorization;
		if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
			return reply.status(401).send({ success: false, error: "Unauthorized" });
		}

		const body = request.body as
			| { repositories?: RepositoryInput[]; linearWorkspaceId?: string }
			| undefined;
		if (!body?.repositories || !Array.isArray(body.repositories)) {
			return reply.status(400).send({
				success: false,
				error: "Missing 'repositories' array in body",
			});
		}

		const config = loadConfig(configPath);

		let linearWorkspaceId = body.linearWorkspaceId;
		if (!linearWorkspaceId) {
			const workspaceIds = Object.keys(config.linearWorkspaces ?? {});
			if (workspaceIds.length === 1) {
				linearWorkspaceId = workspaceIds[0];
			} else {
				return reply.status(400).send({
					success: false,
					error:
						workspaceIds.length === 0
							? "No Linear workspace is authorized yet — complete OAuth first, or pass 'linearWorkspaceId' explicitly."
							: `Multiple Linear workspaces are configured — pass 'linearWorkspaceId' explicitly (one of: ${workspaceIds.join(", ")}).`,
				});
			}
		}

		const results = body.repositories.map((entry) => {
			if (!entry.url) {
				return { added: false, reason: "Missing 'url'" };
			}
			return addRepositoryIfMissing(
				config,
				options.cyrusHome,
				linearWorkspaceId!,
				entry.url,
				entry.routingLabels ?? [],
				logger,
				entry.projectKeys,
			);
		});

		saveConfig(configPath, config);

		const addedCount = results.filter((r) => r.added).length;
		logger.info(
			`✅ Repository registration: ${addedCount}/${results.length} newly added`,
		);

		return reply.status(200).send({
			success: true,
			message: `${addedCount}/${results.length} repositories newly added`,
			results,
		});
	});
}
