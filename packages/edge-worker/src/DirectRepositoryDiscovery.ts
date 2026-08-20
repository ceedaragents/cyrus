import { join } from "node:path";
import { LinearClient } from "@linear/sdk";
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
import { findBestFuzzyMatch } from "./repositoryFuzzyMatch.js";

/**
 * Registers a merge-safe endpoint that discovers repositories itself,
 * rather than requiring a hand-curated list: it fetches the Linear
 * workspace's projects, lists a GitHub owner's repos live via the GitHub
 * API, fuzzy-matches project names against repo names (see
 * `repositoryFuzzyMatch.ts`), and clones + registers the confident matches
 * into `config.json` — the same way `POST /api/update/repositories` does,
 * but without anyone having to look up and paste the repo list by hand.
 *
 * Safe to re-run any time a new Linear project or GitHub repo shows up:
 * already-configured repos are reported as `already-configured` and left
 * untouched, and `dryRun: true` previews the matches without cloning or
 * writing anything.
 *
 * Auth: same shared secret as the rest of the config-updater routes
 * (`CYRUS_API_KEY`), passed as a Bearer token.
 */
export interface DirectRepositoryDiscoveryOptions {
	cyrusHome: string;
	getApiKey: () => string;
	/** Resolves a GitHub token for listing repos (installation token, GITHUB_TOKEN, or undefined for unauthenticated/public-only). */
	getGithubToken: () => Promise<string | undefined>;
	logger?: ILogger;
}

interface GithubRepoCandidate {
	name: string;
	url: string;
}

async function fetchGithubReposForOwnerKind(
	kind: "users" | "orgs",
	owner: string,
	headers: Record<string, string>,
): Promise<GithubRepoCandidate[] | null> {
	const repos: GithubRepoCandidate[] = [];
	for (let page = 1; page <= 5; page++) {
		const response = await fetch(
			`https://api.github.com/${kind}/${encodeURIComponent(owner)}/repos?per_page=100&page=${page}`,
			{ headers },
		);
		if (response.status === 404) {
			return page === 1 ? null : repos;
		}
		if (!response.ok) {
			throw new Error(
				`GitHub API error ${response.status} listing ${kind}/${owner} repos: ${await response.text()}`,
			);
		}
		const data = (await response.json()) as Array<{
			name: string;
			html_url: string;
		}>;
		repos.push(...data.map((r) => ({ name: r.name, url: r.html_url })));
		if (data.length < 100) break;
	}
	return repos;
}

/** List repos for a GitHub owner, trying it as a user first, then an org. */
async function fetchGithubRepos(
	owner: string,
	token: string | undefined,
): Promise<GithubRepoCandidate[]> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	const userRepos = await fetchGithubReposForOwnerKind("users", owner, headers);
	if (userRepos) return userRepos;

	const orgRepos = await fetchGithubReposForOwnerKind("orgs", owner, headers);
	if (orgRepos) return orgRepos;

	throw new Error(
		`GitHub owner '${owner}' not found (checked both /users and /orgs)`,
	);
}

async function fetchLinearProjects(
	linearToken: string,
): Promise<Array<{ id: string; name: string }>> {
	const linearClient = new LinearClient({ accessToken: linearToken });
	// 250 covers every workspace we've seen in practice; revisit with
	// cursor pagination if a workspace ever has more projects than that.
	const result = await linearClient.projects({ first: 250 });
	return result.nodes.map((p) => ({ id: p.id, name: p.name }));
}

interface DiscoveryMatch {
	project: string;
	repo: string;
	url: string;
	status: "added" | "already-configured" | "clone-failed" | "dry-run";
	reason?: string;
}

export function registerRepositoryDiscoveryRoute(
	fastify: FastifyInstance,
	options: DirectRepositoryDiscoveryOptions,
): void {
	const logger =
		options.logger ?? createLogger({ component: "DirectRepositoryDiscovery" });
	const configPath = join(options.cyrusHome, DEFAULT_CONFIG_FILENAME);

	fastify.post("/api/update/repositories/discover", async (request, reply) => {
		const apiKey = options.getApiKey();
		const authHeader = request.headers.authorization;
		if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
			return reply.status(401).send({ success: false, error: "Unauthorized" });
		}

		const body = request.body as
			| { githubOwner?: string; linearWorkspaceId?: string; dryRun?: boolean }
			| undefined;
		if (!body?.githubOwner || typeof body.githubOwner !== "string") {
			return reply.status(400).send({
				success: false,
				error: "Missing 'githubOwner' string in body",
			});
		}

		const config = loadConfig(configPath);
		const workspaceEntries = config.linearWorkspaces ?? {};

		let linearWorkspaceId = body.linearWorkspaceId;
		if (!linearWorkspaceId) {
			const workspaceIds = Object.keys(workspaceEntries);
			if (workspaceIds.length === 1) {
				linearWorkspaceId = workspaceIds[0] as string;
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

		const resolvedWorkspaceId: string = linearWorkspaceId;
		const workspaceEntry = workspaceEntries[resolvedWorkspaceId];
		if (!workspaceEntry?.linearToken) {
			return reply.status(400).send({
				success: false,
				error: `No Linear token stored for workspace '${resolvedWorkspaceId}'`,
			});
		}

		let projects: Array<{ id: string; name: string }>;
		let repos: GithubRepoCandidate[];
		try {
			[projects, repos] = await Promise.all([
				fetchLinearProjects(workspaceEntry.linearToken),
				fetchGithubRepos(body.githubOwner, await options.getGithubToken()),
			]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Repository discovery failed: ${message}`);
			return reply.status(502).send({ success: false, error: message });
		}

		const configuredNames = new Set(
			(config.repositories ?? []).map((r) => r.name),
		);

		const matches: DiscoveryMatch[] = [];
		const unmatchedProjects: string[] = [];

		for (const project of projects) {
			const match = findBestFuzzyMatch(project.name, repos, (r) => [r.name]);
			if (!match) {
				unmatchedProjects.push(project.name);
				continue;
			}

			if (configuredNames.has(match.name)) {
				matches.push({
					project: project.name,
					repo: match.name,
					url: match.url,
					status: "already-configured",
				});
				continue;
			}

			if (body.dryRun) {
				matches.push({
					project: project.name,
					repo: match.name,
					url: match.url,
					status: "dry-run",
				});
				continue;
			}

			const result = addRepositoryIfMissing(
				config,
				options.cyrusHome,
				resolvedWorkspaceId,
				match.url,
				[],
				logger,
				[project.name],
			);
			configuredNames.add(match.name);
			matches.push({
				project: project.name,
				repo: match.name,
				url: match.url,
				status: result.added ? "added" : "clone-failed",
				reason: result.reason,
			});
		}

		if (!body.dryRun) {
			saveConfig(configPath, config);
		}

		const addedCount = matches.filter((m) => m.status === "added").length;
		logger.info(
			`✅ Repository discovery: ${addedCount} newly added, ${unmatchedProjects.length} unmatched projects`,
		);

		return reply.status(200).send({
			success: true,
			dryRun: !!body.dryRun,
			linearWorkspaceId: resolvedWorkspaceId,
			githubOwner: body.githubOwner,
			matches,
			unmatchedProjects,
		});
	});
}
