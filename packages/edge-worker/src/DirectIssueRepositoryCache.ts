import { join } from "node:path";
import { LinearClient } from "@linear/sdk";
import {
	createLogger,
	DEFAULT_CONFIG_FILENAME,
	type ILogger,
} from "cyrus-core";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./DirectLinearOAuth.js";
import type { RepositoryRouter } from "./RepositoryRouter.js";

/**
 * Registers an admin endpoint for clearing the issue-to-repository routing
 * cache on a headless deployment.
 *
 * Per packages/CLAUDE.md, once a repository is selected for a Linear issue's
 * first agentSession it is cached (`RepositoryRouter.issueRepositoryCache`,
 * keyed by issue id) and reused for every subsequent agentSession webhook on
 * that issue — routing is deliberately NOT recomputed, since Cyrus doesn't
 * support switching repositories mid-issue. That means an issue that was
 * first routed before its correct repository was registered (e.g. via
 * `/api/update/repositories/discover`) stays pinned to the wrong repo
 * forever, even after the config is fixed — there was previously no way to
 * unstick it short of restarting with a hand-edited persisted cache.
 *
 * This route deletes one issue's cache entry (or the whole cache), so the
 * next webhook for that issue re-runs `determineRepositoryForWebhook` from
 * scratch instead of reusing the stale mapping.
 *
 * Auth: same shared secret as the rest of the config-updater routes
 * (`CYRUS_API_KEY`), passed as a Bearer token.
 */
export interface DirectIssueRepositoryCacheOptions {
	cyrusHome: string;
	getApiKey: () => string;
	getRepositoryRouter: () => RepositoryRouter;
	logger?: ILogger;
}

export function registerIssueRepositoryCacheRoute(
	fastify: FastifyInstance,
	options: DirectIssueRepositoryCacheOptions,
): void {
	const logger =
		options.logger ?? createLogger({ component: "DirectIssueRepositoryCache" });
	const configPath = join(options.cyrusHome, DEFAULT_CONFIG_FILENAME);

	fastify.post(
		"/api/update/issue-repository-cache/clear",
		async (request, reply) => {
			const apiKey = options.getApiKey();
			const authHeader = request.headers.authorization;
			if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
				return reply
					.status(401)
					.send({ success: false, error: "Unauthorized" });
			}

			const body = request.body as
				| { issueId?: string; all?: boolean; linearWorkspaceId?: string }
				| undefined;

			const cache = options.getRepositoryRouter().getIssueRepositoryCache();

			if (body?.all) {
				const cleared = cache.size;
				cache.clear();
				logger.info(
					`✅ Cleared entire issue-repository cache (${cleared} entries)`,
				);
				return reply.status(200).send({
					success: true,
					cleared,
					message: `Cleared ${cleared} cached issue→repository mapping(s). The next webhook for each affected issue will route fresh.`,
				});
			}

			if (!body?.issueId) {
				return reply.status(400).send({
					success: false,
					error:
						"Missing 'issueId' (a Linear issue UUID or identifier like 'SWARM-114'), or pass all:true to clear the entire cache",
				});
			}

			// The cache is keyed by the raw issue id from webhook payloads (a
			// UUID), but callers will most naturally have the human-readable
			// identifier — resolve it via the Linear API when possible.
			let resolvedId = body.issueId;
			let note: string | undefined;
			try {
				const workspaceEntries = loadConfig(configPath).linearWorkspaces ?? {};
				let linearWorkspaceId = body.linearWorkspaceId;
				if (!linearWorkspaceId) {
					const ids = Object.keys(workspaceEntries);
					if (ids.length === 1) linearWorkspaceId = ids[0];
				}
				const token = linearWorkspaceId
					? workspaceEntries[linearWorkspaceId]?.linearToken
					: undefined;
				if (token) {
					const issue = await new LinearClient({ accessToken: token }).issue(
						body.issueId,
					);
					if (issue?.id) resolvedId = issue.id;
				} else {
					note =
						"No Linear token available to resolve identifiers — treating input as a raw issue id.";
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				note = `Could not resolve '${body.issueId}' via the Linear API (${message}) — trying it as a raw issue id.`;
			}

			const existed = cache.delete(resolvedId);
			logger.info(
				`✅ Issue-repository cache ${existed ? "cleared" : "had no entry"} for issue ${resolvedId}`,
			);
			return reply.status(200).send({
				success: true,
				issueId: resolvedId,
				cleared: existed,
				...(note ? { note } : {}),
				message: existed
					? "Cache entry cleared — the next Linear webhook for this issue will route fresh."
					: "No cache entry found for this issue (nothing to clear, or the id/identifier didn't resolve).",
			});
		},
	);
}
