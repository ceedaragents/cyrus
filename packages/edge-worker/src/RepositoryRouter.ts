import { AgentActivitySignal, type LinearClient } from "@linear/sdk";
import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	LinearWebhook,
	RepositoryConfig,
} from "cyrus-core";

/**
 * Repository routing result types
 */
export type RepositoryRoutingResult =
	| { type: "selected"; repository: RepositoryConfig }
	| { type: "needs_selection"; workspaceRepos: RepositoryConfig[] }
	| { type: "none" };

/**
 * Pending repository selection data
 */
export interface PendingRepositorySelection {
	issueId: string;
	workspaceRepos: RepositoryConfig[];
}

/**
 * Repository router dependencies
 */
export interface RepositoryRouterDeps {
	/** Fetch issue labels for label-based routing */
	fetchIssueLabels: (issueId: string, workspaceId: string) => Promise<string[]>;

	/** Check if an issue has active sessions in a repository */
	hasActiveSession: (issueId: string, repositoryId: string) => boolean;

	/** Get Linear client for a workspace */
	getLinearClient: (workspaceId: string) => LinearClient | undefined;
}

/**
 * RepositoryRouter handles all repository routing logic including:
 * - Multi-priority routing (labels, projects, teams)
 * - Issue-to-repository caching
 * - Repository selection UI via Linear elicitation
 * - Selection response handling
 *
 * This class was extracted from EdgeWorker to improve modularity and testability.
 */
export class RepositoryRouter {
	/** Cache mapping issue IDs to selected repository IDs */
	private issueRepositoryCache = new Map<string, string>();

	/** Pending repository selections awaiting user response */
	private pendingSelections = new Map<string, PendingRepositorySelection>();

	constructor(private deps: RepositoryRouterDeps) {}

	/**
	 * Get cached repository for an issue
	 *
	 * This is a simple cache lookup used by agentSessionPrompted webhooks (Branch 3).
	 * Per CLAUDE.md: "The repository will be retrieved from the issue-to-repository
	 * cache - no new routing logic is performed."
	 *
	 * @param issueId The Linear issue ID
	 * @param repositoriesMap Map of repository IDs to configurations
	 * @returns The cached repository or null if not found
	 */
	getCachedRepository(
		issueId: string,
		repositoriesMap: Map<string, RepositoryConfig>,
	): RepositoryConfig | null {
		const cachedRepositoryId = this.issueRepositoryCache.get(issueId);
		if (!cachedRepositoryId) {
			console.log(
				`[RepositoryRouter] No cached repository found for issue ${issueId}`,
			);
			return null;
		}

		const cachedRepository = repositoriesMap.get(cachedRepositoryId);
		if (!cachedRepository) {
			// Repository no longer exists, remove from cache
			console.warn(
				`[RepositoryRouter] Cached repository ${cachedRepositoryId} no longer exists, removing from cache`,
			);
			this.issueRepositoryCache.delete(issueId);
			return null;
		}

		console.log(
			`[RepositoryRouter] Using cached repository ${cachedRepository.name} for issue ${issueId}`,
		);
		return cachedRepository;
	}

	/**
	 * Determine repository for webhook using multi-priority routing:
	 * Priority 0: Existing active sessions
	 * Priority 1: Routing labels
	 * Priority 2: Project-based routing
	 * Priority 3: Team-based routing
	 * Priority 4: Catch-all repositories
	 */
	async determineRepositoryForWebhook(
		webhook: LinearAgentSessionCreatedWebhook,
		repos: RepositoryConfig[],
	): Promise<RepositoryRoutingResult> {
		const workspaceId = webhook.organizationId;
		if (!workspaceId) {
			return repos[0]
				? { type: "selected", repository: repos[0] }
				: { type: "none" };
		}

		// Extract issue information
		const { issueId, teamKey, issueIdentifier } =
			this.extractIssueInfo(webhook);

		// Priority 0: Check for existing active sessions
		if (issueId) {
			for (const repo of repos) {
				if (this.deps.hasActiveSession(issueId, repo.id)) {
					console.log(
						`[RepositoryRouter] Repository selected: ${repo.name} (existing active session)`,
					);
					return { type: "selected", repository: repo };
				}
			}
		}

		// Filter repos by workspace
		const workspaceRepos = repos.filter(
			(repo) => repo.linearWorkspaceId === workspaceId,
		);
		if (workspaceRepos.length === 0) return { type: "none" };

		// Priority 1: Check routing labels
		const labelMatchedRepo = await this.findRepositoryByLabels(
			issueId,
			workspaceRepos,
			workspaceId,
		);
		if (labelMatchedRepo) {
			console.log(
				`[RepositoryRouter] Repository selected: ${labelMatchedRepo.name} (label-based routing)`,
			);
			return { type: "selected", repository: labelMatchedRepo };
		}

		// Priority 2: Check project-based routing
		if (issueId) {
			const projectMatchedRepo = await this.findRepositoryByProject(
				issueId,
				workspaceRepos,
				workspaceId,
			);
			if (projectMatchedRepo) {
				console.log(
					`[RepositoryRouter] Repository selected: ${projectMatchedRepo.name} (project-based routing)`,
				);
				return { type: "selected", repository: projectMatchedRepo };
			}
		}

		// Priority 3: Check team-based routing
		if (teamKey) {
			const teamMatchedRepo = this.findRepositoryByTeamKey(
				teamKey,
				workspaceRepos,
			);
			if (teamMatchedRepo) {
				console.log(
					`[RepositoryRouter] Repository selected: ${teamMatchedRepo.name} (team-based routing)`,
				);
				return { type: "selected", repository: teamMatchedRepo };
			}
		}

		// Try parsing issue identifier as fallback for team routing
		if (issueIdentifier?.includes("-")) {
			const prefix = issueIdentifier.split("-")[0];
			if (prefix) {
				const repo = this.findRepositoryByTeamKey(prefix, workspaceRepos);
				if (repo) {
					console.log(
						`[RepositoryRouter] Repository selected: ${repo.name} (team prefix routing)`,
					);
					return { type: "selected", repository: repo };
				}
			}
		}

		// Priority 4: Find catch-all repository (no routing configuration)
		const catchAllRepo = workspaceRepos.find(
			(repo) =>
				(!repo.teamKeys || repo.teamKeys.length === 0) &&
				(!repo.routingLabels || repo.routingLabels.length === 0) &&
				(!repo.projectKeys || repo.projectKeys.length === 0),
		);

		if (catchAllRepo) {
			console.log(
				`[RepositoryRouter] Repository selected: ${catchAllRepo.name} (workspace catch-all)`,
			);
			return { type: "selected", repository: catchAllRepo };
		}

		// Multiple repositories with no routing match - request user selection
		if (workspaceRepos.length > 1) {
			console.log(
				`[RepositoryRouter] Multiple repositories (${workspaceRepos.length}) found with no routing match - requesting user selection`,
			);
			return { type: "needs_selection", workspaceRepos };
		}

		// Final fallback to first workspace repo
		const fallbackRepo = workspaceRepos[0];
		if (fallbackRepo) {
			console.log(
				`[RepositoryRouter] Repository selected: ${fallbackRepo.name} (workspace fallback)`,
			);
			return { type: "selected", repository: fallbackRepo };
		}

		return { type: "none" };
	}

	/**
	 * Find repository by routing labels
	 */
	private async findRepositoryByLabels(
		issueId: string | undefined,
		repos: RepositoryConfig[],
		workspaceId: string,
	): Promise<RepositoryConfig | null> {
		if (!issueId) return null;

		const reposWithRoutingLabels = repos.filter(
			(repo) => repo.routingLabels && repo.routingLabels.length > 0,
		);

		if (reposWithRoutingLabels.length === 0) return null;

		try {
			const labels = await this.deps.fetchIssueLabels(issueId, workspaceId);

			for (const repo of reposWithRoutingLabels) {
				if (
					repo.routingLabels?.some((routingLabel) =>
						labels.includes(routingLabel),
					)
				) {
					return repo;
				}
			}
		} catch (error) {
			console.error(
				`[RepositoryRouter] Failed to fetch labels for routing:`,
				error,
			);
		}

		return null;
	}

	/**
	 * Find repository by team key
	 */
	private findRepositoryByTeamKey(
		teamKey: string,
		repos: RepositoryConfig[],
	): RepositoryConfig | undefined {
		return repos.find((r) => r.teamKeys?.includes(teamKey));
	}

	/**
	 * Find repository by project name
	 */
	private async findRepositoryByProject(
		issueId: string,
		repos: RepositoryConfig[],
		workspaceId: string,
	): Promise<RepositoryConfig | null> {
		// Try each repository that has projectKeys configured
		for (const repo of repos) {
			if (!repo.projectKeys || repo.projectKeys.length === 0) continue;

			try {
				const linearClient = this.deps.getLinearClient(workspaceId);
				if (!linearClient) {
					console.warn(
						`[RepositoryRouter] No Linear client found for workspace ${workspaceId}`,
					);
					continue;
				}

				const fullIssue = await linearClient.issue(issueId);
				const project = await fullIssue?.project;
				if (!project || !project.name) {
					console.warn(
						`[RepositoryRouter] No project name found for issue ${issueId} in repository ${repo.name}`,
					);
					continue;
				}

				const projectName = project.name;
				if (repo.projectKeys.includes(projectName)) {
					console.log(
						`[RepositoryRouter] Matched issue ${issueId} to repository ${repo.name} via project: ${projectName}`,
					);
					return repo;
				}
			} catch (error) {
				// Continue to next repository if this one fails
				console.debug(
					`[RepositoryRouter] Failed to fetch project for issue ${issueId} from repository ${repo.name}:`,
					error,
				);
			}
		}

		return null;
	}

	/**
	 * Elicit user repository selection - post elicitation to Linear
	 */
	async elicitUserRepositorySelection(
		webhook: LinearAgentSessionCreatedWebhook,
		workspaceRepos: RepositoryConfig[],
	): Promise<void> {
		const { agentSession } = webhook;
		const agentSessionId = agentSession.id;
		const { issue } = agentSession;

		console.log(
			`[RepositoryRouter] Posting repository selection elicitation for issue ${issue.identifier}`,
		);

		// Store pending selection
		this.pendingSelections.set(agentSessionId, {
			issueId: issue.id,
			workspaceRepos,
		});

		// Validate we have repositories to offer
		const firstRepo = workspaceRepos[0];
		if (!firstRepo) {
			console.error(
				"[RepositoryRouter] No repositories available for selection elicitation",
			);
			return;
		}

		// Get Linear client for the workspace
		const linearClient = this.deps.getLinearClient(webhook.organizationId);
		if (!linearClient) {
			console.error(
				`[RepositoryRouter] No Linear client found for workspace ${webhook.organizationId}`,
			);
			return;
		}

		// Create repository options
		const options = workspaceRepos.map((repo) => ({
			value: repo.githubUrl || repo.name,
		}));

		// Post elicitation activity
		try {
			await linearClient.createAgentActivity({
				agentSessionId,
				content: {
					type: "elicitation",
					body: "Which repository should I work in for this issue?",
				},
				signal: AgentActivitySignal.Select,
				signalMetadata: { options },
			});

			console.log(
				`[RepositoryRouter] Posted repository selection elicitation with ${options.length} options`,
			);
		} catch (error) {
			console.error(
				`[RepositoryRouter] Failed to post repository selection elicitation:`,
				error,
			);

			await this.postRepositorySelectionError(
				agentSessionId,
				linearClient,
				error,
			);

			this.pendingSelections.delete(agentSessionId);
		}
	}

	/**
	 * Post error activity when repository selection fails
	 */
	private async postRepositorySelectionError(
		agentSessionId: string,
		linearClient: LinearClient,
		error: unknown,
	): Promise<void> {
		const errorObj = error as Error;
		const errorMessage = errorObj?.message || String(error);

		try {
			await linearClient.createAgentActivity({
				agentSessionId,
				content: {
					type: "error",
					body: `Failed to display repository selection: ${errorMessage}`,
				},
			});
			console.log(
				`[RepositoryRouter] Posted error activity for repository selection failure`,
			);
		} catch (postError) {
			console.error(
				`[RepositoryRouter] Failed to post error activity (may be due to same underlying issue):`,
				postError,
			);
		}
	}

	/**
	 * Select repository from user response
	 * Returns the selected repository or null if webhook should not be processed further
	 */
	async selectRepositoryFromResponse(
		agentSessionId: string,
		selectedRepositoryName: string,
	): Promise<RepositoryConfig | null> {
		const pendingData = this.pendingSelections.get(agentSessionId);
		if (!pendingData) {
			console.log(
				`[RepositoryRouter] No pending repository selection found for agent session ${agentSessionId}`,
			);
			return null;
		}

		// Remove from pending map
		this.pendingSelections.delete(agentSessionId);

		// Find selected repository by GitHub URL or name
		const selectedRepo = pendingData.workspaceRepos.find(
			(repo) =>
				repo.githubUrl === selectedRepositoryName ||
				repo.name === selectedRepositoryName,
		);

		// Fallback to first repository if not found
		const repository = selectedRepo || pendingData.workspaceRepos[0];
		if (!repository) {
			console.error(
				`[RepositoryRouter] No repository found for selection: ${selectedRepositoryName}`,
			);
			return null;
		}

		if (!selectedRepo) {
			console.log(
				`[RepositoryRouter] Repository "${selectedRepositoryName}" not found, falling back to ${repository.name}`,
			);
		} else {
			console.log(
				`[RepositoryRouter] User selected repository: ${repository.name}`,
			);
		}

		return repository;
	}

	/**
	 * Check if there's a pending repository selection for this agent session
	 */
	hasPendingSelection(agentSessionId: string): boolean {
		return this.pendingSelections.has(agentSessionId);
	}

	/**
	 * Extract issue information from webhook
	 */
	private extractIssueInfo(webhook: LinearWebhook): {
		issueId?: string;
		teamKey?: string;
		issueIdentifier?: string;
	} {
		// Handle agent session webhooks
		if (
			this.isAgentSessionCreatedWebhook(webhook) ||
			this.isAgentSessionPromptedWebhook(webhook)
		) {
			return {
				issueId: webhook.agentSession?.issue?.id,
				teamKey: webhook.agentSession?.issue?.team?.key,
				issueIdentifier: webhook.agentSession?.issue?.identifier,
			};
		}

		// Handle notification webhooks
		return {
			issueId: webhook.notification?.issue?.id,
			teamKey: webhook.notification?.issue?.team?.key,
			issueIdentifier: webhook.notification?.issue?.identifier,
		};
	}

	/**
	 * Type guards
	 */
	private isAgentSessionCreatedWebhook(
		webhook: LinearWebhook,
	): webhook is LinearAgentSessionCreatedWebhook {
		return (webhook as any).action === "AgentSession.created";
	}

	private isAgentSessionPromptedWebhook(
		webhook: LinearWebhook,
	): webhook is LinearAgentSessionPromptedWebhook {
		return (webhook as any).action === "AgentSession.prompted";
	}

	/**
	 * Get issue repository cache for serialization
	 */
	getIssueRepositoryCache(): Map<string, string> {
		return this.issueRepositoryCache;
	}

	/**
	 * Restore issue repository cache from serialization
	 */
	restoreIssueRepositoryCache(cache: Map<string, string>): void {
		this.issueRepositoryCache = cache;
	}
}
