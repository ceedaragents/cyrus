import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LinearClient } from "@linear/sdk";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import type {
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	PostToolUseHookInput,
	SDKMessage,
} from "cyrus-claude-runner";
import {
	ClaudeRunner,
	createCyrusToolsServer,
	createImageToolsServer,
	createSoraToolsServer,
	getAllTools,
	getCoordinatorTools,
	getReadOnlyTools,
	getSafeTools,
} from "cyrus-claude-runner";
import { ConfigUpdater } from "cyrus-config-updater";
import type {
	AgentActivityCreateInput,
	AgentEvent,
	AgentRunnerConfig,
	AgentSessionCreatedWebhook,
	AgentSessionPromptedWebhook,
	Comment,
	ContentUpdateMessage,
	CyrusAgentSession,
	EdgeWorkerConfig,
	GuidanceRule,
	IAgentRunner,
	IIssueTrackerService,
	ILogger,
	InternalMessage,
	Issue,
	IssueMinimal,
	IssueUnassignedWebhook,
	IssueUpdateWebhook,
	RepositoryConfig,
	SerializableEdgeWorkerState,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
	SessionStartMessage,
	StopSignalMessage,
	UnassignMessage,
	UserPromptMessage,
	Webhook,
	WebhookAgentSession,
	WebhookComment,
	WebhookIssue,
} from "cyrus-core";
import {
	CLIIssueTrackerService,
	CLIRPCServer,
	createLogger,
	DEFAULT_PROXY_URL,
	isAgentSessionCreatedWebhook,
	isAgentSessionPromptedWebhook,
	isContentUpdateMessage,
	isIssueAssignedWebhook,
	isIssueCommentMentionWebhook,
	isIssueNewCommentWebhook,
	isIssueTitleOrDescriptionUpdateWebhook,
	isIssueUnassignedWebhook,
	isSessionStartMessage,
	isStopSignalMessage,
	isUnassignMessage,
	isUserPromptMessage,
	PersistenceManager,
	resolvePath,
} from "cyrus-core";
import { GeminiRunner } from "cyrus-gemini-runner";
import {
	extractCommentAuthor,
	extractCommentBody,
	extractCommentId,
	extractCommentUrl,
	extractPRBranchRef,
	extractPRNumber,
	extractPRTitle,
	extractRepoFullName,
	extractRepoName,
	extractRepoOwner,
	extractSessionKey,
	GitHubCommentService,
	GitHubEventTransport,
	type GitHubWebhookEvent,
	isCommentOnPullRequest,
	isIssueCommentPayload,
	isPullRequestReviewCommentPayload,
	stripMention,
} from "cyrus-github-event-transport";
import {
	LinearEventTransport,
	LinearIssueTrackerService,
	type LinearOAuthConfig,
} from "cyrus-linear-event-transport";
import {
	SlackEventTransport,
	SlackMessageService,
	SlackReactionService,
	type SlackWebhookEvent,
	stripMention as stripSlackMention,
} from "cyrus-slack-event-transport";
import { fileTypeFromBuffer } from "file-type";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { AskUserQuestionHandler } from "./AskUserQuestionHandler.js";
import { GitService } from "./GitService.js";
import { GlobalSessionRegistry } from "./GlobalSessionRegistry.js";
import {
	ProcedureAnalyzer,
	type ProcedureDefinition,
	type RequestClassification,
	type SubroutineDefinition,
} from "./procedures/index.js";
import type {
	IssueContextResult,
	PromptAssembly,
	PromptAssemblyInput,
	PromptComponent,
	PromptType,
} from "./prompt-assembly/types.js";
import {
	RepositoryRouter,
	type RepositoryRouterDeps,
} from "./RepositoryRouter.js";
import { SharedApplicationServer } from "./SharedApplicationServer.js";
import { LinearActivitySink } from "./sinks/LinearActivitySink.js";
import { NoopActivitySink } from "./sinks/NoopActivitySink.js";
import type { AgentSessionData, EdgeWorkerEvents } from "./types.js";
import { UserAccessControl } from "./UserAccessControl.js";

export declare interface EdgeWorker {
	on<K extends keyof EdgeWorkerEvents>(
		event: K,
		listener: EdgeWorkerEvents[K],
	): this;
	emit<K extends keyof EdgeWorkerEvents>(
		event: K,
		...args: Parameters<EdgeWorkerEvents[K]>
	): boolean;
}

/**
 * Unified edge worker that **orchestrates**
 *   capturing Linear webhooks,
 *   managing Claude Code processes, and
 *   processes results through to Linear Agent Activity Sessions
 */
export class EdgeWorker extends EventEmitter {
	private config: EdgeWorkerConfig;
	private repositories: Map<string, RepositoryConfig> = new Map(); // repository 'id' (internal, stored in config.json) mapped to the full repo config
	private agentSessionManagers: Map<string, AgentSessionManager> = new Map(); // Maps repository ID to AgentSessionManager, which manages agent runners for a repo
	private issueTrackers: Map<string, IIssueTrackerService> = new Map(); // one issue tracker per 'repository'
	private linearEventTransport: LinearEventTransport | null = null; // Single event transport for webhook delivery
	private gitHubEventTransport: GitHubEventTransport | null = null; // GitHub event transport for forwarded GitHub webhooks
	private slackEventTransport: SlackEventTransport | null = null; // Slack event transport for forwarded Slack webhooks
	private gitHubCommentService: GitHubCommentService; // Service for posting comments back to GitHub PRs
	private cliRPCServer: CLIRPCServer | null = null; // CLI RPC server for CLI platform mode
	private configUpdater: ConfigUpdater | null = null; // Single config updater for configuration updates
	private persistenceManager: PersistenceManager;
	private sharedApplicationServer: SharedApplicationServer;
	private cyrusHome: string;
	private globalSessionRegistry: GlobalSessionRegistry; // Centralized session storage across all repositories
	private childToParentAgentSession: Map<string, string> = new Map(); // Maps child agentSessionId to parent agentSessionId
	private procedureAnalyzer: ProcedureAnalyzer; // Intelligent workflow routing
	private configWatcher?: FSWatcher; // File watcher for config.json
	private configPath?: string; // Path to config.json file
	/** @internal - Exposed for testing only */
	public repositoryRouter: RepositoryRouter; // Repository routing and selection
	private gitService: GitService;
	private activeWebhookCount = 0; // Track number of webhooks currently being processed
	/** Dedicated AgentSessionManager for Slack sessions (not tied to any repository) */
	private slackSessionManager: AgentSessionManager | null = null;
	/** Maps Slack thread key (channel:thread_ts) to session ID for thread-based session reuse */
	private slackThreadSessions: Map<string, string> = new Map();
	/** Handler for AskUserQuestion tool invocations via Linear select signal */
	private askUserQuestionHandler: AskUserQuestionHandler;
	/** User access control for whitelisting/blacklisting Linear users */
	private userAccessControl: UserAccessControl;
	private logger: ILogger;

	constructor(config: EdgeWorkerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		this.logger = createLogger({ component: "EdgeWorker" });
		this.persistenceManager = new PersistenceManager(
			join(this.cyrusHome, "state"),
		);

		// Initialize GitHub comment service for posting replies to GitHub PRs
		this.gitHubCommentService = new GitHubCommentService();

		// Initialize global session registry (centralized session storage)
		this.globalSessionRegistry = new GlobalSessionRegistry();

		// Initialize procedure router with haiku for fast classification
		// Default to claude runner
		this.procedureAnalyzer = new ProcedureAnalyzer({
			cyrusHome: this.cyrusHome,
			model: "haiku",
			timeoutMs: 100000,
			runnerType: "claude", // Use Claude by default
		});

		// Initialize repository router with dependencies
		const repositoryRouterDeps: RepositoryRouterDeps = {
			fetchIssueLabels: async (issueId: string, workspaceId: string) => {
				// Find repository for this workspace
				const repo = Array.from(this.repositories.values()).find(
					(r) => r.linearWorkspaceId === workspaceId,
				);
				if (!repo) return [];

				// Get issue tracker for this repository
				const issueTracker = this.issueTrackers.get(repo.id);
				if (!issueTracker) return [];

				// Use platform-agnostic getIssueLabels method
				return await issueTracker.getIssueLabels(issueId);
			},
			fetchIssueDescription: async (
				issueId: string,
				workspaceId: string,
			): Promise<string | undefined> => {
				// Find repository for this workspace
				const repo = Array.from(this.repositories.values()).find(
					(r) => r.linearWorkspaceId === workspaceId,
				);
				if (!repo) return undefined;

				// Get issue tracker for this repository
				const issueTracker = this.issueTrackers.get(repo.id);
				if (!issueTracker) return undefined;

				// Fetch issue and get description
				try {
					const issue = await issueTracker.fetchIssue(issueId);
					return issue?.description ?? undefined;
				} catch (error) {
					this.logger.error(
						`Failed to fetch issue description for routing:`,
						error,
					);
					return undefined;
				}
			},
			hasActiveSession: (issueId: string, repositoryId: string) => {
				const sessionManager = this.agentSessionManagers.get(repositoryId);
				if (!sessionManager) return false;
				const activeSessions =
					sessionManager.getActiveSessionsByIssueId(issueId);
				return activeSessions.length > 0;
			},
			getIssueTracker: (workspaceId: string) => {
				return this.getIssueTrackerForWorkspace(workspaceId);
			},
		};
		this.repositoryRouter = new RepositoryRouter(repositoryRouterDeps);
		this.gitService = new GitService();

		// Initialize AskUserQuestion handler for elicitation via Linear select signal
		this.askUserQuestionHandler = new AskUserQuestionHandler({
			getIssueTracker: (workspaceId: string) => {
				return this.getIssueTrackerForWorkspace(workspaceId) ?? null;
			},
		});

		// Initialize shared application server
		const serverPort = config.serverPort || config.webhookPort || 3456;
		const serverHost = config.serverHost || "localhost";
		const skipTunnel = config.platform === "cli"; // Skip Cloudflare tunnel in CLI mode
		this.sharedApplicationServer = new SharedApplicationServer(
			serverPort,
			serverHost,
			skipTunnel,
		);

		// Initialize repositories with path resolution
		for (const repo of config.repositories) {
			if (repo.isActive !== false) {
				// Resolve paths that may contain tilde (~) prefix
				const resolvedRepo: RepositoryConfig = {
					...repo,
					repositoryPath: resolvePath(repo.repositoryPath),
					workspaceBaseDir: resolvePath(repo.workspaceBaseDir),
					mcpConfigPath: Array.isArray(repo.mcpConfigPath)
						? repo.mcpConfigPath.map(resolvePath)
						: repo.mcpConfigPath
							? resolvePath(repo.mcpConfigPath)
							: undefined,
					promptTemplatePath: repo.promptTemplatePath
						? resolvePath(repo.promptTemplatePath)
						: undefined,
					openaiOutputDirectory: repo.openaiOutputDirectory
						? resolvePath(repo.openaiOutputDirectory)
						: undefined,
				};

				this.repositories.set(repo.id, resolvedRepo);

				// Create issue tracker for this repository's workspace
				const issueTracker =
					this.config.platform === "cli"
						? (() => {
								const service = new CLIIssueTrackerService();
								service.seedDefaultData();
								return service;
							})()
						: new LinearIssueTrackerService(
								new LinearClient({
									accessToken: repo.linearToken,
								}),
								this.buildOAuthConfig(resolvedRepo),
							);
				this.issueTrackers.set(repo.id, issueTracker);

				// Create AgentSessionManager for this repository with parent session lookup and resume callback
				//
				// Note: This pattern works (despite appearing recursive) because:
				// 1. The agentSessionManager variable is captured by the closure after it's assigned
				// 2. JavaScript's variable hoisting means 'agentSessionManager' exists (but is undefined) when the arrow function is created
				// 3. By the time the callback is actually invoked (when a child session completes), agentSessionManager is fully initialized
				// 4. The callback only executes asynchronously, well after the constructor has completed and agentSessionManager is assigned
				//
				// This allows the AgentSessionManager to call back into itself to access its own sessions,
				// enabling child sessions to trigger parent session resumption using the same manager instance.
				const activitySink = new LinearActivitySink(
					issueTracker,
					repo.linearWorkspaceId,
				);
				const agentSessionManager = new AgentSessionManager(
					activitySink,
					(childSessionId: string) => {
						this.logger.debug(
							`Looking up parent session for child ${childSessionId}`,
						);
						const parentId =
							this.globalSessionRegistry.getParentSessionId(childSessionId);
						this.logger.debug(
							`Child ${childSessionId} -> Parent ${parentId || "not found"}`,
						);
						return parentId;
					},
					async (parentSessionId, prompt, childSessionId) => {
						await this.handleResumeParentSession(
							parentSessionId,
							prompt,
							childSessionId,
							repo,
							agentSessionManager,
						);
					},
					this.procedureAnalyzer,
					this.sharedApplicationServer,
				);

				// Subscribe to subroutine completion events
				agentSessionManager.on(
					"subroutineComplete",
					async ({ sessionId, session }) => {
						await this.handleSubroutineTransition(
							sessionId,
							session,
							repo,
							agentSessionManager,
						);
					},
				);

				// Subscribe to validation loop events
				agentSessionManager.on(
					"validationLoopIteration",
					async ({
						sessionId,
						session,
						fixerPrompt,
						iteration,
						maxIterations,
					}) => {
						this.logger.info(
							`Validation loop iteration ${iteration}/${maxIterations}, running fixer`,
						);
						await this.handleValidationLoopFixer(
							sessionId,
							session,
							repo,
							agentSessionManager,
							fixerPrompt,
							iteration,
						);
					},
				);

				agentSessionManager.on(
					"validationLoopRerun",
					async ({ sessionId, session, iteration }) => {
						this.logger.info(
							`Validation loop re-running verifications (iteration ${iteration})`,
						);
						await this.handleValidationLoopRerun(
							sessionId,
							session,
							repo,
							agentSessionManager,
						);
					},
				);

				this.agentSessionManagers.set(repo.id, agentSessionManager);
			}
		}

		// Initialize user access control with global and per-repository configs
		const repoAccessConfigs = new Map<
			string,
			import("cyrus-core").UserAccessControlConfig | undefined
		>();
		for (const repo of config.repositories) {
			if (repo.isActive !== false) {
				repoAccessConfigs.set(repo.id, repo.userAccessControl);
			}
		}
		this.userAccessControl = new UserAccessControl(
			config.userAccessControl,
			repoAccessConfigs,
		);

		// Components will be initialized and registered in start() method before server starts
	}

	/**
	 * Start the edge worker
	 */
	async start(): Promise<void> {
		// Load persisted state for each repository
		await this.loadPersistedState();

		// Start config file watcher if configPath is provided
		if (this.configPath) {
			this.startConfigWatcher();
		}

		// Initialize and register components BEFORE starting server (routes must be registered before listen())
		await this.initializeComponents();

		// Start shared application server (this also starts Cloudflare tunnel if CLOUDFLARE_TOKEN is set)
		await this.sharedApplicationServer.start();
	}

	/**
	 * Initialize and register components (routes) before server starts
	 */
	private async initializeComponents(): Promise<void> {
		// Get the first active repository for configuration
		const firstRepo = Array.from(this.repositories.values())[0];
		if (!firstRepo) {
			throw new Error("No active repositories configured");
		}

		// Platform-specific initialization
		if (this.config.platform === "cli") {
			// CLI mode: Create and register CLIRPCServer
			const firstIssueTracker = this.issueTrackers.get(firstRepo.id);
			if (!firstIssueTracker) {
				throw new Error("Issue tracker not found for first repository");
			}

			// Type guard to ensure it's a CLIIssueTrackerService
			if (!(firstIssueTracker instanceof CLIIssueTrackerService)) {
				throw new Error(
					"CLI platform requires CLIIssueTrackerService but found different implementation",
				);
			}

			this.cliRPCServer = new CLIRPCServer({
				fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
				issueTracker: firstIssueTracker,
				version: "1.0.0",
			});

			// Register the /cli/rpc endpoint
			this.cliRPCServer.register();

			this.logger.info("✅ CLI RPC server registered");
			this.logger.info("   RPC endpoint: /cli/rpc");

			// Create CLI event transport and register listener
			const cliEventTransport = firstIssueTracker.createEventTransport({
				platform: "cli",
				fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
			});

			// Listen for webhook events (same pattern as Linear mode)
			cliEventTransport.on("event", (event: AgentEvent) => {
				// Get all active repositories for webhook handling
				const repos = Array.from(this.repositories.values());
				this.handleWebhook(event as unknown as Webhook, repos);
			});

			// Listen for errors
			cliEventTransport.on("error", (error: Error) => {
				this.handleError(error);
			});

			// Register the CLI event transport endpoints
			cliEventTransport.register();

			this.logger.info("✅ CLI event transport registered");
			this.logger.info(
				"   Event listener: listening for AgentSessionCreated events",
			);
		} else {
			// Linear mode: Create and register LinearEventTransport
			const useDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase() === "true";
			const verificationMode = useDirectWebhooks ? "direct" : "proxy";

			// Get appropriate secret based on mode
			const secret = useDirectWebhooks
				? process.env.LINEAR_WEBHOOK_SECRET || ""
				: process.env.CYRUS_API_KEY || "";

			this.linearEventTransport = new LinearEventTransport({
				fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
				verificationMode,
				secret,
			});

			// Listen for legacy webhook events (deprecated, kept for backward compatibility)
			this.linearEventTransport.on("event", (event: AgentEvent) => {
				// Get all active repositories for webhook handling
				const repos = Array.from(this.repositories.values());
				this.handleWebhook(event as unknown as Webhook, repos);
			});

			// Listen for unified internal messages (new message bus)
			this.linearEventTransport.on("message", (message: InternalMessage) => {
				this.handleMessage(message);
			});

			// Listen for errors
			this.linearEventTransport.on("error", (error: Error) => {
				this.handleError(error);
			});

			// Register the /webhook endpoint
			this.linearEventTransport.register();

			this.logger.info(
				`✅ Linear event transport registered (${verificationMode} mode)`,
			);
			this.logger.info(
				`   Webhook endpoint: ${this.sharedApplicationServer.getWebhookUrl()}`,
			);
		}

		// 2. Register GitHub event transport (for forwarded GitHub webhooks from CYHOST)
		// This is registered regardless of platform mode since GitHub webhooks can come from CYHOST
		this.registerGitHubEventTransport();

		// 2b. Register Slack event transport (for forwarded Slack webhooks from CYHOST)
		this.registerSlackEventTransport();

		// 3. Create and register ConfigUpdater (both platforms)
		this.configUpdater = new ConfigUpdater(
			this.sharedApplicationServer.getFastifyInstance(),
			this.cyrusHome,
			process.env.CYRUS_API_KEY || "",
		);

		// Register config update routes
		this.configUpdater.register();

		this.logger.info("✅ Config updater registered");
		this.logger.info(
			"   Routes: /api/update/cyrus-config, /api/update/cyrus-env,",
		);
		this.logger.info(
			"           /api/update/repository, /api/test-mcp, /api/configure-mcp",
		);

		// 4. Register /status endpoint for process activity monitoring
		this.registerStatusEndpoint();

		// 5. Register /version endpoint for CLI version info
		this.registerVersionEndpoint();
	}

	/**
	 * Register the /status endpoint for checking if the process is busy or idle
	 * This endpoint is used to determine if the process can be safely restarted
	 */
	private registerStatusEndpoint(): void {
		const fastify = this.sharedApplicationServer.getFastifyInstance();

		fastify.get("/status", async (_request, reply) => {
			const status = this.computeStatus();
			return reply.status(200).send({ status });
		});

		this.logger.info("✅ Status endpoint registered");
		this.logger.info("   Route: GET /status");
	}

	/**
	 * Register the /version endpoint for CLI version information
	 * This endpoint is used by dashboards to display the installed CLI version
	 */
	private registerVersionEndpoint(): void {
		const fastify = this.sharedApplicationServer.getFastifyInstance();

		fastify.get("/version", async (_request, reply) => {
			return reply.status(200).send({
				cyrus_cli_version: this.config.version ?? null,
			});
		});

		this.logger.info("✅ Version endpoint registered");
		this.logger.info("   Route: GET /version");
	}

	/**
	 * Register the GitHub event transport for receiving forwarded GitHub webhooks from CYHOST.
	 * This creates a /github-webhook endpoint that handles @cyrusagent mentions on GitHub PRs.
	 */
	private registerGitHubEventTransport(): void {
		// Use the same verification approach as Linear webhooks
		// In proxy mode: Bearer token (CYRUS_API_KEY)
		// In direct/cloud mode: GitHub HMAC-SHA256 signature
		const useSignatureVerification =
			process.env.GITHUB_WEBHOOK_SECRET != null &&
			process.env.GITHUB_WEBHOOK_SECRET !== "";
		const verificationMode = useSignatureVerification ? "signature" : "proxy";
		const secret = useSignatureVerification
			? process.env.GITHUB_WEBHOOK_SECRET!
			: process.env.CYRUS_API_KEY || "";

		this.gitHubEventTransport = new GitHubEventTransport({
			fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
			verificationMode,
			secret,
		});

		// Listen for legacy GitHub webhook events (deprecated, kept for backward compatibility)
		this.gitHubEventTransport.on("event", (event: GitHubWebhookEvent) => {
			this.handleGitHubWebhook(event).catch((error) => {
				this.logger.error(
					"Failed to handle GitHub webhook",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		});

		// Listen for unified internal messages (new message bus)
		this.gitHubEventTransport.on("message", (message: InternalMessage) => {
			this.handleMessage(message);
		});

		// Listen for errors
		this.gitHubEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		// Register the /github-webhook endpoint
		this.gitHubEventTransport.register();

		this.logger.info(
			`GitHub event transport registered (${verificationMode} mode)`,
		);
		this.logger.info("Webhook endpoint: POST /github-webhook");
	}

	/**
	 * Register the Slack event transport for receiving forwarded Slack webhooks from CYHOST.
	 * This creates a /slack-webhook endpoint that handles @mention events from Slack.
	 */
	private registerSlackEventTransport(): void {
		const secret = process.env.CYRUS_API_KEY || "";

		this.slackEventTransport = new SlackEventTransport({
			fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
			verificationMode: "proxy",
			secret,
		});

		// Initialize a dedicated AgentSessionManager for Slack (not tied to any repository)
		const slackActivitySink = new NoopActivitySink("slack");
		this.slackSessionManager = new AgentSessionManager(
			slackActivitySink,
			undefined, // No parent session lookup for Slack
			undefined, // No resume parent session for Slack
			undefined, // No procedure analyzer for Slack
			undefined, // No shared application server for Slack
		);

		// Add "eyes" reaction to acknowledge receipt of Slack @mentions,
		// then process the event as an agent session
		this.slackEventTransport.on("event", (event: SlackWebhookEvent) => {
			if (!event.slackBotToken) {
				this.logger.warn(
					"Cannot add Slack reaction: no slackBotToken available (x-slack-bot-token header missing)",
				);
				return;
			}
			new SlackReactionService()
				.addReaction({
					token: event.slackBotToken,
					channel: event.payload.channel,
					timestamp: event.payload.ts,
					name: "eyes",
				})
				.catch((err: unknown) => {
					this.logger.warn(
						`Failed to add Slack reaction: ${err instanceof Error ? err.message : err}`,
					);
				});

			// Process as agent session (fire-and-forget with error logging)
			this.handleSlackWebhook(event).catch((error) => {
				this.logger.error(
					"Failed to handle Slack webhook",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		});

		// Listen for unified internal messages (new message bus)
		this.slackEventTransport.on("message", (message: InternalMessage) => {
			this.handleMessage(message);
		});

		// Listen for errors
		this.slackEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		// Register the /slack-webhook endpoint
		this.slackEventTransport.register();

		this.logger.info("Slack event transport registered");
		this.logger.info("Webhook endpoint: POST /slack-webhook");
	}

	/**
	 * Handle a GitHub webhook event (forwarded from CYHOST).
	 *
	 * This creates a new session for the GitHub PR comment, checks out the PR branch
	 * via git worktree, and processes the comment as a task prompt.
	 */
	private async handleGitHubWebhook(event: GitHubWebhookEvent): Promise<void> {
		this.activeWebhookCount++;

		try {
			// Only handle comments on pull requests
			if (!isCommentOnPullRequest(event)) {
				this.logger.debug("Ignoring GitHub comment on non-PR issue");
				return;
			}

			const repoFullName = extractRepoFullName(event);
			const prNumber = extractPRNumber(event);
			const commentBody = extractCommentBody(event);
			const commentAuthor = extractCommentAuthor(event);
			const prTitle = extractPRTitle(event);
			const sessionKey = extractSessionKey(event);

			this.logger.info(
				`Processing GitHub webhook: ${repoFullName}#${prNumber} by @${commentAuthor}`,
			);

			// Add "eyes" reaction to acknowledge receipt
			const reactionToken = event.installationToken || process.env.GITHUB_TOKEN;
			if (reactionToken) {
				const commentId = extractCommentId(event);
				if (commentId) {
					this.gitHubCommentService
						.addReaction({
							token: reactionToken,
							owner: extractRepoOwner(event),
							repo: extractRepoName(event),
							commentId,
							isPullRequestReviewComment: isPullRequestReviewCommentPayload(
								event.payload,
							),
							content: "eyes",
						})
						.catch((err: unknown) => {
							this.logger.warn(
								`Failed to add reaction: ${err instanceof Error ? err.message : err}`,
							);
						});
				}
			}

			// Find the repository configuration that matches this GitHub repo
			const repository = this.findRepositoryByGitHubUrl(repoFullName);
			if (!repository) {
				this.logger.warn(
					`No repository configured for GitHub repo: ${repoFullName}`,
				);
				return;
			}

			// Get the agent session manager for this repository
			const agentSessionManager = this.agentSessionManagers.get(repository.id);
			if (!agentSessionManager) {
				this.logger.error(
					`No AgentSessionManager for repository ${repository.name}`,
				);
				return;
			}

			// Determine the PR branch
			let branchRef = extractPRBranchRef(event);

			// For issue_comment events, the branch ref is not in the payload
			// We need to fetch it from the GitHub API
			if (!branchRef && isIssueCommentPayload(event.payload)) {
				branchRef = await this.fetchPRBranchRef(event, repository);
			}

			if (!branchRef) {
				this.logger.error(
					`Could not determine branch for ${repoFullName}#${prNumber}`,
				);
				return;
			}

			// Strip the @cyrusagent mention to get the task instructions
			const taskInstructions = stripMention(commentBody);

			// Create workspace (git worktree) for the PR branch
			const workspace = await this.createGitHubWorkspace(
				repository,
				branchRef,
				prNumber!,
			);

			if (!workspace) {
				this.logger.error(
					`Failed to create workspace for ${repoFullName}#${prNumber}`,
				);
				return;
			}

			this.logger.info(`GitHub workspace created at: ${workspace.path}`);

			// Check if another active session is already using this branch/workspace
			const existingSessions =
				agentSessionManager.getActiveSessionsByBranchName(branchRef);
			const firstExisting = existingSessions[0];
			if (firstExisting) {
				this.logger.warn(
					`Reusing workspace from active session ${firstExisting.id} — concurrent writes possible`,
				);
			}

			// Create a synthetic session for this GitHub PR comment
			const issueMinimal: IssueMinimal = {
				id: sessionKey,
				identifier: `${extractRepoName(event)}#${prNumber}`,
				title: prTitle || `PR #${prNumber}`,
				branchName: branchRef,
			};

			// Create an internal agent session (no Linear session for GitHub)
			const githubSessionId = `github-${event.deliveryId}`;
			agentSessionManager.createLinearAgentSession(
				githubSessionId,
				sessionKey,
				issueMinimal,
				workspace,
				"github", // Don't stream activities to Linear for GitHub sources
			);

			const session = agentSessionManager.getSession(githubSessionId);
			if (!session) {
				this.logger.error(
					`Failed to create session for GitHub webhook ${event.deliveryId}`,
				);
				return;
			}

			// Initialize procedure metadata
			if (!session.metadata) {
				session.metadata = {};
			}

			// Store GitHub-specific metadata for reply posting
			session.metadata.commentId = String(extractCommentId(event));

			// Build the system prompt for this GitHub PR session
			const systemPrompt = this.buildGitHubSystemPrompt(
				event,
				branchRef,
				taskInstructions,
			);

			// Build allowed tools and directories
			const allowedTools = this.buildAllowedTools(repository);
			const disallowedTools = this.buildDisallowedTools(repository);
			const allowedDirectories: string[] = [repository.repositoryPath];

			// Create agent runner using the standard config builder
			const { config: runnerConfig } = this.buildAgentRunnerConfig(
				session,
				repository,
				githubSessionId,
				systemPrompt,
				allowedTools,
				allowedDirectories,
				disallowedTools,
				undefined, // resumeSessionId
				undefined, // labels
				200, // maxTurns
				false, // singleTurn
			);

			const runner = new ClaudeRunner(runnerConfig);

			// Store the runner in the session manager
			agentSessionManager.addAgentRunner(githubSessionId, runner);

			// Save persisted state
			await this.savePersistedState();

			this.emit(
				"session:started",
				sessionKey,
				issueMinimal as unknown as Issue,
				repository.id,
			);

			this.logger.info(
				`Starting Claude runner for GitHub PR ${repoFullName}#${prNumber}`,
			);

			// Start the session and handle completion
			try {
				const sessionInfo = await runner.start(taskInstructions);
				this.logger.info(`GitHub session started: ${sessionInfo.sessionId}`);

				// When session completes, post the reply back to GitHub
				await this.postGitHubReply(event, runner, repository);
			} catch (error) {
				this.logger.error(
					`GitHub session error for ${repoFullName}#${prNumber}`,
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				await this.savePersistedState();
			}
		} catch (error) {
			this.logger.error(
				"Failed to process GitHub webhook",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			this.activeWebhookCount--;
		}
	}

	/**
	 * Find a repository configuration that matches a GitHub repository URL.
	 * Matches against the githubUrl field in repository config.
	 */
	private findRepositoryByGitHubUrl(
		repoFullName: string,
	): RepositoryConfig | null {
		for (const repo of this.repositories.values()) {
			if (!repo.githubUrl) continue;
			// Match against full name (owner/repo) or URL containing it
			if (
				repo.githubUrl.includes(repoFullName) ||
				repo.githubUrl.endsWith(`/${repoFullName}`)
			) {
				return repo;
			}
		}
		return null;
	}

	/**
	 * Fetch the PR branch ref for an issue_comment webhook.
	 * For issue_comment events, the branch ref is not in the payload
	 * and must be fetched from the GitHub API.
	 */
	private async fetchPRBranchRef(
		event: GitHubWebhookEvent,
		_repository: RepositoryConfig,
	): Promise<string | null> {
		if (!isIssueCommentPayload(event.payload)) return null;

		const prUrl = event.payload.issue.pull_request?.url;
		if (!prUrl) return null;

		try {
			const owner = extractRepoOwner(event);
			const repo = extractRepoName(event);
			const prNumber = event.payload.issue.number;

			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			};

			// Prefer forwarded installation token, fall back to GITHUB_TOKEN
			const token = event.installationToken || process.env.GITHUB_TOKEN;
			if (token) {
				headers.Authorization = `Bearer ${token}`;
			}

			const response = await fetch(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
				{ headers },
			);

			if (!response.ok) {
				this.logger.warn(
					`Failed to fetch PR details from GitHub API: ${response.status}`,
				);
				return null;
			}

			const prData = (await response.json()) as { head?: { ref?: string } };
			return prData.head?.ref ?? null;
		} catch (error) {
			this.logger.error(
				"Failed to fetch PR branch ref",
				error instanceof Error ? error : new Error(String(error)),
			);
			return null;
		}
	}

	/**
	 * Create a git worktree for a GitHub PR branch.
	 * If the worktree already exists for this branch, reuse it.
	 */
	private async createGitHubWorkspace(
		repository: RepositoryConfig,
		branchRef: string,
		prNumber: number,
	): Promise<{ path: string; isGitWorktree: boolean } | null> {
		try {
			// Use the GitService to create the worktree
			// Create a synthetic issue-like object for the git service
			const syntheticIssue = {
				id: `github-pr-${prNumber}`,
				identifier: `PR-${prNumber}`,
				title: `PR #${prNumber}`,
				description: null,
				url: "",
				branchName: branchRef,
				assigneeId: null,
				stateId: null,
				teamId: null,
				labelIds: [],
				priority: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
				archivedAt: null,
				state: Promise.resolve(undefined),
				assignee: Promise.resolve(undefined),
				team: Promise.resolve(undefined),
				parent: Promise.resolve(undefined),
				project: Promise.resolve(undefined),
				labels: () => Promise.resolve({ nodes: [] }),
				comments: () => Promise.resolve({ nodes: [] }),
				attachments: () => Promise.resolve({ nodes: [] }),
				children: () => Promise.resolve({ nodes: [] }),
				inverseRelations: () => Promise.resolve({ nodes: [] }),
				update: () =>
					Promise.resolve({
						success: true,
						issue: undefined,
						lastSyncId: 0,
					}),
			} as unknown as Issue;

			return await this.gitService.createGitWorktree(
				syntheticIssue,
				repository,
			);
		} catch (error) {
			this.logger.error(
				`Failed to create GitHub workspace for PR #${prNumber}`,
				error instanceof Error ? error : new Error(String(error)),
			);
			return null;
		}
	}

	/**
	 * Build a system prompt for a GitHub PR comment session.
	 */
	private buildGitHubSystemPrompt(
		event: GitHubWebhookEvent,
		branchRef: string,
		taskInstructions: string,
	): string {
		const repoFullName = extractRepoFullName(event);
		const prNumber = extractPRNumber(event);
		const prTitle = extractPRTitle(event);
		const commentAuthor = extractCommentAuthor(event);
		const commentUrl = extractCommentUrl(event);

		return `You are working on a GitHub Pull Request.

## Context
- **Repository**: ${repoFullName}
- **PR**: #${prNumber} - ${prTitle || "Untitled"}
- **Branch**: ${branchRef}
- **Requested by**: @${commentAuthor}
- **Comment URL**: ${commentUrl}

## Task
${taskInstructions}

## Instructions
- You are already checked out on the PR branch \`${branchRef}\`
- Make changes directly to the code on this branch
- After making changes, commit and push them to the branch
- Be concise in your responses as they will be posted back to the GitHub PR`;
	}

	/**
	 * Post a reply back to the GitHub PR comment after the session completes.
	 */
	private async postGitHubReply(
		event: GitHubWebhookEvent,
		runner: IAgentRunner,
		_repository: RepositoryConfig,
	): Promise<void> {
		try {
			// Get the last assistant message from the runner as the summary
			const messages = runner.getMessages();
			const lastAssistantMessage = [...messages]
				.reverse()
				.find((m) => m.type === "assistant");

			let summary = "Task completed. Please review the changes on this branch.";
			if (
				lastAssistantMessage &&
				lastAssistantMessage.type === "assistant" &&
				"message" in lastAssistantMessage
			) {
				const msg = lastAssistantMessage as {
					message: { content: Array<{ type: string; text?: string }> };
				};
				const textBlock = msg.message.content?.find(
					(block) => block.type === "text" && block.text,
				);
				if (textBlock?.text) {
					summary = textBlock.text;
				}
			}

			const owner = extractRepoOwner(event);
			const repo = extractRepoName(event);
			const prNumber = extractPRNumber(event);
			const commentId = extractCommentId(event);

			if (!prNumber) {
				this.logger.warn("Cannot post GitHub reply: no PR number");
				return;
			}

			// Prefer the forwarded installation token from CYHOST (1-hour expiry)
			// Fall back to process.env.GITHUB_TOKEN if not provided
			const token = event.installationToken || process.env.GITHUB_TOKEN;
			if (!token) {
				this.logger.warn(
					"Cannot post GitHub reply: no installation token or GITHUB_TOKEN configured",
				);
				this.logger.debug(
					`Would have posted reply to ${owner}/${repo}#${prNumber} (comment ${commentId}): ${summary}`,
				);
				return;
			}

			if (event.eventType === "pull_request_review_comment") {
				// Reply to the specific review comment thread
				await this.gitHubCommentService.postReviewCommentReply({
					token,
					owner,
					repo,
					pullNumber: prNumber,
					commentId,
					body: summary,
				});
			} else {
				// Post as a regular issue comment on the PR
				await this.gitHubCommentService.postIssueComment({
					token,
					owner,
					repo,
					issueNumber: prNumber,
					body: summary,
				});
			}

			this.logger.info(`Posted GitHub reply to ${owner}/${repo}#${prNumber}`);
		} catch (error) {
			this.logger.error(
				"Failed to post GitHub reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Handle a Slack webhook event (forwarded from CYHOST).
	 *
	 * Slack sessions are transient and not associated with any repository.
	 * They run in an empty working directory keyed by the Slack thread,
	 * so subsequent @mentions in the same thread share context.
	 */
	private async handleSlackWebhook(event: SlackWebhookEvent): Promise<void> {
		this.activeWebhookCount++;

		try {
			if (!this.slackSessionManager) {
				this.logger.error(
					"Cannot handle Slack webhook: Slack session manager not initialized",
				);
				return;
			}

			this.logger.info(
				`Processing Slack webhook: ${event.eventId} in channel ${event.payload.channel} by ${event.payload.user}`,
			);

			// Strip the @mention from the text to get the task instructions
			const taskInstructions = stripSlackMention(event.payload.text);

			// Thread key: channel:thread_ts — used to associate sessions with a thread
			const threadTs = event.payload.thread_ts || event.payload.ts;
			const threadKey = `${event.payload.channel}:${threadTs}`;

			// Check if there's already an active session for this thread
			const existingSessionId = this.slackThreadSessions.get(threadKey);
			if (existingSessionId) {
				const existingSession =
					this.slackSessionManager.getSession(existingSessionId);
				const existingRunner =
					this.slackSessionManager.getAgentRunner(existingSessionId);

				if (existingSession && existingRunner?.isRunning()) {
					// Session is actively running — inject the follow-up via streaming input
					if (existingRunner.addStreamMessage) {
						this.logger.info(
							`Injecting follow-up prompt into running session ${existingSessionId} (thread ${threadKey})`,
						);
						existingRunner.addStreamMessage(taskInstructions);
					} else {
						// Runner doesn't support streaming input — notify user
						this.logger.info(
							`Session ${existingSessionId} is still running, notifying user (thread ${threadKey})`,
						);
						if (event.slackBotToken) {
							await new SlackMessageService().postMessage({
								token: event.slackBotToken,
								channel: event.payload.channel,
								text: "I'm still working on the previous request in this thread. I'll pick up your new message once I'm done.",
								thread_ts: threadTs,
							});
						}
					}
					return;
				}

				if (existingSession && existingRunner) {
					// Session exists but is not running — resume with --continue
					this.logger.info(
						`Resuming completed Slack session ${existingSessionId} (thread ${threadKey})`,
					);

					const resumeSessionId =
						existingSession.claudeSessionId || existingSession.geminiSessionId;

					if (resumeSessionId) {
						try {
							await this.resumeSlackSession(
								event,
								existingSession,
								existingSessionId,
								resumeSessionId,
								taskInstructions,
							);
						} catch (error) {
							this.logger.error(
								`Failed to resume Slack session ${existingSessionId}`,
								error instanceof Error ? error : new Error(String(error)),
							);
						}
						return;
					}
				}

				// Session exists but runner was lost — fall through to create a new session
				this.logger.info(
					`Previous session ${existingSessionId} for thread ${threadKey} has no runner, creating new session`,
				);
			}

			// Create an empty workspace directory for this thread
			const workspace = await this.createSlackWorkspace(threadKey);
			if (!workspace) {
				this.logger.error(
					`Failed to create workspace for Slack thread ${threadKey}`,
				);
				return;
			}

			this.logger.info(`Slack workspace created at: ${workspace.path}`);

			// Create a synthetic session for this Slack mention
			const sessionKey = `slack:${threadKey}`;
			const issueMinimal: IssueMinimal = {
				id: sessionKey,
				identifier: `slack-${event.eventId}`,
				title:
					taskInstructions.slice(0, 100) +
					(taskInstructions.length > 100 ? "..." : ""),
				branchName: "",
			};

			// Create an internal agent session (not tied to any repository)
			const slackSessionId = `slack-${event.eventId}`;
			this.slackSessionManager.createLinearAgentSession(
				slackSessionId,
				sessionKey,
				issueMinimal,
				workspace,
				"slack",
			);

			const session = this.slackSessionManager.getSession(slackSessionId);
			if (!session) {
				this.logger.error(
					`Failed to create session for Slack webhook ${event.eventId}`,
				);
				return;
			}

			// Track this thread → session mapping for follow-up messages
			this.slackThreadSessions.set(threadKey, slackSessionId);

			// Initialize procedure metadata
			if (!session.metadata) {
				session.metadata = {};
			}

			// Build the system prompt for this Slack session
			const systemPrompt = this.buildSlackSystemPrompt(event);

			// Build runner config directly for Slack (no repository dependency)
			const runnerConfig = {
				workingDirectory: session.workspace.path,
				allowedTools: getAllTools(),
				disallowedTools: [] as string[],
				allowedDirectories: [session.workspace.path],
				workspaceName: session.issue?.identifier || session.issueId,
				cyrusHome: this.cyrusHome,
				systemPrompt,
				model: this.config.defaultModel,
				fallbackModel: this.config.defaultFallbackModel,
				logger: this.logger.withContext({
					sessionId: slackSessionId,
					platform: "slack",
				}),
				maxTurns: 200,
				onMessage: (message: SDKMessage) => {
					this.handleSlackClaudeMessage(slackSessionId, message);
				},
				onError: (error: Error) => this.handleClaudeError(error),
			};

			const runner = new ClaudeRunner(runnerConfig);

			// Store the runner in the Slack session manager
			this.slackSessionManager.addAgentRunner(slackSessionId, runner);

			// Save persisted state
			await this.savePersistedState();

			this.logger.info(
				`Starting Claude runner for Slack event ${event.eventId}`,
			);

			// Start the session and handle completion
			try {
				const sessionInfo = await runner.start(taskInstructions);
				this.logger.info(`Slack session started: ${sessionInfo.sessionId}`);

				// When session completes, post the reply back to Slack
				await this.postSlackReply(event, runner);
			} catch (error) {
				this.logger.error(
					`Slack session error for event ${event.eventId}`,
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				await this.savePersistedState();
			}
		} catch (error) {
			this.logger.error(
				"Failed to process Slack webhook",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			this.activeWebhookCount--;
		}
	}

	/**
	 * Resume an existing Slack session with a new prompt (--continue behavior).
	 */
	private async resumeSlackSession(
		event: SlackWebhookEvent,
		existingSession: CyrusAgentSession,
		sessionId: string,
		resumeSessionId: string,
		taskInstructions: string,
	): Promise<void> {
		if (!this.slackSessionManager) {
			return;
		}

		const runnerConfig = {
			workingDirectory: existingSession.workspace.path,
			allowedTools: getAllTools(),
			disallowedTools: [] as string[],
			allowedDirectories: [existingSession.workspace.path],
			workspaceName:
				existingSession.issue?.identifier || existingSession.issueId,
			cyrusHome: this.cyrusHome,
			systemPrompt: this.buildSlackSystemPrompt(event),
			model: this.config.defaultModel,
			fallbackModel: this.config.defaultFallbackModel,
			resumeSessionId,
			logger: this.logger.withContext({
				sessionId,
				platform: "slack",
			}),
			maxTurns: 200,
			onMessage: (message: SDKMessage) => {
				this.handleSlackClaudeMessage(sessionId, message);
			},
			onError: (error: Error) => this.handleClaudeError(error),
		};

		const runner = new ClaudeRunner(runnerConfig);
		this.slackSessionManager.addAgentRunner(sessionId, runner);

		try {
			const sessionInfo = await runner.start(taskInstructions);
			this.logger.info(
				`Slack session resumed: ${sessionInfo.sessionId} (was ${resumeSessionId})`,
			);

			await this.postSlackReply(event, runner);
		} catch (error) {
			this.logger.error(
				`Slack resume session error for ${sessionId}`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Handle Claude messages for Slack sessions.
	 * Routes to the dedicated Slack AgentSessionManager.
	 */
	private async handleSlackClaudeMessage(
		sessionId: string,
		message: SDKMessage,
	): Promise<void> {
		if (this.slackSessionManager) {
			await this.slackSessionManager.handleClaudeMessage(sessionId, message);
		}
	}

	/**
	 * Create an empty workspace directory for a Slack thread.
	 * Unlike repository-associated sessions, Slack sessions use plain directories (not git worktrees).
	 */
	private async createSlackWorkspace(
		threadKey: string,
	): Promise<{ path: string; isGitWorktree: boolean } | null> {
		try {
			// Create a sanitized directory name from the thread key
			const sanitizedKey = threadKey.replace(/[^a-zA-Z0-9.-]/g, "_");
			const workspacePath = join(
				this.cyrusHome,
				"slack-workspaces",
				sanitizedKey,
			);

			await mkdir(workspacePath, { recursive: true });

			return { path: workspacePath, isGitWorktree: false };
		} catch (error) {
			this.logger.error(
				`Failed to create Slack workspace for thread ${threadKey}`,
				error instanceof Error ? error : new Error(String(error)),
			);
			return null;
		}
	}

	/**
	 * Build a system prompt for a Slack @mention session.
	 * Slack sessions are transient and not associated with any repository.
	 */
	private buildSlackSystemPrompt(event: SlackWebhookEvent): string {
		return `You are responding to a Slack @mention.

## Context
- **Requested by**: ${event.payload.user}
- **Channel**: ${event.payload.channel}

## Instructions
- You are running in a transient workspace, not associated with any code repository
- Be concise in your responses as they will be posted back to Slack
- If the user's request involves code changes, help them plan the work and suggest creating an issue in their project tracker (Linear, Jira, or GitHub Issues)
- You can answer questions, provide analysis, help with planning, and assist with research
- If files need to be created or examined, they will be in your working directory`;
	}

	/**
	 * Post a reply back to Slack after the session completes.
	 */
	private async postSlackReply(
		event: SlackWebhookEvent,
		runner: IAgentRunner,
	): Promise<void> {
		try {
			// Get the last assistant message from the runner as the summary
			const messages = runner.getMessages();
			const lastAssistantMessage = [...messages]
				.reverse()
				.find((m) => m.type === "assistant");

			let summary = "Task completed.";
			if (
				lastAssistantMessage &&
				lastAssistantMessage.type === "assistant" &&
				"message" in lastAssistantMessage
			) {
				const msg = lastAssistantMessage as {
					message: {
						content: Array<{ type: string; text?: string }>;
					};
				};
				const textBlock = msg.message.content?.find(
					(block) => block.type === "text" && block.text,
				);
				if (textBlock?.text) {
					summary = textBlock.text;
				}
			}

			if (!event.slackBotToken) {
				this.logger.warn("Cannot post Slack reply: no slackBotToken available");
				return;
			}

			// Thread the reply under the original message
			const threadTs = event.payload.thread_ts || event.payload.ts;

			await new SlackMessageService().postMessage({
				token: event.slackBotToken,
				channel: event.payload.channel,
				text: summary,
				thread_ts: threadTs,
			});

			this.logger.info(
				`Posted Slack reply to channel ${event.payload.channel} (thread ${threadTs})`,
			);
		} catch (error) {
			this.logger.error(
				"Failed to post Slack reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Compute the current status of the Cyrus process
	 * @returns "idle" if the process can be safely restarted, "busy" if work is in progress
	 */
	private computeStatus(): "idle" | "busy" {
		// Busy if any webhooks are currently being processed
		if (this.activeWebhookCount > 0) {
			return "busy";
		}

		// Busy if any runner is actively running (repository-tied sessions)
		for (const manager of this.agentSessionManagers.values()) {
			const runners = manager.getAllAgentRunners();
			for (const runner of runners) {
				if (runner.isRunning()) {
					return "busy";
				}
			}
		}

		// Busy if any Slack runner is actively running
		if (this.slackSessionManager) {
			const slackRunners = this.slackSessionManager.getAllAgentRunners();
			for (const runner of slackRunners) {
				if (runner.isRunning()) {
					return "busy";
				}
			}
		}

		return "idle";
	}

	/**
	 * Stop the edge worker
	 */
	async stop(): Promise<void> {
		// Stop config file watcher
		if (this.configWatcher) {
			await this.configWatcher.close();
			this.configWatcher = undefined;
			this.logger.info("✅ Config file watcher stopped");
		}

		try {
			await this.savePersistedState();
			this.logger.info("✅ EdgeWorker state saved successfully");
		} catch (error) {
			this.logger.error(
				"❌ Failed to save EdgeWorker state during shutdown:",
				error,
			);
		}

		// get all agent runners (including Slack sessions)
		const agentRunners: IAgentRunner[] = [];
		for (const agentSessionManager of this.agentSessionManagers.values()) {
			agentRunners.push(...agentSessionManager.getAllAgentRunners());
		}
		if (this.slackSessionManager) {
			agentRunners.push(...this.slackSessionManager.getAllAgentRunners());
		}

		// Kill all agent processes with null checking
		for (const runner of agentRunners) {
			if (runner) {
				try {
					runner.stop();
				} catch (error) {
					this.logger.error("Error stopping Claude runner:", error);
				}
			}
		}

		// Clear event transport (no explicit cleanup needed, routes are removed when server stops)
		this.linearEventTransport = null;
		this.configUpdater = null;

		// Stop shared application server (this also stops Cloudflare tunnel if running)
		await this.sharedApplicationServer.stop();
	}

	/**
	 * Set the config file path for dynamic reloading
	 */
	setConfigPath(configPath: string): void {
		this.configPath = configPath;
	}

	/**
	 * Handle resuming a parent session when a child session completes
	 * This is the core logic used by the resume parent session callback
	 * Extracted to reduce duplication between constructor and addNewRepositories
	 */
	private async handleResumeParentSession(
		parentSessionId: string,
		prompt: string,
		childSessionId: string,
		_childRepo: RepositoryConfig,
		childAgentSessionManager: AgentSessionManager,
	): Promise<void> {
		const log = this.logger.withContext({ sessionId: parentSessionId });
		log.info(
			`Child session completed, resuming parent session ${parentSessionId}`,
		);

		// Find parent session across all repositories
		// This is critical for cross-repository orchestration where parent and child
		// may be in different repositories with different AgentSessionManagers
		// See also: feedback delivery code at line ~4413 which uses same pattern
		log.debug(
			`Searching for parent session ${parentSessionId} across all repositories`,
		);
		let parentSession: CyrusAgentSession | undefined;
		let parentRepo: RepositoryConfig | undefined;
		let parentAgentSessionManager: AgentSessionManager | undefined;

		for (const [repoId, manager] of this.agentSessionManagers) {
			const candidate = manager.getSession(parentSessionId);
			if (candidate) {
				parentSession = candidate;
				parentRepo = this.repositories.get(repoId);
				parentAgentSessionManager = manager;
				log.debug(
					`Found parent session in repository: ${parentRepo?.name || repoId}`,
				);
				break;
			}
		}

		if (!parentSession || !parentRepo || !parentAgentSessionManager) {
			log.error(
				`Parent session ${parentSessionId} not found in any repository's agent session manager`,
			);
			return;
		}

		log.debug(
			`Found parent session - Issue: ${parentSession.issueId}, Workspace: ${parentSession.workspace.path}`,
		);

		// Get the child session to access its workspace path
		// Child session is in the child's manager (passed in from the callback)
		const childSession = childAgentSessionManager.getSession(childSessionId);
		const childWorkspaceDirs: string[] = [];
		if (childSession) {
			childWorkspaceDirs.push(childSession.workspace.path);
			log.debug(
				`Adding child workspace to parent allowed directories: ${childSession.workspace.path}`,
			);
		} else {
			log.warn(
				`Could not find child session ${childSessionId} to add workspace to parent allowed directories`,
			);
		}

		await this.postParentResumeAcknowledgment(parentSessionId, parentRepo.id);

		// Post thought showing child result receipt
		// Use parent's issue tracker since we're posting to the parent's session
		const issueTracker = this.issueTrackers.get(parentRepo.id);
		if (issueTracker && childSession) {
			const childIssueIdentifier =
				childSession.issue?.identifier || childSession.issueId;
			const resultThought = `Received result from sub-issue ${childIssueIdentifier}:\n\n---\n\n${prompt}\n\n---`;

			await this.postActivityDirect(
				issueTracker,
				{
					agentSessionId: parentSessionId,
					content: { type: "thought", body: resultThought },
				},
				"child result receipt",
			);
		}

		// Use centralized streaming check and routing logic
		log.info(`Handling child result for parent session ${parentSessionId}`);
		try {
			await this.handlePromptWithStreamingCheck(
				parentSession,
				parentRepo,
				parentSessionId,
				parentAgentSessionManager,
				prompt,
				"", // No attachment manifest for child results
				false, // Not a new session
				childWorkspaceDirs, // Add child workspace directories to parent's allowed directories
				"parent resume from child",
			);
			log.info(
				`Successfully handled child result for parent session ${parentSessionId}`,
			);
		} catch (error) {
			log.error(`Failed to resume parent session ${parentSessionId}:`, error);
			log.error(
				`Error context - Parent issue: ${parentSession.issueId}, Repository: ${parentRepo.name}`,
			);
		}
	}

	/**
	 * Handle subroutine transition when a subroutine completes
	 * This is triggered by the AgentSessionManager's 'subroutineComplete' event
	 */
	private async handleSubroutineTransition(
		sessionId: string,
		session: CyrusAgentSession,
		repo: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
	): Promise<void> {
		const log = this.logger.withContext({ sessionId });
		log.info(`Handling subroutine completion for session ${sessionId}`);

		// Get next subroutine (advancement already handled by AgentSessionManager)
		const nextSubroutine = this.procedureAnalyzer.getCurrentSubroutine(session);

		if (!nextSubroutine) {
			log.info(`Procedure complete for session ${sessionId}`);
			return;
		}

		log.info(`Next subroutine: ${nextSubroutine.name}`);

		// Load subroutine prompt
		let subroutinePrompt: string | null;
		try {
			subroutinePrompt = await this.loadSubroutinePrompt(
				nextSubroutine,
				this.config.linearWorkspaceSlug,
			);
			if (!subroutinePrompt) {
				// Fallback if loadSubroutinePrompt returns null
				subroutinePrompt = `Continue with: ${nextSubroutine.description}`;
			}
		} catch (error) {
			log.error(`Failed to load subroutine prompt:`, error);
			// Fallback to simple prompt
			subroutinePrompt = `Continue with: ${nextSubroutine.description}`;
		}

		// Resume Claude session with subroutine prompt
		try {
			await this.resumeAgentSession(
				session,
				repo,
				sessionId,
				agentSessionManager,
				subroutinePrompt,
				"", // No attachment manifest
				false, // Not a new session
				[], // No additional allowed directories
				nextSubroutine?.singleTurn ? 1 : undefined, // singleTurn mode
			);
			log.info(
				`Successfully resumed session for ${nextSubroutine.name} subroutine${nextSubroutine.singleTurn ? " (singleTurn)" : ""}`,
			);
		} catch (error) {
			log.error(
				`Failed to resume session for ${nextSubroutine.name} subroutine:`,
				error,
			);
		}
	}

	/**
	 * Handle validation loop fixer - run the fixer prompt
	 */
	private async handleValidationLoopFixer(
		sessionId: string,
		session: CyrusAgentSession,
		repo: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
		fixerPrompt: string,
		iteration: number,
	): Promise<void> {
		this.logger.info(
			`Running fixer for session ${sessionId}, iteration ${iteration}`,
		);

		try {
			await this.resumeAgentSession(
				session,
				repo,
				sessionId,
				agentSessionManager,
				fixerPrompt,
				"", // No attachment manifest
				false, // Not a new session
				[], // No additional allowed directories
				undefined, // No maxTurns limit for fixer
			);
			this.logger.info(`Successfully started fixer for iteration ${iteration}`);
		} catch (error) {
			this.logger.error(
				`Failed to run fixer for iteration ${iteration}:`,
				error,
			);
		}
	}

	/**
	 * Handle validation loop rerun - re-run the verifications subroutine
	 */
	private async handleValidationLoopRerun(
		sessionId: string,
		session: CyrusAgentSession,
		repo: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
	): Promise<void> {
		this.logger.info(`Re-running verifications for session ${sessionId}`);

		// Get the verifications subroutine definition
		const verificationsSubroutine =
			this.procedureAnalyzer.getCurrentSubroutine(session);

		if (
			!verificationsSubroutine ||
			verificationsSubroutine.name !== "verifications"
		) {
			this.logger.error(
				`Expected verifications subroutine, got: ${verificationsSubroutine?.name}`,
			);
			return;
		}

		try {
			// Load the verifications prompt
			const subroutinePrompt = await this.loadSubroutinePrompt(
				verificationsSubroutine,
				this.config.linearWorkspaceSlug,
			);

			if (!subroutinePrompt) {
				this.logger.error(`Failed to load verifications prompt`);
				return;
			}

			await this.resumeAgentSession(
				session,
				repo,
				sessionId,
				agentSessionManager,
				subroutinePrompt,
				"", // No attachment manifest
				false, // Not a new session
				[], // No additional allowed directories
				undefined, // No maxTurns limit
			);
			this.logger.info(`Successfully re-started verifications`);
		} catch (error) {
			this.logger.error(`Failed to re-run verifications:`, error);
		}
	}

	/**
	 * Start watching config file for changes
	 */
	private startConfigWatcher(): void {
		if (!this.configPath) {
			this.logger.warn("⚠️  No config path set, skipping config file watcher");
			return;
		}

		this.logger.info(`👀 Watching config file for changes: ${this.configPath}`);

		this.configWatcher = chokidarWatch(this.configPath, {
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 500,
				pollInterval: 100,
			},
		});

		this.configWatcher.on("change", async () => {
			this.logger.info("🔄 Config file changed, reloading...");
			await this.handleConfigChange();
		});

		this.configWatcher.on("error", (error: unknown) => {
			this.logger.error("❌ Config watcher error:", error);
		});
	}

	/**
	 * Handle configuration file changes
	 */
	private async handleConfigChange(): Promise<void> {
		try {
			const newConfig = await this.loadConfigSafely();
			if (!newConfig) {
				return;
			}

			const changes = this.detectRepositoryChanges(newConfig);

			if (
				changes.added.length === 0 &&
				changes.modified.length === 0 &&
				changes.removed.length === 0
			) {
				this.logger.info("ℹ️  No repository changes detected");
				return;
			}

			this.logger.info(
				`📊 Repository changes detected: ${changes.added.length} added, ${changes.modified.length} modified, ${changes.removed.length} removed`,
			);

			// Apply changes incrementally
			await this.removeDeletedRepositories(changes.removed);
			await this.updateModifiedRepositories(changes.modified);
			await this.addNewRepositories(changes.added);

			// Update config reference
			this.config = newConfig;

			this.logger.info("✅ Configuration reloaded successfully");
		} catch (error) {
			this.logger.error("❌ Failed to reload configuration:", error);
		}
	}

	/**
	 * Safely load configuration from file with validation
	 */
	private async loadConfigSafely(): Promise<EdgeWorkerConfig | null> {
		try {
			if (!this.configPath) {
				this.logger.error("❌ No config path set");
				return null;
			}

			const configContent = await readFile(this.configPath, "utf-8");
			const parsedConfig = JSON.parse(configContent);

			// Merge with current EdgeWorker config structure
			const newConfig: EdgeWorkerConfig = {
				...this.config,
				repositories: parsedConfig.repositories || [],
				ngrokAuthToken:
					parsedConfig.ngrokAuthToken || this.config.ngrokAuthToken,
				linearWorkspaceSlug:
					parsedConfig.linearWorkspaceSlug || this.config.linearWorkspaceSlug,
				defaultModel: parsedConfig.defaultModel || this.config.defaultModel,
				defaultFallbackModel:
					parsedConfig.defaultFallbackModel || this.config.defaultFallbackModel,
				defaultAllowedTools:
					parsedConfig.defaultAllowedTools || this.config.defaultAllowedTools,
				defaultDisallowedTools:
					parsedConfig.defaultDisallowedTools ||
					this.config.defaultDisallowedTools,
				// Issue update trigger: use parsed value if explicitly set, otherwise keep current or default to true
				issueUpdateTrigger:
					parsedConfig.issueUpdateTrigger ?? this.config.issueUpdateTrigger,
			};

			// Basic validation
			if (!Array.isArray(newConfig.repositories)) {
				this.logger.error("❌ Invalid config: repositories must be an array");
				return null;
			}

			// Validate each repository has required fields
			for (const repo of newConfig.repositories) {
				if (
					!repo.id ||
					!repo.name ||
					!repo.repositoryPath ||
					!repo.baseBranch
				) {
					this.logger.error(
						`❌ Invalid repository config: missing required fields (id, name, repositoryPath, baseBranch)`,
						repo,
					);
					return null;
				}
			}

			return newConfig;
		} catch (error) {
			this.logger.error("❌ Failed to load config file:", error);
			return null;
		}
	}

	/**
	 * Detect changes between current and new repository configurations
	 */
	private detectRepositoryChanges(newConfig: EdgeWorkerConfig): {
		added: RepositoryConfig[];
		modified: RepositoryConfig[];
		removed: RepositoryConfig[];
	} {
		const currentRepos = new Map(this.repositories);
		const newRepos = new Map(newConfig.repositories.map((r) => [r.id, r]));

		const added: RepositoryConfig[] = [];
		const modified: RepositoryConfig[] = [];
		const removed: RepositoryConfig[] = [];

		// Find added and modified repositories
		for (const [id, repo] of newRepos) {
			if (!currentRepos.has(id)) {
				added.push(repo);
			} else {
				const currentRepo = currentRepos.get(id);
				if (currentRepo && !this.deepEqual(currentRepo, repo)) {
					modified.push(repo);
				}
			}
		}

		// Find removed repositories
		for (const [id, repo] of currentRepos) {
			if (!newRepos.has(id)) {
				removed.push(repo);
			}
		}

		return { added, modified, removed };
	}

	/**
	 * Deep equality check for repository configs
	 */
	private deepEqual(obj1: any, obj2: any): boolean {
		return JSON.stringify(obj1) === JSON.stringify(obj2);
	}

	/**
	 * Add new repositories to the running EdgeWorker
	 */
	private async addNewRepositories(repos: RepositoryConfig[]): Promise<void> {
		for (const repo of repos) {
			if (repo.isActive === false) {
				this.logger.info(`⏭️  Skipping inactive repository: ${repo.name}`);
				continue;
			}

			try {
				this.logger.info(`➕ Adding repository: ${repo.name} (${repo.id})`);

				// Resolve paths that may contain tilde (~) prefix
				const resolvedRepo: RepositoryConfig = {
					...repo,
					repositoryPath: resolvePath(repo.repositoryPath),
					workspaceBaseDir: resolvePath(repo.workspaceBaseDir),
					mcpConfigPath: Array.isArray(repo.mcpConfigPath)
						? repo.mcpConfigPath.map(resolvePath)
						: repo.mcpConfigPath
							? resolvePath(repo.mcpConfigPath)
							: undefined,
					promptTemplatePath: repo.promptTemplatePath
						? resolvePath(repo.promptTemplatePath)
						: undefined,
					openaiOutputDirectory: repo.openaiOutputDirectory
						? resolvePath(repo.openaiOutputDirectory)
						: undefined,
				};

				// Add to internal map
				this.repositories.set(repo.id, resolvedRepo);

				// Create issue tracker with OAuth config for token refresh
				const issueTracker =
					this.config.platform === "cli"
						? (() => {
								const service = new CLIIssueTrackerService();
								service.seedDefaultData();
								return service;
							})()
						: new LinearIssueTrackerService(
								new LinearClient({
									accessToken: repo.linearToken,
								}),
								this.buildOAuthConfig(resolvedRepo),
							);
				this.issueTrackers.set(repo.id, issueTracker);

				// Create AgentSessionManager with same pattern as constructor
				const activitySink = new LinearActivitySink(
					issueTracker,
					repo.linearWorkspaceId,
				);
				const agentSessionManager = new AgentSessionManager(
					activitySink,
					(childSessionId: string) => {
						return this.globalSessionRegistry.getParentSessionId(
							childSessionId,
						);
					},
					async (parentSessionId, prompt, childSessionId) => {
						await this.handleResumeParentSession(
							parentSessionId,
							prompt,
							childSessionId,
							repo,
							agentSessionManager,
						);
					},
					this.procedureAnalyzer,
					this.sharedApplicationServer,
				);

				// Subscribe to subroutine completion events
				agentSessionManager.on(
					"subroutineComplete",
					async ({ sessionId, session }) => {
						await this.handleSubroutineTransition(
							sessionId,
							session,
							repo,
							agentSessionManager,
						);
					},
				);

				// Subscribe to validation loop events
				agentSessionManager.on(
					"validationLoopIteration",
					async ({
						sessionId,
						session,
						fixerPrompt,
						iteration,
						maxIterations,
					}) => {
						this.logger.info(
							`Validation loop iteration ${iteration}/${maxIterations}, running fixer`,
						);
						await this.handleValidationLoopFixer(
							sessionId,
							session,
							repo,
							agentSessionManager,
							fixerPrompt,
							iteration,
						);
					},
				);

				agentSessionManager.on(
					"validationLoopRerun",
					async ({ sessionId, session, iteration }) => {
						this.logger.info(
							`Validation loop re-running verifications (iteration ${iteration})`,
						);
						await this.handleValidationLoopRerun(
							sessionId,
							session,
							repo,
							agentSessionManager,
						);
					},
				);

				this.agentSessionManagers.set(repo.id, agentSessionManager);

				this.logger.info(`✅ Repository added successfully: ${repo.name}`);
			} catch (error) {
				this.logger.error(`❌ Failed to add repository ${repo.name}:`, error);
			}
		}
	}

	/**
	 * Update existing repositories
	 */
	private async updateModifiedRepositories(
		repos: RepositoryConfig[],
	): Promise<void> {
		for (const repo of repos) {
			try {
				const oldRepo = this.repositories.get(repo.id);
				if (!oldRepo) {
					this.logger.warn(
						`⚠️  Repository ${repo.id} not found for update, skipping`,
					);
					continue;
				}

				this.logger.info(`🔄 Updating repository: ${repo.name} (${repo.id})`);

				// Resolve paths that may contain tilde (~) prefix
				const resolvedRepo: RepositoryConfig = {
					...repo,
					repositoryPath: resolvePath(repo.repositoryPath),
					workspaceBaseDir: resolvePath(repo.workspaceBaseDir),
					mcpConfigPath: Array.isArray(repo.mcpConfigPath)
						? repo.mcpConfigPath.map(resolvePath)
						: repo.mcpConfigPath
							? resolvePath(repo.mcpConfigPath)
							: undefined,
					promptTemplatePath: repo.promptTemplatePath
						? resolvePath(repo.promptTemplatePath)
						: undefined,
					openaiOutputDirectory: repo.openaiOutputDirectory
						? resolvePath(repo.openaiOutputDirectory)
						: undefined,
				};

				// Update stored config
				this.repositories.set(repo.id, resolvedRepo);

				// If token changed, update the issue tracker's client
				if (oldRepo.linearToken !== repo.linearToken) {
					this.logger.info(`  🔑 Token changed, updating client`);
					const issueTracker = this.issueTrackers.get(repo.id);
					if (issueTracker) {
						(issueTracker as LinearIssueTrackerService).setAccessToken(
							repo.linearToken,
						);
					}
				}

				// If active status changed
				if (oldRepo.isActive !== repo.isActive) {
					if (repo.isActive === false) {
						this.logger.info(
							`  ⏸️  Repository set to inactive - existing sessions will continue`,
						);
					} else {
						this.logger.info(`  ▶️  Repository reactivated`);
					}
				}

				this.logger.info(`✅ Repository updated successfully: ${repo.name}`);
			} catch (error) {
				this.logger.error(
					`❌ Failed to update repository ${repo.name}:`,
					error,
				);
			}
		}
	}

	/**
	 * Remove deleted repositories
	 */
	private async removeDeletedRepositories(
		repos: RepositoryConfig[],
	): Promise<void> {
		for (const repo of repos) {
			try {
				this.logger.info(`🗑️  Removing repository: ${repo.name} (${repo.id})`);

				// Check for active sessions
				const manager = this.agentSessionManagers.get(repo.id);
				const activeSessions = manager?.getActiveSessions() || [];

				if (activeSessions.length > 0) {
					this.logger.warn(
						`  ⚠️  Repository has ${activeSessions.length} active sessions - stopping them`,
					);

					// Stop all active sessions and notify Linear
					for (const session of activeSessions) {
						try {
							this.logger.debug(
								`  🛑 Stopping session for issue ${session.issueId}`,
							);

							// Get the agent runner for this session
							const runner = manager?.getAgentRunner(session.id);
							if (runner) {
								// Stop the agent process
								runner.stop();
								this.logger.debug(
									`  ✅ Stopped Claude runner for session ${session.id}`,
								);
							}

							// Post cancellation message to tracker
							const issueTracker = this.issueTrackers.get(repo.id);
							if (issueTracker && session.externalSessionId) {
								await this.postActivityDirect(
									issueTracker,
									{
										agentSessionId: session.externalSessionId,
										content: {
											type: "response",
											body: `**Repository Removed from Configuration**\n\nThis repository (\`${repo.name}\`) has been removed from the Cyrus configuration. All active sessions for this repository have been stopped.\n\nIf you need to continue working on this issue, please contact your administrator to restore the repository configuration.`,
										},
									},
									"repository removal",
								);
							}
						} catch (error) {
							this.logger.error(
								`  ❌ Failed to stop session ${session.id}:`,
								error,
							);
						}
					}
				}

				// Remove repository from all maps
				this.repositories.delete(repo.id);
				this.issueTrackers.delete(repo.id);
				this.agentSessionManagers.delete(repo.id);

				this.logger.info(`✅ Repository removed successfully: ${repo.name}`);
			} catch (error) {
				this.logger.error(
					`❌ Failed to remove repository ${repo.name}:`,
					error,
				);
			}
		}
	}

	/**
	 * Handle errors
	 */
	private handleError(error: Error): void {
		this.emit("error", error);
		this.config.handlers?.onError?.(error);
	}

	/**
	 * Get cached repository for an issue (used by agentSessionPrompted Branch 3)
	 */
	private getCachedRepository(issueId: string): RepositoryConfig | null {
		return this.repositoryRouter.getCachedRepository(
			issueId,
			this.repositories,
		);
	}

	/**
	 * Handle webhook events from proxy - main router for all webhooks
	 */
	private async handleWebhook(
		webhook: Webhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		// Track active webhook processing for status endpoint
		this.activeWebhookCount++;

		// Log verbose webhook info if enabled
		if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
			this.logger.debug(
				`Full webhook payload:`,
				JSON.stringify(webhook, null, 2),
			);
		}

		try {
			// Route to specific webhook handlers based on webhook type
			// NOTE: Traditional webhooks (assigned, comment) are disabled in favor of agent session events
			if (isIssueAssignedWebhook(webhook)) {
				return;
			} else if (isIssueCommentMentionWebhook(webhook)) {
				return;
			} else if (isIssueNewCommentWebhook(webhook)) {
				return;
			} else if (isIssueUnassignedWebhook(webhook)) {
				// Keep unassigned webhook active
				await this.handleIssueUnassignedWebhook(webhook);
			} else if (isAgentSessionCreatedWebhook(webhook)) {
				await this.handleAgentSessionCreatedWebhook(webhook, repos);
			} else if (isAgentSessionPromptedWebhook(webhook)) {
				await this.handleUserPromptedAgentActivity(webhook);
			} else if (isIssueTitleOrDescriptionUpdateWebhook(webhook)) {
				// Handle issue title/description/attachments updates - feed changes into active session
				await this.handleIssueContentUpdate(webhook);
			} else {
				if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
					this.logger.debug(
						`Unhandled webhook type: ${(webhook as any).action}`,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`Failed to process webhook: ${(webhook as any).action}`,
				error,
			);
			// Don't re-throw webhook processing errors to prevent application crashes
			// The error has been logged and individual webhook failures shouldn't crash the entire system
		} finally {
			// Always decrement counter when webhook processing completes
			this.activeWebhookCount--;
		}
	}

	// ============================================================================
	// INTERNAL MESSAGE BUS HANDLERS
	// ============================================================================
	// These handlers process unified InternalMessage types from the message bus.
	// They provide a platform-agnostic interface for handling events from
	// Linear, GitHub, Slack, and other platforms.
	// ============================================================================

	/**
	 * Handle unified internal messages from the message bus.
	 * This is the new entry point for processing events from all platforms.
	 *
	 * Note: For now, this runs in parallel with legacy webhook handlers.
	 * Once migration is complete, legacy handlers will be removed.
	 */
	private async handleMessage(message: InternalMessage): Promise<void> {
		// NOTE: activeWebhookCount is NOT tracked here because legacy webhook handlers
		// already increment/decrement it for every event. Counting here would double-count.
		// TODO: When legacy handlers are removed, restore activeWebhookCount tracking here.

		// Log verbose message info if enabled
		if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
			this.logger.debug(
				`Internal message received: ${message.source}/${message.action}`,
				JSON.stringify(message, null, 2),
			);
		}

		try {
			// Route to specific message handlers based on action type
			if (isSessionStartMessage(message)) {
				await this.handleSessionStartMessage(message);
			} else if (isUserPromptMessage(message)) {
				await this.handleUserPromptMessage(message);
			} else if (isStopSignalMessage(message)) {
				await this.handleStopSignalMessage(message);
			} else if (isContentUpdateMessage(message)) {
				await this.handleContentUpdateMessage(message);
			} else if (isUnassignMessage(message)) {
				await this.handleUnassignMessage(message);
			} else {
				// This branch should never be reached due to exhaustive type checking
				// If it is reached, log the unexpected message for debugging
				if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
					const unexpectedMessage = message as InternalMessage;
					this.logger.debug(
						`Unhandled message action: ${unexpectedMessage.action}`,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`Failed to process message: ${message.source}/${message.action}`,
				error,
			);
			// Don't re-throw message processing errors to prevent application crashes
		}
	}

	/**
	 * Handle session start message (unified handler for session creation).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleAgentSessionCreatedWebhook and handleGitHubWebhook.
	 */
	private async handleSessionStartMessage(
		message: SessionStartMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] Session start: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified session start handling
		// For now, the legacy handlers (handleAgentSessionCreatedWebhook, handleGitHubWebhook)
		// continue to process the actual session creation via the 'event' emitter.
	}

	/**
	 * Handle user prompt message (unified handler for mid-session prompts).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleUserPromptedAgentActivity (branch 3).
	 */
	private async handleUserPromptMessage(
		message: UserPromptMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] User prompt: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified user prompt handling
		// For now, the legacy handler (handleUserPromptedAgentActivity)
		// continues to process the actual prompt via the 'event' emitter.
	}

	/**
	 * Handle stop signal message (unified handler for session termination).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleUserPromptedAgentActivity (branch 1).
	 */
	private async handleStopSignalMessage(
		message: StopSignalMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] Stop signal: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified stop signal handling
		// For now, the legacy handler (handleUserPromptedAgentActivity)
		// continues to process the actual stop via the 'event' emitter.
	}

	/**
	 * Handle content update message (unified handler for issue/PR content changes).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleIssueContentUpdate.
	 */
	private async handleContentUpdateMessage(
		message: ContentUpdateMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] Content update: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified content update handling
		// For now, the legacy handler (handleIssueContentUpdate)
		// continues to process the actual update via the 'event' emitter.
	}

	/**
	 * Handle unassign message (unified handler for task unassignment).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleIssueUnassignedWebhook.
	 */
	private async handleUnassignMessage(message: UnassignMessage): Promise<void> {
		this.logger.debug(
			`[MessageBus] Unassign: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified unassign handling
		// For now, the legacy handler (handleIssueUnassignedWebhook)
		// continues to process the actual unassignment via the 'event' emitter.
	}

	// ============================================================================
	// LEGACY WEBHOOK HANDLERS
	// ============================================================================

	/**
	 * Handle issue unassignment webhook
	 */
	private async handleIssueUnassignedWebhook(
		webhook: IssueUnassignedWebhook,
	): Promise<void> {
		if (!webhook.notification.issue) {
			this.logger.warn("Received issue unassignment webhook without issue");
			return;
		}

		const issueId = webhook.notification.issue.id;

		// Get cached repository (unassignment should only happen on issues with active sessions)
		const repository = this.getCachedRepository(issueId);
		if (!repository) {
			this.logger.debug(
				`No cached repository for issue unassignment webhook ${webhook.notification.issue.identifier} (no active sessions to stop)`,
			);
			return;
		}

		this.logger.info(
			`Handling issue unassignment: ${webhook.notification.issue.identifier}`,
		);

		// Log the complete webhook payload for TypeScript type definition
		// console.log('=== ISSUE UNASSIGNMENT WEBHOOK PAYLOAD ===')
		// console.log(JSON.stringify(webhook, null, 2))
		// console.log('=== END WEBHOOK PAYLOAD ===')

		await this.handleIssueUnassigned(webhook.notification.issue, repository);
	}

	/**
	 * Handle issue content update webhook (title, description, or attachments).
	 *
	 * When the title, description, or attachments of an issue are updated, this handler feeds
	 * the changes into any active session for that issue, allowing the AI to
	 * compare old vs new values and decide whether to take action.
	 *
	 * The prompt uses XML-style formatting to clearly show what changed:
	 * - <issue_update> wrapper with timestamp and issue identifier
	 * - <title_change> with <old_title> and <new_title> if title changed
	 * - <description_change> with <old_description> and <new_description> if description changed
	 * - <attachments_change> with <old_attachments> and <new_attachments> if attachments changed
	 * - <guidance> section instructing the agent to evaluate whether changes affect its work
	 *
	 * @see https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/objects/EntityWebhookPayload
	 * @see https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/objects/IssueWebhookPayload
	 * @see https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/unions/DataWebhookPayload
	 */
	private async handleIssueContentUpdate(
		webhook: IssueUpdateWebhook,
	): Promise<void> {
		// Check if issue update trigger is enabled (defaults to true if not set)
		if (this.config.issueUpdateTrigger === false) {
			if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
				this.logger.debug(
					"Issue update trigger is disabled, skipping issue content update",
				);
			}
			return;
		}

		const issueData = webhook.data;
		const issueId = issueData.id;
		const issueIdentifier = issueData.identifier;
		const updatedFrom = webhook.updatedFrom;

		if (!updatedFrom) {
			this.logger.warn(
				`Issue update webhook for ${issueIdentifier} has no updatedFrom data`,
			);
			return;
		}

		// Get cached repository (updates should only be processed for issues with active sessions)
		const repository = this.getCachedRepository(issueId);
		if (!repository) {
			if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
				this.logger.debug(
					`No cached repository for issue update webhook ${issueIdentifier} (no active sessions to notify)`,
				);
			}
			return;
		}

		// Determine what changed for logging
		const changedFields: string[] = [];
		if ("title" in updatedFrom) changedFields.push("title");
		if ("description" in updatedFrom) changedFields.push("description");
		if ("attachments" in updatedFrom) changedFields.push("attachments");

		this.logger.info(
			`Handling issue content update: ${issueIdentifier} (changed: ${changedFields.join(", ")})`,
		);

		// Get agent session manager for this repository
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			this.logger.debug(
				`No agent session manager for repository ${repository.id}`,
			);
			return;
		}

		// Find session(s) for this issue (may be running or paused between subroutines)
		const sessions = agentSessionManager.getSessionsByIssueId(issueId);
		if (sessions.length === 0) {
			if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
				this.logger.debug(
					`No sessions found for issue ${issueIdentifier} to receive update`,
				);
			}
			return;
		}

		// Process attachments from the updated description if description changed
		let attachmentManifest = "";
		if ("description" in updatedFrom && issueData.description) {
			const firstSession = sessions[0];
			if (!firstSession) {
				this.logger.debug(`No sessions found for issue ${issueIdentifier}`);
				return;
			}
			const workspaceFolderName = basename(firstSession.workspace.path);
			const attachmentsDir = join(
				this.cyrusHome,
				workspaceFolderName,
				"attachments",
			);

			try {
				// Ensure directory exists
				await mkdir(attachmentsDir, { recursive: true });

				// Count existing attachments
				const existingFiles = await readdir(attachmentsDir).catch(() => []);
				const existingAttachmentCount = existingFiles.filter(
					(file) => file.startsWith("attachment_") || file.startsWith("image_"),
				).length;

				// Download attachments from the new description
				const downloadResult = await this.downloadCommentAttachments(
					issueData.description,
					attachmentsDir,
					repository.linearToken,
					existingAttachmentCount,
				);

				if (downloadResult.totalNewAttachments > 0) {
					attachmentManifest =
						this.generateNewAttachmentManifest(downloadResult);
					this.logger.debug(
						`Downloaded ${downloadResult.totalNewAttachments} attachments from updated description`,
					);
				}
			} catch (error) {
				this.logger.error(
					"Failed to process attachments from updated description:",
					error,
				);
			}
		}

		// Build the XML-formatted prompt showing old vs new values
		const promptBody = this.buildIssueUpdatePrompt(
			issueIdentifier,
			issueData,
			updatedFrom,
		);

		// Feed the update into each active session
		for (const session of sessions) {
			const linearAgentActivitySessionId = session.id;

			// Check if runner is actively running and supports streaming input
			const existingRunner = session.agentRunner;
			const isRunning = existingRunner?.isRunning() || false;

			// Combine prompt body with attachment manifest
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}

			if (
				isRunning &&
				existingRunner?.supportsStreamingInput &&
				existingRunner.addStreamMessage
			) {
				// Add to existing stream
				this.logger.debug(
					`Adding issue update to existing stream for ${linearAgentActivitySessionId}`,
				);
				existingRunner.addStreamMessage(fullPrompt);
			} else if (isRunning) {
				// Runner is running but doesn't support streaming input - log and skip
				this.logger.debug(
					`Session ${linearAgentActivitySessionId} is running but doesn't support streaming input, skipping issue update`,
				);
			} else {
				// Session exists but runner is not running - resume with the update
				this.logger.debug(
					`Resuming session ${linearAgentActivitySessionId} with issue update`,
				);

				await this.handlePromptWithStreamingCheck(
					session,
					repository,
					linearAgentActivitySessionId,
					agentSessionManager,
					promptBody,
					attachmentManifest,
					false, // Not a new session
					[], // No additional allowed directories
					"issue content update",
					undefined, // No comment author
					undefined, // No comment timestamp
				);
			}
		}
	}

	/**
	 * Build an XML-formatted prompt for issue content updates (title, description, attachments).
	 *
	 * The prompt clearly shows what fields changed by comparing old vs new values,
	 * and includes guidance for the agent to evaluate whether these changes affect
	 * its current implementation or action plan.
	 */
	private buildIssueUpdatePrompt(
		issueIdentifier: string,
		issueData: {
			title: string;
			description?: string | null;
			attachments?: unknown;
		},
		updatedFrom: {
			title?: string;
			description?: string;
			attachments?: unknown;
		},
	): string {
		const timestamp = new Date().toISOString();
		const parts: string[] = [];

		parts.push(`<issue_update>`);
		parts.push(`  <identifier>${issueIdentifier}</identifier>`);
		parts.push(`  <timestamp>${timestamp}</timestamp>`);

		// Add title change if title was updated
		if ("title" in updatedFrom) {
			parts.push(`  <title_change>`);
			parts.push(`    <old_title>${updatedFrom.title ?? ""}</old_title>`);
			parts.push(`    <new_title>${issueData.title}</new_title>`);
			parts.push(`  </title_change>`);
		}

		// Add description change if description was updated
		if ("description" in updatedFrom) {
			parts.push(`  <description_change>`);
			parts.push(
				`    <old_description>${updatedFrom.description ?? ""}</old_description>`,
			);
			parts.push(
				`    <new_description>${issueData.description ?? ""}</new_description>`,
			);
			parts.push(`  </description_change>`);
		}

		// Add attachments change if attachments were updated
		if ("attachments" in updatedFrom) {
			parts.push(`  <attachments_change>`);
			parts.push(
				`    <old_attachments>${JSON.stringify(updatedFrom.attachments ?? null)}</old_attachments>`,
			);
			parts.push(
				`    <new_attachments>${JSON.stringify(issueData.attachments ?? null)}</new_attachments>`,
			);
			parts.push(`  </attachments_change>`);
		}

		parts.push(`</issue_update>`);

		// Add guidance for the agent on how to respond to this update
		parts.push(``);
		parts.push(`<guidance>`);
		parts.push(
			`  The issue has been updated while you are working on it. Please evaluate whether these changes`,
		);
		parts.push(
			`  affect your current implementation or action plan. Consider the following:`,
		);
		parts.push(
			`  - Does the updated content change the requirements or scope of your work?`,
		);
		parts.push(
			`  - Are there new details, clarifications, or attachments that should inform your approach?`,
		);
		parts.push(
			`  - Should you adjust your implementation strategy based on this update?`,
		);
		parts.push(
			`  If the changes are relevant, incorporate them into your work. If not, you may continue as planned.`,
		);
		parts.push(`</guidance>`);

		return parts.join("\n");
	}

	/**
	 * Get issue tracker for a workspace by finding first repository with that workspace ID
	 */
	private getIssueTrackerForWorkspace(
		workspaceId: string,
	): IIssueTrackerService | undefined {
		for (const [repoId, repo] of this.repositories) {
			if (repo.linearWorkspaceId === workspaceId) {
				return this.issueTrackers.get(repoId);
			}
		}
		return undefined;
	}

	/**
	 * Create a new Linear agent session with all necessary setup
	 * @param sessionId The Linear agent activity session ID
	 * @param issue Linear issue object
	 * @param repository Repository configuration
	 * @param agentSessionManager Agent session manager instance
	 * @returns Object containing session details and setup information
	 */
	private async createLinearAgentSession(
		sessionId: string,
		issue: { id: string; identifier: string },
		repository: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
	): Promise<AgentSessionData> {
		// Fetch full Linear issue details
		const fullIssue = await this.fetchFullIssueDetails(issue.id, repository.id);
		if (!fullIssue) {
			throw new Error(`Failed to fetch full issue details for ${issue.id}`);
		}

		// Move issue to started state automatically, in case it's not already
		await this.moveIssueToStartedState(fullIssue, repository.id);

		// Create workspace using full issue data
		// Use custom handler if provided, otherwise create a git worktree by default
		const workspace = this.config.handlers?.createWorkspace
			? await this.config.handlers.createWorkspace(fullIssue, repository)
			: await this.gitService.createGitWorktree(fullIssue, repository);

		this.logger.debug(`Workspace created at: ${workspace.path}`);

		const issueMinimal = this.convertLinearIssueToCore(fullIssue);
		agentSessionManager.createLinearAgentSession(
			sessionId,
			issue.id,
			issueMinimal,
			workspace,
		);

		// Get the newly created session
		const session = agentSessionManager.getSession(sessionId);
		if (!session) {
			throw new Error(
				`Failed to create session for agent activity session ${sessionId}`,
			);
		}

		// Download attachments before creating Claude runner
		const attachmentResult = await this.downloadIssueAttachments(
			fullIssue,
			repository,
			workspace.path,
		);

		// Pre-create attachments directory even if no attachments exist yet
		const workspaceFolderName = basename(workspace.path);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);
		await mkdir(attachmentsDir, { recursive: true });

		// Build allowed directories list - always include attachments directory
		const allowedDirectories: string[] = [
			attachmentsDir,
			repository.repositoryPath,
		];

		this.logger.debug(
			`Configured allowed directories for ${fullIssue.identifier}:`,
			allowedDirectories,
		);

		// Build allowed tools list with Linear MCP tools
		const allowedTools = this.buildAllowedTools(repository);
		const disallowedTools = this.buildDisallowedTools(repository);

		return {
			session,
			fullIssue,
			workspace,
			attachmentResult,
			attachmentsDir,
			allowedDirectories,
			allowedTools,
			disallowedTools,
		};
	}

	/**
	 * Handle agent session created webhook
	 * Can happen due to being 'delegated' or @ mentioned in a new thread
	 * @param webhook The agent session created webhook
	 * @param repos All available repositories for routing
	 */
	private async handleAgentSessionCreatedWebhook(
		webhook: AgentSessionCreatedWebhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		const issueId = webhook.agentSession?.issue?.id;

		// Check the cache first, as the agentSessionCreated webhook may have been triggered by an @mention
		// on an issue that already has an agentSession and an associated repository.
		let repository: RepositoryConfig | null = null;
		if (issueId) {
			repository = this.getCachedRepository(issueId);
			if (repository) {
				this.logger.debug(
					`Using cached repository ${repository.name} for issue ${issueId}`,
				);
			}
		}

		// If not cached, perform routing logic
		if (!repository) {
			const routingResult =
				await this.repositoryRouter.determineRepositoryForWebhook(
					webhook,
					repos,
				);

			if (routingResult.type === "none") {
				if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
					this.logger.info(
						`No repository configured for webhook from workspace ${webhook.organizationId}`,
					);
				}
				return;
			}

			// Handle needs_selection case
			if (routingResult.type === "needs_selection") {
				await this.repositoryRouter.elicitUserRepositorySelection(
					webhook,
					routingResult.workspaceRepos,
				);
				// Selection in progress - will be handled by handleRepositorySelectionResponse
				return;
			}

			// At this point, routingResult.type === "selected"
			repository = routingResult.repository;
			const routingMethod = routingResult.routingMethod;

			// Cache the repository for this issue
			if (issueId) {
				this.repositoryRouter
					.getIssueRepositoryCache()
					.set(issueId, repository.id);
			}

			// Post agent activity showing auto-matched routing
			await this.postRepositorySelectionActivity(
				webhook.agentSession.id,
				repository.id,
				repository.name,
				routingMethod,
			);
		}

		if (!webhook.agentSession.issue) {
			this.logger.warn("Agent session created webhook missing issue");
			return;
		}

		// User access control check
		const accessResult = this.checkUserAccess(webhook, repository);
		if (!accessResult.allowed) {
			this.logger.info(
				`User ${accessResult.userName} blocked from delegating: ${accessResult.reason}`,
			);
			await this.handleBlockedUser(webhook, repository, accessResult.reason);
			return;
		}

		const log = this.logger.withContext({
			sessionId: webhook.agentSession.id,
			platform: this.getRepositoryPlatform(repository.id),
			issueIdentifier: webhook.agentSession.issue.identifier,
		});
		log.info(`Handling agent session created`);
		const { agentSession, guidance } = webhook;
		const commentBody = agentSession.comment?.body;

		// Initialize agent runner using shared logic
		await this.initializeAgentRunner(
			agentSession,
			repository,
			guidance,
			commentBody,
		);
	}

	/**

	/**
	 * Initialize and start agent runner for an agent session
	 * This method contains the shared logic for creating an agent runner that both
	 * handleAgentSessionCreatedWebhook and handleUserPromptedAgentActivity use.
	 *
	 * @param agentSession The Linear agent session
	 * @param repository The repository configuration
	 * @param guidance Optional guidance rules from Linear
	 * @param commentBody Optional comment body (for mentions)
	 */
	private async initializeAgentRunner(
		agentSession: AgentSessionCreatedWebhook["agentSession"],
		repository: RepositoryConfig,
		guidance?: AgentSessionCreatedWebhook["guidance"],
		commentBody?: string | null,
	): Promise<void> {
		const sessionId = agentSession.id;
		const { issue } = agentSession;

		if (!issue) {
			this.logger.warn("Cannot initialize Claude runner without issue");
			return;
		}

		const log = this.logger.withContext({
			sessionId,
			issueIdentifier: issue.identifier,
		});

		// Log guidance if present
		if (guidance && guidance.length > 0) {
			log.debug(`Agent guidance received: ${guidance.length} rule(s)`);
			for (const rule of guidance) {
				let origin = "Unknown";
				if (rule.origin) {
					if (rule.origin.__typename === "TeamOriginWebhookPayload") {
						origin = `Team: ${rule.origin.team.displayName}`;
					} else {
						origin = "Organization";
					}
				}
				log.info(`- ${origin}: ${rule.body.substring(0, 100)}...`);
			}
		}

		// HACK: This is required since the comment body is always populated, thus there is no other way to differentiate between the two trigger events
		const AGENT_SESSION_MARKER = "This thread is for an agent session";
		const isMentionTriggered =
			commentBody && !commentBody.includes(AGENT_SESSION_MARKER);
		// Check if the comment contains the /label-based-prompt command
		const isLabelBasedPromptRequested = commentBody?.includes(
			"/label-based-prompt",
		);

		// Initialize the agent session in AgentSessionManager
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			log.error(
				"There was no agentSessionManage for the repository with id",
				repository.id,
			);
			return;
		}

		// Post instant acknowledgment thought
		await this.postInstantAcknowledgment(sessionId, repository.id);

		// Create the session using the shared method
		const sessionData = await this.createLinearAgentSession(
			sessionId,
			issue,
			repository,
			agentSessionManager,
		);

		// Destructure the session data (excluding allowedTools which we'll build with promptType)
		const {
			session,
			fullIssue,
			workspace: _workspace,
			attachmentResult,
			attachmentsDir: _attachmentsDir,
			allowedDirectories,
		} = sessionData;

		// Initialize procedure metadata using intelligent routing
		if (!session.metadata) {
			session.metadata = {};
		}

		// Post ephemeral "Routing..." thought
		await agentSessionManager.postAnalyzingThought(sessionId);

		// Fetch labels early (needed for label override check)
		const labels = await this.fetchIssueLabels(fullIssue);
		// Lowercase labels for case-insensitive comparison
		const lowercaseLabels = labels.map((label) => label.toLowerCase());

		// Check for label overrides BEFORE AI routing
		const debuggerConfig = repository.labelPrompts?.debugger;
		const debuggerLabels = Array.isArray(debuggerConfig)
			? debuggerConfig
			: debuggerConfig?.labels;
		const hasDebuggerLabel = debuggerLabels?.some((label) =>
			lowercaseLabels.includes(label.toLowerCase()),
		);

		// ALWAYS check for 'orchestrator' label (case-insensitive) regardless of EdgeConfig
		// This is a hardcoded rule: any issue with 'orchestrator'/'Orchestrator' label
		// goes to orchestrator procedure
		const hasHardcodedOrchestratorLabel =
			lowercaseLabels.includes("orchestrator");

		// Also check any additional orchestrator labels from config
		const orchestratorConfig = repository.labelPrompts?.orchestrator;
		const orchestratorLabels = Array.isArray(orchestratorConfig)
			? orchestratorConfig
			: orchestratorConfig?.labels;
		const hasConfiguredOrchestratorLabel =
			orchestratorLabels?.some((label) =>
				lowercaseLabels.includes(label.toLowerCase()),
			) ?? false;

		const hasOrchestratorLabel =
			hasHardcodedOrchestratorLabel || hasConfiguredOrchestratorLabel;

		// Check for graphite label (for graphite-orchestrator combination)
		const graphiteConfig = repository.labelPrompts?.graphite;
		const graphiteLabels = Array.isArray(graphiteConfig)
			? graphiteConfig
			: (graphiteConfig?.labels ?? ["graphite"]);
		const hasGraphiteLabel = graphiteLabels?.some((label: string) =>
			lowercaseLabels.includes(label.toLowerCase()),
		);

		// Graphite-orchestrator requires BOTH graphite AND orchestrator labels
		const hasGraphiteOrchestratorLabels =
			hasGraphiteLabel && hasOrchestratorLabel;

		let finalProcedure: ProcedureDefinition;
		let finalClassification: RequestClassification;

		// If labels indicate a specific procedure, use that instead of AI routing
		if (hasDebuggerLabel) {
			const debuggerProcedure =
				this.procedureAnalyzer.getProcedure("debugger-full");
			if (!debuggerProcedure) {
				throw new Error("debugger-full procedure not found in registry");
			}
			finalProcedure = debuggerProcedure;
			finalClassification = "debugger";
			log.info(
				`Using debugger-full procedure due to debugger label (skipping AI routing)`,
			);
		} else if (hasGraphiteOrchestratorLabels) {
			// Graphite-orchestrator takes precedence over regular orchestrator when both labels present
			const orchestratorProcedure =
				this.procedureAnalyzer.getProcedure("orchestrator-full");
			if (!orchestratorProcedure) {
				throw new Error("orchestrator-full procedure not found in registry");
			}
			finalProcedure = orchestratorProcedure;
			// Use orchestrator classification but the system prompt will be graphite-orchestrator
			finalClassification = "orchestrator";
			log.info(
				`Using orchestrator-full procedure with graphite-orchestrator prompt (graphite + orchestrator labels)`,
			);
		} else if (hasOrchestratorLabel) {
			const orchestratorProcedure =
				this.procedureAnalyzer.getProcedure("orchestrator-full");
			if (!orchestratorProcedure) {
				throw new Error("orchestrator-full procedure not found in registry");
			}
			finalProcedure = orchestratorProcedure;
			finalClassification = "orchestrator";
			log.info(
				`Using orchestrator-full procedure due to orchestrator label (skipping AI routing)`,
			);
		} else {
			// No label override - use AI routing
			const issueDescription =
				`${issue.title}\n\n${fullIssue.description || ""}`.trim();
			const routingDecision =
				await this.procedureAnalyzer.determineRoutine(issueDescription);
			finalProcedure = routingDecision.procedure;
			finalClassification = routingDecision.classification;

			// Log AI routing decision
			log.info(`AI routing decision for ${sessionId}:`);
			log.info(`  Classification: ${routingDecision.classification}`);
			log.info(`  Procedure: ${finalProcedure.name}`);
			log.info(`  Reasoning: ${routingDecision.reasoning}`);
		}

		// Initialize procedure metadata in session with final decision
		this.procedureAnalyzer.initializeProcedureMetadata(session, finalProcedure);

		// Post single procedure selection result (replaces ephemeral routing thought)
		await agentSessionManager.postProcedureSelectionThought(
			sessionId,
			finalProcedure.name,
			finalClassification,
		);

		// Build and start Claude with initial prompt using full issue (streaming mode)
		log.info(`Building initial prompt for issue ${fullIssue.identifier}`);
		try {
			// Create input for unified prompt assembly
			const input: PromptAssemblyInput = {
				session,
				fullIssue,
				repository,
				userComment: commentBody || "", // Empty for delegation, present for mentions
				attachmentManifest: attachmentResult.manifest,
				guidance: guidance || undefined,
				agentSession,
				labels,
				isNewSession: true,
				isStreaming: false, // Not yet streaming
				isMentionTriggered: isMentionTriggered || false,
				isLabelBasedPromptRequested: isLabelBasedPromptRequested || false,
			};

			// Use unified prompt assembly
			const assembly = await this.assemblePrompt(input);

			// Get systemPromptVersion for tracking (TODO: add to PromptAssembly metadata)
			let systemPromptVersion: string | undefined;
			let promptType:
				| "debugger"
				| "builder"
				| "scoper"
				| "orchestrator"
				| "graphite-orchestrator"
				| undefined;

			if (!isMentionTriggered || isLabelBasedPromptRequested) {
				const systemPromptResult = await this.determineSystemPromptFromLabels(
					labels,
					repository,
				);
				systemPromptVersion = systemPromptResult?.version;
				promptType = systemPromptResult?.type;

				// Post thought about system prompt selection
				if (assembly.systemPrompt) {
					await this.postSystemPromptSelectionThought(
						sessionId,
						labels,
						repository.id,
					);
				}
			}

			// Get current subroutine to check for singleTurn mode and disallowAllTools
			const currentSubroutine =
				this.procedureAnalyzer.getCurrentSubroutine(session);

			// Build allowed tools list with Linear MCP tools (now with prompt type context)
			// If subroutine has disallowAllTools: true, use empty array to disable all tools
			const allowedTools = currentSubroutine?.disallowAllTools
				? []
				: this.buildAllowedTools(repository, promptType);
			const baseDisallowedTools = this.buildDisallowedTools(
				repository,
				promptType,
			);

			// Merge subroutine-level disallowedTools if applicable
			const disallowedTools = this.mergeSubroutineDisallowedTools(
				session,
				baseDisallowedTools,
				"EdgeWorker",
			);

			if (currentSubroutine?.disallowAllTools) {
				log.debug(
					`All tools disabled for ${fullIssue.identifier} (subroutine: ${currentSubroutine.name})`,
				);
			} else {
				log.debug(
					`Configured allowed tools for ${fullIssue.identifier}:`,
					allowedTools,
				);
			}
			if (disallowedTools.length > 0) {
				log.debug(
					`Configured disallowed tools for ${fullIssue.identifier}:`,
					disallowedTools,
				);
			}

			// Create agent runner with system prompt from assembly
			// buildAgentRunnerConfig now determines runner type from labels internally
			const { config: runnerConfig, runnerType } = this.buildAgentRunnerConfig(
				session,
				repository,
				sessionId,
				assembly.systemPrompt,
				allowedTools,
				allowedDirectories,
				disallowedTools,
				undefined, // resumeSessionId
				labels, // Pass labels for runner selection and model override
				undefined, // maxTurns
				currentSubroutine?.singleTurn, // singleTurn flag
				currentSubroutine?.disallowAllTools, // disallowAllTools flag - also disables MCP tools
			);

			log.debug(
				`Label-based runner selection for new session: ${runnerType} (session ${sessionId})`,
			);

			const runner =
				runnerType === "claude"
					? new ClaudeRunner(runnerConfig)
					: new GeminiRunner(runnerConfig);

			// Store runner by comment ID
			agentSessionManager.addAgentRunner(sessionId, runner);

			// Save state after mapping changes
			await this.savePersistedState();

			// Emit events using full issue (core Issue type)
			this.emit("session:started", fullIssue.id, fullIssue, repository.id);
			this.config.handlers?.onSessionStart?.(
				fullIssue.id,
				fullIssue,
				repository.id,
			);

			// Update runner with version information (if available)
			// Note: updatePromptVersions is specific to ClaudeRunner
			if (
				systemPromptVersion &&
				"updatePromptVersions" in runner &&
				typeof runner.updatePromptVersions === "function"
			) {
				runner.updatePromptVersions({
					systemPromptVersion,
				});
			}

			// Log metadata for debugging
			log.debug(
				`Initial prompt built successfully - components: ${assembly.metadata.components.join(", ")}, type: ${assembly.metadata.promptType}, length: ${assembly.userPrompt.length} characters`,
			);

			// Start session - use streaming mode if supported for ability to add messages later
			if (runner.supportsStreamingInput && runner.startStreaming) {
				log.debug(`Starting streaming session`);
				const sessionInfo = await runner.startStreaming(assembly.userPrompt);
				log.debug(`Streaming session started: ${sessionInfo.sessionId}`);
			} else {
				log.debug(`Starting non-streaming session`);
				const sessionInfo = await runner.start(assembly.userPrompt);
				log.debug(`Non-streaming session started: ${sessionInfo.sessionId}`);
			}
			// Note: AgentSessionManager will be initialized automatically when the first system message
			// is received via handleClaudeMessage() callback
		} catch (error) {
			log.error(`Error in prompt building/starting:`, error);
			throw error;
		}
	}

	/**
	 * Handle stop signal from prompted webhook
	 * Branch 1 of agentSessionPrompted (see packages/CLAUDE.md)
	 *
	 * IMPORTANT: Stop signals do NOT require repository lookup.
	 * The session must already exist (per CLAUDE.md), so we search
	 * all agent session managers to find it.
	 */
	private async handleStopSignal(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const agentSessionId = webhook.agentSession.id;
		const { issue } = webhook.agentSession;
		const log = this.logger.withContext({ sessionId: agentSessionId });

		log.info(
			`Received stop signal for agent activity session ${agentSessionId}`,
		);

		// Find the agent session manager that contains this session
		// We don't need repository lookup - just search all managers
		let foundManager: AgentSessionManager | null = null;
		let foundSession: CyrusAgentSession | null = null;

		for (const manager of this.agentSessionManagers.values()) {
			const session = manager.getSession(agentSessionId);
			if (session) {
				foundManager = manager;
				foundSession = session;
				break;
			}
		}

		if (!foundManager || !foundSession) {
			log.warn(`No session found for stop signal: ${agentSessionId}`);
			return;
		}

		// Stop the existing runner if it's active
		const existingRunner = foundSession.agentRunner;
		if (existingRunner) {
			existingRunner.stop();
			log.info(
				`Stopped agent session for agent activity session ${agentSessionId}`,
			);
		}

		// Post confirmation
		const issueTitle = issue?.title || "this issue";
		const stopConfirmation = `I've stopped working on ${issueTitle} as requested.\n\n**Stop Signal:** Received from ${webhook.agentSession.creator?.name || "user"}\n**Action Taken:** All ongoing work has been halted`;

		await foundManager.createResponseActivity(agentSessionId, stopConfirmation);
	}

	/**
	 * Handle repository selection response from prompted webhook
	 * Branch 2 of agentSessionPrompted (see packages/CLAUDE.md)
	 *
	 * This method extracts the user's repository selection from their response,
	 * or uses the fallback repository if their message doesn't match any option.
	 * In both cases, the selected repository is cached for future use.
	 */
	private async handleRepositorySelectionResponse(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const { agentSession, agentActivity, guidance } = webhook;
		const commentBody = agentSession.comment?.body;
		const agentSessionId = agentSession.id;
		const log = this.logger.withContext({ sessionId: agentSessionId });

		if (!agentActivity) {
			log.warn("Cannot handle repository selection without agentActivity");
			return;
		}

		if (!agentSession.issue) {
			log.warn("Cannot handle repository selection without issue");
			return;
		}

		const userMessage = agentActivity.content.body;

		log.debug(`Processing repository selection response: "${userMessage}"`);

		// Get the selected repository (or fallback)
		const repository = await this.repositoryRouter.selectRepositoryFromResponse(
			agentSessionId,
			userMessage,
		);

		if (!repository) {
			log.error(
				`Failed to select repository for agent session ${agentSessionId}`,
			);
			return;
		}

		// Cache the selected repository for this issue
		const issueId = agentSession.issue.id;
		this.repositoryRouter.getIssueRepositoryCache().set(issueId, repository.id);

		// Post agent activity showing user-selected repository
		await this.postRepositorySelectionActivity(
			agentSessionId,
			repository.id,
			repository.name,
			"user-selected",
		);

		log.debug(
			`Initializing agent runner after repository selection: ${agentSession.issue.identifier} -> ${repository.name}`,
		);

		// Initialize agent runner with the selected repository
		await this.initializeAgentRunner(
			agentSession,
			repository,
			guidance,
			commentBody,
		);
	}

	/**
	 * Handle AskUserQuestion response from prompted webhook
	 * Branch 2.5: User response to a question posed via AskUserQuestion tool
	 *
	 * @param webhook The prompted webhook containing user's response
	 */
	private async handleAskUserQuestionResponse(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const { agentSession, agentActivity } = webhook;
		const agentSessionId = agentSession.id;

		if (!agentActivity) {
			this.logger.warn(
				"Cannot handle AskUserQuestion response without agentActivity",
			);
			// Resolve with a denial to unblock the waiting promise
			this.askUserQuestionHandler.cancelPendingQuestion(
				agentSessionId,
				"No agent activity in webhook",
			);
			return;
		}

		// Extract the user's response from the activity body
		const userResponse = agentActivity.content?.body || "";

		this.logger.debug(
			`Processing AskUserQuestion response for session ${agentSessionId}: "${userResponse}"`,
		);

		// Pass the response to the handler to resolve the waiting promise
		const handled = this.askUserQuestionHandler.handleUserResponse(
			agentSessionId,
			userResponse,
		);

		if (!handled) {
			this.logger.warn(
				`AskUserQuestion response not handled for session ${agentSessionId} (no pending question)`,
			);
		} else {
			this.logger.debug(
				`AskUserQuestion response handled for session ${agentSessionId}`,
			);
		}
	}

	/**
	 * Handle normal prompted activity (existing session continuation)
	 * Branch 3 of agentSessionPrompted (see packages/CLAUDE.md)
	 */
	private async handleNormalPromptedActivity(
		webhook: AgentSessionPromptedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		const { agentSession } = webhook;
		const sessionId = agentSession.id;
		const { issue } = agentSession;

		if (!issue) {
			this.logger.warn("Cannot handle prompted activity without issue");
			return;
		}

		if (!webhook.agentActivity) {
			this.logger.warn("Cannot handle prompted activity without agentActivity");
			return;
		}

		const commentId = webhook.agentActivity.sourceCommentId;

		// Initialize the agent session in AgentSessionManager
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			this.logger.error(
				"Unexpected: There was no agentSessionManage for the repository with id",
				repository.id,
			);
			return;
		}

		let session = agentSessionManager.getSession(sessionId);
		let isNewSession = false;
		let fullIssue: Issue | null = null;

		if (!session) {
			this.logger.debug(
				`No existing session found for agent activity session ${sessionId}, creating new session`,
			);
			isNewSession = true;

			// Post instant acknowledgment for new session creation
			await this.postInstantPromptedAcknowledgment(
				sessionId,
				repository.id,
				false,
			);

			// Create the session using the shared method
			const sessionData = await this.createLinearAgentSession(
				sessionId,
				issue,
				repository,
				agentSessionManager,
			);

			// Destructure session data for new session
			fullIssue = sessionData.fullIssue;
			session = sessionData.session;

			this.logger.debug(`Created new session ${sessionId} (prompted webhook)`);

			// Save state and emit events for new session
			await this.savePersistedState();
			// Emit events using full issue (core Issue type)
			this.emit("session:started", fullIssue.id, fullIssue, repository.id);
			this.config.handlers?.onSessionStart?.(
				fullIssue.id,
				fullIssue,
				repository.id,
			);
		} else {
			this.logger.debug(
				`Found existing session ${sessionId} for new user prompt`,
			);

			// Post instant acknowledgment for existing session BEFORE any async work
			// Check if runner is currently running (streaming is Claude-specific, use isRunning for both)
			const isCurrentlyStreaming = session?.agentRunner?.isRunning() || false;

			await this.postInstantPromptedAcknowledgment(
				sessionId,
				repository.id,
				isCurrentlyStreaming,
			);

			// Need to fetch full issue for routing context
			const issueTracker = this.issueTrackers.get(repository.id);
			if (issueTracker) {
				try {
					fullIssue = await issueTracker.fetchIssue(issue.id);
				} catch (error) {
					this.logger.warn(
						`Failed to fetch full issue for routing: ${issue.id}`,
						error,
					);
					// Continue with degraded routing context
				}
			}
		}

		// Note: Routing and streaming check happens later in handlePromptWithStreamingCheck
		// after attachments are processed

		// Ensure session is not null after creation/retrieval
		if (!session) {
			throw new Error(
				`Failed to get or create session for agent activity session ${sessionId}`,
			);
		}

		// Acknowledgment already posted above for both new and existing sessions
		// (before any async routing work to ensure instant user feedback)

		// Get issue tracker for this repository
		const issueTracker = this.issueTrackers.get(repository.id);
		if (!issueTracker) {
			this.logger.error(
				"Unexpected: There was no IssueTrackerService for the repository with id",
				repository.id,
			);
			return;
		}

		// Always set up attachments directory, even if no attachments in current comment
		const workspaceFolderName = basename(session.workspace.path);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);
		// Ensure directory exists
		await mkdir(attachmentsDir, { recursive: true });

		let attachmentManifest = "";
		let commentAuthor: string | undefined;
		let commentTimestamp: string | undefined;

		if (!commentId) {
			this.logger.warn("No comment ID provided for attachment handling");
		}

		try {
			const comment = commentId
				? await issueTracker.fetchComment(commentId)
				: null;

			// Extract comment metadata for multi-player context
			if (comment) {
				const user = await comment.user;
				commentAuthor =
					user?.displayName || user?.name || user?.email || "Unknown";
				commentTimestamp = comment.createdAt
					? comment.createdAt.toISOString()
					: new Date().toISOString();
			}

			// Count existing attachments
			const existingFiles = await readdir(attachmentsDir).catch(() => []);
			const existingAttachmentCount = existingFiles.filter(
				(file) => file.startsWith("attachment_") || file.startsWith("image_"),
			).length;

			// Download new attachments from the comment
			const downloadResult = comment
				? await this.downloadCommentAttachments(
						comment.body,
						attachmentsDir,
						repository.linearToken,
						existingAttachmentCount,
					)
				: {
						totalNewAttachments: 0,
						newAttachmentMap: {},
						newImageMap: {},
						failedCount: 0,
					};

			if (downloadResult.totalNewAttachments > 0) {
				attachmentManifest = this.generateNewAttachmentManifest(downloadResult);
			}
		} catch (error) {
			this.logger.error("Failed to fetch comments for attachments:", error);
		}

		const promptBody = webhook.agentActivity.content.body;

		// Use centralized streaming check and routing logic
		try {
			await this.handlePromptWithStreamingCheck(
				session,
				repository,
				sessionId,
				agentSessionManager,
				promptBody,
				attachmentManifest,
				isNewSession,
				[], // No additional allowed directories for regular continuation
				`prompted webhook (${isNewSession ? "new" : "existing"} session)`,
				commentAuthor,
				commentTimestamp,
			);
		} catch (error) {
			this.logger.error("Failed to handle prompted webhook:", error);
		}
	}

	/**
	 * Handle user-prompted agent activity webhook
	 * Implements three-branch architecture from packages/CLAUDE.md:
	 *   1. Stop signal - terminate existing runner
	 *   2. Repository selection response - initialize Claude runner for first time
	 *   3. Normal prompted activity - continue existing session or create new one
	 *
	 * @param webhook The prompted webhook containing user's message
	 */
	private async handleUserPromptedAgentActivity(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const agentSessionId = webhook.agentSession.id;

		// Branch 1: Handle stop signal (checked FIRST, before any routing work)
		// Per CLAUDE.md: "an agentSession MUST already exist" for stop signals
		// IMPORTANT: Stop signals do NOT require repository lookup
		if (webhook.agentActivity?.signal === "stop") {
			await this.handleStopSignal(webhook);
			return;
		}

		// Branch 2: Handle repository selection response
		// This is the first Claude runner initialization after user selects a repository.
		// The selection handler extracts the choice from the response (or uses fallback)
		// and caches the repository for future use.
		if (this.repositoryRouter.hasPendingSelection(agentSessionId)) {
			await this.handleRepositorySelectionResponse(webhook);
			return;
		}

		// Branch 2.5: Handle AskUserQuestion response
		// This handles responses to questions posed via the AskUserQuestion tool.
		// The response is passed to the pending promise resolver.
		if (this.askUserQuestionHandler.hasPendingQuestion(agentSessionId)) {
			await this.handleAskUserQuestionResponse(webhook);
			return;
		}

		// Branch 3: Handle normal prompted activity (existing session continuation)
		// Per CLAUDE.md: "an agentSession MUST exist and a repository MUST already
		// be associated with the Linear issue. The repository will be retrieved from
		// the issue-to-repository cache - no new routing logic is performed."
		const issueId = webhook.agentSession?.issue?.id;
		if (!issueId) {
			this.logger.error(
				`No issue ID found in prompted webhook ${agentSessionId}`,
			);
			return;
		}

		const repository = this.getCachedRepository(issueId);
		if (!repository) {
			this.logger.warn(
				`No cached repository found for prompted webhook ${agentSessionId}`,
			);
			return;
		}

		// User access control check for mid-session prompts
		const accessResult = this.checkUserAccess(webhook, repository);
		if (!accessResult.allowed) {
			this.logger.info(
				`User ${accessResult.userName} blocked from prompting: ${accessResult.reason}`,
			);
			await this.handleBlockedUser(webhook, repository, accessResult.reason);
			return;
		}

		await this.handleNormalPromptedActivity(webhook, repository);
	}

	/**
	 * Handle issue unassignment
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 */
	private async handleIssueUnassigned(
		issue: WebhookIssue,
		repository: RepositoryConfig,
	): Promise<void> {
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			this.logger.info(
				"No agentSessionManager for unassigned issue, so no sessions to stop",
			);
			return;
		}

		// Get all agent runners for this specific issue
		const agentRunners = agentSessionManager.getAgentRunnersForIssue(issue.id);

		// Stop all agent runners for this issue
		const activeThreadCount = agentRunners.length;
		for (const runner of agentRunners) {
			this.logger.info(`Stopping agent runner for issue ${issue.identifier}`);
			runner.stop();
		}

		// Post ONE farewell comment on the issue (not in any thread) if there were active sessions
		if (activeThreadCount > 0) {
			await this.postComment(
				issue.id,
				"I've been unassigned and am stopping work now.",
				repository.id,
				// No parentId - post as a new comment on the issue
			);
		}

		// Emit events
		this.logger.info(
			`Stopped ${activeThreadCount} sessions for unassigned issue ${issue.identifier}`,
		);
	}

	/**
	 * Handle Claude messages
	 */
	private async handleClaudeMessage(
		sessionId: string,
		message: SDKMessage,
		repositoryId: string,
	): Promise<void> {
		const agentSessionManager = this.agentSessionManagers.get(repositoryId);
		// Integrate with AgentSessionManager to capture streaming messages
		if (agentSessionManager) {
			await agentSessionManager.handleClaudeMessage(sessionId, message);
		}
	}

	/**
	 * Handle Claude session error
	 * Silently ignores AbortError (user-initiated stop), logs other errors
	 */
	private async handleClaudeError(error: Error): Promise<void> {
		// AbortError is expected when user stops Claude process, don't log it
		// Check by name since the SDK's AbortError class may not match our imported definition
		const isAbortError =
			error.name === "AbortError" || error.message.includes("aborted by user");

		// Also check for SIGTERM (exit code 143), which indicates graceful termination
		const isSigterm = error.message.includes(
			"Claude Code process exited with code 143",
		);

		if (isAbortError || isSigterm) {
			return;
		}
		this.logger.error("Unhandled claude error:", error);
	}

	/**
	 * Fetch issue labels for a given issue
	 */
	private async fetchIssueLabels(issue: Issue): Promise<string[]> {
		try {
			const labels = await issue.labels();
			return labels.nodes.map((label) => label.name);
		} catch (error) {
			this.logger.error(`Failed to fetch labels for issue ${issue.id}:`, error);
			return [];
		}
	}

	/**
	 * Determine runner type and model from issue labels.
	 * Returns the runner type ("claude" or "gemini"), optional model override, and fallback model.
	 *
	 * Label priority (case-insensitive):
	 * - Gemini labels: gemini, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-3-pro, gemini-3-pro-preview
	 * - Claude labels: claude, sonnet, opus
	 *
	 * If no runner label is found, defaults to claude.
	 */
	private determineRunnerFromLabels(labels: string[]): {
		runnerType: "claude" | "gemini";
		modelOverride?: string;
		fallbackModelOverride?: string;
	} {
		if (!labels || labels.length === 0) {
			return {
				runnerType: "claude",
				modelOverride: "opus",
				fallbackModelOverride: "sonnet",
			};
		}

		const lowercaseLabels = labels.map((label) => label.toLowerCase());

		// Check for Gemini labels first
		if (
			lowercaseLabels.includes("gemini-2.5-pro") ||
			lowercaseLabels.includes("gemini-2.5")
		) {
			return {
				runnerType: "gemini",
				modelOverride: "gemini-2.5-pro",
				fallbackModelOverride: "gemini-2.5-flash",
			};
		}
		if (lowercaseLabels.includes("gemini-2.5-flash")) {
			return {
				runnerType: "gemini",
				modelOverride: "gemini-2.5-flash",
				fallbackModelOverride: "gemini-2.5-flash-lite",
			};
		}
		if (lowercaseLabels.includes("gemini-2.5-flash-lite")) {
			return {
				runnerType: "gemini",
				modelOverride: "gemini-2.5-flash-lite",
				fallbackModelOverride: "gemini-2.5-flash-lite",
			};
		}
		if (
			lowercaseLabels.includes("gemini-3") ||
			lowercaseLabels.includes("gemini-3-pro") ||
			lowercaseLabels.includes("gemini-3-pro-preview")
		) {
			return {
				runnerType: "gemini",
				modelOverride: "gemini-3-pro-preview",
				fallbackModelOverride: "gemini-2.5-pro",
			};
		}
		if (lowercaseLabels.includes("gemini")) {
			return {
				runnerType: "gemini",
				modelOverride: "gemini-2.5-pro",
				fallbackModelOverride: "gemini-2.5-flash",
			};
		}

		// Check for Claude labels
		if (lowercaseLabels.includes("opus")) {
			return {
				runnerType: "claude",
				modelOverride: "opus",
				fallbackModelOverride: "sonnet",
			};
		}
		if (lowercaseLabels.includes("sonnet")) {
			return {
				runnerType: "claude",
				modelOverride: "sonnet",
				fallbackModelOverride: "haiku",
			};
		}
		if (lowercaseLabels.includes("haiku")) {
			// fallbackModelOverride must be different from modelOverride
			// (haiku falls back to sonnet for retry scenarios)
			return {
				runnerType: "claude",
				modelOverride: "haiku",
				fallbackModelOverride: "sonnet",
			};
		}
		// Default to claude if no runner labels found
		return {
			runnerType: "claude",
			modelOverride: "opus",
			fallbackModelOverride: "sonnet",
		};
	}

	/**
	 * Determine system prompt based on issue labels and repository configuration
	 */
	private async determineSystemPromptFromLabels(
		labels: string[],
		repository: RepositoryConfig,
	): Promise<
		| {
				prompt: string;
				version?: string;
				type?:
					| "debugger"
					| "builder"
					| "scoper"
					| "orchestrator"
					| "graphite-orchestrator";
		  }
		| undefined
	> {
		if (labels.length === 0) {
			return undefined;
		}

		// Lowercase labels for case-insensitive comparison
		const lowercaseLabels = labels.map((label) => label.toLowerCase());

		// HARDCODED RULE: Always check for 'orchestrator' label (case-insensitive)
		// regardless of whether repository.labelPrompts is configured.
		// This matches the hardcoded routing behavior from CYPACK-715.
		const hasHardcodedOrchestratorLabel =
			lowercaseLabels.includes("orchestrator");

		// If no labelPrompts configured but has hardcoded orchestrator label,
		// load orchestrator system prompt directly
		if (!repository.labelPrompts && hasHardcodedOrchestratorLabel) {
			try {
				const __filename = fileURLToPath(import.meta.url);
				const __dirname = dirname(__filename);
				const promptPath = join(__dirname, "..", "prompts", "orchestrator.md");
				const promptContent = await readFile(promptPath, "utf-8");
				this.logger.debug(
					`Using orchestrator system prompt (hardcoded rule) for labels: ${labels.join(", ")}`,
				);

				const promptVersion = this.extractVersionTag(promptContent);
				if (promptVersion) {
					this.logger.debug(
						`orchestrator system prompt version: ${promptVersion}`,
					);
				}

				return {
					prompt: promptContent,
					version: promptVersion,
					type: "orchestrator",
				};
			} catch (error) {
				this.logger.error(
					`Failed to load orchestrator prompt template:`,
					error,
				);
				return undefined;
			}
		}

		// If no labelPrompts configured and no hardcoded orchestrator, return undefined
		if (!repository.labelPrompts) {
			return undefined;
		}

		// Check for graphite-orchestrator first (requires BOTH graphite AND orchestrator labels)
		const graphiteConfig = repository.labelPrompts.graphite;
		const graphiteLabels = Array.isArray(graphiteConfig)
			? graphiteConfig
			: (graphiteConfig?.labels ?? ["graphite"]);
		const hasGraphiteLabel = graphiteLabels?.some((label: string) =>
			lowercaseLabels.includes(label.toLowerCase()),
		);

		const orchestratorConfig = repository.labelPrompts.orchestrator;
		const orchestratorLabels = Array.isArray(orchestratorConfig)
			? orchestratorConfig
			: (orchestratorConfig?.labels ?? ["orchestrator"]);
		// Use hardcoded check OR config-based check for orchestrator
		const hasOrchestratorLabel =
			hasHardcodedOrchestratorLabel ||
			orchestratorLabels?.some((label) =>
				lowercaseLabels.includes(label.toLowerCase()),
			);

		// If both graphite AND orchestrator labels are present, use graphite-orchestrator prompt
		if (hasGraphiteLabel && hasOrchestratorLabel) {
			try {
				const __filename = fileURLToPath(import.meta.url);
				const __dirname = dirname(__filename);
				const promptPath = join(
					__dirname,
					"..",
					"prompts",
					"graphite-orchestrator.md",
				);
				const promptContent = await readFile(promptPath, "utf-8");
				this.logger.debug(
					`Using graphite-orchestrator system prompt for labels: ${labels.join(", ")}`,
				);

				const promptVersion = this.extractVersionTag(promptContent);
				if (promptVersion) {
					this.logger.debug(
						`graphite-orchestrator system prompt version: ${promptVersion}`,
					);
				}

				return {
					prompt: promptContent,
					version: promptVersion,
					type: "graphite-orchestrator",
				};
			} catch (error) {
				this.logger.error(
					`Failed to load graphite-orchestrator prompt template:`,
					error,
				);
				// Fall through to regular orchestrator if graphite-orchestrator prompt fails
			}
		}

		// Check each prompt type for matching labels
		const promptTypes = [
			"debugger",
			"builder",
			"scoper",
			"orchestrator",
		] as const;

		for (const promptType of promptTypes) {
			const promptConfig = repository.labelPrompts[promptType];
			// Handle both old array format and new object format for backward compatibility
			const configuredLabels = Array.isArray(promptConfig)
				? promptConfig
				: promptConfig?.labels;

			// For orchestrator type, also check the hardcoded 'orchestrator' label
			// This ensures orchestrator prompt loads even without explicit labelPrompts config
			const matchesLabel =
				promptType === "orchestrator"
					? hasHardcodedOrchestratorLabel ||
						configuredLabels?.some((label) =>
							lowercaseLabels.includes(label.toLowerCase()),
						)
					: configuredLabels?.some((label) =>
							lowercaseLabels.includes(label.toLowerCase()),
						);

			if (matchesLabel) {
				try {
					// Load the prompt template from file
					const __filename = fileURLToPath(import.meta.url);
					const __dirname = dirname(__filename);
					const promptPath = join(
						__dirname,
						"..",
						"prompts",
						`${promptType}.md`,
					);
					const promptContent = await readFile(promptPath, "utf-8");
					this.logger.debug(
						`Using ${promptType} system prompt for labels: ${labels.join(", ")}`,
					);

					// Extract and log version tag if present
					const promptVersion = this.extractVersionTag(promptContent);
					if (promptVersion) {
						this.logger.debug(
							`${promptType} system prompt version: ${promptVersion}`,
						);
					}

					return {
						prompt: promptContent,
						version: promptVersion,
						type: promptType,
					};
				} catch (error) {
					this.logger.error(
						`Failed to load ${promptType} prompt template:`,
						error,
					);
					return undefined;
				}
			}
		}

		return undefined;
	}

	/**
	 * Build simplified prompt for label-based workflows
	 * @param issue Full Linear issue
	 * @param repository Repository configuration
	 * @param attachmentManifest Optional attachment manifest
	 * @param guidance Optional agent guidance rules from Linear
	 * @returns Formatted prompt string
	 */
	private async buildLabelBasedPrompt(
		issue: Issue,
		repository: RepositoryConfig,
		attachmentManifest: string = "",
		guidance?: GuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		this.logger.debug(
			`buildLabelBasedPrompt called for issue ${issue.identifier}`,
		);

		try {
			// Load the label-based prompt template
			const __filename = fileURLToPath(import.meta.url);
			const __dirname = dirname(__filename);
			const templatePath = resolve(__dirname, "../label-prompt-template.md");

			this.logger.debug(`Loading label prompt template from: ${templatePath}`);
			const template = await readFile(templatePath, "utf-8");
			this.logger.debug(
				`Template loaded, length: ${template.length} characters`,
			);

			// Extract and log version tag if present
			const templateVersion = this.extractVersionTag(template);
			if (templateVersion) {
				this.logger.debug(`Label prompt template version: ${templateVersion}`);
			}

			// Determine the base branch considering parent issues
			const baseBranch = await this.determineBaseBranch(issue, repository);

			// Fetch assignee information
			let assigneeId = "";
			let assigneeName = "";
			try {
				if (issue.assigneeId) {
					assigneeId = issue.assigneeId;
					// Fetch the full assignee object to get the name
					const assignee = await issue.assignee;
					if (assignee) {
						assigneeName = assignee.displayName || assignee.name || "";
					}
				}
			} catch (error) {
				this.logger.warn(`Failed to fetch assignee details:`, error);
			}

			// Get LinearClient for this repository
			const issueTracker = this.issueTrackers.get(repository.id);
			if (!issueTracker) {
				this.logger.error(
					`No IssueTrackerService found for repository ${repository.id}`,
				);
				throw new Error(
					`No IssueTrackerService found for repository ${repository.id}`,
				);
			}

			// Fetch workspace teams and labels
			let workspaceTeams = "";
			let workspaceLabels = "";
			try {
				this.logger.debug(
					`Fetching workspace teams and labels for repository ${repository.id}`,
				);

				// Fetch teams
				const teamsConnection = await issueTracker.fetchTeams();
				const teamsArray = [];
				for (const team of teamsConnection.nodes) {
					teamsArray.push({
						id: team.id,
						name: team.name,
						key: team.key,
						description: team.description || "",
						color: team.color,
					});
				}
				workspaceTeams = teamsArray
					.map(
						(team) =>
							`- ${team.name} (${team.key}): ${team.id}${team.description ? ` - ${team.description}` : ""}`,
					)
					.join("\n");

				// Fetch labels
				const labelsConnection = await issueTracker.fetchLabels();
				const labelsArray = [];
				for (const label of labelsConnection.nodes) {
					labelsArray.push({
						id: label.id,
						name: label.name,
						description: label.description || "",
						color: label.color,
					});
				}
				workspaceLabels = labelsArray
					.map(
						(label) =>
							`- ${label.name}: ${label.id}${label.description ? ` - ${label.description}` : ""}`,
					)
					.join("\n");

				this.logger.debug(
					`Fetched ${teamsArray.length} teams and ${labelsArray.length} labels`,
				);
			} catch (error) {
				this.logger.warn(`Failed to fetch workspace teams and labels:`, error);
			}

			// Generate routing context for orchestrator mode
			const routingContext = this.generateRoutingContext(repository);

			// Build the simplified prompt with only essential variables
			let prompt = template
				.replace(/{{repository_name}}/g, repository.name)
				.replace(/{{base_branch}}/g, baseBranch)
				.replace(/{{issue_id}}/g, issue.id || "")
				.replace(/{{issue_identifier}}/g, issue.identifier || "")
				.replace(/{{issue_title}}/g, issue.title || "")
				.replace(
					/{{issue_description}}/g,
					issue.description || "No description provided",
				)
				.replace(/{{issue_url}}/g, issue.url || "")
				.replace(/{{assignee_id}}/g, assigneeId)
				.replace(/{{assignee_name}}/g, assigneeName)
				.replace(/{{workspace_teams}}/g, workspaceTeams)
				.replace(/{{workspace_labels}}/g, workspaceLabels)
				// Replace routing context - if empty, also remove the preceding newlines
				.replace(
					routingContext ? /{{routing_context}}/g : /\n*{{routing_context}}/g,
					routingContext,
				);

			// Append agent guidance if present
			prompt += this.formatAgentGuidance(guidance);

			if (attachmentManifest) {
				this.logger.debug(
					`Adding attachment manifest to label-based prompt, length: ${attachmentManifest.length} characters`,
				);
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			this.logger.debug(
				`Label-based prompt built successfully, length: ${prompt.length} characters`,
			);
			return { prompt, version: templateVersion };
		} catch (error) {
			this.logger.error(`Error building label-based prompt:`, error);
			throw error;
		}
	}

	/**
	 * Generate routing context for orchestrator mode
	 *
	 * This provides the orchestrator with information about available repositories
	 * and how to route sub-issues to them. The context includes:
	 * - List of configured repositories in the workspace
	 * - Routing rules for each repository (labels, teams, projects)
	 * - Instructions on using description tags for explicit routing
	 *
	 * @param currentRepository The repository handling the current orchestrator issue
	 * @returns XML-formatted routing context string, or empty string if no routing info available
	 */
	private generateRoutingContext(currentRepository: RepositoryConfig): string {
		// Get all repositories in the same workspace
		const workspaceRepos = Array.from(this.repositories.values()).filter(
			(repo) =>
				repo.linearWorkspaceId === currentRepository.linearWorkspaceId &&
				repo.isActive !== false,
		);

		// If there's only one repository, no routing context needed
		if (workspaceRepos.length <= 1) {
			return "";
		}

		const repoDescriptions = workspaceRepos.map((repo) => {
			const routingMethods: string[] = [];

			// Description tag routing (always available)
			const repoIdentifier = repo.githubUrl
				? repo.githubUrl.replace("https://github.com/", "")
				: repo.name;
			routingMethods.push(
				`    - Description tag: Add \`[repo=${repoIdentifier}]\` to sub-issue description`,
			);

			// Label-based routing
			if (repo.routingLabels && repo.routingLabels.length > 0) {
				routingMethods.push(
					`    - Routing labels: ${repo.routingLabels.map((l) => `"${l}"`).join(", ")}`,
				);
			}

			// Team-based routing
			if (repo.teamKeys && repo.teamKeys.length > 0) {
				routingMethods.push(
					`    - Team keys: ${repo.teamKeys.map((t) => `"${t}"`).join(", ")} (create issue in this team)`,
				);
			}

			// Project-based routing
			if (repo.projectKeys && repo.projectKeys.length > 0) {
				routingMethods.push(
					`    - Project keys: ${repo.projectKeys.map((p) => `"${p}"`).join(", ")} (add issue to this project)`,
				);
			}

			const currentMarker =
				repo.id === currentRepository.id ? " (current)" : "";

			return `  <repository name="${repo.name}"${currentMarker}>
    <github_url>${repo.githubUrl || "N/A"}</github_url>
    <routing_methods>
${routingMethods.join("\n")}
    </routing_methods>
  </repository>`;
		});

		return `<repository_routing_context>
<description>
When creating sub-issues that should be handled in a DIFFERENT repository, use one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=org/repo-name]\` or \`[repo=repo-name]\` to the sub-issue description. This is the most explicit and reliable method.
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.
</description>

<available_repositories>
${repoDescriptions.join("\n")}
</available_repositories>
</repository_routing_context>`;
	}

	/**
	 * Build prompt for mention-triggered sessions
	 * @param issue Full Linear issue object
	 * @param repository Repository configuration
	 * @param agentSession The agent session containing the mention
	 * @param attachmentManifest Optional attachment manifest to append
	 * @param guidance Optional agent guidance rules from Linear
	 * @returns The constructed prompt and optional version tag
	 */
	private async buildMentionPrompt(
		issue: Issue,
		agentSession: WebhookAgentSession,
		attachmentManifest: string = "",
		guidance?: GuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		try {
			this.logger.debug(
				`Building mention prompt for issue ${issue.identifier}`,
			);

			// Get the mention comment metadata
			const mentionContent = agentSession.comment?.body || "";
			const authorName =
				agentSession.creator?.name || agentSession.creator?.id || "Unknown";
			const timestamp = agentSession.createdAt || new Date().toISOString();

			// Build a focused prompt with comment metadata
			let prompt = `You were mentioned in a Linear comment on this issue:

<linear_issue>
  <id>${issue.id}</id>
  <identifier>${issue.identifier}</identifier>
  <title>${issue.title}</title>
  <url>${issue.url}</url>
</linear_issue>

<mention_comment>
  <author>${authorName}</author>
  <timestamp>${timestamp}</timestamp>
  <content>
${mentionContent}
  </content>
</mention_comment>

Focus on addressing the specific request in the mention. You can use the Linear MCP tools to fetch additional context if needed.`;

			// Append agent guidance if present
			prompt += this.formatAgentGuidance(guidance);

			// Append attachment manifest if any
			if (attachmentManifest) {
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			return { prompt };
		} catch (error) {
			this.logger.error(`Error building mention prompt:`, error);
			throw error;
		}
	}

	/**
	 * Extract version tag from template content
	 * @param templateContent The template content to parse
	 * @returns The version value if found, undefined otherwise
	 */
	private extractVersionTag(templateContent: string): string | undefined {
		// Match the version tag pattern: <version-tag value="..." />
		const versionTagMatch = templateContent.match(
			/<version-tag\s+value="([^"]*)"\s*\/>/i,
		);
		const version = versionTagMatch ? versionTagMatch[1] : undefined;
		// Return undefined for empty strings
		return version?.trim() ? version : undefined;
	}

	/**
	 * Format agent guidance rules as markdown for injection into prompts
	 * @param guidance Array of guidance rules from Linear
	 * @returns Formatted markdown string with guidance, or empty string if no guidance
	 */
	private formatAgentGuidance(guidance?: GuidanceRule[]): string {
		if (!guidance || guidance.length === 0) {
			return "";
		}

		let formatted =
			"\n\n<agent_guidance>\nThe following guidance has been configured for this workspace/team in Linear. Team-specific guidance takes precedence over workspace-level guidance.\n";

		for (const rule of guidance) {
			let origin = "Global";
			if (rule.origin) {
				if (rule.origin.__typename === "TeamOriginWebhookPayload") {
					origin = `Team (${rule.origin.team.displayName})`;
				} else {
					origin = "Organization";
				}
			}
			formatted += `\n## Guidance from ${origin}\n${rule.body}\n`;
		}

		formatted += "\n</agent_guidance>";
		return formatted;
	}

	/**
	 * Determine the base branch for an issue, considering parent issues and blocked-by relationships
	 *
	 * Priority order:
	 * 1. If issue has graphite label AND has a "blocked by" relationship, use the blocking issue's branch
	 *    (This enables Graphite stacking where each sub-issue branches off the previous)
	 * 2. If issue has a parent, use the parent's branch
	 * 3. Fall back to repository's default base branch
	 */
	private async determineBaseBranch(
		issue: Issue,
		repository: RepositoryConfig,
	): Promise<string> {
		// Start with the repository's default base branch
		let baseBranch = repository.baseBranch;

		// Check if this issue has the graphite label - if so, blocked-by relationship takes priority
		const isGraphiteIssue = await this.hasGraphiteLabel(issue, repository);

		if (isGraphiteIssue) {
			// For Graphite stacking: use the blocking issue's branch as base
			const blockingIssues = await this.fetchBlockingIssues(issue);

			if (blockingIssues.length > 0) {
				// Use the first blocking issue's branch (typically there's only one in a stack)
				const blockingIssue = blockingIssues[0]!;
				this.logger.debug(
					`Issue ${issue.identifier} has graphite label and is blocked by ${blockingIssue.identifier}`,
				);

				// Get blocking issue's branch name
				const blockingRawBranchName =
					blockingIssue.branchName ||
					`${blockingIssue.identifier}-${(blockingIssue.title ?? "")
						.toLowerCase()
						.replace(/\s+/g, "-")
						.substring(0, 30)}`;
				const blockingBranchName = this.gitService.sanitizeBranchName(
					blockingRawBranchName,
				);

				// Check if blocking issue's branch exists
				const blockingBranchExists = await this.gitService.branchExists(
					blockingBranchName,
					repository.repositoryPath,
				);

				if (blockingBranchExists) {
					baseBranch = blockingBranchName;
					this.logger.debug(
						`Using blocking issue branch '${blockingBranchName}' as base for Graphite-stacked issue ${issue.identifier}`,
					);
					return baseBranch;
				}
				this.logger.debug(
					`Blocking issue branch '${blockingBranchName}' not found, falling back to parent/default`,
				);
			}
		}

		// Check if issue has a parent (standard sub-issue behavior)
		try {
			const parent = await issue.parent;
			if (parent) {
				this.logger.debug(
					`Issue ${issue.identifier} has parent: ${parent.identifier}`,
				);

				// Get parent's branch name
				const parentRawBranchName =
					parent.branchName ||
					`${parent.identifier}-${parent.title
						?.toLowerCase()
						.replace(/\s+/g, "-")
						.substring(0, 30)}`;
				const parentBranchName =
					this.gitService.sanitizeBranchName(parentRawBranchName);

				// Check if parent branch exists
				const parentBranchExists = await this.gitService.branchExists(
					parentBranchName,
					repository.repositoryPath,
				);

				if (parentBranchExists) {
					baseBranch = parentBranchName;
					this.logger.debug(
						`Using parent issue branch '${parentBranchName}' as base for sub-issue ${issue.identifier}`,
					);
				} else {
					this.logger.debug(
						`Parent branch '${parentBranchName}' not found, using default base branch '${repository.baseBranch}'`,
					);
				}
			}
		} catch (_error) {
			// Parent field might not exist or couldn't be fetched, use default base branch
			this.logger.debug(
				`No parent issue found for ${issue.identifier}, using default base branch '${repository.baseBranch}'`,
			);
		}

		return baseBranch;
	}

	/**
	 * Convert full Linear SDK issue to CoreIssue interface for Session creation
	 */
	private convertLinearIssueToCore(issue: Issue): IssueMinimal {
		return {
			id: issue.id,
			identifier: issue.identifier,
			title: issue.title || "",
			description: issue.description || undefined,
			branchName: issue.branchName, // Use the real branchName property!
		};
	}

	/**
	 * Fetch issues that block this issue (i.e., issues this one is "blocked by")
	 * Uses the inverseRelations field with type "blocks"
	 *
	 * Linear relations work like this:
	 * - When Issue A "blocks" Issue B, a relation is created with:
	 *   - issue = A (the blocker)
	 *   - relatedIssue = B (the blocked one)
	 *   - type = "blocks"
	 *
	 * So to find "who blocks Issue B", we need inverseRelations (where B is the relatedIssue)
	 * and look for type === "blocks", then get the `issue` field (the blocker).
	 *
	 * @param issue The issue to fetch blocking issues for
	 * @returns Array of issues that block this one, or empty array if none
	 */
	private async fetchBlockingIssues(issue: Issue): Promise<Issue[]> {
		try {
			// inverseRelations contains relations where THIS issue is the relatedIssue
			// When type is "blocks", it means the `issue` field blocks THIS issue
			const inverseRelations = await issue.inverseRelations();
			if (!inverseRelations?.nodes) {
				return [];
			}

			const blockingIssues: Issue[] = [];

			for (const relation of inverseRelations.nodes) {
				// "blocks" type in inverseRelations means the `issue` blocks this one
				if (relation.type === "blocks") {
					// The `issue` field is the one that blocks THIS issue
					const blockingIssue = await relation.issue;
					if (blockingIssue) {
						blockingIssues.push(blockingIssue);
					}
				}
			}

			this.logger.debug(
				`Issue ${issue.identifier} is blocked by ${blockingIssues.length} issue(s): ${blockingIssues.map((i) => i.identifier).join(", ") || "none"}`,
			);

			return blockingIssues;
		} catch (error) {
			this.logger.error(
				`Failed to fetch blocking issues for ${issue.identifier}:`,
				error,
			);
			return [];
		}
	}

	/**
	 * Check if an issue has the graphite label
	 *
	 * @param issue The issue to check
	 * @param repository The repository configuration
	 * @returns True if the issue has the graphite label
	 */
	private async hasGraphiteLabel(
		issue: Issue,
		repository: RepositoryConfig,
	): Promise<boolean> {
		const graphiteConfig = repository.labelPrompts?.graphite;
		const graphiteLabels = Array.isArray(graphiteConfig)
			? graphiteConfig
			: (graphiteConfig?.labels ?? ["graphite"]);

		const issueLabels = await this.fetchIssueLabels(issue);
		return graphiteLabels.some((label: string) => issueLabels.includes(label));
	}

	/**
	 * Format Linear comments into a threaded structure that mirrors the Linear UI
	 * @param comments Array of Linear comments
	 * @returns Formatted string showing comment threads
	 */
	private async formatCommentThreads(comments: Comment[]): Promise<string> {
		if (comments.length === 0) {
			return "No comments yet.";
		}

		// Group comments by thread (root comments and their replies)
		const threads = new Map<string, { root: Comment; replies: Comment[] }>();
		const rootComments: Comment[] = [];

		// First pass: identify root comments and create thread structure
		for (const comment of comments) {
			const parent = await comment.parent;
			if (!parent) {
				// This is a root comment
				rootComments.push(comment);
				threads.set(comment.id, { root: comment, replies: [] });
			}
		}

		// Second pass: assign replies to their threads
		for (const comment of comments) {
			const parent = await comment.parent;
			if (parent?.id) {
				const thread = threads.get(parent.id);
				if (thread) {
					thread.replies.push(comment);
				}
			}
		}

		// Format threads in chronological order
		const formattedThreads: string[] = [];

		for (const rootComment of rootComments) {
			const thread = threads.get(rootComment.id);
			if (!thread) continue;

			// Format root comment
			const rootUser = await rootComment.user;
			const rootAuthor =
				rootUser?.displayName || rootUser?.name || rootUser?.email || "Unknown";
			const rootTime = new Date(rootComment.createdAt).toLocaleString();

			let threadText = `<comment_thread>
	<root_comment>
		<author>@${rootAuthor}</author>
		<timestamp>${rootTime}</timestamp>
		<content>
${rootComment.body}
		</content>
	</root_comment>`;

			// Format replies if any
			if (thread.replies.length > 0) {
				threadText += "\n  <replies>";
				for (const reply of thread.replies) {
					const replyUser = await reply.user;
					const replyAuthor =
						replyUser?.displayName ||
						replyUser?.name ||
						replyUser?.email ||
						"Unknown";
					const replyTime = new Date(reply.createdAt).toLocaleString();

					threadText += `
		<reply>
			<author>@${replyAuthor}</author>
			<timestamp>${replyTime}</timestamp>
			<content>
${reply.body}
			</content>
		</reply>`;
				}
				threadText += "\n  </replies>";
			}

			threadText += "\n</comment_thread>";
			formattedThreads.push(threadText);
		}

		return formattedThreads.join("\n\n");
	}

	/**
	 * Build a prompt for Claude using the improved XML-style template
	 * @param issue Full Linear issue
	 * @param repository Repository configuration
	 * @param newComment Optional new comment to focus on (for handleNewRootComment)
	 * @param attachmentManifest Optional attachment manifest
	 * @param guidance Optional agent guidance rules from Linear
	 * @returns Formatted prompt string
	 */
	private async buildIssueContextPrompt(
		issue: Issue,
		repository: RepositoryConfig,
		newComment?: WebhookComment,
		attachmentManifest: string = "",
		guidance?: GuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		this.logger.debug(
			`buildIssueContextPrompt called for issue ${issue.identifier}${newComment ? " with new comment" : ""}`,
		);

		try {
			// Use custom template if provided (repository-specific)
			let templatePath = repository.promptTemplatePath;

			// If no custom template, use the standard issue assigned user prompt template
			if (!templatePath) {
				const __filename = fileURLToPath(import.meta.url);
				const __dirname = dirname(__filename);
				templatePath = resolve(
					__dirname,
					"../prompts/standard-issue-assigned-user-prompt.md",
				);
			}

			// Load the template
			this.logger.debug(`Loading prompt template from: ${templatePath}`);
			const template = await readFile(templatePath, "utf-8");
			this.logger.debug(
				`Template loaded, length: ${template.length} characters`,
			);

			// Extract and log version tag if present
			const templateVersion = this.extractVersionTag(template);
			if (templateVersion) {
				this.logger.debug(`Prompt template version: ${templateVersion}`);
			}

			// Get state name from Linear API
			const state = await issue.state;
			const stateName = state?.name || "Unknown";

			// Determine the base branch considering parent issues
			const baseBranch = await this.determineBaseBranch(issue, repository);

			// Get formatted comment threads
			const issueTracker = this.issueTrackers.get(repository.id);
			let commentThreads = "No comments yet.";

			if (issueTracker && issue.id) {
				try {
					this.logger.debug(`Fetching comments for issue ${issue.identifier}`);
					const comments = await issueTracker.fetchComments(issue.id);

					const commentNodes = comments.nodes;
					if (commentNodes.length > 0) {
						commentThreads = await this.formatCommentThreads(commentNodes);
						this.logger.debug(
							`Formatted ${commentNodes.length} comments into threads`,
						);
					}
				} catch (error) {
					this.logger.error("Failed to fetch comments:", error);
				}
			}

			// Build the prompt with all variables
			let prompt = template
				.replace(/{{repository_name}}/g, repository.name)
				.replace(/{{issue_id}}/g, issue.id || "")
				.replace(/{{issue_identifier}}/g, issue.identifier || "")
				.replace(/{{issue_title}}/g, issue.title || "")
				.replace(
					/{{issue_description}}/g,
					issue.description || "No description provided",
				)
				.replace(/{{issue_state}}/g, stateName)
				.replace(/{{issue_priority}}/g, issue.priority?.toString() || "None")
				.replace(/{{issue_url}}/g, issue.url || "")
				.replace(/{{comment_threads}}/g, commentThreads)
				.replace(
					/{{working_directory}}/g,
					this.config.handlers?.createWorkspace
						? "Will be created based on issue"
						: repository.repositoryPath,
				)
				.replace(/{{base_branch}}/g, baseBranch)
				.replace(
					/{{branch_name}}/g,
					this.gitService.sanitizeBranchName(issue.branchName),
				);

			// Handle the optional new comment section
			if (newComment) {
				// Replace the conditional block
				const newCommentSection = `<new_comment_to_address>
	<author>{{new_comment_author}}</author>
	<timestamp>{{new_comment_timestamp}}</timestamp>
	<content>
{{new_comment_content}}
	</content>
</new_comment_to_address>

IMPORTANT: Focus specifically on addressing the new comment above. This is a new request that requires your attention.`;

				prompt = prompt.replace(
					/{{#if new_comment}}[\s\S]*?{{\/if}}/g,
					newCommentSection,
				);

				// Now replace the new comment variables
				// We'll need to fetch the comment author
				let authorName = "Unknown";
				if (issueTracker) {
					try {
						const fullComment = await issueTracker.fetchComment(newComment.id);
						const user = await fullComment.user;
						authorName =
							user?.displayName || user?.name || user?.email || "Unknown";
					} catch (error) {
						this.logger.error("Failed to fetch comment author:", error);
					}
				}

				prompt = prompt
					.replace(/{{new_comment_author}}/g, authorName)
					.replace(/{{new_comment_timestamp}}/g, new Date().toLocaleString())
					.replace(/{{new_comment_content}}/g, newComment.body || "");
			} else {
				// Remove the new comment section entirely (including preceding newlines)
				prompt = prompt.replace(/\n*{{#if new_comment}}[\s\S]*?{{\/if}}/g, "");
			}

			// Append agent guidance if present
			prompt += this.formatAgentGuidance(guidance);

			// Append attachment manifest if provided
			if (attachmentManifest) {
				this.logger.debug(
					`Adding attachment manifest, length: ${attachmentManifest.length} characters`,
				);
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			// Append repository-specific instruction if provided
			if (repository.appendInstruction) {
				this.logger.debug(`Adding repository-specific instruction`);
				prompt = `${prompt}\n\n<repository-specific-instruction>\n${repository.appendInstruction}\n</repository-specific-instruction>`;
			}

			this.logger.debug(`Final prompt length: ${prompt.length} characters`);
			return { prompt, version: templateVersion };
		} catch (error) {
			this.logger.error("Failed to load prompt template:", error);

			// Fallback to simple prompt
			const state = await issue.state;
			const stateName = state?.name || "Unknown";

			// Determine the base branch considering parent issues
			const baseBranch = await this.determineBaseBranch(issue, repository);

			const fallbackPrompt = `Please help me with the following Linear issue:

Repository: ${repository.name}
Issue: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || "No description provided"}
State: ${stateName}
Priority: ${issue.priority?.toString() || "None"}
Branch: ${issue.branchName}

Working directory: ${repository.repositoryPath}
Base branch: ${baseBranch}

${newComment ? `New comment to address:\n${newComment.body}\n\n` : ""}Please analyze this issue and help implement a solution.`;

			return { prompt: fallbackPrompt, version: undefined };
		}
	}

	/**
	 * Get connection status by repository ID
	 */
	getConnectionStatus(): Map<string, boolean> {
		const status = new Map<string, boolean>();
		// Single event transport is "connected" if it exists
		if (this.linearEventTransport) {
			// Mark all repositories as connected since they share the single transport
			for (const repoId of this.repositories.keys()) {
				status.set(repoId, true);
			}
		}
		return status;
	}

	/**
	 * Get event transport (for testing purposes)
	 * @internal
	 */
	_getClientByToken(_token: string): any {
		// Return the single shared event transport
		return this.linearEventTransport;
	}

	/**
	 * Start OAuth flow using the shared application server
	 */
	async startOAuthFlow(proxyUrl?: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}> {
		const oauthProxyUrl = proxyUrl || this.config.proxyUrl || DEFAULT_PROXY_URL;
		return this.sharedApplicationServer.startOAuthFlow(oauthProxyUrl);
	}

	/**
	 * Get the server port
	 */
	getServerPort(): number {
		return this.config.serverPort || this.config.webhookPort || 3456;
	}

	/**
	 * Get the OAuth callback URL
	 */
	getOAuthCallbackUrl(): string {
		return this.sharedApplicationServer.getOAuthCallbackUrl();
	}

	/**
	 * Move issue to started state when assigned
	 * @param issue Full Linear issue object from Linear SDK
	 * @param repositoryId Repository ID for issue tracker lookup
	 */

	private async moveIssueToStartedState(
		issue: Issue,
		repositoryId: string,
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(repositoryId);
			if (!issueTracker) {
				this.logger.warn(
					`No issue tracker found for repository ${repositoryId}, skipping state update`,
				);
				return;
			}

			// Check if issue is already in a started state
			const currentState = await issue.state;
			if (currentState?.type === "started") {
				this.logger.debug(
					`Issue ${issue.identifier} is already in started state (${currentState.name})`,
				);
				return;
			}

			// Get team for the issue
			const team = await issue.team;
			if (!team) {
				this.logger.warn(
					`No team found for issue ${issue.identifier}, skipping state update`,
				);
				return;
			}

			// Get available workflow states for the issue's team
			const teamStates = await issueTracker.fetchWorkflowStates(team.id);

			const states = teamStates;

			// Find all states with type "started" and pick the one with lowest position
			// This ensures we pick "In Progress" over "In Review" when both have type "started"
			// Linear uses standardized state types: triage, backlog, unstarted, started, completed, canceled
			const startedStates = states.nodes.filter(
				(state) => state.type === "started",
			);
			const startedState = startedStates.sort(
				(a, b) => a.position - b.position,
			)[0];

			if (!startedState) {
				throw new Error(
					'Could not find a state with type "started" for this team',
				);
			}

			// Update the issue state
			this.logger.debug(
				`Moving issue ${issue.identifier} to started state: ${startedState.name}`,
			);
			if (!issue.id) {
				this.logger.warn(
					`Issue ${issue.identifier} has no ID, skipping state update`,
				);
				return;
			}

			await issueTracker.updateIssue(issue.id, {
				stateId: startedState.id,
			});

			this.logger.debug(
				`✅ Successfully moved issue ${issue.identifier} to ${startedState.name} state`,
			);
		} catch (error) {
			this.logger.error(
				`Failed to move issue ${issue.identifier} to started state:`,
				error,
			);
			// Don't throw - we don't want to fail the entire assignment process due to state update failure
		}
	}

	/**
	 * Post initial comment when assigned to issue
	 */
	// private async postInitialComment(issueId: string, repositoryId: string): Promise<void> {
	//   const body = "I'm getting started right away."
	//   // Get the issue tracker for this repository
	//   const issueTracker = this.issueTrackers.get(repositoryId)
	//   if (!issueTracker) {
	//     throw new Error(`No issue tracker found for repository ${repositoryId}`)
	//   }
	//   const commentData = {

	//     body
	//   }
	//   await issueTracker.createComment(commentData)
	// }

	/**
	 * Post a comment to Linear
	 */
	private async postComment(
		issueId: string,
		body: string,
		repositoryId: string,
		parentId?: string,
	): Promise<void> {
		// Get the issue tracker for this repository
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			throw new Error(`No issue tracker found for repository ${repositoryId}`);
		}
		const commentInput: { body: string; parentId?: string } = {
			body,
		};
		// Add parent ID if provided (for reply)
		if (parentId) {
			commentInput.parentId = parentId;
		}
		await issueTracker.createComment(issueId, commentInput);
	}

	/**
	 * Format todos as Linear checklist markdown
	 */
	// private formatTodosAsChecklist(todos: Array<{id: string, content: string, status: string, priority: string}>): string {
	//   return todos.map(todo => {
	//     const checkbox = todo.status === 'completed' ? '[x]' : '[ ]'
	//     const statusEmoji = todo.status === 'in_progress' ? ' 🔄' : ''
	//     return `- ${checkbox} ${todo.content}${statusEmoji}`
	//   }).join('\n')
	// }

	/**
	 * Extract attachment URLs from text (issue description or comment)
	 */
	private extractAttachmentUrls(text: string): string[] {
		if (!text) return [];

		// Match URLs that start with https://uploads.linear.app
		// Exclude brackets and parentheses to avoid capturing malformed markdown link syntax
		const regex = /https:\/\/uploads\.linear\.app\/[a-zA-Z0-9/_.-]+/gi;
		const matches = text.match(regex) || [];

		// Remove duplicates
		return [...new Set(matches)];
	}

	/**
	 * Download attachments from Linear issue
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 * @param workspacePath Path to workspace directory
	 */
	private async downloadIssueAttachments(
		issue: Issue,
		repository: RepositoryConfig,
		workspacePath: string,
	): Promise<{ manifest: string; attachmentsDir: string | null }> {
		// Create attachments directory in home directory
		const workspaceFolderName = basename(workspacePath);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);

		try {
			const attachmentMap: Record<string, string> = {};
			const imageMap: Record<string, string> = {};
			let attachmentCount = 0;
			let imageCount = 0;
			let skippedCount = 0;
			let failedCount = 0;
			const maxAttachments = 20;

			// Ensure directory exists
			await mkdir(attachmentsDir, { recursive: true });

			// Extract URLs from issue description
			const descriptionUrls = this.extractAttachmentUrls(
				issue.description || "",
			);

			// Extract URLs from comments if available
			const commentUrls: string[] = [];
			const issueTracker = this.issueTrackers.get(repository.id);

			// Fetch native Linear attachments (e.g., Sentry links)
			const nativeAttachments: Array<{ title: string; url: string }> = [];
			if (issueTracker && issue.id) {
				try {
					// Fetch native attachments using Linear SDK
					this.logger.debug(
						`Fetching native attachments for issue ${issue.identifier}`,
					);
					const attachments = await issue.attachments();
					if (attachments?.nodes) {
						for (const attachment of attachments.nodes) {
							nativeAttachments.push({
								title: attachment.title || "Untitled attachment",
								url: attachment.url,
							});
						}
						this.logger.debug(
							`Found ${nativeAttachments.length} native attachments`,
						);
					}
				} catch (error) {
					this.logger.error("Failed to fetch native attachments:", error);
				}

				try {
					const comments = await issueTracker.fetchComments(issue.id);
					const commentNodes = comments.nodes;
					for (const comment of commentNodes) {
						const urls = this.extractAttachmentUrls(comment.body);
						commentUrls.push(...urls);
					}
				} catch (error) {
					this.logger.error("Failed to fetch comments for attachments:", error);
				}
			}

			// Combine and deduplicate all URLs
			const allUrls = [...new Set([...descriptionUrls, ...commentUrls])];

			this.logger.debug(
				`Found ${allUrls.length} unique attachment URLs in issue ${issue.identifier}`,
			);

			if (allUrls.length > maxAttachments) {
				this.logger.warn(
					`Warning: Found ${allUrls.length} attachments but limiting to ${maxAttachments}. Skipping ${allUrls.length - maxAttachments} attachments.`,
				);
			}

			// Download attachments up to the limit
			for (const url of allUrls) {
				if (attachmentCount >= maxAttachments) {
					skippedCount++;
					continue;
				}

				// Generate a temporary filename
				const tempFilename = `attachment_${attachmentCount + 1}.tmp`;
				const tempPath = join(attachmentsDir, tempFilename);

				const result = await this.downloadAttachment(
					url,
					tempPath,
					repository.linearToken,
				);

				if (result.success) {
					// Determine the final filename based on type
					let finalFilename: string;
					if (result.isImage) {
						imageCount++;
						finalFilename = `image_${imageCount}${result.fileType || ".png"}`;
					} else {
						finalFilename = `attachment_${attachmentCount + 1}${result.fileType || ""}`;
					}

					const finalPath = join(attachmentsDir, finalFilename);

					// Rename the file to include the correct extension
					await rename(tempPath, finalPath);

					// Store in appropriate map
					if (result.isImage) {
						imageMap[url] = finalPath;
					} else {
						attachmentMap[url] = finalPath;
					}
					attachmentCount++;
				} else {
					failedCount++;
					this.logger.warn(`Failed to download attachment: ${url}`);
				}
			}

			// Generate attachment manifest
			const manifest = this.generateAttachmentManifest({
				attachmentMap,
				imageMap,
				totalFound: allUrls.length,
				downloaded: attachmentCount,
				imagesDownloaded: imageCount,
				skipped: skippedCount,
				failed: failedCount,
				nativeAttachments,
			});

			// Always return the attachments directory path (it's pre-created)
			return {
				manifest,
				attachmentsDir: attachmentsDir,
			};
		} catch (error) {
			this.logger.error("Error downloading attachments:", error);
			// Still return the attachments directory even on error
			return { manifest: "", attachmentsDir: attachmentsDir };
		}
	}

	/**
	 * Download a single attachment from Linear
	 */
	private async downloadAttachment(
		attachmentUrl: string,
		destinationPath: string,
		linearToken: string,
	): Promise<{ success: boolean; fileType?: string; isImage?: boolean }> {
		try {
			this.logger.debug(`Downloading attachment from: ${attachmentUrl}`);

			const response = await fetch(attachmentUrl, {
				headers: {
					Authorization: `Bearer ${linearToken}`,
				},
			});

			if (!response.ok) {
				this.logger.error(
					`Attachment download failed: ${response.status} ${response.statusText}`,
				);
				return { success: false };
			}

			const buffer = Buffer.from(await response.arrayBuffer());

			// Detect the file type from the buffer
			const fileType = await fileTypeFromBuffer(buffer);
			let detectedExtension: string | undefined;
			let isImage = false;

			if (fileType) {
				detectedExtension = `.${fileType.ext}`;
				isImage = fileType.mime.startsWith("image/");
				this.logger.debug(
					`Detected file type: ${fileType.mime} (${fileType.ext}), is image: ${isImage}`,
				);
			} else {
				// Try to get extension from URL
				const urlPath = new URL(attachmentUrl).pathname;
				const urlExt = extname(urlPath);
				if (urlExt) {
					detectedExtension = urlExt;
					this.logger.debug(`Using extension from URL: ${detectedExtension}`);
				}
			}

			// Write the attachment to disk
			await writeFile(destinationPath, buffer);

			this.logger.debug(
				`Successfully downloaded attachment to: ${destinationPath}`,
			);
			return { success: true, fileType: detectedExtension, isImage };
		} catch (error) {
			this.logger.error(`Error downloading attachment:`, error);
			return { success: false };
		}
	}

	/**
	 * Download attachments from a specific comment
	 * @param commentBody The body text of the comment
	 * @param attachmentsDir Directory where attachments should be saved
	 * @param linearToken Linear API token
	 * @param existingAttachmentCount Current number of attachments already downloaded
	 */
	private async downloadCommentAttachments(
		commentBody: string,
		attachmentsDir: string,
		linearToken: string,
		existingAttachmentCount: number,
	): Promise<{
		newAttachmentMap: Record<string, string>;
		newImageMap: Record<string, string>;
		totalNewAttachments: number;
		failedCount: number;
	}> {
		const newAttachmentMap: Record<string, string> = {};
		const newImageMap: Record<string, string> = {};
		let newAttachmentCount = 0;
		let newImageCount = 0;
		let failedCount = 0;
		const maxAttachments = 20;

		// Extract URLs from the comment
		const urls = this.extractAttachmentUrls(commentBody);

		if (urls.length === 0) {
			return {
				newAttachmentMap,
				newImageMap,
				totalNewAttachments: 0,
				failedCount: 0,
			};
		}

		this.logger.debug(`Found ${urls.length} attachment URLs in new comment`);

		// Download new attachments
		for (const url of urls) {
			// Skip if we've already reached the total attachment limit
			if (existingAttachmentCount + newAttachmentCount >= maxAttachments) {
				this.logger.warn(
					`Skipping attachment due to ${maxAttachments} total attachment limit`,
				);
				break;
			}

			// Generate filename based on total attachment count
			const attachmentNumber = existingAttachmentCount + newAttachmentCount + 1;
			const tempFilename = `attachment_${attachmentNumber}.tmp`;
			const tempPath = join(attachmentsDir, tempFilename);

			const result = await this.downloadAttachment(url, tempPath, linearToken);

			if (result.success) {
				// Determine the final filename based on type
				let finalFilename: string;
				if (result.isImage) {
					newImageCount++;
					// Count existing images to get correct numbering
					const existingImageCount =
						await this.countExistingImages(attachmentsDir);
					finalFilename = `image_${existingImageCount + newImageCount}${result.fileType || ".png"}`;
				} else {
					finalFilename = `attachment_${attachmentNumber}${result.fileType || ""}`;
				}

				const finalPath = join(attachmentsDir, finalFilename);

				// Rename the file to include the correct extension
				await rename(tempPath, finalPath);

				// Store in appropriate map
				if (result.isImage) {
					newImageMap[url] = finalPath;
				} else {
					newAttachmentMap[url] = finalPath;
				}
				newAttachmentCount++;
			} else {
				failedCount++;
				this.logger.warn(`Failed to download attachment: ${url}`);
			}
		}

		return {
			newAttachmentMap,
			newImageMap,
			totalNewAttachments: newAttachmentCount,
			failedCount,
		};
	}

	/**
	 * Count existing images in the attachments directory
	 */
	private async countExistingImages(attachmentsDir: string): Promise<number> {
		try {
			const files = await readdir(attachmentsDir);
			return files.filter((file) => file.startsWith("image_")).length;
		} catch {
			return 0;
		}
	}

	/**
	 * Generate attachment manifest for new comment attachments
	 */
	private generateNewAttachmentManifest(result: {
		newAttachmentMap: Record<string, string>;
		newImageMap: Record<string, string>;
		totalNewAttachments: number;
		failedCount: number;
	}): string {
		const { newAttachmentMap, newImageMap, totalNewAttachments, failedCount } =
			result;

		if (totalNewAttachments === 0) {
			return "";
		}

		let manifest = "\n## New Attachments from Comment\n\n";

		manifest += `Downloaded ${totalNewAttachments} new attachment${totalNewAttachments > 1 ? "s" : ""}`;
		if (failedCount > 0) {
			manifest += ` (${failedCount} failed)`;
		}
		manifest += ".\n\n";

		// List new images
		if (Object.keys(newImageMap).length > 0) {
			manifest += "### New Images\n";
			Object.entries(newImageMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these images.\n\n";
		}

		// List new other attachments
		if (Object.keys(newAttachmentMap).length > 0) {
			manifest += "### New Attachments\n";
			Object.entries(newAttachmentMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these files.\n\n";
		}

		return manifest;
	}

	/**
	 * Generate a markdown section describing downloaded attachments
	 */
	private generateAttachmentManifest(downloadResult: {
		attachmentMap: Record<string, string>;
		imageMap: Record<string, string>;
		totalFound: number;
		downloaded: number;
		imagesDownloaded: number;
		skipped: number;
		failed: number;
		nativeAttachments?: Array<{ title: string; url: string }>;
	}): string {
		const {
			attachmentMap,
			imageMap,
			totalFound,
			downloaded,
			imagesDownloaded,
			skipped,
			failed,
			nativeAttachments = [],
		} = downloadResult;

		let manifest = "\n## Downloaded Attachments\n\n";

		// Add native Linear attachments section if available
		if (nativeAttachments.length > 0) {
			manifest += "### Linear Issue Links\n";
			nativeAttachments.forEach((attachment, index) => {
				manifest += `${index + 1}. ${attachment.title}\n`;
				manifest += `   URL: ${attachment.url}\n\n`;
			});
		}

		if (totalFound === 0 && nativeAttachments.length === 0) {
			manifest += "No attachments were found in this issue.\n\n";
			manifest +=
				"The attachments directory `~/.cyrus/<workspace>/attachments` has been created and is available for any future attachments that may be added to this issue.\n";
			return manifest;
		}

		manifest += `Found ${totalFound} attachments. Downloaded ${downloaded}`;
		if (imagesDownloaded > 0) {
			manifest += ` (including ${imagesDownloaded} images)`;
		}
		if (skipped > 0) {
			manifest += `, skipped ${skipped} due to ${downloaded} attachment limit`;
		}
		if (failed > 0) {
			manifest += `, failed to download ${failed}`;
		}
		manifest += ".\n\n";

		if (failed > 0) {
			manifest +=
				"**Note**: Some attachments failed to download. This may be due to authentication issues or the files being unavailable. The agent will continue processing the issue with the available information.\n\n";
		}

		manifest +=
			"Attachments have been downloaded to the `~/.cyrus/<workspace>/attachments` directory:\n\n";

		// List images first
		if (Object.keys(imageMap).length > 0) {
			manifest += "### Images\n";
			Object.entries(imageMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these images.\n\n";
		}

		// List other attachments
		if (Object.keys(attachmentMap).length > 0) {
			manifest += "### Other Attachments\n";
			Object.entries(attachmentMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these files.\n\n";
		}

		return manifest;
	}

	/**
	 * Build MCP configuration with automatic Linear server injection and inline cyrus tools
	 */
	private buildMcpConfig(
		repository: RepositoryConfig,
		parentSessionId?: string,
	): Record<string, McpServerConfig> {
		// Always inject the Linear MCP servers with the repository's token
		// https://linear.app/docs/mcp
		const mcpConfig: Record<string, McpServerConfig> = {
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: {
					Authorization: `Bearer ${repository.linearToken}`,
				},
			},
			"cyrus-tools": createCyrusToolsServer(repository.linearToken, {
				parentSessionId,
				onSessionCreated: (childSessionId, parentId) => {
					this.logger.debug(
						`Agent session created: ${childSessionId}, mapping to parent ${parentId}`,
					);
					// Map child to parent session
					this.globalSessionRegistry.setParentSession(childSessionId, parentId);
					this.logger.debug(
						`Parent-child mapping updated via GlobalSessionRegistry`,
					);
				},
				onFeedbackDelivery: async (childSessionId, message) => {
					this.logger.debug(
						`Processing feedback delivery to child session ${childSessionId}`,
					);

					// Find the parent session ID for context
					const parentSessionId =
						this.globalSessionRegistry.getParentSessionId(childSessionId);

					// Find the repository containing the child session
					// We need to search all repositories for this child session
					let childRepo: RepositoryConfig | undefined;
					let childAgentSessionManager: AgentSessionManager | undefined;

					for (const [repoId, manager] of this.agentSessionManagers) {
						if (manager.hasAgentRunner(childSessionId)) {
							childRepo = this.repositories.get(repoId);
							childAgentSessionManager = manager;
							break;
						}
					}

					if (!childRepo || !childAgentSessionManager) {
						this.logger.error(
							`Child session ${childSessionId} not found in any repository`,
						);
						return false;
					}

					// Get the child session
					const childSession =
						childAgentSessionManager.getSession(childSessionId);
					if (!childSession) {
						this.logger.error(`Child session ${childSessionId} not found`);
						return false;
					}

					this.logger.debug(
						`Found child session - Issue: ${childSession.issueId}`,
					);

					// Get parent session info for better context in the thought
					let parentIssueId: string | undefined;
					if (parentSessionId) {
						// Find parent session across all repositories
						for (const manager of this.agentSessionManagers.values()) {
							const parentSession = manager.getSession(parentSessionId);
							if (parentSession) {
								parentIssueId =
									parentSession.issue?.identifier || parentSession.issueId;
								break;
							}
						}
					}

					// Post thought showing feedback receipt
					const issueTracker = this.issueTrackers.get(childRepo.id);
					if (issueTracker) {
						const feedbackThought = parentIssueId
							? `Received feedback from orchestrator (${parentIssueId}):\n\n---\n\n${message}\n\n---`
							: `Received feedback from orchestrator:\n\n---\n\n${message}\n\n---`;

						await this.postActivityDirect(
							issueTracker,
							{
								agentSessionId: childSessionId,
								content: { type: "thought", body: feedbackThought },
							},
							"feedback receipt",
						);
					}

					// Format the feedback as a prompt for the child session with enhanced markdown formatting
					const feedbackPrompt = `## Received feedback from orchestrator\n\n---\n\n${message}\n\n---`;

					// Use centralized streaming check and routing logic
					// Important: We don't await the full session completion to avoid timeouts.
					// The feedback is delivered immediately when the session starts, so we can
					// return success right away while the session continues in the background.
					this.logger.debug(
						`Handling feedback delivery to child session ${childSessionId}`,
					);

					this.handlePromptWithStreamingCheck(
						childSession,
						childRepo,
						childSessionId,
						childAgentSessionManager,
						feedbackPrompt,
						"", // No attachment manifest for feedback
						false, // Not a new session
						[], // No additional allowed directories for feedback
						"give feedback to child",
					)
						.then(() => {
							this.logger.debug(
								`Child session ${childSessionId} completed processing feedback`,
							);
						})
						.catch((error) => {
							this.logger.error(
								`Failed to process feedback in child session:`,
								error,
							);
						});

					// Return success immediately after initiating the handling
					this.logger.debug(
						`Feedback delivered successfully to child session ${childSessionId}`,
					);
					return true;
				},
			}),
		};

		// Add OpenAI-based MCP servers if API key is configured
		if (repository.openaiApiKey) {
			// Sora video generation tools
			mcpConfig["sora-tools"] = createSoraToolsServer({
				apiKey: repository.openaiApiKey,
				outputDirectory: repository.openaiOutputDirectory,
			});

			// GPT Image generation tools
			mcpConfig["image-tools"] = createImageToolsServer({
				apiKey: repository.openaiApiKey,
				outputDirectory: repository.openaiOutputDirectory,
			});

			this.logger.debug(
				`Configured OpenAI MCP servers (Sora + GPT Image) for repository: ${repository.name}`,
			);
		}

		return mcpConfig;
	}

	/**
	 * Resolve tool preset names to actual tool lists
	 */
	private resolveToolPreset(preset: string | string[]): string[] {
		if (Array.isArray(preset)) {
			return preset;
		}

		switch (preset) {
			case "readOnly":
				return getReadOnlyTools();
			case "safe":
				return getSafeTools();
			case "all":
				return getAllTools();
			case "coordinator":
				return getCoordinatorTools();
			default:
				// If it's a string but not a preset, treat it as a single tool
				return [preset];
		}
	}

	/**
	 * Build the complete prompt for a session - shows full prompt assembly in one place
	 *
	 * New session prompt structure:
	 * 1. Issue context (from buildIssueContextPrompt)
	 * 2. Initial subroutine prompt (if procedure initialized)
	 * 3. User comment
	 *
	 * Existing session prompt structure:
	 * 1. User comment
	 * 2. Attachment manifest (if present)
	 */
	private async buildSessionPrompt(
		isNewSession: boolean,
		session: CyrusAgentSession,
		fullIssue: Issue,
		repository: RepositoryConfig,
		promptBody: string,
		attachmentManifest?: string,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<string> {
		// Fetch labels for system prompt determination
		const labels = await this.fetchIssueLabels(fullIssue);

		// Create input for unified prompt assembly
		const input: PromptAssemblyInput = {
			session,
			fullIssue,
			repository,
			userComment: promptBody,
			commentAuthor,
			commentTimestamp,
			attachmentManifest,
			isNewSession,
			isStreaming: false, // This path is only for non-streaming prompts
			labels,
		};

		// Use unified prompt assembly
		const assembly = await this.assemblePrompt(input);

		// Log metadata for debugging
		this.logger.debug(
			`Built prompt - components: ${assembly.metadata.components.join(", ")}, type: ${assembly.metadata.promptType}`,
		);

		return assembly.userPrompt;
	}

	/**
	 * Assemble a complete prompt - unified entry point for all prompt building
	 * This method contains all prompt assembly logic in one place
	 */
	private async assemblePrompt(
		input: PromptAssemblyInput,
	): Promise<PromptAssembly> {
		// If actively streaming, just pass through the comment
		if (input.isStreaming) {
			return this.buildStreamingPrompt(input);
		}

		// If new session, build full prompt with all components
		if (input.isNewSession) {
			return this.buildNewSessionPrompt(input);
		}

		// Existing session continuation - just user comment + attachments
		return this.buildContinuationPrompt(input);
	}

	/**
	 * Build prompt for actively streaming session - pass through user comment as-is
	 */
	private buildStreamingPrompt(input: PromptAssemblyInput): PromptAssembly {
		const components: PromptComponent[] = ["user-comment"];
		if (input.attachmentManifest) {
			components.push("attachment-manifest");
		}

		const parts: string[] = [input.userComment];
		if (input.attachmentManifest) {
			parts.push(input.attachmentManifest);
		}

		return {
			systemPrompt: undefined,
			userPrompt: parts.join("\n\n"),
			metadata: {
				components,
				promptType: "continuation",
				isNewSession: false,
				isStreaming: true,
			},
		};
	}

	/**
	 * Build prompt for new session - includes issue context, subroutine prompt, and user comment
	 */
	private async buildNewSessionPrompt(
		input: PromptAssemblyInput,
	): Promise<PromptAssembly> {
		const components: PromptComponent[] = [];
		const parts: string[] = [];

		// 1. Determine system prompt from labels
		// Only for delegation (not mentions) or when /label-based-prompt is requested
		let labelBasedSystemPrompt: string | undefined;
		if (!input.isMentionTriggered || input.isLabelBasedPromptRequested) {
			labelBasedSystemPrompt = await this.determineSystemPromptForAssembly(
				input.labels || [],
				input.repository,
			);
		}

		// 2. Determine system prompt based on prompt type
		// Label-based: Use only the label-based system prompt
		// Fallback: Use scenarios system prompt (shared instructions)
		let systemPrompt: string;
		if (labelBasedSystemPrompt) {
			// Use label-based system prompt as-is (no shared instructions)
			systemPrompt = labelBasedSystemPrompt;
		} else {
			// Use scenarios system prompt for fallback cases
			const sharedInstructions = await this.loadSharedInstructions();
			systemPrompt = sharedInstructions;
		}

		// 3. Build issue context using appropriate builder
		// Use label-based prompt ONLY if we have a label-based system prompt
		const promptType = this.determinePromptType(
			input,
			!!labelBasedSystemPrompt,
		);
		const issueContext = await this.buildIssueContextForPromptAssembly(
			input.fullIssue,
			input.repository,
			promptType,
			input.attachmentManifest,
			input.guidance,
			input.agentSession,
		);

		parts.push(issueContext.prompt);
		components.push("issue-context");

		// 4. Load and append initial subroutine prompt
		const currentSubroutine = this.procedureAnalyzer.getCurrentSubroutine(
			input.session,
		);
		let subroutineName: string | undefined;
		if (currentSubroutine) {
			const subroutinePrompt = await this.loadSubroutinePrompt(
				currentSubroutine,
				this.config.linearWorkspaceSlug,
			);
			if (subroutinePrompt) {
				parts.push(subroutinePrompt);
				components.push("subroutine-prompt");
				subroutineName = currentSubroutine.name;
			}
		}

		// 5. Add user comment (if present)
		// Skip for mention-triggered prompts since the comment is already in the mention block
		if (input.userComment.trim() && !input.isMentionTriggered) {
			// If we have author/timestamp metadata, include it for multi-player context
			if (input.commentAuthor || input.commentTimestamp) {
				const author = input.commentAuthor || "Unknown";
				const timestamp = input.commentTimestamp || new Date().toISOString();
				parts.push(`<user_comment>
  <author>${author}</author>
  <timestamp>${timestamp}</timestamp>
  <content>
${input.userComment}
  </content>
</user_comment>`);
			} else {
				// Legacy format without metadata
				parts.push(`<user_comment>\n${input.userComment}\n</user_comment>`);
			}
			components.push("user-comment");
		}

		// 6. Add guidance rules (if present)
		if (input.guidance && input.guidance.length > 0) {
			components.push("guidance-rules");
		}

		return {
			systemPrompt,
			userPrompt: parts.join("\n\n"),
			metadata: {
				components,
				subroutineName,
				promptType,
				isNewSession: true,
				isStreaming: false,
			},
		};
	}

	/**
	 * Build prompt for existing session continuation - user comment and attachments only
	 */
	private buildContinuationPrompt(input: PromptAssemblyInput): PromptAssembly {
		const components: PromptComponent[] = ["user-comment"];
		if (input.attachmentManifest) {
			components.push("attachment-manifest");
		}

		// Wrap comment in XML with author and timestamp for multi-player context
		const author = input.commentAuthor || "Unknown";
		const timestamp = input.commentTimestamp || new Date().toISOString();

		const commentXml = `<new_comment>
  <author>${author}</author>
  <timestamp>${timestamp}</timestamp>
  <content>
${input.userComment}
  </content>
</new_comment>`;

		const parts: string[] = [commentXml];
		if (input.attachmentManifest) {
			parts.push(input.attachmentManifest);
		}

		return {
			systemPrompt: undefined,
			userPrompt: parts.join("\n\n"),
			metadata: {
				components,
				promptType: "continuation",
				isNewSession: false,
				isStreaming: false,
			},
		};
	}

	/**
	 * Determine the prompt type based on input flags and system prompt availability
	 */
	private determinePromptType(
		input: PromptAssemblyInput,
		hasSystemPrompt: boolean,
	): PromptType {
		if (input.isMentionTriggered && input.isLabelBasedPromptRequested) {
			return "label-based-prompt-command";
		}
		if (input.isMentionTriggered) {
			return "mention";
		}
		if (hasSystemPrompt) {
			return "label-based";
		}
		return "fallback";
	}

	/**
	 * Load a subroutine prompt file
	 * Extracted helper to make prompt assembly more readable
	 */
	private async loadSubroutinePrompt(
		subroutine: SubroutineDefinition,
		workspaceSlug?: string,
	): Promise<string | null> {
		// Skip loading for "primary" - it's a placeholder that doesn't have a file
		if (subroutine.promptPath === "primary") {
			return null;
		}

		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const subroutinePromptPath = join(
			__dirname,
			"prompts",
			subroutine.promptPath,
		);

		try {
			let prompt = await readFile(subroutinePromptPath, "utf-8");
			this.logger.debug(
				`Loaded ${subroutine.name} subroutine prompt (${prompt.length} characters)`,
			);

			// Perform template substitution if workspace slug is provided
			if (workspaceSlug) {
				prompt = prompt.replace(
					/https:\/\/linear\.app\/linear\/profiles\//g,
					`https://linear.app/${workspaceSlug}/profiles/`,
				);
			}

			return prompt;
		} catch (error) {
			this.logger.warn(
				`Failed to load subroutine prompt from ${subroutinePromptPath}:`,
				error,
			);
			return null;
		}
	}

	/**
	 * Load shared instructions that get appended to all system prompts
	 */
	private async loadSharedInstructions(): Promise<string> {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const instructionsPath = join(
			__dirname,
			"..",
			"prompts",
			"todolist-system-prompt-extension.md",
		);

		try {
			const instructions = await readFile(instructionsPath, "utf-8");
			return instructions;
		} catch (error) {
			this.logger.error(
				`Failed to load shared instructions from ${instructionsPath}:`,
				error,
			);
			return ""; // Return empty string if file can't be loaded
		}
	}

	/**
	 * Adapter method for prompt assembly - extracts just the prompt string
	 */
	private async determineSystemPromptForAssembly(
		labels: string[],
		repository: RepositoryConfig,
	): Promise<string | undefined> {
		const result = await this.determineSystemPromptFromLabels(
			labels,
			repository,
		);
		return result?.prompt;
	}

	/**
	 * Adapter method for prompt assembly - routes to appropriate issue context builder
	 */
	private async buildIssueContextForPromptAssembly(
		issue: Issue,
		repository: RepositoryConfig,
		promptType: PromptType,
		attachmentManifest?: string,
		guidance?: GuidanceRule[],
		agentSession?: WebhookAgentSession,
	): Promise<IssueContextResult> {
		// Delegate to appropriate builder based on promptType
		if (promptType === "mention") {
			if (!agentSession) {
				throw new Error(
					"agentSession is required for mention-triggered prompts",
				);
			}
			return this.buildMentionPrompt(
				issue,
				agentSession,
				attachmentManifest,
				guidance,
			);
		}
		if (
			promptType === "label-based" ||
			promptType === "label-based-prompt-command"
		) {
			return this.buildLabelBasedPrompt(
				issue,
				repository,
				attachmentManifest,
				guidance,
			);
		}
		// Fallback to standard issue context
		return this.buildIssueContextPrompt(
			issue,
			repository,
			undefined, // No new comment for initial prompt assembly
			attachmentManifest,
			guidance,
		);
	}

	/**
	 * Build agent runner configuration with common settings.
	 * Also determines which runner type to use based on labels.
	 * @returns Object containing the runner config and runner type to use
	 */
	private buildAgentRunnerConfig(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		sessionId: string,
		systemPrompt: string | undefined,
		allowedTools: string[],
		allowedDirectories: string[],
		disallowedTools: string[],
		resumeSessionId?: string,
		labels?: string[],
		maxTurns?: number,
		singleTurn?: boolean,
		disallowAllTools?: boolean,
	): { config: AgentRunnerConfig; runnerType: "claude" | "gemini" } {
		const log = this.logger.withContext({
			sessionId,
			platform: session.issueContext?.trackerId,
			issueIdentifier: session.issueContext?.issueIdentifier,
		});

		// Configure PostToolUse hooks for screenshot tools to guide Claude to use linear_upload_file
		// This ensures screenshots can be viewed in Linear comments instead of remaining as local files
		const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
			PostToolUse: [
				{
					matcher: "playwright_screenshot",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							log.debug(
								`Tool ${postToolUseInput.tool_name} completed with response:`,
								postToolUseInput.tool_response,
							);
							const response = postToolUseInput.tool_response as {
								path?: string;
							};
							const filePath = response?.path || "the screenshot file";
							return {
								continue: true,
								additionalContext: `Screenshot taken successfully. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown. You can also use the Read tool to view the screenshot file to analyze the visual content.`,
							};
						},
					],
				},
				{
					matcher: "mcp__claude-in-chrome__computer",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							const response = postToolUseInput.tool_response as {
								action?: string;
								imageId?: string;
								path?: string;
							};
							// Only provide upload guidance for screenshot actions
							if (response?.action === "screenshot") {
								const filePath = response?.path || "the screenshot file";
								return {
									continue: true,
									additionalContext: `Screenshot captured. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
								};
							}
							return { continue: true };
						},
					],
				},
				{
					matcher: "mcp__claude-in-chrome__gif_creator",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							const response = postToolUseInput.tool_response as {
								action?: string;
								path?: string;
							};
							// Only provide upload guidance for export actions
							if (response?.action === "export") {
								const filePath = response?.path || "the exported GIF";
								return {
									continue: true,
									additionalContext: `GIF exported successfully. To share this GIF in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
								};
							}
							return { continue: true };
						},
					],
				},
				{
					matcher: "mcp__chrome-devtools__take_screenshot",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							// Extract file path from input (the tool saves to filePath parameter)
							const toolInput = postToolUseInput.tool_input as {
								filePath?: string;
							};
							const filePath = toolInput?.filePath || "the screenshot file";
							return {
								continue: true,
								additionalContext: `Screenshot saved. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
							};
						},
					],
				},
			],
		};

		// Determine runner type and model override from labels
		const runnerSelection = this.determineRunnerFromLabels(labels || []);
		let runnerType = runnerSelection.runnerType;
		let modelOverride = runnerSelection.modelOverride;
		let fallbackModelOverride = runnerSelection.fallbackModelOverride;

		// If the labels have changed, and we are resuming a session. Use the existing runner for the session.
		if (session.claudeSessionId && runnerType !== "claude") {
			runnerType = "claude";
			modelOverride = "sonnet";
			fallbackModelOverride = "haiku";
		} else if (session.geminiSessionId && runnerType !== "gemini") {
			runnerType = "gemini";
			modelOverride = "gemini-2.5-pro";
			fallbackModelOverride = "gemini-2.5-flash";
		}

		// Log model override if found
		if (modelOverride) {
			log.debug(`Model override via label: ${modelOverride}`);
		}

		// Convert singleTurn flag to effective maxTurns value
		const effectiveMaxTurns = singleTurn ? 1 : maxTurns;

		// Determine final model name with singleTurn suffix for Gemini
		const finalModel =
			modelOverride || repository.model || this.config.defaultModel;

		// When disallowAllTools is true, don't provide any MCP servers to ensure
		// the agent cannot use any tools (including MCP-provided tools like Linear create_comment)
		const mcpConfig = disallowAllTools
			? undefined
			: this.buildMcpConfig(repository, sessionId);
		const mcpConfigPath = disallowAllTools
			? undefined
			: repository.mcpConfigPath;

		if (disallowAllTools) {
			log.info(
				`MCP tools disabled for session ${sessionId} (disallowAllTools=true)`,
			);
		}

		const config = {
			workingDirectory: session.workspace.path,
			allowedTools,
			disallowedTools,
			allowedDirectories,
			workspaceName: session.issue?.identifier || session.issueId,
			cyrusHome: this.cyrusHome,
			mcpConfigPath,
			mcpConfig,
			appendSystemPrompt: systemPrompt || "",
			// When disallowAllTools is true, remove all built-in tools from model context
			// so Claude cannot see or attempt tool use (distinct from allowedTools which only controls permissions)
			...(disallowAllTools && { tools: [] }),
			// Priority order: label override > repository config > global default
			model: finalModel,
			fallbackModel:
				fallbackModelOverride ||
				repository.fallbackModel ||
				this.config.defaultFallbackModel,
			logger: log,
			hooks,
			// Enable Chrome integration for Claude runner (disabled for other runners)
			...(runnerType === "claude" && { extraArgs: { chrome: null } }),
			// AskUserQuestion callback - only for Claude runner
			...(runnerType === "claude" && {
				onAskUserQuestion: this.createAskUserQuestionCallback(
					sessionId,
					repository.linearWorkspaceId,
				),
			}),
			onMessage: (message: SDKMessage) => {
				this.handleClaudeMessage(sessionId, message, repository.id);
			},
			onError: (error: Error) => this.handleClaudeError(error),
		};

		if (resumeSessionId) {
			(config as any).resumeSessionId = resumeSessionId;
		}

		if (effectiveMaxTurns !== undefined) {
			(config as any).maxTurns = effectiveMaxTurns;
			if (singleTurn) {
				log.debug(`Applied singleTurn maxTurns=1`);
			}
		}

		return { config, runnerType };
	}

	/**
	 * Create an onAskUserQuestion callback for the ClaudeRunner.
	 * This callback delegates to the AskUserQuestionHandler which posts
	 * elicitations to Linear and waits for user responses.
	 *
	 * @param linearAgentSessionId - Linear agent session ID for tracking
	 * @param organizationId - Linear organization/workspace ID
	 */
	private createAskUserQuestionCallback(
		linearAgentSessionId: string,
		organizationId: string,
	): AgentRunnerConfig["onAskUserQuestion"] {
		return async (input, _sessionId, signal) => {
			// Note: We use linearAgentSessionId (from closure) instead of the passed sessionId
			// because the passed sessionId is the Claude session ID, not the Linear agent session ID
			return this.askUserQuestionHandler.handleAskUserQuestion(
				input,
				linearAgentSessionId,
				organizationId,
				signal,
			);
		};
	}

	/**
	 * Build disallowed tools list following the same hierarchy as allowed tools
	 */
	private buildDisallowedTools(
		repository: RepositoryConfig,
		promptType?:
			| "debugger"
			| "builder"
			| "scoper"
			| "orchestrator"
			| "graphite-orchestrator",
	): string[] {
		// graphite-orchestrator uses the same tool config as orchestrator
		const effectivePromptType =
			promptType === "graphite-orchestrator" ? "orchestrator" : promptType;
		let disallowedTools: string[] = [];
		let toolSource = "";

		// Priority order (same as allowedTools):
		// 1. Repository-specific prompt type configuration
		const promptConfig = effectivePromptType
			? repository.labelPrompts?.[effectivePromptType]
			: undefined;
		// Only access disallowedTools if config is object form (not simple string[])
		const promptDisallowedTools =
			promptConfig && !Array.isArray(promptConfig)
				? promptConfig.disallowedTools
				: undefined;
		if (promptDisallowedTools) {
			disallowedTools = promptDisallowedTools;
			toolSource = `repository label prompt (${effectivePromptType})`;
		}
		// 2. Global prompt type defaults
		else if (
			effectivePromptType &&
			this.config.promptDefaults?.[effectivePromptType]?.disallowedTools
		) {
			disallowedTools =
				this.config.promptDefaults[effectivePromptType].disallowedTools;
			toolSource = `global prompt defaults (${effectivePromptType})`;
		}
		// 3. Repository-level disallowed tools
		else if (repository.disallowedTools) {
			disallowedTools = repository.disallowedTools;
			toolSource = "repository configuration";
		}
		// 4. Global default disallowed tools
		else if (this.config.defaultDisallowedTools) {
			disallowedTools = this.config.defaultDisallowedTools;
			toolSource = "global defaults";
		}
		// 5. No defaults for disallowedTools (as per requirements)
		else {
			disallowedTools = [];
			toolSource = "none (no defaults)";
		}

		if (disallowedTools.length > 0) {
			this.logger.debug(
				`Disallowed tools for ${repository.name}: ${disallowedTools.length} tools from ${toolSource}`,
			);
		}

		return disallowedTools;
	}

	/**
	 * Merge subroutine-level disallowedTools with base disallowedTools
	 * @param session Current agent session
	 * @param baseDisallowedTools Base disallowed tools from repository/global config
	 * @param logContext Context string for logging (e.g., "EdgeWorker", "resumeClaudeSession")
	 * @returns Merged disallowed tools list
	 */
	private mergeSubroutineDisallowedTools(
		session: CyrusAgentSession,
		baseDisallowedTools: string[],
		logContext: string,
	): string[] {
		const currentSubroutine =
			this.procedureAnalyzer.getCurrentSubroutine(session);
		if (currentSubroutine?.disallowedTools) {
			const mergedTools = [
				...new Set([
					...baseDisallowedTools,
					...currentSubroutine.disallowedTools,
				]),
			];
			this.logger.debug(
				`[${logContext}] Merged subroutine-level disallowedTools for ${currentSubroutine.name}:`,
				currentSubroutine.disallowedTools,
			);
			return mergedTools;
		}
		return baseDisallowedTools;
	}

	/**
	 * Build allowed tools list with Linear MCP tools automatically included
	 */
	private buildAllowedTools(
		repository: RepositoryConfig,
		promptType?:
			| "debugger"
			| "builder"
			| "scoper"
			| "orchestrator"
			| "graphite-orchestrator",
	): string[] {
		// graphite-orchestrator uses the same tool config as orchestrator
		const effectivePromptType =
			promptType === "graphite-orchestrator" ? "orchestrator" : promptType;
		let baseTools: string[] = [];
		let toolSource = "";

		// Priority order:
		// 1. Repository-specific prompt type configuration
		const promptConfig = effectivePromptType
			? repository.labelPrompts?.[effectivePromptType]
			: undefined;
		// Only access allowedTools if config is object form (not simple string[])
		const promptAllowedTools =
			promptConfig && !Array.isArray(promptConfig)
				? promptConfig.allowedTools
				: undefined;
		if (promptAllowedTools) {
			baseTools = this.resolveToolPreset(promptAllowedTools);
			toolSource = `repository label prompt (${effectivePromptType})`;
		}
		// 2. Global prompt type defaults
		else if (
			effectivePromptType &&
			this.config.promptDefaults?.[effectivePromptType]?.allowedTools
		) {
			baseTools = this.resolveToolPreset(
				this.config.promptDefaults[effectivePromptType].allowedTools,
			);
			toolSource = `global prompt defaults (${effectivePromptType})`;
		}
		// 3. Repository-level allowed tools
		else if (repository.allowedTools) {
			baseTools = repository.allowedTools;
			toolSource = "repository configuration";
		}
		// 4. Global default allowed tools
		else if (this.config.defaultAllowedTools) {
			baseTools = this.config.defaultAllowedTools;
			toolSource = "global defaults";
		}
		// 5. Fall back to safe tools
		else {
			baseTools = getSafeTools();
			toolSource = "safe tools fallback";
		}

		// Linear MCP tools that should always be available
		// See: https://docs.anthropic.com/en/docs/claude-code/iam#tool-specific-permission-rules
		const linearMcpTools = ["mcp__linear", "mcp__cyrus-tools"];

		// Combine and deduplicate
		const allTools = [...new Set([...baseTools, ...linearMcpTools])];

		this.logger.debug(
			`Tool selection for ${repository.name}: ${allTools.length} tools from ${toolSource}`,
		);

		return allTools;
	}

	/**
	 * Get Agent Sessions for an issue
	 */
	public getAgentSessionsForIssue(
		issueId: string,
		repositoryId: string,
	): any[] {
		const agentSessionManager = this.agentSessionManagers.get(repositoryId);
		if (!agentSessionManager) {
			return [];
		}

		return agentSessionManager.getSessionsByIssueId(issueId);
	}

	// ========================================================================
	// User Access Control
	// ========================================================================

	/**
	 * Check if the user who triggered the webhook is allowed to interact.
	 * @param webhook The webhook containing user information
	 * @param repository The repository configuration
	 * @returns Access check result with allowed status and user name
	 */
	private checkUserAccess(
		webhook: AgentSessionCreatedWebhook | AgentSessionPromptedWebhook,
		repository: RepositoryConfig,
	): { allowed: true } | { allowed: false; reason: string; userName: string } {
		const creator = webhook.agentSession.creator;
		const userId = creator?.id;
		const userEmail = creator?.email;
		const userName = creator?.name || userId || "Unknown";

		const result = this.userAccessControl.checkAccess(
			userId,
			userEmail,
			repository.id,
		);

		if (!result.allowed) {
			return { allowed: false, reason: result.reason, userName };
		}
		return { allowed: true };
	}

	/**
	 * Handle blocked user according to configured behavior.
	 * Posts a response activity to end the session.
	 * @param webhook The webhook that triggered the blocked access
	 * @param repository The repository configuration
	 * @param _reason The reason for blocking (for logging)
	 */
	private async handleBlockedUser(
		webhook: AgentSessionCreatedWebhook | AgentSessionPromptedWebhook,
		repository: RepositoryConfig,
		_reason: string,
	): Promise<void> {
		const issueTracker = this.issueTrackers.get(repository.id);
		const agentSessionId = webhook.agentSession.id;
		const behavior = this.userAccessControl.getBlockBehavior(repository.id);

		if (!issueTracker) {
			return;
		}

		if (behavior === "comment") {
			// Get user info for templating
			const creator = webhook.agentSession.creator;
			const userName = creator?.name || "User";
			const userId = creator?.id || "";

			// Get the message template and replace variables
			// Supported variables:
			// - {{userName}} - The user's display name
			// - {{userId}} - The user's Linear ID
			let message = this.userAccessControl.getBlockMessage(repository.id);
			message = message
				.replace(/\{\{userName\}\}/g, userName)
				.replace(/\{\{userId\}\}/g, userId);

			await this.postActivityDirect(
				issueTracker,
				{
					agentSessionId,
					content: { type: "response", body: message },
				},
				"blocked user message",
			);
		}
		// For "silent" behavior, we don't post any activity.
		// The session will remain in "Working" state until manually stopped or timed out.
	}

	/**
	 * Load persisted EdgeWorker state for all repositories
	 */
	private async loadPersistedState(): Promise<void> {
		try {
			const state = await this.persistenceManager.loadEdgeWorkerState();
			if (state) {
				this.restoreMappings(state);
				this.logger.debug(
					`✅ Loaded persisted EdgeWorker state with ${Object.keys(state.agentSessions || {}).length} repositories`,
				);
			}
		} catch (error) {
			this.logger.error(`Failed to load persisted EdgeWorker state:`, error);
		}
	}

	/**
	 * Save current EdgeWorker state for all repositories
	 */
	private async savePersistedState(): Promise<void> {
		try {
			const state = this.serializeMappings();
			await this.persistenceManager.saveEdgeWorkerState(state);
			this.logger.debug(
				`✅ Saved EdgeWorker state for ${Object.keys(state.agentSessions || {}).length} repositories`,
			);
		} catch (error) {
			this.logger.error(`Failed to save persisted EdgeWorker state:`, error);
		}
	}

	/**
	 * Serialize EdgeWorker mappings to a serializable format
	 */
	public serializeMappings(): SerializableEdgeWorkerState {
		// Serialize Agent Session state for all repositories
		const agentSessions: Record<
			string,
			Record<string, SerializedCyrusAgentSession>
		> = {};
		const agentSessionEntries: Record<
			string,
			Record<string, SerializedCyrusAgentSessionEntry[]>
		> = {};
		for (const [
			repositoryId,
			agentSessionManager,
		] of this.agentSessionManagers.entries()) {
			const serializedState = agentSessionManager.serializeState();
			agentSessions[repositoryId] = serializedState.sessions;
			agentSessionEntries[repositoryId] = serializedState.entries;
		}
		// Serialize child to parent agent session mapping
		const childToParentAgentSession = Object.fromEntries(
			this.childToParentAgentSession.entries(),
		);

		// Serialize issue to repository cache from RepositoryRouter
		const issueRepositoryCache = Object.fromEntries(
			this.repositoryRouter.getIssueRepositoryCache().entries(),
		);

		return {
			agentSessions,
			agentSessionEntries,
			childToParentAgentSession,
			issueRepositoryCache,
		};
	}

	/**
	 * Restore EdgeWorker mappings from serialized state
	 */
	public restoreMappings(state: SerializableEdgeWorkerState): void {
		// Restore Agent Session state for all repositories
		if (state.agentSessions && state.agentSessionEntries) {
			for (const [
				repositoryId,
				agentSessionManager,
			] of this.agentSessionManagers.entries()) {
				const repositorySessions = state.agentSessions[repositoryId] || {};
				const repositoryEntries = state.agentSessionEntries[repositoryId] || {};

				if (
					Object.keys(repositorySessions).length > 0 ||
					Object.keys(repositoryEntries).length > 0
				) {
					agentSessionManager.restoreState(
						repositorySessions,
						repositoryEntries,
					);
					this.logger.debug(
						`Restored Agent Session state for repository ${repositoryId}`,
					);
				}
			}
		}

		// Restore child to parent agent session mapping
		if (state.childToParentAgentSession) {
			this.childToParentAgentSession = new Map(
				Object.entries(state.childToParentAgentSession),
			);
			this.logger.debug(
				`Restored ${this.childToParentAgentSession.size} child-to-parent agent session mappings`,
			);
		}

		// Restore issue to repository cache in RepositoryRouter
		if (state.issueRepositoryCache) {
			const cache = new Map(Object.entries(state.issueRepositoryCache));
			this.repositoryRouter.restoreIssueRepositoryCache(cache);
			this.logger.debug(
				`Restored ${cache.size} issue-to-repository cache mappings`,
			);
		}
	}

	/**
	 * Post an activity directly via an issue tracker instance.
	 * Consolidates try/catch and success/error logging for EdgeWorker call sites
	 * that already have the issueTracker and agentSessionId resolved.
	 *
	 * @returns The activity ID when resolved, `null` otherwise.
	 */
	private async postActivityDirect(
		issueTracker: IIssueTrackerService,
		input: AgentActivityCreateInput,
		label: string,
	): Promise<string | null> {
		try {
			const result = await issueTracker.createAgentActivity(input);
			if (result.success) {
				if (result.agentActivity) {
					const activity = await result.agentActivity;
					this.logger.debug(`Created ${label} activity ${activity.id}`);
					return activity.id;
				}
				this.logger.debug(`Created ${label}`);
				return null;
			}
			this.logger.error(`Failed to create ${label}:`, result);
			return null;
		} catch (error) {
			this.logger.error(`Error creating ${label}:`, error);
			return null;
		}
	}

	/**
	 * Post instant acknowledgment thought when agent session is created
	 */
	private async postInstantAcknowledgment(
		sessionId: string,
		repositoryId: string,
	): Promise<void> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			this.logger.warn(`No issue tracker found for repository ${repositoryId}`);
			return;
		}

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: "I've received your request and I'm starting to work on it. Let me analyze the issue and prepare my approach.",
				},
			},
			"instant acknowledgment",
		);
	}

	/**
	 * Post parent resume acknowledgment thought when parent session is resumed from child
	 */
	private async postParentResumeAcknowledgment(
		sessionId: string,
		repositoryId: string,
	): Promise<void> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			this.logger.warn(`No issue tracker found for repository ${repositoryId}`);
			return;
		}

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: { type: "thought", body: "Resuming from child session" },
			},
			"parent resume acknowledgment",
		);
	}

	/**
	 * Post repository selection activity
	 * Shows which method was used to select the repository (auto-routing or user selection)
	 */
	private async postRepositorySelectionActivity(
		sessionId: string,
		repositoryId: string,
		repositoryName: string,
		selectionMethod:
			| "description-tag"
			| "label-based"
			| "project-based"
			| "team-based"
			| "team-prefix"
			| "catch-all"
			| "workspace-fallback"
			| "user-selected",
	): Promise<void> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			this.logger.warn(`No issue tracker found for repository ${repositoryId}`);
			return;
		}

		let methodDisplay: string;
		if (selectionMethod === "user-selected") {
			methodDisplay = "selected by user";
		} else if (selectionMethod === "description-tag") {
			methodDisplay = "matched via [repo=...] tag in issue description";
		} else if (selectionMethod === "label-based") {
			methodDisplay = "matched via label-based routing";
		} else if (selectionMethod === "project-based") {
			methodDisplay = "matched via project-based routing";
		} else if (selectionMethod === "team-based") {
			methodDisplay = "matched via team-based routing";
		} else if (selectionMethod === "team-prefix") {
			methodDisplay = "matched via team prefix routing";
		} else if (selectionMethod === "catch-all") {
			methodDisplay = "matched via catch-all routing";
		} else {
			methodDisplay = "matched via workspace fallback";
		}

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: `Repository "${repositoryName}" has been ${methodDisplay}.`,
				},
			},
			"repository selection",
		);
	}

	/**
	 * Re-route procedure for a session (used when resuming from child or give feedback)
	 * This ensures the currentSubroutine is reset to avoid suppression issues
	 */
	private async rerouteProcedureForSession(
		session: CyrusAgentSession,
		sessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		repository: RepositoryConfig,
	): Promise<void> {
		// Initialize procedure metadata using intelligent routing
		if (!session.metadata) {
			session.metadata = {};
		}

		// Post ephemeral "Routing..." thought
		await agentSessionManager.postAnalyzingThought(sessionId);

		// Fetch full issue and labels to check for Orchestrator label override
		const issueTracker = this.issueTrackers.get(repository.id);
		let hasOrchestratorLabel = false;

		// Get issueId from issueContext (preferred) or deprecated issueId field
		const issueId = session.issueContext?.issueId ?? session.issueId;
		if (issueTracker && issueId) {
			try {
				const fullIssue = await issueTracker.fetchIssue(issueId);
				const labels = await this.fetchIssueLabels(fullIssue);

				// ALWAYS check for 'orchestrator' label (case-insensitive) regardless of EdgeConfig
				// This is a hardcoded rule: any issue with 'orchestrator'/'Orchestrator' label
				// goes to orchestrator procedure
				const lowercaseLabels = labels.map((label) => label.toLowerCase());
				const hasHardcodedOrchestratorLabel =
					lowercaseLabels.includes("orchestrator");

				// Also check any additional orchestrator labels from config
				const orchestratorConfig = repository.labelPrompts?.orchestrator;
				const orchestratorLabels = Array.isArray(orchestratorConfig)
					? orchestratorConfig
					: orchestratorConfig?.labels;
				const hasConfiguredOrchestratorLabel =
					orchestratorLabels?.some((label) =>
						lowercaseLabels.includes(label.toLowerCase()),
					) ?? false;

				hasOrchestratorLabel =
					hasHardcodedOrchestratorLabel || hasConfiguredOrchestratorLabel;
			} catch (error) {
				this.logger.error(`Failed to fetch issue labels for routing:`, error);
				// Continue with AI routing if label fetch fails
			}
		}

		let selectedProcedure: ProcedureDefinition;
		let finalClassification: RequestClassification;

		// If Orchestrator label is present, ALWAYS use orchestrator-full procedure
		if (hasOrchestratorLabel) {
			const orchestratorProcedure =
				this.procedureAnalyzer.getProcedure("orchestrator-full");
			if (!orchestratorProcedure) {
				throw new Error("orchestrator-full procedure not found in registry");
			}
			selectedProcedure = orchestratorProcedure;
			finalClassification = "orchestrator";
			this.logger.info(
				`Using orchestrator-full procedure due to Orchestrator label (skipping AI routing)`,
			);
		} else {
			// No Orchestrator label - use AI routing based on prompt content
			const routingDecision = await this.procedureAnalyzer.determineRoutine(
				promptBody.trim(),
			);
			selectedProcedure = routingDecision.procedure;
			finalClassification = routingDecision.classification;

			// Log AI routing decision
			this.logger.info(`AI routing decision for ${sessionId}:`);
			this.logger.info(`  Classification: ${routingDecision.classification}`);
			this.logger.info(`  Procedure: ${selectedProcedure.name}`);
			this.logger.info(`  Reasoning: ${routingDecision.reasoning}`);
		}

		// Initialize procedure metadata in session (resets currentSubroutine)
		this.procedureAnalyzer.initializeProcedureMetadata(
			session,
			selectedProcedure,
		);

		// Post procedure selection result (replaces ephemeral routing thought)
		await agentSessionManager.postProcedureSelectionThought(
			sessionId,
			selectedProcedure.name,
			finalClassification,
		);
	}

	/**
	 * Handle prompt with streaming check - centralized logic for all input types
	 *
	 * This method implements the unified pattern for handling prompts:
	 * 1. Check if runner is actively streaming
	 * 2. Route procedure if NOT streaming (resets currentSubroutine)
	 * 3. Add to stream if streaming, OR resume session if not
	 *
	 * @param session The Cyrus agent session
	 * @param repository Repository configuration
	 * @param sessionId Linear agent activity session ID
	 * @param agentSessionManager Agent session manager instance
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest to append
	 * @param isNewSession Whether this is a new session
	 * @param additionalAllowedDirs Additional directories to allow access to
	 * @param logContext Context string for logging (e.g., "prompted webhook", "parent resume")
	 * @returns true if message was added to stream, false if session was resumed
	 */
	private async handlePromptWithStreamingCheck(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		sessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest: string,
		isNewSession: boolean,
		additionalAllowedDirs: string[],
		logContext: string,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<boolean> {
		const log = this.logger.withContext({ sessionId });
		// Check if runner is actively running before routing
		const existingRunner = session.agentRunner;
		const isRunning = existingRunner?.isRunning() || false;

		// Always route procedure for new input, UNLESS actively running
		if (!isRunning) {
			await this.rerouteProcedureForSession(
				session,
				sessionId,
				agentSessionManager,
				promptBody,
				repository,
			);
			log.debug(`Routed procedure for ${logContext}`);
		} else {
			log.debug(
				`Skipping routing for ${sessionId} (${logContext}) - runner is actively running`,
			);
		}

		// Handle running case - add message to existing stream (if supported)
		if (
			existingRunner?.isRunning() &&
			existingRunner.supportsStreamingInput &&
			existingRunner.addStreamMessage
		) {
			log.debug(
				`Adding prompt to existing stream for ${sessionId} (${logContext})`,
			);

			// Append attachment manifest to the prompt if we have one
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}

			existingRunner.addStreamMessage(fullPrompt);
			return true; // Message added to stream
		}

		// Not streaming - resume/start session
		log.debug(`Resuming Claude session for ${sessionId} (${logContext})`);

		await this.resumeAgentSession(
			session,
			repository,
			sessionId,
			agentSessionManager,
			promptBody,
			attachmentManifest,
			isNewSession,
			additionalAllowedDirs,
			undefined, // maxTurns
			commentAuthor,
			commentTimestamp,
		);

		return false; // Session was resumed
	}

	/**
	 * Post thought about system prompt selection based on labels
	 */
	private async postSystemPromptSelectionThought(
		sessionId: string,
		labels: string[],
		repositoryId: string,
	): Promise<void> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			this.logger.warn(`No issue tracker found for repository ${repositoryId}`);
			return;
		}

		// Determine which prompt type was selected and which label triggered it
		let selectedPromptType: string | null = null;
		let triggerLabel: string | null = null;
		const repository = Array.from(this.repositories.values()).find(
			(r) => r.id === repositoryId,
		);

		if (repository?.labelPrompts) {
			// Check debugger labels
			const debuggerConfig = repository.labelPrompts.debugger;
			const debuggerLabels = Array.isArray(debuggerConfig)
				? debuggerConfig
				: debuggerConfig?.labels;
			const debuggerLabel = debuggerLabels?.find((label) =>
				labels.includes(label),
			);
			if (debuggerLabel) {
				selectedPromptType = "debugger";
				triggerLabel = debuggerLabel;
			} else {
				// Check builder labels
				const builderConfig = repository.labelPrompts.builder;
				const builderLabels = Array.isArray(builderConfig)
					? builderConfig
					: builderConfig?.labels;
				const builderLabel = builderLabels?.find((label) =>
					labels.includes(label),
				);
				if (builderLabel) {
					selectedPromptType = "builder";
					triggerLabel = builderLabel;
				} else {
					// Check scoper labels
					const scoperConfig = repository.labelPrompts.scoper;
					const scoperLabels = Array.isArray(scoperConfig)
						? scoperConfig
						: scoperConfig?.labels;
					const scoperLabel = scoperLabels?.find((label) =>
						labels.includes(label),
					);
					if (scoperLabel) {
						selectedPromptType = "scoper";
						triggerLabel = scoperLabel;
					} else {
						// Check orchestrator labels
						const orchestratorConfig = repository.labelPrompts.orchestrator;
						const orchestratorLabels = Array.isArray(orchestratorConfig)
							? orchestratorConfig
							: (orchestratorConfig?.labels ?? ["orchestrator"]);
						const orchestratorLabel = orchestratorLabels?.find((label) =>
							labels.includes(label),
						);
						if (orchestratorLabel) {
							selectedPromptType = "orchestrator";
							triggerLabel = orchestratorLabel;
						}
					}
				}
			}
		}

		// Only post if a role was actually triggered
		if (!selectedPromptType || !triggerLabel) {
			return;
		}

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`,
				},
			},
			"system prompt selection",
		);
	}

	/**
	 * Resume or create an Agent session with the given prompt
	 * This is the core logic for handling prompted agent activities
	 * @param session The Cyrus agent session
	 * @param repository The repository configuration
	 * @param sessionId The Linear agent session ID
	 * @param agentSessionManager The agent session manager
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest
	 * @param isNewSession Whether this is a new session
	 */
	async resumeAgentSession(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		sessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest: string = "",
		isNewSession: boolean = false,
		additionalAllowedDirectories: string[] = [],
		maxTurns?: number,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<void> {
		const log = this.logger.withContext({ sessionId });
		// Check for existing runner
		const existingRunner = session.agentRunner;

		// If there's an existing running runner that supports streaming, add to it
		if (
			existingRunner?.isRunning() &&
			existingRunner.supportsStreamingInput &&
			existingRunner.addStreamMessage
		) {
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}
			existingRunner.addStreamMessage(fullPrompt);
			return;
		}

		// Stop existing runner if it's not running
		if (existingRunner) {
			existingRunner.stop();
		}

		// Get issueId from issueContext (preferred) or deprecated issueId field
		const issueIdForResume = session.issueContext?.issueId ?? session.issueId;
		if (!issueIdForResume) {
			log.error(`No issue ID found for session ${session.id}`);
			throw new Error(`No issue ID found for session ${session.id}`);
		}

		// Fetch full issue details
		const fullIssue = await this.fetchFullIssueDetails(
			issueIdForResume,
			repository.id,
		);
		if (!fullIssue) {
			log.error(`Failed to fetch full issue details for ${issueIdForResume}`);
			throw new Error(
				`Failed to fetch full issue details for ${issueIdForResume}`,
			);
		}

		// Fetch issue labels early to determine runner type
		const labels = await this.fetchIssueLabels(fullIssue);

		// Determine which runner to use based on existing session IDs
		const hasClaudeSession = !isNewSession && Boolean(session.claudeSessionId);
		const hasGeminiSession = !isNewSession && Boolean(session.geminiSessionId);
		const needsNewSession =
			isNewSession || (!hasClaudeSession && !hasGeminiSession);

		// Fetch system prompt based on labels

		const systemPromptResult = await this.determineSystemPromptFromLabels(
			labels,
			repository,
		);
		const systemPrompt = systemPromptResult?.prompt;
		const promptType = systemPromptResult?.type;

		// Get current subroutine to check for singleTurn mode and disallowAllTools
		const currentSubroutine =
			this.procedureAnalyzer.getCurrentSubroutine(session);

		// Build allowed tools list
		// If subroutine has disallowAllTools: true, use empty array to disable all tools
		const allowedTools = currentSubroutine?.disallowAllTools
			? []
			: this.buildAllowedTools(repository, promptType);
		const baseDisallowedTools = this.buildDisallowedTools(
			repository,
			promptType,
		);

		// Merge subroutine-level disallowedTools if applicable
		const disallowedTools = this.mergeSubroutineDisallowedTools(
			session,
			baseDisallowedTools,
			"resumeClaudeSession",
		);

		if (currentSubroutine?.disallowAllTools) {
			log.debug(`All tools disabled for subroutine: ${currentSubroutine.name}`);
		}

		// Set up attachments directory
		const workspaceFolderName = basename(session.workspace.path);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);
		await mkdir(attachmentsDir, { recursive: true });

		const allowedDirectories = [
			attachmentsDir,
			repository.repositoryPath,
			...additionalAllowedDirectories,
		];

		const resumeSessionId = needsNewSession
			? undefined
			: session.claudeSessionId
				? session.claudeSessionId
				: session.geminiSessionId;

		// Create runner configuration
		// buildAgentRunnerConfig determines runner type from labels for new sessions
		// For existing sessions, we still need labels for model override but ignore runner type
		const { config: runnerConfig, runnerType } = this.buildAgentRunnerConfig(
			session,
			repository,
			sessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			resumeSessionId,
			labels, // Always pass labels to preserve model override
			maxTurns, // Pass maxTurns if specified
			currentSubroutine?.singleTurn, // singleTurn flag
			currentSubroutine?.disallowAllTools, // disallowAllTools flag - also disables MCP tools
		);

		// Create the appropriate runner based on session state
		const runner =
			runnerType === "claude"
				? new ClaudeRunner(runnerConfig)
				: new GeminiRunner(runnerConfig);

		// Store runner
		agentSessionManager.addAgentRunner(sessionId, runner);

		// Save state
		await this.savePersistedState();

		// Prepare the full prompt
		const fullPrompt = await this.buildSessionPrompt(
			isNewSession,
			session,
			fullIssue,
			repository,
			promptBody,
			attachmentManifest,
			commentAuthor,
			commentTimestamp,
		);

		// Start session - use streaming mode if supported for ability to add messages later
		try {
			if (runner.supportsStreamingInput && runner.startStreaming) {
				await runner.startStreaming(fullPrompt);
			} else {
				await runner.start(fullPrompt);
			}
		} catch (error) {
			log.error(`Failed to start streaming session for ${sessionId}:`, error);
			throw error;
		}
	}

	/**
	 * Post instant acknowledgment thought when receiving prompted webhook
	 */
	private async postInstantPromptedAcknowledgment(
		sessionId: string,
		repositoryId: string,
		isStreaming: boolean,
	): Promise<void> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			this.logger.warn(`No issue tracker found for repository ${repositoryId}`);
			return;
		}

		const message = isStreaming
			? "I've queued up your message as guidance"
			: "Getting started on that...";

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: { type: "thought", body: message },
			},
			"prompted acknowledgment",
		);
	}

	/**
	 * Get the platform type for a repository's issue tracker.
	 */
	private getRepositoryPlatform(repositoryId: string): string | undefined {
		try {
			return this.issueTrackers.get(repositoryId)?.getPlatformType();
		} catch {
			return undefined;
		}
	}

	/**
	 * Fetch complete issue details from Linear API
	 */
	public async fetchFullIssueDetails(
		issueId: string,
		repositoryId: string,
	): Promise<Issue | null> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			this.logger.warn(`No issue tracker found for repository ${repositoryId}`);
			return null;
		}

		try {
			this.logger.debug(`Fetching full issue details for ${issueId}`);
			const fullIssue = await issueTracker.fetchIssue(issueId);
			this.logger.debug(`Successfully fetched issue details for ${issueId}`);

			// Check if issue has a parent
			try {
				const parent = await fullIssue.parent;
				if (parent) {
					this.logger.debug(
						`Issue ${issueId} has parent: ${parent.identifier}`,
					);
				}
			} catch (_error) {
				// Parent field might not exist, ignore error
			}

			return fullIssue;
		} catch (error) {
			this.logger.error(`Failed to fetch issue details for ${issueId}:`, error);
			return null;
		}
	}

	// ========================================================================
	// OAuth Token Refresh
	// ========================================================================

	/**
	 * Build OAuth config for LinearIssueTrackerService.
	 * Returns undefined if OAuth credentials are not available.
	 */
	private buildOAuthConfig(
		repo: RepositoryConfig,
	): LinearOAuthConfig | undefined {
		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			this.logger.warn(
				"LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET not set, token refresh disabled",
			);
			return undefined;
		}

		if (!repo.linearRefreshToken) {
			this.logger.warn(
				`No refresh token for repository ${repo.id}, token refresh disabled`,
			);
			return undefined;
		}

		const workspaceId = repo.linearWorkspaceId;
		const workspaceName = repo.linearWorkspaceName || workspaceId;

		return {
			clientId,
			clientSecret,
			refreshToken: repo.linearRefreshToken,
			workspaceId,
			onTokenRefresh: async (tokens) => {
				// Update repository config state (for EdgeWorker's internal tracking)
				for (const [, repository] of this.repositories) {
					if (repository.linearWorkspaceId === workspaceId) {
						repository.linearToken = tokens.accessToken;
						repository.linearRefreshToken = tokens.refreshToken;
					}
				}

				// Persist tokens to config.json
				await this.saveOAuthTokens({
					linearToken: tokens.accessToken,
					linearRefreshToken: tokens.refreshToken,
					linearWorkspaceId: workspaceId,
					linearWorkspaceName: workspaceName,
				});
			},
		};
	}

	/**
	 * Save OAuth tokens to config.json
	 */
	private async saveOAuthTokens(tokens: {
		linearToken: string;
		linearRefreshToken?: string;
		linearWorkspaceId: string;
		linearWorkspaceName?: string;
	}): Promise<void> {
		if (!this.configPath) {
			this.logger.warn("No config path set, cannot save OAuth tokens");
			return;
		}

		try {
			const configContent = await readFile(this.configPath, "utf-8");
			const config = JSON.parse(configContent);

			// Find and update all repositories with this workspace ID
			if (config.repositories && Array.isArray(config.repositories)) {
				for (const repo of config.repositories) {
					if (repo.linearWorkspaceId === tokens.linearWorkspaceId) {
						repo.linearToken = tokens.linearToken;
						if (tokens.linearRefreshToken) {
							repo.linearRefreshToken = tokens.linearRefreshToken;
						}
						if (tokens.linearWorkspaceName) {
							repo.linearWorkspaceName = tokens.linearWorkspaceName;
						}
					}
				}
			}

			await writeFile(this.configPath, JSON.stringify(config, null, "\t"));
			this.logger.debug(
				`OAuth tokens saved to config for workspace ${tokens.linearWorkspaceId}`,
			);
		} catch (error) {
			this.logger.error("Failed to save OAuth tokens:", error);
		}
	}
}
