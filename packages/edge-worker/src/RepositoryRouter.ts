import {
	AgentActivitySignal,
	type AgentSessionCreatedWebhook,
	type AgentSessionPromptedWebhook,
	createLogger,
	type IIssueTrackerService,
	type ILogger,
	type RepositoryConfig,
	type Webhook,
} from "cyrus-core";

/**
 * Repository routing result types
 */
export type RoutingMethod =
	| "description-tag"
	| "label-based"
	| "project-based"
	| "team-based"
	| "team-prefix"
	| "catch-all"
	| "workspace-fallback";

export type RepositoryRoutingResult =
	| {
			type: "selected";
			repository: RepositoryConfig;
			routingMethod: RoutingMethod;
	  }
	| {
			type: "selected-multiple";
			/** Ordered repository list used to construct the workspace */
			repositories: RepositoryConfig[];
			/** Primary repository used for session manager + issue tracker interactions */
			primaryRepository: RepositoryConfig;
			/** Explicit routing methods that contributed to this multi-repo selection */
			routingMethods: Array<
				Extract<RoutingMethod, "description-tag" | "label-based">
			>;
	  }
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

	/** Fetch issue description for description-tag routing */
	fetchIssueDescription: (
		issueId: string,
		workspaceId: string,
	) => Promise<string | undefined>;

	/** Check if an issue has active sessions in a repository */
	hasActiveSession: (issueId: string, repositoryId: string) => boolean;

	/** Get issue tracker service for a workspace */
	getIssueTracker: (workspaceId: string) => IIssueTrackerService | undefined;
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
	/** Cache mapping issue IDs to primary selected repository IDs */
	private issueRepositoryCache = new Map<string, string>();
	/** Cache mapping issue IDs to all repositories selected for workspace creation */
	private issueWorkspaceRepositoryCache = new Map<string, string[]>();

	/** Pending repository selections awaiting user response */
	private pendingSelections = new Map<string, PendingRepositorySelection>();

	private logger: ILogger;

	constructor(
		private deps: RepositoryRouterDeps,
		logger?: ILogger,
	) {
		this.logger = logger ?? createLogger({ component: "RepositoryRouter" });
	}

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
			this.logger.debug(`No cached repository found for issue ${issueId}`);
			return null;
		}

		const cachedRepository = repositoriesMap.get(cachedRepositoryId);
		if (!cachedRepository) {
			// Repository no longer exists, remove from cache
			this.logger.warn(
				`Cached repository ${cachedRepositoryId} no longer exists, removing from cache`,
			);
			this.issueRepositoryCache.delete(issueId);
			this.issueWorkspaceRepositoryCache.delete(issueId);
			return null;
		}

		this.logger.debug(
			`Using cached repository ${cachedRepository.name} for issue ${issueId}`,
		);
		return cachedRepository;
	}

	/**
	 * Get cached workspace repositories for an issue.
	 * Falls back to primary repository cache for backwards compatibility.
	 */
	getCachedWorkspaceRepositories(
		issueId: string,
		repositoriesMap: Map<string, RepositoryConfig>,
	): RepositoryConfig[] | null {
		const cachedRepositoryIds = this.issueWorkspaceRepositoryCache.get(issueId);
		if (cachedRepositoryIds && cachedRepositoryIds.length > 0) {
			const repositories = cachedRepositoryIds
				.map((repositoryId) => repositoriesMap.get(repositoryId) ?? null)
				.filter((repo): repo is RepositoryConfig => repo !== null);

			if (repositories.length > 0) {
				return repositories;
			}

			// Clean up invalid cache entries
			this.issueWorkspaceRepositoryCache.delete(issueId);
		}

		const cachedPrimaryRepository = this.getCachedRepository(
			issueId,
			repositoriesMap,
		);
		return cachedPrimaryRepository ? [cachedPrimaryRepository] : null;
	}

	/**
	 * Cache repository selection for an issue.
	 * Stores both primary repository (legacy behavior) and optional multi-repo workspace set.
	 */
	setIssueRepositorySelection(
		issueId: string,
		primaryRepositoryId: string,
		workspaceRepositoryIds?: string[],
	): void {
		this.issueRepositoryCache.set(issueId, primaryRepositoryId);

		const uniqueWorkspaceRepositoryIds = Array.from(
			new Set(
				(workspaceRepositoryIds ?? [primaryRepositoryId]).filter(
					(repositoryId) => repositoryId.length > 0,
				),
			),
		);

		if (uniqueWorkspaceRepositoryIds.length > 1) {
			this.issueWorkspaceRepositoryCache.set(
				issueId,
				uniqueWorkspaceRepositoryIds,
			);
			return;
		}

		this.issueWorkspaceRepositoryCache.delete(issueId);
	}

	/**
	 * Determine repository for webhook using multi-priority routing:
	 * Priority 0: Existing active sessions
	 * Priority 1: Description tag (explicit [repo=...] in issue description)
	 * Priority 2: Routing labels
	 * Priority 3: Project-based routing
	 * Priority 4: Team-based routing
	 * Priority 5: Catch-all repositories
	 */
	async determineRepositoryForWebhook(
		webhook: AgentSessionCreatedWebhook | AgentSessionPromptedWebhook,
		repos: RepositoryConfig[],
	): Promise<RepositoryRoutingResult> {
		const workspaceId = webhook.organizationId;
		if (!workspaceId) {
			return repos[0]
				? {
						type: "selected",
						repository: repos[0],
						routingMethod: "workspace-fallback",
					}
				: { type: "none" };
		}

		// Extract issue information
		const { issueId, teamKey, issueIdentifier } =
			this.extractIssueInfo(webhook);

		// Priority 0: Check for existing active sessions
		// TODO: Remove this priority check - existing session detection should not be a routing method
		if (issueId) {
			for (const repo of repos) {
				if (this.deps.hasActiveSession(issueId, repo.id)) {
					this.logger.info(
						`Repository selected: ${repo.name} (existing active session)`,
					);
					return {
						type: "selected",
						repository: repo,
						routingMethod: "workspace-fallback",
					};
				}
			}
		}

		// Filter repos by workspace
		const workspaceRepos = repos.filter(
			(repo) => repo.linearWorkspaceId === workspaceId,
		);
		if (workspaceRepos.length === 0) return { type: "none" };

		// Priority 1 + 2 (explicit mentions): description tags and routing labels.
		// If they collectively mention 2+ repositories, we enter multi-repo mode.
		const descriptionTagRepos = await this.findRepositoriesByDescriptionTags(
			issueId,
			workspaceRepos,
			workspaceId,
		);
		const labelMatchedRepos = await this.findRepositoriesByLabels(
			issueId,
			workspaceRepos,
			workspaceId,
		);

		const explicitRepos = this.mergeUniqueRepositories(
			[...descriptionTagRepos, ...labelMatchedRepos],
			workspaceRepos,
		);

		if (explicitRepos.length > 1) {
			const methods: Array<"description-tag" | "label-based"> = [];
			if (descriptionTagRepos.length > 0) methods.push("description-tag");
			if (labelMatchedRepos.length > 0) methods.push("label-based");

			const primaryRepository = explicitRepos[0];
			if (!primaryRepository) {
				return { type: "none" };
			}

			this.logger.info(
				`Multiple repositories explicitly matched (${explicitRepos.length}) - using multi-repo workspace`,
			);
			return {
				type: "selected-multiple",
				repositories: explicitRepos,
				primaryRepository,
				routingMethods: methods,
			};
		}

		if (explicitRepos.length === 1) {
			const explicitRepository = explicitRepos[0];
			if (!explicitRepository) {
				return { type: "none" };
			}
			const routingMethod =
				descriptionTagRepos.length > 0 ? "description-tag" : "label-based";
			this.logger.info(
				`Repository selected: ${explicitRepository.name} (${routingMethod} routing)`,
			);
			return {
				type: "selected",
				repository: explicitRepository,
				routingMethod,
			};
		}

		// Priority 3: Check project-based routing
		if (issueId) {
			const projectMatchedRepo = await this.findRepositoryByProject(
				issueId,
				workspaceRepos,
				workspaceId,
			);
			if (projectMatchedRepo) {
				this.logger.info(
					`Repository selected: ${projectMatchedRepo.name} (project-based routing)`,
				);
				return {
					type: "selected",
					repository: projectMatchedRepo,
					routingMethod: "project-based",
				};
			}
		}

		// Priority 4: Check team-based routing
		if (teamKey) {
			const teamMatchedRepo = this.findRepositoryByTeamKey(
				teamKey,
				workspaceRepos,
			);
			if (teamMatchedRepo) {
				this.logger.info(
					`Repository selected: ${teamMatchedRepo.name} (team-based routing)`,
				);
				return {
					type: "selected",
					repository: teamMatchedRepo,
					routingMethod: "team-based",
				};
			}
		}

		// Try parsing issue identifier as fallback for team routing
		// TODO: Remove team prefix routing - should rely on explicit team-based routing only
		if (issueIdentifier?.includes("-")) {
			const prefix = issueIdentifier.split("-")[0];
			if (prefix) {
				const repo = this.findRepositoryByTeamKey(prefix, workspaceRepos);
				if (repo) {
					this.logger.info(
						`Repository selected: ${repo.name} (team prefix routing)`,
					);
					return {
						type: "selected",
						repository: repo,
						routingMethod: "team-prefix",
					};
				}
			}
		}

		// Priority 5: Find catch-all repository (no routing configuration)
		// TODO: Remove catch-all routing - require explicit routing configuration for all repositories
		const catchAllRepo = workspaceRepos.find(
			(repo) =>
				(!repo.teamKeys || repo.teamKeys.length === 0) &&
				(!repo.routingLabels || repo.routingLabels.length === 0) &&
				(!repo.projectKeys || repo.projectKeys.length === 0),
		);

		if (catchAllRepo) {
			this.logger.info(
				`Repository selected: ${catchAllRepo.name} (workspace catch-all)`,
			);
			return {
				type: "selected",
				repository: catchAllRepo,
				routingMethod: "catch-all",
			};
		}

		// Multiple repositories with no routing match - request user selection
		if (workspaceRepos.length > 1) {
			this.logger.info(
				`Multiple repositories (${workspaceRepos.length}) found with no routing match - requesting user selection`,
			);
			return { type: "needs_selection", workspaceRepos };
		}

		// Final fallback to first workspace repo
		const fallbackRepo = workspaceRepos[0];
		if (fallbackRepo) {
			this.logger.info(
				`Repository selected: ${fallbackRepo.name} (workspace fallback)`,
			);
			return {
				type: "selected",
				repository: fallbackRepo,
				routingMethod: "workspace-fallback",
			};
		}

		return { type: "none" };
	}

	/**
	 * Find repository by routing labels
	 */
	private async findRepositoriesByLabels(
		issueId: string | undefined,
		repos: RepositoryConfig[],
		workspaceId: string,
	): Promise<RepositoryConfig[]> {
		if (!issueId) return [];

		const reposWithRoutingLabels = repos.filter(
			(repo) => repo.routingLabels && repo.routingLabels.length > 0,
		);

		if (reposWithRoutingLabels.length === 0) return [];

		try {
			const labels = await this.deps.fetchIssueLabels(issueId, workspaceId);
			return reposWithRoutingLabels.filter((repo) =>
				repo.routingLabels?.some((routingLabel: string) =>
					labels.includes(routingLabel),
				),
			);
		} catch (error) {
			this.logger.error(`Failed to fetch labels for routing:`, error);
			return [];
		}
	}

	/**
	 * Find repositories by description tags.
	 *
	 * Parses issue description for [repo=...] tags and matches against:
	 * - Repository GitHub URL (contains org/repo-name)
	 * - Repository name
	 * - Repository ID
	 *
	 * Example tags:
	 * - [repo=Trelent/lighthouse-financial-disclosure]
	 * - [repo=my-repo-name]
	 */
	private async findRepositoriesByDescriptionTags(
		issueId: string | undefined,
		repos: RepositoryConfig[],
		workspaceId: string,
	): Promise<RepositoryConfig[]> {
		if (!issueId) return [];

		try {
			const description = await this.deps.fetchIssueDescription(
				issueId,
				workspaceId,
			);
			if (!description) return [];

			const repoTags = this.parseRepoTagsFromDescription(description);
			if (repoTags.length === 0) return [];

			this.logger.debug(
				`Found ${repoTags.length} [repo=...] tag(s) in issue description`,
			);

			const matchedRepositoryIds = new Set<string>();
			for (const repoTag of repoTags) {
				const matchedRepo = repos.find((repo) => {
					if (repo.githubUrl?.includes(repoTag)) return true;
					if (repo.name.toLowerCase() === repoTag.toLowerCase()) return true;
					if (repo.id === repoTag) return true;
					return false;
				});

				if (matchedRepo) {
					matchedRepositoryIds.add(matchedRepo.id);
				}
			}

			if (matchedRepositoryIds.size === 0) {
				this.logger.debug(
					`No repository matched repo tags: ${repoTags.join(", ")}`,
				);
				return [];
			}

			// Preserve configured repository order for determinism.
			return repos.filter((repo) => matchedRepositoryIds.has(repo.id));
		} catch (error) {
			this.logger.error(`Failed to fetch description for routing:`, error);
			return [];
		}
	}

	/**
	 * Parse [repo=...] tag from issue description
	 *
	 * Supports various formats:
	 * - [repo=org/repo-name]
	 * - [repo=repo-name]
	 * - [repo=repo-id]
	 *
	 * Also handles escaped brackets (\\[repo=...\\]) which Linear may produce
	 * when the description contains markdown-escaped square brackets.
	 *
	 * Returns the tag value or null if not found.
	 */
	parseRepoTagsFromDescription(description: string): string[] {
		const regex = /\\?\[repo=([a-zA-Z0-9_\-/.]+)\\?\]/g;
		const matches = Array.from(description.matchAll(regex)).map(
			(match) => match[1],
		);
		return Array.from(
			new Set(matches.filter((value): value is string => !!value)),
		);
	}

	/**
	 * Parse first [repo=...] tag from issue description.
	 * Kept for backwards compatibility with existing callers/tests.
	 */
	parseRepoTagFromDescription(description: string): string | null {
		return this.parseRepoTagsFromDescription(description)[0] ?? null;
	}

	private mergeUniqueRepositories(
		repositories: RepositoryConfig[],
		orderedWorkspaceRepos: RepositoryConfig[],
	): RepositoryConfig[] {
		const repositoryIds = new Set(
			repositories.map((repository) => repository.id),
		);
		return orderedWorkspaceRepos.filter((repository) =>
			repositoryIds.has(repository.id),
		);
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
				const issueTracker = this.deps.getIssueTracker(workspaceId);
				if (!issueTracker) {
					this.logger.warn(
						`No issue tracker found for workspace ${workspaceId}`,
					);
					continue;
				}

				const fullIssue = await issueTracker.fetchIssue(issueId);
				const project = await fullIssue?.project;
				if (!project || !project.name) {
					this.logger.debug(
						`No project name found for issue ${issueId} in repository ${repo.name}`,
					);
					continue;
				}

				const projectName = project.name;
				if (repo.projectKeys.includes(projectName)) {
					this.logger.debug(
						`Matched issue ${issueId} to repository ${repo.name} via project: ${projectName}`,
					);
					return repo;
				}
			} catch (error) {
				// Continue to next repository if this one fails
				this.logger.debug(
					`Failed to fetch project for issue ${issueId} from repository ${repo.name}:`,
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
		webhook: AgentSessionCreatedWebhook,
		workspaceRepos: RepositoryConfig[],
	): Promise<void> {
		const { agentSession } = webhook;
		const agentSessionId = agentSession.id;
		const { issue } = agentSession;

		if (!issue) {
			this.logger.error("Cannot elicit repository selection without issue");
			return;
		}

		this.logger.info(
			`Posting repository selection elicitation for issue ${issue.identifier}`,
		);

		// Store pending selection
		this.pendingSelections.set(agentSessionId, {
			issueId: issue.id,
			workspaceRepos,
		});

		// Validate we have repositories to offer
		const firstRepo = workspaceRepos[0];
		if (!firstRepo) {
			this.logger.error("No repositories available for selection elicitation");
			return;
		}

		// Get issue tracker for the workspace
		const issueTracker = this.deps.getIssueTracker(webhook.organizationId);
		if (!issueTracker) {
			this.logger.error(
				`No issue tracker found for workspace ${webhook.organizationId}`,
			);
			return;
		}

		// Create repository options
		const options = workspaceRepos.map((repo) => ({
			value: repo.githubUrl || repo.name,
		}));

		// Post elicitation activity
		try {
			await issueTracker.createAgentActivity({
				agentSessionId,
				content: {
					type: "elicitation",
					body: "Which repository should I work in for this issue?",
				},
				signal: AgentActivitySignal.Select,
				signalMetadata: { options },
			});

			this.logger.info(
				`Posted repository selection elicitation with ${options.length} options`,
			);
		} catch (error) {
			this.logger.error(
				`Failed to post repository selection elicitation:`,
				error,
			);

			await this.postRepositorySelectionError(
				agentSessionId,
				issueTracker,
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
		issueTracker: IIssueTrackerService,
		error: unknown,
	): Promise<void> {
		const errorObj = error as Error;
		const errorMessage = errorObj?.message || String(error);

		try {
			await issueTracker.createAgentActivity({
				agentSessionId,
				content: {
					type: "error",
					body: `Failed to display repository selection: ${errorMessage}`,
				},
			});
			this.logger.info(
				`Posted error activity for repository selection failure`,
			);
		} catch (postError) {
			this.logger.error(
				`Failed to post error activity (may be due to same underlying issue):`,
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
			this.logger.debug(
				`No pending repository selection found for agent session ${agentSessionId}`,
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
			this.logger.error(
				`No repository found for selection: ${selectedRepositoryName}`,
			);
			return null;
		}

		if (!selectedRepo) {
			this.logger.info(
				`Repository "${selectedRepositoryName}" not found, falling back to ${repository.name}`,
			);
		} else {
			this.logger.info(`User selected repository: ${repository.name}`);
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
	private extractIssueInfo(webhook: Webhook): {
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

		// Handle entity webhooks (e.g., Issue updates)
		if (this.isEntityWebhook(webhook)) {
			// For Issue entity webhooks, data contains the issue payload
			if (webhook.type === "Issue") {
				const issueData = webhook.data as {
					id?: string;
					identifier?: string;
					team?: { key?: string };
				};
				return {
					issueId: issueData?.id,
					teamKey: issueData?.team?.key,
					issueIdentifier: issueData?.identifier,
				};
			}
			// Other entity types don't have issue info
			return {};
		}

		// Handle notification webhooks (AppUserNotification)
		if ("notification" in webhook && webhook.notification) {
			return {
				issueId: webhook.notification?.issue?.id,
				teamKey: webhook.notification?.issue?.team?.key,
				issueIdentifier: webhook.notification?.issue?.identifier,
			};
		}

		return {};
	}

	/**
	 * Type guard for entity webhooks (Issue, Comment, etc.)
	 */
	private isEntityWebhook(
		webhook: Webhook,
	): webhook is Webhook & { data: unknown } {
		return "data" in webhook && webhook.data !== undefined;
	}

	/**
	 * Type guards
	 */
	private isAgentSessionCreatedWebhook(
		webhook: Webhook,
	): webhook is AgentSessionCreatedWebhook {
		return webhook.action === "created";
	}

	private isAgentSessionPromptedWebhook(
		webhook: Webhook,
	): webhook is AgentSessionPromptedWebhook {
		return webhook.action === "prompted";
	}

	/**
	 * Get issue repository cache for serialization
	 */
	getIssueRepositoryCache(): Map<string, string> {
		return this.issueRepositoryCache;
	}

	/**
	 * Get issue workspace repository cache for serialization
	 */
	getIssueWorkspaceRepositoryCache(): Map<string, string[]> {
		return this.issueWorkspaceRepositoryCache;
	}

	/**
	 * Restore issue repository cache from serialization
	 */
	restoreIssueRepositoryCache(cache: Map<string, string>): void {
		this.issueRepositoryCache = cache;
	}

	/**
	 * Restore issue workspace repository cache from serialization
	 */
	restoreIssueWorkspaceRepositoryCache(cache: Map<string, string[]>): void {
		this.issueWorkspaceRepositoryCache = cache;
	}
}
