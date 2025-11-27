import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LinearClient, type Issue as LinearIssue } from "@linear/sdk";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import type {
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	PostToolUseHookInput,
	SDKMessage,
} from "cyrus-claude-runner";
import {
	AbortError,
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
	AgentEvent,
	AgentRunnerConfig,
	AgentSessionCreatedWebhook,
	AgentSessionPromptedWebhook,
	Comment,
	CyrusAgentSession,
	EdgeWorkerConfig,
	GuidanceRule,
	IAgentRunner,
	IIssueTrackerService,
	IssueMinimal,
	IssueUnassignedWebhook,
	RepositoryConfig,
	SerializableEdgeWorkerState,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
	Webhook,
	WebhookAgentSession,
	WebhookComment,
	WebhookIssue,
} from "cyrus-core";
import {
	DEFAULT_PROXY_URL,
	isAgentSessionCreatedWebhook,
	isAgentSessionPromptedWebhook,
	isIssueAssignedWebhook,
	isIssueCommentMentionWebhook,
	isIssueNewCommentWebhook,
	isIssueUnassignedWebhook,
	PersistenceManager,
	resolvePath,
} from "cyrus-core";
import { GeminiRunner } from "cyrus-gemini-runner";
import {
	LinearEventTransport,
	LinearIssueTrackerService,
} from "cyrus-linear-event-transport";
import { fileTypeFromBuffer } from "file-type";
import { AgentSessionManager } from "./AgentSessionManager.js";
import {
	type ProcedureDefinition,
	ProcedureRouter,
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
import type { AgentSessionData, EdgeWorkerEvents } from "./types.js";

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
	private configUpdater: ConfigUpdater | null = null; // Single config updater for configuration updates
	private persistenceManager: PersistenceManager;
	private sharedApplicationServer: SharedApplicationServer;
	private cyrusHome: string;
	private childToParentAgentSession: Map<string, string> = new Map(); // Maps child agentSessionId to parent agentSessionId
	private rawLinearClients: Map<string, LinearClient> = new Map(); // Raw clients - proxies delegate to these
	private procedureRouter: ProcedureRouter; // Intelligent workflow routing
	private configWatcher?: FSWatcher; // File watcher for config.json
	private configPath?: string; // Path to config.json file
	/** @internal - Exposed for testing only */
	public repositoryRouter: RepositoryRouter; // Repository routing and selection
	private pendingRefreshes: Map<
		string,
		Promise<{ success: boolean; newToken?: string }>
	> = new Map(); // Coalesces concurrent token refreshes per workspace

	constructor(config: EdgeWorkerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		this.persistenceManager = new PersistenceManager(
			join(this.cyrusHome, "state"),
		);

		// Initialize procedure router with haiku for fast classification
		// Default to claude runner
		this.procedureRouter = new ProcedureRouter({
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

		console.log(
			`[EdgeWorker Constructor] Initializing parent-child session mapping system`,
		);
		console.log(
			`[EdgeWorker Constructor] Parent-child mapping initialized with 0 entries`,
		);

		// Initialize shared application server
		const serverPort = config.serverPort || config.webhookPort || 3456;
		const serverHost = config.serverHost || "localhost";
		this.sharedApplicationServer = new SharedApplicationServer(
			serverPort,
			serverHost,
			this.saveOAuthTokens.bind(this),
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
				// Store raw client in Map, create stable proxy that looks it up
				const rawClient = new LinearClient({
					accessToken: repo.linearToken,
				});
				this.rawLinearClients.set(repo.id, rawClient);
				const clientProxy = this.createLinearClientProxy(repo.id);
				const issueTracker = new LinearIssueTrackerService(clientProxy);
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
				const agentSessionManager = new AgentSessionManager(
					issueTracker,
					(childSessionId: string) => {
						console.log(
							`[Parent-Child Lookup] Looking up parent session for child ${childSessionId}`,
						);
						const parentId = this.childToParentAgentSession.get(childSessionId);
						console.log(
							`[Parent-Child Lookup] Child ${childSessionId} -> Parent ${parentId || "not found"}`,
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
					this.procedureRouter,
					this.sharedApplicationServer,
				);

				// Subscribe to subroutine completion events
				agentSessionManager.on(
					"subroutineComplete",
					async ({ linearAgentActivitySessionId, session }) => {
						await this.handleSubroutineTransition(
							linearAgentActivitySessionId,
							session,
							repo,
							agentSessionManager,
						);
					},
				);

				this.agentSessionManagers.set(repo.id, agentSessionManager);
			}
		}

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

		// 1. Create and register LinearEventTransport
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

		// Listen for webhook events
		this.linearEventTransport.on("event", (event: AgentEvent) => {
			// Get all active repositories for webhook handling
			const repos = Array.from(this.repositories.values());
			this.handleWebhook(event as unknown as Webhook, repos);
		});

		// Listen for errors
		this.linearEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		// Register the /webhook endpoint
		this.linearEventTransport.register();

		console.log(
			`✅ Linear event transport registered (${verificationMode} mode)`,
		);
		console.log(
			`   Webhook endpoint: ${this.sharedApplicationServer.getWebhookUrl()}`,
		);

		// 2. Create and register ConfigUpdater
		this.configUpdater = new ConfigUpdater(
			this.sharedApplicationServer.getFastifyInstance(),
			this.cyrusHome,
			process.env.CYRUS_API_KEY || "",
		);

		// Register config update routes
		this.configUpdater.register();

		console.log("✅ Config updater registered");
		console.log("   Routes: /api/update/cyrus-config, /api/update/cyrus-env,");
		console.log(
			"           /api/update/repository, /api/test-mcp, /api/configure-mcp",
		);
	}

	/**
	 * Stop the edge worker
	 */
	async stop(): Promise<void> {
		// Stop config file watcher
		if (this.configWatcher) {
			await this.configWatcher.close();
			this.configWatcher = undefined;
			console.log("✅ Config file watcher stopped");
		}

		try {
			await this.savePersistedState();
			console.log("✅ EdgeWorker state saved successfully");
		} catch (error) {
			console.error(
				"❌ Failed to save EdgeWorker state during shutdown:",
				error,
			);
		}

		// get all agent runners
		const agentRunners: IAgentRunner[] = [];
		for (const agentSessionManager of this.agentSessionManagers.values()) {
			agentRunners.push(...agentSessionManager.getAllAgentRunners());
		}

		// Kill all agent processes with null checking
		for (const runner of agentRunners) {
			if (runner) {
				try {
					runner.stop();
				} catch (error) {
					console.error("Error stopping Claude runner:", error);
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
		repo: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
	): Promise<void> {
		console.log(
			`[Parent Session Resume] Child session completed, resuming parent session ${parentSessionId}`,
		);

		// Get the parent session and repository
		console.log(
			`[Parent Session Resume] Retrieving parent session ${parentSessionId} from agent session manager`,
		);
		const parentSession = agentSessionManager.getSession(parentSessionId);
		if (!parentSession) {
			console.error(
				`[Parent Session Resume] Parent session ${parentSessionId} not found in agent session manager`,
			);
			return;
		}

		console.log(
			`[Parent Session Resume] Found parent session - Issue: ${parentSession.issueId}, Workspace: ${parentSession.workspace.path}`,
		);

		// Get the child session to access its workspace path
		const childSession = agentSessionManager.getSession(childSessionId);
		const childWorkspaceDirs: string[] = [];
		if (childSession) {
			childWorkspaceDirs.push(childSession.workspace.path);
			console.log(
				`[Parent Session Resume] Adding child workspace to parent allowed directories: ${childSession.workspace.path}`,
			);
		} else {
			console.warn(
				`[Parent Session Resume] Could not find child session ${childSessionId} to add workspace to parent allowed directories`,
			);
		}

		await this.postParentResumeAcknowledgment(parentSessionId, repo.id);

		// Post thought to Linear showing child result receipt
		const issueTracker = this.issueTrackers.get(repo.id);
		if (issueTracker && childSession) {
			const childIssueIdentifier =
				childSession.issue?.identifier || childSession.issueId;
			const resultThought = `Received result from sub-issue ${childIssueIdentifier}:\n\n---\n\n${prompt}\n\n---`;

			try {
				const result = await issueTracker.createAgentActivity({
					agentSessionId: parentSessionId,
					content: {
						type: "thought",
						body: resultThought,
					},
				});

				if (result.success) {
					console.log(
						`[Parent Session Resume] Posted child result receipt thought for parent session ${parentSessionId}`,
					);
				} else {
					console.error(
						`[Parent Session Resume] Failed to post child result receipt thought:`,
						result,
					);
				}
			} catch (error) {
				console.error(
					`[Parent Session Resume] Error posting child result receipt thought:`,
					error,
				);
			}
		}

		// Use centralized streaming check and routing logic
		console.log(
			`[Parent Session Resume] Handling child result for parent session ${parentSessionId}`,
		);
		try {
			await this.handlePromptWithStreamingCheck(
				parentSession,
				repo,
				parentSessionId,
				agentSessionManager,
				prompt,
				"", // No attachment manifest for child results
				false, // Not a new session
				childWorkspaceDirs, // Add child workspace directories to parent's allowed directories
				"parent resume from child",
			);
			console.log(
				`[Parent Session Resume] Successfully handled child result for parent session ${parentSessionId}`,
			);
		} catch (error) {
			console.error(
				`[Parent Session Resume] Failed to resume parent session ${parentSessionId}:`,
				error,
			);
			console.error(
				`[Parent Session Resume] Error context - Parent issue: ${parentSession.issueId}, Repository: ${repo.name}`,
			);
		}
	}

	/**
	 * Handle subroutine transition when a subroutine completes
	 * This is triggered by the AgentSessionManager's 'subroutineComplete' event
	 */
	private async handleSubroutineTransition(
		linearAgentActivitySessionId: string,
		session: CyrusAgentSession,
		repo: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
	): Promise<void> {
		console.log(
			`[Subroutine Transition] Handling subroutine completion for session ${linearAgentActivitySessionId}`,
		);

		// Get next subroutine (advancement already handled by AgentSessionManager)
		const nextSubroutine = this.procedureRouter.getCurrentSubroutine(session);

		if (!nextSubroutine) {
			console.log(
				`[Subroutine Transition] Procedure complete for session ${linearAgentActivitySessionId}`,
			);
			return;
		}

		console.log(
			`[Subroutine Transition] Next subroutine: ${nextSubroutine.name}`,
		);

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
			console.error(
				`[Subroutine Transition] Failed to load subroutine prompt:`,
				error,
			);
			// Fallback to simple prompt
			subroutinePrompt = `Continue with: ${nextSubroutine.description}`;
		}

		// Resume Claude session with subroutine prompt
		try {
			await this.resumeAgentSession(
				session,
				repo,
				linearAgentActivitySessionId,
				agentSessionManager,
				subroutinePrompt,
				"", // No attachment manifest
				false, // Not a new session
				[], // No additional allowed directories
				nextSubroutine?.singleTurn ? 1 : undefined, // Convert singleTurn to maxTurns: 1
			);
			console.log(
				`[Subroutine Transition] Successfully resumed session for ${nextSubroutine.name} subroutine${nextSubroutine.singleTurn ? " (singleTurn)" : ""}`,
			);
		} catch (error) {
			console.error(
				`[Subroutine Transition] Failed to resume session for ${nextSubroutine.name} subroutine:`,
				error,
			);
		}
	}

	/**
	 * Start watching config file for changes
	 */
	private startConfigWatcher(): void {
		if (!this.configPath) {
			console.warn("⚠️  No config path set, skipping config file watcher");
			return;
		}

		console.log(`👀 Watching config file for changes: ${this.configPath}`);

		this.configWatcher = chokidarWatch(this.configPath, {
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 500,
				pollInterval: 100,
			},
		});

		this.configWatcher.on("change", async () => {
			console.log("🔄 Config file changed, reloading...");
			await this.handleConfigChange();
		});

		this.configWatcher.on("error", (error: unknown) => {
			console.error("❌ Config watcher error:", error);
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
				console.log("ℹ️  No repository changes detected");
				return;
			}

			console.log(
				`📊 Repository changes detected: ${changes.added.length} added, ${changes.modified.length} modified, ${changes.removed.length} removed`,
			);

			// Apply changes incrementally
			await this.removeDeletedRepositories(changes.removed);
			await this.updateModifiedRepositories(changes.modified);
			await this.addNewRepositories(changes.added);

			// Update config reference
			this.config = newConfig;

			console.log("✅ Configuration reloaded successfully");
		} catch (error) {
			console.error("❌ Failed to reload configuration:", error);
		}
	}

	/**
	 * Safely load configuration from file with validation
	 */
	private async loadConfigSafely(): Promise<EdgeWorkerConfig | null> {
		try {
			if (!this.configPath) {
				console.error("❌ No config path set");
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
			};

			// Basic validation
			if (!Array.isArray(newConfig.repositories)) {
				console.error("❌ Invalid config: repositories must be an array");
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
					console.error(
						`❌ Invalid repository config: missing required fields (id, name, repositoryPath, baseBranch)`,
						repo,
					);
					return null;
				}
			}

			return newConfig;
		} catch (error) {
			console.error("❌ Failed to load config file:", error);
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
				console.log(`⏭️  Skipping inactive repository: ${repo.name}`);
				continue;
			}

			try {
				console.log(`➕ Adding repository: ${repo.name} (${repo.id})`);

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

				// Create issue tracker - store raw client, create stable proxy
				const rawClient = new LinearClient({
					accessToken: repo.linearToken,
				});
				this.rawLinearClients.set(repo.id, rawClient);
				const clientProxy = this.createLinearClientProxy(repo.id);
				const issueTracker = new LinearIssueTrackerService(clientProxy);
				this.issueTrackers.set(repo.id, issueTracker);

				// Create AgentSessionManager with same pattern as constructor
				const agentSessionManager = new AgentSessionManager(
					issueTracker,
					(childSessionId: string) => {
						return this.childToParentAgentSession.get(childSessionId);
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
					this.procedureRouter,
					this.sharedApplicationServer,
				);

				// Subscribe to subroutine completion events
				agentSessionManager.on(
					"subroutineComplete",
					async ({ linearAgentActivitySessionId, session }) => {
						await this.handleSubroutineTransition(
							linearAgentActivitySessionId,
							session,
							repo,
							agentSessionManager,
						);
					},
				);

				this.agentSessionManagers.set(repo.id, agentSessionManager);

				console.log(`✅ Repository added successfully: ${repo.name}`);
			} catch (error) {
				console.error(`❌ Failed to add repository ${repo.name}:`, error);
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
					console.warn(
						`⚠️  Repository ${repo.id} not found for update, skipping`,
					);
					continue;
				}

				console.log(`🔄 Updating repository: ${repo.name} (${repo.id})`);

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

				// If token changed, just update the raw client - proxy automatically uses it
				if (oldRepo.linearToken !== repo.linearToken) {
					console.log(`  🔑 Token changed, updating raw client`);
					const newRawClient = new LinearClient({
						accessToken: repo.linearToken,
					});
					this.rawLinearClients.set(repo.id, newRawClient);
					// No need to update issueTracker - the proxy automatically uses the new client
				}

				// If active status changed
				if (oldRepo.isActive !== repo.isActive) {
					if (repo.isActive === false) {
						console.log(
							`  ⏸️  Repository set to inactive - existing sessions will continue`,
						);
					} else {
						console.log(`  ▶️  Repository reactivated`);
					}
				}

				console.log(`✅ Repository updated successfully: ${repo.name}`);
			} catch (error) {
				console.error(`❌ Failed to update repository ${repo.name}:`, error);
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
				console.log(`🗑️  Removing repository: ${repo.name} (${repo.id})`);

				// Check for active sessions
				const manager = this.agentSessionManagers.get(repo.id);
				const activeSessions = manager?.getActiveSessions() || [];

				if (activeSessions.length > 0) {
					console.warn(
						`  ⚠️  Repository has ${activeSessions.length} active sessions - stopping them`,
					);

					// Stop all active sessions and notify Linear
					for (const session of activeSessions) {
						try {
							console.log(`  🛑 Stopping session for issue ${session.issueId}`);

							// Get the agent runner for this session
							const runner = manager?.getAgentRunner(
								session.linearAgentActivitySessionId,
							);
							if (runner) {
								// Stop the agent process
								runner.stop();
								console.log(
									`  ✅ Stopped Claude runner for session ${session.linearAgentActivitySessionId}`,
								);
							}

							// Post cancellation message to Linear
							const issueTracker = this.issueTrackers.get(repo.id);
							if (issueTracker) {
								await issueTracker.createAgentActivity({
									agentSessionId: session.linearAgentActivitySessionId,
									content: {
										type: "response",
										body: `**Repository Removed from Configuration**\n\nThis repository (\`${repo.name}\`) has been removed from the Cyrus configuration. All active sessions for this repository have been stopped.\n\nIf you need to continue working on this issue, please contact your administrator to restore the repository configuration.`,
									},
								});
								console.log(
									`  📤 Posted cancellation message to Linear for issue ${session.issueId}`,
								);
							}
						} catch (error) {
							console.error(
								`  ❌ Failed to stop session ${session.linearAgentActivitySessionId}:`,
								error,
							);
						}
					}
				}

				// Remove repository from all maps
				this.repositories.delete(repo.id);
				this.issueTrackers.delete(repo.id);
				this.agentSessionManagers.delete(repo.id);

				console.log(`✅ Repository removed successfully: ${repo.name}`);
			} catch (error) {
				console.error(`❌ Failed to remove repository ${repo.name}:`, error);
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
		retryCount: number = 0,
	): Promise<void> {
		// Log verbose webhook info if enabled
		if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
			console.log(
				`[handleWebhook] Full webhook payload:`,
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
			} else {
				if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
					console.log(
						`[handleWebhook] Unhandled webhook type: ${(webhook as any).action}`,
					);
				}
			}
		} catch (error) {
			// Check if token expired and we haven't retried yet
			if (this.isTokenExpiredError(error) && retryCount === 0) {
				console.log("[EdgeWorker] Token expired, refreshing and retrying...");

				// Get the first repository from the list - they all share the same workspace
				const firstRepo = repos[0];
				if (firstRepo) {
					await this.refreshLinearToken(firstRepo.id);
					return await this.handleWebhook(webhook, repos, 1);
				}
			}

			console.error(
				`[handleWebhook] Failed to process webhook: ${(webhook as any).action}`,
				error,
			);

			// Don't re-throw webhook processing errors to prevent application crashes
			// The error has been logged and individual webhook failures shouldn't crash the entire system
		}
	}

	/**
	 * Handle issue unassignment webhook
	 */
	private async handleIssueUnassignedWebhook(
		webhook: IssueUnassignedWebhook,
	): Promise<void> {
		if (!webhook.notification.issue) {
			console.warn(
				"[EdgeWorker] Received issue unassignment webhook without issue",
			);
			return;
		}

		const issueId = webhook.notification.issue.id;

		// Get cached repository (unassignment should only happen on issues with active sessions)
		const repository = this.getCachedRepository(issueId);
		if (!repository) {
			console.log(
				`[EdgeWorker] No cached repository for issue unassignment webhook ${webhook.notification.issue.identifier} (no active sessions to stop)`,
			);
			return;
		}

		console.log(
			`[EdgeWorker] Handling issue unassignment: ${webhook.notification.issue.identifier}`,
		);

		// Log the complete webhook payload for TypeScript type definition
		// console.log('=== ISSUE UNASSIGNMENT WEBHOOK PAYLOAD ===')
		// console.log(JSON.stringify(webhook, null, 2))
		// console.log('=== END WEBHOOK PAYLOAD ===')

		await this.handleIssueUnassigned(webhook.notification.issue, repository);
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
	 * @param linearAgentActivitySessionId The Linear agent activity session ID
	 * @param issue Linear issue object
	 * @param repository Repository configuration
	 * @param agentSessionManager Agent session manager instance
	 * @returns Object containing session details and setup information
	 */
	private async createLinearAgentSession(
		linearAgentActivitySessionId: string,
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
		const workspace = this.config.handlers?.createWorkspace
			? await this.config.handlers.createWorkspace(fullIssue, repository)
			: {
					path: `${repository.workspaceBaseDir}/${fullIssue.identifier}`,
					isGitWorktree: false,
				};

		console.log(`[EdgeWorker] Workspace created at: ${workspace.path}`);

		const issueMinimal = this.convertLinearIssueToCore(fullIssue);
		agentSessionManager.createLinearAgentSession(
			linearAgentActivitySessionId,
			issue.id,
			issueMinimal,
			workspace,
		);

		// Get the newly created session
		const session = agentSessionManager.getSession(
			linearAgentActivitySessionId,
		);
		if (!session) {
			throw new Error(
				`Failed to create session for agent activity session ${linearAgentActivitySessionId}`,
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

		console.log(
			`[EdgeWorker] Configured allowed directories for ${fullIssue.identifier}:`,
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
				console.log(
					`[EdgeWorker] Using cached repository ${repository.name} for issue ${issueId}`,
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
					console.log(
						`[EdgeWorker] No repository configured for webhook from workspace ${webhook.organizationId}`,
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
			console.warn("[EdgeWorker] Agent session created webhook missing issue");
			return;
		}

		console.log(
			`[EdgeWorker] Handling agent session created: ${webhook.agentSession.issue.identifier}`,
		);
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
		const linearAgentActivitySessionId = agentSession.id;
		const { issue } = agentSession;

		if (!issue) {
			console.warn(
				"[EdgeWorker] Cannot initialize Claude runner without issue",
			);
			return;
		}

		// Log guidance if present
		if (guidance && guidance.length > 0) {
			console.log(
				`[EdgeWorker] Agent guidance received: ${guidance.length} rule(s)`,
			);
			for (const rule of guidance) {
				let origin = "Unknown";
				if (rule.origin) {
					if (rule.origin.__typename === "TeamOriginWebhookPayload") {
						origin = `Team: ${rule.origin.team.displayName}`;
					} else {
						origin = "Organization";
					}
				}
				console.log(
					`[EdgeWorker]   - ${origin}: ${rule.body.substring(0, 100)}...`,
				);
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
			console.error(
				"There was no agentSessionManage for the repository with id",
				repository.id,
			);
			return;
		}

		// Post instant acknowledgment thought
		await this.postInstantAcknowledgment(
			linearAgentActivitySessionId,
			repository.id,
		);

		// Create the session using the shared method
		const sessionData = await this.createLinearAgentSession(
			linearAgentActivitySessionId,
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
		await agentSessionManager.postRoutingThought(linearAgentActivitySessionId);

		// Fetch labels early (needed for label override check)
		const labels = await this.fetchIssueLabels(fullIssue);

		// Check for label overrides BEFORE AI routing
		const debuggerConfig = repository.labelPrompts?.debugger;
		const debuggerLabels = Array.isArray(debuggerConfig)
			? debuggerConfig
			: debuggerConfig?.labels;
		const hasDebuggerLabel = debuggerLabels?.some((label) =>
			labels.includes(label),
		);

		const orchestratorConfig = repository.labelPrompts?.orchestrator;
		const orchestratorLabels = Array.isArray(orchestratorConfig)
			? orchestratorConfig
			: orchestratorConfig?.labels;
		const hasOrchestratorLabel = orchestratorLabels?.some((label) =>
			labels.includes(label),
		);

		let finalProcedure: ProcedureDefinition;
		let finalClassification: RequestClassification;

		// If labels indicate a specific procedure, use that instead of AI routing
		if (hasDebuggerLabel) {
			const debuggerProcedure =
				this.procedureRouter.getProcedure("debugger-full");
			if (!debuggerProcedure) {
				throw new Error("debugger-full procedure not found in registry");
			}
			finalProcedure = debuggerProcedure;
			finalClassification = "debugger";
			console.log(
				`[EdgeWorker] Using debugger-full procedure due to debugger label (skipping AI routing)`,
			);
		} else if (hasOrchestratorLabel) {
			const orchestratorProcedure =
				this.procedureRouter.getProcedure("orchestrator-full");
			if (!orchestratorProcedure) {
				throw new Error("orchestrator-full procedure not found in registry");
			}
			finalProcedure = orchestratorProcedure;
			finalClassification = "orchestrator";
			console.log(
				`[EdgeWorker] Using orchestrator-full procedure due to orchestrator label (skipping AI routing)`,
			);
		} else {
			// No label override - use AI routing
			const issueDescription =
				`${issue.title}\n\n${fullIssue.description || ""}`.trim();
			const routingDecision =
				await this.procedureRouter.determineRoutine(issueDescription);
			finalProcedure = routingDecision.procedure;
			finalClassification = routingDecision.classification;

			// Log AI routing decision
			console.log(
				`[EdgeWorker] AI routing decision for ${linearAgentActivitySessionId}:`,
			);
			console.log(`  Classification: ${routingDecision.classification}`);
			console.log(`  Procedure: ${finalProcedure.name}`);
			console.log(`  Reasoning: ${routingDecision.reasoning}`);
		}

		// Initialize procedure metadata in session with final decision
		this.procedureRouter.initializeProcedureMetadata(session, finalProcedure);

		// Post single procedure selection result (replaces ephemeral routing thought)
		await agentSessionManager.postProcedureSelectionThought(
			linearAgentActivitySessionId,
			finalProcedure.name,
			finalClassification,
		);

		// Build and start Claude with initial prompt using full issue (streaming mode)
		console.log(
			`[EdgeWorker] Building initial prompt for issue ${fullIssue.identifier}`,
		);
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
						linearAgentActivitySessionId,
						labels,
						repository.id,
					);
				}
			}

			// Build allowed tools list with Linear MCP tools (now with prompt type context)
			const allowedTools = this.buildAllowedTools(repository, promptType);
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

			console.log(
				`[EdgeWorker] Configured allowed tools for ${fullIssue.identifier}:`,
				allowedTools,
			);
			if (disallowedTools.length > 0) {
				console.log(
					`[EdgeWorker] Configured disallowed tools for ${fullIssue.identifier}:`,
					disallowedTools,
				);
			}

			// Get current subroutine to check for singleTurn mode
			const currentSubroutine =
				this.procedureRouter.getCurrentSubroutine(session);

			// Create agent runner with system prompt from assembly
			// buildAgentRunnerConfig now determines runner type from labels internally
			const { config: runnerConfig, runnerType } = this.buildAgentRunnerConfig(
				session,
				repository,
				linearAgentActivitySessionId,
				assembly.systemPrompt,
				allowedTools,
				allowedDirectories,
				disallowedTools,
				undefined, // resumeSessionId
				labels, // Pass labels for runner selection and model override
				undefined, // maxTurns
				currentSubroutine?.singleTurn, // singleTurn flag
			);

			console.log(
				`[EdgeWorker] Label-based runner selection for new session: ${runnerType} (session ${linearAgentActivitySessionId})`,
			);

			const runner =
				runnerType === "claude"
					? new ClaudeRunner(runnerConfig)
					: new GeminiRunner(runnerConfig);

			// Store runner by comment ID
			agentSessionManager.addAgentRunner(linearAgentActivitySessionId, runner);

			// Save state after mapping changes
			await this.savePersistedState();

			// Emit events using full Linear issue
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
			console.log(
				`[EdgeWorker] Initial prompt built successfully - components: ${assembly.metadata.components.join(", ")}, type: ${assembly.metadata.promptType}, length: ${assembly.userPrompt.length} characters`,
			);

			// Start session - use streaming mode if supported for ability to add messages later
			if (runner.supportsStreamingInput && runner.startStreaming) {
				console.log(`[EdgeWorker] Starting streaming session`);
				const sessionInfo = await runner.startStreaming(assembly.userPrompt);
				console.log(
					`[EdgeWorker] Streaming session started: ${sessionInfo.sessionId}`,
				);
			} else {
				console.log(`[EdgeWorker] Starting non-streaming session`);
				const sessionInfo = await runner.start(assembly.userPrompt);
				console.log(
					`[EdgeWorker] Non-streaming session started: ${sessionInfo.sessionId}`,
				);
			}
			// Note: AgentSessionManager will be initialized automatically when the first system message
			// is received via handleClaudeMessage() callback
		} catch (error) {
			console.error(`[EdgeWorker] Error in prompt building/starting:`, error);
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

		console.log(
			`[EdgeWorker] Received stop signal for agent activity session ${agentSessionId}`,
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
			console.warn(
				`[EdgeWorker] No session found for stop signal: ${agentSessionId}`,
			);
			return;
		}

		// Stop the existing runner if it's active
		const existingRunner = foundSession.agentRunner;
		if (existingRunner) {
			existingRunner.stop();
			console.log(
				`[EdgeWorker] Stopped agent session for agent activity session ${agentSessionId}`,
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

		if (!agentActivity) {
			console.warn(
				"[EdgeWorker] Cannot handle repository selection without agentActivity",
			);
			return;
		}

		if (!agentSession.issue) {
			console.warn(
				"[EdgeWorker] Cannot handle repository selection without issue",
			);
			return;
		}

		const userMessage = agentActivity.content.body;

		console.log(
			`[EdgeWorker] Processing repository selection response: "${userMessage}"`,
		);

		// Get the selected repository (or fallback)
		const repository = await this.repositoryRouter.selectRepositoryFromResponse(
			agentSessionId,
			userMessage,
		);

		if (!repository) {
			console.error(
				`[EdgeWorker] Failed to select repository for agent session ${agentSessionId}`,
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

		console.log(
			`[EdgeWorker] Initializing agent runner after repository selection: ${agentSession.issue.identifier} -> ${repository.name}`,
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
	 * Handle normal prompted activity (existing session continuation)
	 * Branch 3 of agentSessionPrompted (see packages/CLAUDE.md)
	 */
	private async handleNormalPromptedActivity(
		webhook: AgentSessionPromptedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		const { agentSession } = webhook;
		const linearAgentActivitySessionId = agentSession.id;
		const { issue } = agentSession;

		if (!issue) {
			console.warn(
				"[EdgeWorker] Cannot handle prompted activity without issue",
			);
			return;
		}

		if (!webhook.agentActivity) {
			console.warn(
				"[EdgeWorker] Cannot handle prompted activity without agentActivity",
			);
			return;
		}

		const commentId = webhook.agentActivity.sourceCommentId;

		// Initialize the agent session in AgentSessionManager
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			console.error(
				"Unexpected: There was no agentSessionManage for the repository with id",
				repository.id,
			);
			return;
		}

		let session = agentSessionManager.getSession(linearAgentActivitySessionId);
		let isNewSession = false;
		let fullIssue: LinearIssue | null = null;

		if (!session) {
			console.log(
				`[EdgeWorker] No existing session found for agent activity session ${linearAgentActivitySessionId}, creating new session`,
			);
			isNewSession = true;

			// Post instant acknowledgment for new session creation
			await this.postInstantPromptedAcknowledgment(
				linearAgentActivitySessionId,
				repository.id,
				false,
			);

			// Create the session using the shared method
			const sessionData = await this.createLinearAgentSession(
				linearAgentActivitySessionId,
				issue,
				repository,
				agentSessionManager,
			);

			// Destructure session data for new session
			fullIssue = sessionData.fullIssue;
			session = sessionData.session;

			console.log(
				`[EdgeWorker] Created new session ${linearAgentActivitySessionId} (prompted webhook)`,
			);

			// Save state and emit events for new session
			await this.savePersistedState();
			this.emit("session:started", fullIssue.id, fullIssue, repository.id);
			this.config.handlers?.onSessionStart?.(
				fullIssue.id,
				fullIssue,
				repository.id,
			);
		} else {
			console.log(
				`[EdgeWorker] Found existing session ${linearAgentActivitySessionId} for new user prompt`,
			);

			// Post instant acknowledgment for existing session BEFORE any async work
			// Check if runner is currently running (streaming is Claude-specific, use isRunning for both)
			const isCurrentlyStreaming = session?.agentRunner?.isRunning() || false;

			await this.postInstantPromptedAcknowledgment(
				linearAgentActivitySessionId,
				repository.id,
				isCurrentlyStreaming,
			);

			// Need to fetch full issue for routing context
			const issueTracker = this.issueTrackers.get(repository.id);
			if (issueTracker) {
				try {
					fullIssue = await issueTracker.fetchIssue(issue.id);
				} catch (error) {
					console.warn(
						`[EdgeWorker] Failed to fetch full issue for routing: ${issue.id}`,
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
				`Failed to get or create session for agent activity session ${linearAgentActivitySessionId}`,
			);
		}

		// Acknowledgment already posted above for both new and existing sessions
		// (before any async routing work to ensure instant user feedback)

		// Get issue tracker for this repository
		const issueTracker = this.issueTrackers.get(repository.id);
		if (!issueTracker) {
			console.error(
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
			console.warn(
				"[EdgeWorker] No comment ID provided for attachment handling",
			);
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
			console.error("Failed to fetch comments for attachments:", error);
		}

		const promptBody = webhook.agentActivity.content.body;

		// Use centralized streaming check and routing logic
		try {
			await this.handlePromptWithStreamingCheck(
				session,
				repository,
				linearAgentActivitySessionId,
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
			console.error("Failed to handle prompted webhook:", error);
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

		// Branch 3: Handle normal prompted activity (existing session continuation)
		// Per CLAUDE.md: "an agentSession MUST exist and a repository MUST already
		// be associated with the Linear issue. The repository will be retrieved from
		// the issue-to-repository cache - no new routing logic is performed."
		const issueId = webhook.agentSession?.issue?.id;
		if (!issueId) {
			console.error(
				`[EdgeWorker] No issue ID found in prompted webhook ${agentSessionId}`,
			);
			return;
		}

		const repository = this.getCachedRepository(issueId);
		if (!repository) {
			console.warn(
				`[EdgeWorker] No cached repository found for prompted webhook ${agentSessionId}`,
			);
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
			console.log(
				"No agentSessionManager for unassigned issue, so no sessions to stop",
			);
			return;
		}

		// Get all agent runners for this specific issue
		const agentRunners = agentSessionManager.getAgentRunnersForIssue(issue.id);

		// Stop all agent runners for this issue
		const activeThreadCount = agentRunners.length;
		for (const runner of agentRunners) {
			console.log(
				`[EdgeWorker] Stopping agent runner for issue ${issue.identifier}`,
			);
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
		console.log(
			`[EdgeWorker] Stopped ${activeThreadCount} sessions for unassigned issue ${issue.identifier}`,
		);
	}

	/**
	 * Handle Claude messages
	 */
	private async handleClaudeMessage(
		linearAgentActivitySessionId: string,
		message: SDKMessage,
		repositoryId: string,
	): Promise<void> {
		const agentSessionManager = this.agentSessionManagers.get(repositoryId);
		// Integrate with AgentSessionManager to capture streaming messages
		if (agentSessionManager) {
			await agentSessionManager.handleClaudeMessage(
				linearAgentActivitySessionId,
				message,
			);
		}
	}

	/**
	 * Handle Claude session error
	 * Silently ignores AbortError (user-initiated stop), logs other errors
	 */
	private async handleClaudeError(error: Error): Promise<void> {
		// AbortError is expected when user stops Claude process, don't log it
		if (error instanceof AbortError) {
			return;
		}
		console.error("Unhandled claude error:", error);
	}

	/**
	 * Fetch issue labels for a given issue
	 */
	private async fetchIssueLabels(issue: LinearIssue): Promise<string[]> {
		try {
			const labels = await issue.labels();
			return labels.nodes.map((label) => label.name);
		} catch (error) {
			console.error(
				`[EdgeWorker] Failed to fetch labels for issue ${issue.id}:`,
				error,
			);
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
				modelOverride: "sonnet",
				fallbackModelOverride: "haiku",
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
		// Default to claude if no runner labels found
		return {
			runnerType: "claude",
			modelOverride: "sonnet",
			fallbackModelOverride: "haiku",
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
				type?: "debugger" | "builder" | "scoper" | "orchestrator";
		  }
		| undefined
	> {
		if (!repository.labelPrompts || labels.length === 0) {
			return undefined;
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

			if (configuredLabels?.some((label) => labels.includes(label))) {
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
					console.log(
						`[EdgeWorker] Using ${promptType} system prompt for labels: ${labels.join(", ")}`,
					);

					// Extract and log version tag if present
					const promptVersion = this.extractVersionTag(promptContent);
					if (promptVersion) {
						console.log(
							`[EdgeWorker] ${promptType} system prompt version: ${promptVersion}`,
						);
					}

					return {
						prompt: promptContent,
						version: promptVersion,
						type: promptType,
					};
				} catch (error) {
					console.error(
						`[EdgeWorker] Failed to load ${promptType} prompt template:`,
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
		issue: LinearIssue,
		repository: RepositoryConfig,
		attachmentManifest: string = "",
		guidance?: GuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		console.log(
			`[EdgeWorker] buildLabelBasedPrompt called for issue ${issue.identifier}`,
		);

		try {
			// Load the label-based prompt template
			const __filename = fileURLToPath(import.meta.url);
			const __dirname = dirname(__filename);
			const templatePath = resolve(__dirname, "../label-prompt-template.md");

			console.log(
				`[EdgeWorker] Loading label prompt template from: ${templatePath}`,
			);
			const template = await readFile(templatePath, "utf-8");
			console.log(
				`[EdgeWorker] Template loaded, length: ${template.length} characters`,
			);

			// Extract and log version tag if present
			const templateVersion = this.extractVersionTag(template);
			if (templateVersion) {
				console.log(
					`[EdgeWorker] Label prompt template version: ${templateVersion}`,
				);
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
				console.warn(`[EdgeWorker] Failed to fetch assignee details:`, error);
			}

			// Get LinearClient for this repository
			const issueTracker = this.issueTrackers.get(repository.id);
			if (!issueTracker) {
				console.error(
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
				console.log(
					`[EdgeWorker] Fetching workspace teams and labels for repository ${repository.id}`,
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

				console.log(
					`[EdgeWorker] Fetched ${teamsArray.length} teams and ${labelsArray.length} labels`,
				);
			} catch (error) {
				console.warn(
					`[EdgeWorker] Failed to fetch workspace teams and labels:`,
					error,
				);
			}

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
				.replace(/{{workspace_labels}}/g, workspaceLabels);

			// Append agent guidance if present
			prompt += this.formatAgentGuidance(guidance);

			if (attachmentManifest) {
				console.log(
					`[EdgeWorker] Adding attachment manifest to label-based prompt, length: ${attachmentManifest.length} characters`,
				);
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			console.log(
				`[EdgeWorker] Label-based prompt built successfully, length: ${prompt.length} characters`,
			);
			return { prompt, version: templateVersion };
		} catch (error) {
			console.error(`[EdgeWorker] Error building label-based prompt:`, error);
			throw error;
		}
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
		issue: LinearIssue,
		agentSession: WebhookAgentSession,
		attachmentManifest: string = "",
		guidance?: GuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		try {
			console.log(
				`[EdgeWorker] Building mention prompt for issue ${issue.identifier}`,
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
			console.error(`[EdgeWorker] Error building mention prompt:`, error);
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
	 * Check if a branch exists locally or remotely
	 */
	private async branchExists(
		branchName: string,
		repoPath: string,
	): Promise<boolean> {
		const { execSync } = await import("node:child_process");
		try {
			// Check if branch exists locally
			execSync(`git rev-parse --verify "${branchName}"`, {
				cwd: repoPath,
				stdio: "pipe",
			});
			return true;
		} catch {
			// Branch doesn't exist locally, check remote
			try {
				execSync(`git ls-remote --heads origin "${branchName}"`, {
					cwd: repoPath,
					stdio: "pipe",
				});
				return true;
			} catch {
				// Branch doesn't exist remotely either
				return false;
			}
		}
	}

	/**
	 * Determine the base branch for an issue, considering parent issues
	 */
	private async determineBaseBranch(
		issue: LinearIssue,
		repository: RepositoryConfig,
	): Promise<string> {
		// Start with the repository's default base branch
		let baseBranch = repository.baseBranch;

		// Check if issue has a parent
		try {
			const parent = await issue.parent;
			if (parent) {
				console.log(
					`[EdgeWorker] Issue ${issue.identifier} has parent: ${parent.identifier}`,
				);

				// Get parent's branch name
				const parentRawBranchName =
					parent.branchName ||
					`${parent.identifier}-${parent.title
						?.toLowerCase()
						.replace(/\s+/g, "-")
						.substring(0, 30)}`;
				const parentBranchName = this.sanitizeBranchName(parentRawBranchName);

				// Check if parent branch exists
				const parentBranchExists = await this.branchExists(
					parentBranchName,
					repository.repositoryPath,
				);

				if (parentBranchExists) {
					baseBranch = parentBranchName;
					console.log(
						`[EdgeWorker] Using parent issue branch '${parentBranchName}' as base for sub-issue ${issue.identifier}`,
					);
				} else {
					console.log(
						`[EdgeWorker] Parent branch '${parentBranchName}' not found, using default base branch '${repository.baseBranch}'`,
					);
				}
			}
		} catch (_error) {
			// Parent field might not exist or couldn't be fetched, use default base branch
			console.log(
				`[EdgeWorker] No parent issue found for ${issue.identifier}, using default base branch '${repository.baseBranch}'`,
			);
		}

		return baseBranch;
	}

	/**
	 * Convert full Linear SDK issue to CoreIssue interface for Session creation
	 */
	private convertLinearIssueToCore(issue: LinearIssue): IssueMinimal {
		return {
			id: issue.id,
			identifier: issue.identifier,
			title: issue.title || "",
			description: issue.description || undefined,
			branchName: issue.branchName, // Use the real branchName property!
		};
	}

	/**
	 * Sanitize branch name by removing backticks to prevent command injection
	 */
	private sanitizeBranchName(name: string): string {
		return name ? name.replace(/`/g, "") : name;
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
		issue: LinearIssue,
		repository: RepositoryConfig,
		newComment?: WebhookComment,
		attachmentManifest: string = "",
		guidance?: GuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		console.log(
			`[EdgeWorker] buildIssueContextPrompt called for issue ${issue.identifier}${newComment ? " with new comment" : ""}`,
		);

		try {
			// Use custom template if provided (repository-specific takes precedence)
			let templatePath =
				repository.promptTemplatePath ||
				this.config.features?.promptTemplatePath;

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
			console.log(`[EdgeWorker] Loading prompt template from: ${templatePath}`);
			const template = await readFile(templatePath, "utf-8");
			console.log(
				`[EdgeWorker] Template loaded, length: ${template.length} characters`,
			);

			// Extract and log version tag if present
			const templateVersion = this.extractVersionTag(template);
			if (templateVersion) {
				console.log(`[EdgeWorker] Prompt template version: ${templateVersion}`);
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
					console.log(
						`[EdgeWorker] Fetching comments for issue ${issue.identifier}`,
					);
					const comments = await issueTracker.fetchComments(issue.id);

					const commentNodes = comments.nodes;
					if (commentNodes.length > 0) {
						commentThreads = await this.formatCommentThreads(commentNodes);
						console.log(
							`[EdgeWorker] Formatted ${commentNodes.length} comments into threads`,
						);
					}
				} catch (error) {
					console.error("Failed to fetch comments:", error);
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
				.replace(/{{branch_name}}/g, this.sanitizeBranchName(issue.branchName));

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
						console.error("Failed to fetch comment author:", error);
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
				console.log(
					`[EdgeWorker] Adding attachment manifest, length: ${attachmentManifest.length} characters`,
				);
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			// Append repository-specific instruction if provided
			if (repository.appendInstruction) {
				console.log(`[EdgeWorker] Adding repository-specific instruction`);
				prompt = `${prompt}\n\n<repository-specific-instruction>\n${repository.appendInstruction}\n</repository-specific-instruction>`;
			}

			console.log(
				`[EdgeWorker] Final prompt length: ${prompt.length} characters`,
			);
			return { prompt, version: templateVersion };
		} catch (error) {
			console.error("[EdgeWorker] Failed to load prompt template:", error);

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
		issue: LinearIssue,
		repositoryId: string,
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(repositoryId);
			if (!issueTracker) {
				console.warn(
					`No issue tracker found for repository ${repositoryId}, skipping state update`,
				);
				return;
			}

			// Check if issue is already in a started state
			const currentState = await issue.state;
			if (currentState?.type === "started") {
				console.log(
					`Issue ${issue.identifier} is already in started state (${currentState.name})`,
				);
				return;
			}

			// Get team for the issue
			const team = await issue.team;
			if (!team) {
				console.warn(
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
			console.log(
				`Moving issue ${issue.identifier} to started state: ${startedState.name}`,
			);
			if (!issue.id) {
				console.warn(
					`Issue ${issue.identifier} has no ID, skipping state update`,
				);
				return;
			}

			await issueTracker.updateIssue(issue.id, {
				stateId: startedState.id,
			});

			console.log(
				`✅ Successfully moved issue ${issue.identifier} to ${startedState.name} state`,
			);
		} catch (error) {
			console.error(
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
		issue: LinearIssue,
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
					console.log(
						`[EdgeWorker] Fetching native attachments for issue ${issue.identifier}`,
					);
					const attachments = await issue.attachments();
					if (attachments?.nodes) {
						for (const attachment of attachments.nodes) {
							nativeAttachments.push({
								title: attachment.title || "Untitled attachment",
								url: attachment.url,
							});
						}
						console.log(
							`[EdgeWorker] Found ${nativeAttachments.length} native attachments`,
						);
					}
				} catch (error) {
					console.error("Failed to fetch native attachments:", error);
				}

				try {
					const comments = await issueTracker.fetchComments(issue.id);
					const commentNodes = comments.nodes;
					for (const comment of commentNodes) {
						const urls = this.extractAttachmentUrls(comment.body);
						commentUrls.push(...urls);
					}
				} catch (error) {
					console.error("Failed to fetch comments for attachments:", error);
				}
			}

			// Combine and deduplicate all URLs
			const allUrls = [...new Set([...descriptionUrls, ...commentUrls])];

			console.log(
				`Found ${allUrls.length} unique attachment URLs in issue ${issue.identifier}`,
			);

			if (allUrls.length > maxAttachments) {
				console.warn(
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
					console.warn(`Failed to download attachment: ${url}`);
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
			console.error("Error downloading attachments:", error);
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
			console.log(`Downloading attachment from: ${attachmentUrl}`);

			const response = await fetch(attachmentUrl, {
				headers: {
					Authorization: `Bearer ${linearToken}`,
				},
			});

			if (!response.ok) {
				console.error(
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
				console.log(
					`Detected file type: ${fileType.mime} (${fileType.ext}), is image: ${isImage}`,
				);
			} else {
				// Try to get extension from URL
				const urlPath = new URL(attachmentUrl).pathname;
				const urlExt = extname(urlPath);
				if (urlExt) {
					detectedExtension = urlExt;
					console.log(`Using extension from URL: ${detectedExtension}`);
				}
			}

			// Write the attachment to disk
			await writeFile(destinationPath, buffer);

			console.log(`Successfully downloaded attachment to: ${destinationPath}`);
			return { success: true, fileType: detectedExtension, isImage };
		} catch (error) {
			console.error(`Error downloading attachment:`, error);
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

		console.log(`Found ${urls.length} attachment URLs in new comment`);

		// Download new attachments
		for (const url of urls) {
			// Skip if we've already reached the total attachment limit
			if (existingAttachmentCount + newAttachmentCount >= maxAttachments) {
				console.warn(
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
				console.warn(`Failed to download attachment: ${url}`);
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
					console.log(
						`[EdgeWorker] Agent session created: ${childSessionId}, mapping to parent ${parentId}`,
					);
					// Map child to parent session
					this.childToParentAgentSession.set(childSessionId, parentId);
					console.log(
						`[EdgeWorker] Parent-child mapping updated: ${this.childToParentAgentSession.size} mappings`,
					);
				},
				onFeedbackDelivery: async (childSessionId, message) => {
					console.log(
						`[EdgeWorker] Processing feedback delivery to child session ${childSessionId}`,
					);

					// Find the parent session ID for context
					const parentSessionId =
						this.childToParentAgentSession.get(childSessionId);

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
						console.error(
							`[EdgeWorker] Child session ${childSessionId} not found in any repository`,
						);
						return false;
					}

					// Get the child session
					const childSession =
						childAgentSessionManager.getSession(childSessionId);
					if (!childSession) {
						console.error(
							`[EdgeWorker] Child session ${childSessionId} not found`,
						);
						return false;
					}

					console.log(
						`[EdgeWorker] Found child session - Issue: ${childSession.issueId}`,
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

					// Post thought to Linear showing feedback receipt
					const issueTracker = this.issueTrackers.get(childRepo.id);
					if (issueTracker) {
						const feedbackThought = parentIssueId
							? `Received feedback from orchestrator (${parentIssueId}):\n\n---\n\n${message}\n\n---`
							: `Received feedback from orchestrator:\n\n---\n\n${message}\n\n---`;

						try {
							const result = await issueTracker.createAgentActivity({
								agentSessionId: childSessionId,
								content: {
									type: "thought",
									body: feedbackThought,
								},
							});

							if (result.success) {
								console.log(
									`[EdgeWorker] Posted feedback receipt thought for child session ${childSessionId}`,
								);
							} else {
								console.error(
									`[EdgeWorker] Failed to post feedback receipt thought:`,
									result,
								);
							}
						} catch (error) {
							console.error(
								`[EdgeWorker] Error posting feedback receipt thought:`,
								error,
							);
						}
					}

					// Format the feedback as a prompt for the child session with enhanced markdown formatting
					const feedbackPrompt = `## Received feedback from orchestrator\n\n---\n\n${message}\n\n---`;

					// Use centralized streaming check and routing logic
					// Important: We don't await the full session completion to avoid timeouts.
					// The feedback is delivered immediately when the session starts, so we can
					// return success right away while the session continues in the background.
					console.log(
						`[EdgeWorker] Handling feedback delivery to child session ${childSessionId}`,
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
							console.log(
								`[EdgeWorker] Child session ${childSessionId} completed processing feedback`,
							);
						})
						.catch((error) => {
							console.error(
								`[EdgeWorker] Failed to process feedback in child session:`,
								error,
							);
						});

					// Return success immediately after initiating the handling
					console.log(
						`[EdgeWorker] Feedback delivered successfully to child session ${childSessionId}`,
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

			console.log(
				`[EdgeWorker] Configured OpenAI MCP servers (Sora + GPT Image) for repository: ${repository.name}`,
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
		fullIssue: LinearIssue,
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
		console.log(
			`[EdgeWorker] Built prompt - components: ${assembly.metadata.components.join(", ")}, type: ${assembly.metadata.promptType}`,
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
		const currentSubroutine = this.procedureRouter.getCurrentSubroutine(
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
			console.log(
				`[EdgeWorker] Loaded ${subroutine.name} subroutine prompt (${prompt.length} characters)`,
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
			console.warn(
				`[EdgeWorker] Failed to load subroutine prompt from ${subroutinePromptPath}:`,
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
			console.error(
				`[EdgeWorker] Failed to load shared instructions from ${instructionsPath}:`,
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
		issue: LinearIssue,
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
		linearAgentActivitySessionId: string,
		systemPrompt: string | undefined,
		allowedTools: string[],
		allowedDirectories: string[],
		disallowedTools: string[],
		resumeSessionId?: string,
		labels?: string[],
		maxTurns?: number,
		singleTurn?: boolean,
	): { config: AgentRunnerConfig; runnerType: "claude" | "gemini" } {
		// Configure PostToolUse hook for playwright screenshots
		const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
			PostToolUse: [
				{
					matcher: "playwright_screenshot",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							console.log(
								`Tool ${postToolUseInput.tool_name} completed with response:`,
								postToolUseInput.tool_response,
							);
							return {
								continue: true,
								additionalContext:
									"Screenshot taken successfully. You should use the Read tool to view the screenshot file to analyze the visual content.",
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
			console.log(
				`[EdgeWorker] Model override via label: ${modelOverride} (for session ${linearAgentActivitySessionId})`,
			);
		}

		// Convert singleTurn flag to effective maxTurns value
		const effectiveMaxTurns = singleTurn ? 1 : maxTurns;

		// Determine final model name with singleTurn suffix for Gemini
		const finalModel =
			modelOverride || repository.model || this.config.defaultModel;

		const config = {
			workingDirectory: session.workspace.path,
			allowedTools,
			disallowedTools,
			allowedDirectories,
			workspaceName: session.issue?.identifier || session.issueId,
			cyrusHome: this.cyrusHome,
			mcpConfigPath: repository.mcpConfigPath,
			mcpConfig: this.buildMcpConfig(repository, linearAgentActivitySessionId),
			appendSystemPrompt: systemPrompt || "",
			// Priority order: label override > repository config > global default
			model: finalModel,
			fallbackModel:
				fallbackModelOverride ||
				repository.fallbackModel ||
				this.config.defaultFallbackModel,
			hooks,
			onMessage: (message: SDKMessage) => {
				this.handleClaudeMessage(
					linearAgentActivitySessionId,
					message,
					repository.id,
				);
			},
			onError: (error: Error) => this.handleClaudeError(error),
		};

		if (resumeSessionId) {
			(config as any).resumeSessionId = resumeSessionId;
		}

		if (effectiveMaxTurns !== undefined) {
			(config as any).maxTurns = effectiveMaxTurns;
			if (singleTurn) {
				console.log(
					`[EdgeWorker] Applied singleTurn maxTurns=1 (for session ${linearAgentActivitySessionId})`,
				);
			}
		}

		return { config, runnerType };
	}

	/**
	 * Build disallowed tools list following the same hierarchy as allowed tools
	 */
	private buildDisallowedTools(
		repository: RepositoryConfig,
		promptType?: "debugger" | "builder" | "scoper" | "orchestrator",
	): string[] {
		let disallowedTools: string[] = [];
		let toolSource = "";

		// Priority order (same as allowedTools):
		// 1. Repository-specific prompt type configuration
		if (promptType && repository.labelPrompts?.[promptType]?.disallowedTools) {
			disallowedTools = repository.labelPrompts[promptType].disallowedTools;
			toolSource = `repository label prompt (${promptType})`;
		}
		// 2. Global prompt type defaults
		else if (
			promptType &&
			this.config.promptDefaults?.[promptType]?.disallowedTools
		) {
			disallowedTools = this.config.promptDefaults[promptType].disallowedTools;
			toolSource = `global prompt defaults (${promptType})`;
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
			console.log(
				`[EdgeWorker] Disallowed tools for ${repository.name}: ${disallowedTools.length} tools from ${toolSource}`,
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
			this.procedureRouter.getCurrentSubroutine(session);
		if (currentSubroutine?.disallowedTools) {
			const mergedTools = [
				...new Set([
					...baseDisallowedTools,
					...currentSubroutine.disallowedTools,
				]),
			];
			console.log(
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
		promptType?: "debugger" | "builder" | "scoper" | "orchestrator",
	): string[] {
		let baseTools: string[] = [];
		let toolSource = "";

		// Priority order:
		// 1. Repository-specific prompt type configuration
		if (promptType && repository.labelPrompts?.[promptType]?.allowedTools) {
			baseTools = this.resolveToolPreset(
				repository.labelPrompts[promptType].allowedTools,
			);
			toolSource = `repository label prompt (${promptType})`;
		}
		// 2. Global prompt type defaults
		else if (
			promptType &&
			this.config.promptDefaults?.[promptType]?.allowedTools
		) {
			baseTools = this.resolveToolPreset(
				this.config.promptDefaults[promptType].allowedTools,
			);
			toolSource = `global prompt defaults (${promptType})`;
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

		console.log(
			`[EdgeWorker] Tool selection for ${repository.name}: ${allTools.length} tools from ${toolSource}`,
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

	/**
	 * Load persisted EdgeWorker state for all repositories
	 */
	private async loadPersistedState(): Promise<void> {
		try {
			const state = await this.persistenceManager.loadEdgeWorkerState();
			if (state) {
				this.restoreMappings(state);
				console.log(
					`✅ Loaded persisted EdgeWorker state with ${Object.keys(state.agentSessions || {}).length} repositories`,
				);
			}
		} catch (error) {
			console.error(`Failed to load persisted EdgeWorker state:`, error);
		}
	}

	/**
	 * Save current EdgeWorker state for all repositories
	 */
	private async savePersistedState(): Promise<void> {
		try {
			const state = this.serializeMappings();
			await this.persistenceManager.saveEdgeWorkerState(state);
			console.log(
				`✅ Saved EdgeWorker state for ${Object.keys(state.agentSessions || {}).length} repositories`,
			);
		} catch (error) {
			console.error(`Failed to save persisted EdgeWorker state:`, error);
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
					console.log(
						`[EdgeWorker] Restored Agent Session state for repository ${repositoryId}`,
					);
				}
			}
		}

		// Restore child to parent agent session mapping
		if (state.childToParentAgentSession) {
			this.childToParentAgentSession = new Map(
				Object.entries(state.childToParentAgentSession),
			);
			console.log(
				`[EdgeWorker] Restored ${this.childToParentAgentSession.size} child-to-parent agent session mappings`,
			);
		}

		// Restore issue to repository cache in RepositoryRouter
		if (state.issueRepositoryCache) {
			const cache = new Map(Object.entries(state.issueRepositoryCache));
			this.repositoryRouter.restoreIssueRepositoryCache(cache);
			console.log(
				`[EdgeWorker] Restored ${cache.size} issue-to-repository cache mappings`,
			);
		}
	}

	/**
	 * Post instant acknowledgment thought when agent session is created
	 */
	private async postInstantAcknowledgment(
		linearAgentActivitySessionId: string,
		repositoryId: string,
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(repositoryId);
			if (!issueTracker) {
				console.warn(
					`[EdgeWorker] No issue tracker found for repository ${repositoryId}`,
				);
				return;
			}

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: "I've received your request and I'm starting to work on it. Let me analyze the issue and prepare my approach.",
				},
			};

			const result = await issueTracker.createAgentActivity(activityInput);
			if (result.success) {
				console.log(
					`[EdgeWorker] Posted instant acknowledgment thought for session ${linearAgentActivitySessionId}`,
				);
			} else {
				console.error(
					`[EdgeWorker] Failed to post instant acknowledgment:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[EdgeWorker] Error posting instant acknowledgment:`,
				error,
			);
		}
	}

	/**
	 * Post parent resume acknowledgment thought when parent session is resumed from child
	 */
	private async postParentResumeAcknowledgment(
		linearAgentActivitySessionId: string,
		repositoryId: string,
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(repositoryId);
			if (!issueTracker) {
				console.warn(
					`[EdgeWorker] No issue tracker found for repository ${repositoryId}`,
				);
				return;
			}

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: "Resuming from child session",
				},
			};

			const result = await issueTracker.createAgentActivity(activityInput);
			if (result.success) {
				console.log(
					`[EdgeWorker] Posted parent resumption acknowledgment thought for session ${linearAgentActivitySessionId}`,
				);
			} else {
				console.error(
					`[EdgeWorker] Failed to post parent resumption acknowledgment:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[EdgeWorker] Error posting parent resumption acknowledgment:`,
				error,
			);
		}
	}

	/**
	 * Post repository selection activity to Linear
	 * Shows which method was used to select the repository (auto-routing or user selection)
	 */
	private async postRepositorySelectionActivity(
		linearAgentActivitySessionId: string,
		repositoryId: string,
		repositoryName: string,
		selectionMethod:
			| "label-based"
			| "project-based"
			| "team-based"
			| "team-prefix"
			| "catch-all"
			| "workspace-fallback"
			| "user-selected",
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(repositoryId);
			if (!issueTracker) {
				console.warn(
					`[EdgeWorker] No issue tracker found for repository ${repositoryId}`,
				);
				return;
			}

			let methodDisplay: string;
			if (selectionMethod === "user-selected") {
				methodDisplay = "selected by user";
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

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Repository "${repositoryName}" has been ${methodDisplay}.`,
				},
			};

			const result = await issueTracker.createAgentActivity(activityInput);
			if (result.success) {
				console.log(
					`[EdgeWorker] Posted repository selection activity for session ${linearAgentActivitySessionId} (${selectionMethod})`,
				);
			} else {
				console.error(
					`[EdgeWorker] Failed to post repository selection activity:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[EdgeWorker] Error posting repository selection activity:`,
				error,
			);
		}
	}

	/**
	 * Re-route procedure for a session (used when resuming from child or give feedback)
	 * This ensures the currentSubroutine is reset to avoid suppression issues
	 */
	private async rerouteProcedureForSession(
		session: CyrusAgentSession,
		linearAgentActivitySessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		repository: RepositoryConfig,
	): Promise<void> {
		// Initialize procedure metadata using intelligent routing
		if (!session.metadata) {
			session.metadata = {};
		}

		// Post ephemeral "Routing..." thought
		await agentSessionManager.postRoutingThought(linearAgentActivitySessionId);

		// Fetch full issue and labels to check for Orchestrator label override
		const issueTracker = this.issueTrackers.get(repository.id);
		let hasOrchestratorLabel = false;

		if (issueTracker) {
			try {
				const fullIssue = await issueTracker.fetchIssue(session.issueId);
				const labels = await this.fetchIssueLabels(fullIssue);

				// Check for Orchestrator label (same logic as initial routing)
				const orchestratorConfig = repository.labelPrompts?.orchestrator;
				const orchestratorLabels = Array.isArray(orchestratorConfig)
					? orchestratorConfig
					: orchestratorConfig?.labels;
				hasOrchestratorLabel =
					orchestratorLabels?.some((label) => labels.includes(label)) || false;
			} catch (error) {
				console.error(
					`[EdgeWorker] Failed to fetch issue labels for routing:`,
					error,
				);
				// Continue with AI routing if label fetch fails
			}
		}

		let selectedProcedure: ProcedureDefinition;
		let finalClassification: RequestClassification;

		// If Orchestrator label is present, ALWAYS use orchestrator-full procedure
		if (hasOrchestratorLabel) {
			const orchestratorProcedure =
				this.procedureRouter.getProcedure("orchestrator-full");
			if (!orchestratorProcedure) {
				throw new Error("orchestrator-full procedure not found in registry");
			}
			selectedProcedure = orchestratorProcedure;
			finalClassification = "orchestrator";
			console.log(
				`[EdgeWorker] Using orchestrator-full procedure due to Orchestrator label (skipping AI routing)`,
			);
		} else {
			// No Orchestrator label - use AI routing based on prompt content
			const routingDecision = await this.procedureRouter.determineRoutine(
				promptBody.trim(),
			);
			selectedProcedure = routingDecision.procedure;
			finalClassification = routingDecision.classification;

			// Log AI routing decision
			console.log(
				`[EdgeWorker] AI routing decision for ${linearAgentActivitySessionId}:`,
			);
			console.log(`  Classification: ${routingDecision.classification}`);
			console.log(`  Procedure: ${selectedProcedure.name}`);
			console.log(`  Reasoning: ${routingDecision.reasoning}`);
		}

		// Initialize procedure metadata in session (resets currentSubroutine)
		this.procedureRouter.initializeProcedureMetadata(
			session,
			selectedProcedure,
		);

		// Post procedure selection result (replaces ephemeral routing thought)
		await agentSessionManager.postProcedureSelectionThought(
			linearAgentActivitySessionId,
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
	 * @param linearAgentActivitySessionId Linear agent activity session ID
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
		linearAgentActivitySessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest: string,
		isNewSession: boolean,
		additionalAllowedDirs: string[],
		logContext: string,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<boolean> {
		// Check if runner is actively running before routing
		const existingRunner = session.agentRunner;
		const isRunning = existingRunner?.isRunning() || false;

		// Always route procedure for new input, UNLESS actively running
		if (!isRunning) {
			await this.rerouteProcedureForSession(
				session,
				linearAgentActivitySessionId,
				agentSessionManager,
				promptBody,
				repository,
			);
			console.log(`[EdgeWorker] Routed procedure for ${logContext}`);
		} else {
			console.log(
				`[EdgeWorker] Skipping routing for ${linearAgentActivitySessionId} (${logContext}) - runner is actively running`,
			);
		}

		// Handle running case - add message to existing stream (if supported)
		if (
			existingRunner?.isRunning() &&
			existingRunner.supportsStreamingInput &&
			existingRunner.addStreamMessage
		) {
			console.log(
				`[EdgeWorker] Adding prompt to existing stream for ${linearAgentActivitySessionId} (${logContext})`,
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
		console.log(
			`[EdgeWorker] Resuming Claude session for ${linearAgentActivitySessionId} (${logContext})`,
		);

		await this.resumeAgentSession(
			session,
			repository,
			linearAgentActivitySessionId,
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
		linearAgentActivitySessionId: string,
		labels: string[],
		repositoryId: string,
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(repositoryId);
			if (!issueTracker) {
				console.warn(
					`[EdgeWorker] No issue tracker found for repository ${repositoryId}`,
				);
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
								: orchestratorConfig?.labels;
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

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`,
				},
			};

			const result = await issueTracker.createAgentActivity(activityInput);
			if (result.success) {
				console.log(
					`[EdgeWorker] Posted system prompt selection thought for session ${linearAgentActivitySessionId} (${selectedPromptType} mode)`,
				);
			} else {
				console.error(
					`[EdgeWorker] Failed to post system prompt selection thought:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[EdgeWorker] Error posting system prompt selection thought:`,
				error,
			);
		}
	}

	/**
	 * Resume or create an Agent session with the given prompt
	 * This is the core logic for handling prompted agent activities
	 * @param session The Cyrus agent session
	 * @param repository The repository configuration
	 * @param linearAgentActivitySessionId The Linear agent session ID
	 * @param agentSessionManager The agent session manager
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest
	 * @param isNewSession Whether this is a new session
	 */
	async resumeAgentSession(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		linearAgentActivitySessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest: string = "",
		isNewSession: boolean = false,
		additionalAllowedDirectories: string[] = [],
		maxTurns?: number,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<void> {
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

		// Fetch full issue details
		const fullIssue = await this.fetchFullIssueDetails(
			session.issueId,
			repository.id,
		);
		if (!fullIssue) {
			console.error(
				`[resumeAgentSession] Failed to fetch full issue details for ${session.issueId}`,
			);
			throw new Error(
				`Failed to fetch full issue details for ${session.issueId}`,
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

		// Build allowed tools list
		const allowedTools = this.buildAllowedTools(repository, promptType);
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

		// Get current subroutine to check for singleTurn mode
		const currentSubroutine =
			this.procedureRouter.getCurrentSubroutine(session);

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
			linearAgentActivitySessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			resumeSessionId,
			labels, // Always pass labels to preserve model override
			maxTurns, // Pass maxTurns if specified
			currentSubroutine?.singleTurn, // singleTurn flag
		);

		// Create the appropriate runner based on session state
		const runner =
			runnerType === "claude"
				? new ClaudeRunner(runnerConfig)
				: new GeminiRunner(runnerConfig);

		// Store runner
		agentSessionManager.addAgentRunner(linearAgentActivitySessionId, runner);

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
			console.error(
				`[resumeAgentSession] Failed to start streaming session for ${linearAgentActivitySessionId}:`,
				error,
			);
			throw error;
		}
	}

	/**
	 * Post instant acknowledgment thought when receiving prompted webhook
	 */
	private async postInstantPromptedAcknowledgment(
		linearAgentActivitySessionId: string,
		repositoryId: string,
		isStreaming: boolean,
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(repositoryId);
			if (!issueTracker) {
				console.warn(
					`[EdgeWorker] No issue tracker found for repository ${repositoryId}`,
				);
				return;
			}

			const message = isStreaming
				? "I've queued up your message as guidance"
				: "Getting started on that...";

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: message,
				},
			};

			const result = await issueTracker.createAgentActivity(activityInput);
			if (result.success) {
				console.log(
					`[EdgeWorker] Posted instant prompted acknowledgment thought for session ${linearAgentActivitySessionId} (streaming: ${isStreaming})`,
				);
			} else {
				console.error(
					`[EdgeWorker] Failed to post instant prompted acknowledgment:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[EdgeWorker] Error posting instant prompted acknowledgment:`,
				error,
			);
		}
	}

	/**
	 * Fetch complete issue details from Linear API
	 */
	public async fetchFullIssueDetails(
		issueId: string,
		repositoryId: string,
	): Promise<LinearIssue | null> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			console.warn(
				`[EdgeWorker] No issue tracker found for repository ${repositoryId}`,
			);
			return null;
		}

		try {
			console.log(`[EdgeWorker] Fetching full issue details for ${issueId}`);
			const fullIssue = await issueTracker.fetchIssue(issueId);
			console.log(
				`[EdgeWorker] Successfully fetched issue details for ${issueId}`,
			);

			// Check if issue has a parent
			try {
				const parent = await fullIssue.parent;
				if (parent) {
					console.log(
						`[EdgeWorker] Issue ${issueId} has parent: ${parent.identifier}`,
					);
				}
			} catch (_error) {
				// Parent field might not exist, ignore error
			}

			return fullIssue;
		} catch (error) {
			console.error(
				`[EdgeWorker] Failed to fetch issue details for ${issueId}:`,
				error,
			);
			return null;
		}
	}

	/**
	 * Create a Proxy that always delegates to the current raw LinearClient.
	 *
	 * This is the stable pointer - it never changes. On every call, it looks up
	 * the current client from rawLinearClients Map. When token refreshes, we just
	 * update the Map, and all existing references automatically use the new client.
	 *
	 * Uses promise coalescing in refreshLinearToken to handle concurrent
	 * 401 errors - all concurrent callers wait for a single refresh.
	 */
	private createLinearClientProxy(repositoryId: string): LinearClient {
		// Create a proxy that always looks up the current client
		return new Proxy({} as LinearClient, {
			get: (_, prop) => {
				// Always get the CURRENT client from the Map
				const currentClient = this.rawLinearClients.get(repositoryId);
				if (!currentClient) {
					throw new Error(
						`No LinearClient found for repository ${repositoryId}`,
					);
				}

				const value = currentClient[prop as keyof LinearClient];
				if (typeof value !== "function") return value;

				return async (...args: any[]) => {
					// Get current client again (in case it changed)
					const client = this.rawLinearClients.get(repositoryId)!;

					try {
						return await (client[prop as keyof LinearClient] as any).apply(
							client,
							args,
						);
					} catch (error) {
						// Only handle 401 token expiration errors
						if (!this.isTokenExpiredError(error)) {
							throw error;
						}

						console.log(`[EdgeWorker] 401 error, attempting token refresh...`);

						// Refresh token (coalesced - concurrent calls share one refresh)
						const refreshResult = await this.refreshLinearToken(repositoryId);
						console.log(
							`[EdgeWorker] Refresh result for ${repositoryId}: success=${refreshResult.success}`,
						);
						if (!refreshResult.success) {
							console.error(`[EdgeWorker] Token refresh failed`);
							throw error;
						}

						// Retry - the Map now has the new client with new token
						console.log(
							`[EdgeWorker] Retrying with refreshed token for ${String(prop)}...`,
						);
						const freshClient = this.rawLinearClients.get(repositoryId);
						if (!freshClient) {
							console.error(
								`[EdgeWorker] No client found in rawLinearClients for ${repositoryId}`,
							);
							throw error;
						}
						try {
							return await (
								freshClient[prop as keyof LinearClient] as any
							).apply(freshClient, args);
						} catch (retryError) {
							console.error(`[EdgeWorker] Retry failed:`, retryError);
							throw retryError;
						}
					}
				};
			},
		});
	}

	/**
	 * Check if an error is a 401 token expiration error
	 */
	private isTokenExpiredError(error: any): boolean {
		return error?.status === 401 || error?.response?.status === 401;
	}

	/**
	 * Save OAuth tokens to config.json
	 */
	private async saveOAuthTokens(tokens: {
		linearToken: string;
		linearRefreshToken?: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}): Promise<void> {
		if (!this.configPath) {
			console.error("❌ Cannot save OAuth tokens: config path not set");
			return;
		}

		try {
			// Read current config
			const configContent = await readFile(this.configPath, "utf-8");
			const config = JSON.parse(configContent);

			// Update tokens for all repositories with matching workspace
			let updatedCount = 0;
			for (const repo of config.repositories) {
				if (repo.linearWorkspaceId === tokens.linearWorkspaceId) {
					repo.linearToken = tokens.linearToken;
					if (tokens.linearRefreshToken) {
						repo.linearRefreshToken = tokens.linearRefreshToken;
					}
					repo.linearWorkspaceName = tokens.linearWorkspaceName;
					updatedCount++;
				}
			}

			// Write updated config back to file
			await writeFile(
				this.configPath,
				JSON.stringify(config, null, 2),
				"utf-8",
			);

			console.log(
				`✅ OAuth tokens saved to config.json (${updatedCount} repositories updated)`,
			);
		} catch (error) {
			console.error("❌ Failed to save OAuth tokens to config.json:", error);
			throw error;
		}
	}

	/**
	 * Refresh Linear OAuth token using refresh token
	 * Updates all repositories with the same workspace ID
	 *
	 * Uses promise coalescing to prevent race conditions when multiple
	 * concurrent requests attempt to refresh the same workspace's token.
	 */
	async refreshLinearToken(
		repositoryId: string,
	): Promise<{ success: boolean; newToken?: string }> {
		const repo = this.repositories.get(repositoryId);
		if (!repo || !repo.linearRefreshToken) {
			console.error(
				`[EdgeWorker] No refresh token available for repo ${repositoryId}`,
			);
			return { success: false };
		}

		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			console.error(
				"[EdgeWorker] LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET required for token refresh",
			);
			return { success: false };
		}

		const workspaceId = repo.linearWorkspaceId;

		// Check if a refresh is already in progress for this workspace
		const pendingRefresh = this.pendingRefreshes.get(workspaceId);
		if (pendingRefresh) {
			console.log(
				`[EdgeWorker] Token refresh already in progress for workspace ${workspaceId}, waiting...`,
			);
			return pendingRefresh;
		}

		// Create the refresh promise and store it
		const refreshPromise = this.doTokenRefresh(repo, clientId, clientSecret);
		this.pendingRefreshes.set(workspaceId, refreshPromise);

		try {
			return await refreshPromise;
		} finally {
			this.pendingRefreshes.delete(workspaceId);
		}
	}

	/**
	 * Performs the actual token refresh HTTP request
	 * @internal
	 */
	private async doTokenRefresh(
		repo: RepositoryConfig,
		clientId: string,
		clientSecret: string,
	): Promise<{ success: boolean; newToken?: string }> {
		const workspaceId = repo.linearWorkspaceId;

		try {
			console.log(
				`[EdgeWorker] Refreshing token for workspace ${workspaceId}...`,
			);

			const params = new URLSearchParams({
				grant_type: "refresh_token",
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: repo.linearRefreshToken!,
			});

			const response = await fetch("https://api.linear.app/oauth/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: params.toString(),
			});

			if (!response.ok) {
				console.error(`[EdgeWorker] Token refresh failed: ${response.status}`);
				return { success: false };
			}

			const data = (await response.json()) as {
				access_token: string;
				refresh_token: string;
				expires_in: number;
			};

			// Update all repositories with this workspace ID
			for (const [repoId, repository] of this.repositories) {
				if (repository.linearWorkspaceId === workspaceId) {
					repository.linearToken = data.access_token;
					repository.linearRefreshToken = data.refresh_token;

					// Update the raw LinearClient - the proxy will automatically use it
					const newClient = new LinearClient({
						accessToken: data.access_token,
					});
					this.rawLinearClients.set(repoId, newClient);
				}
			}

			// Save tokens to config.json
			const workspaceName = repo.linearWorkspaceName || repo.linearWorkspaceId;
			await this.saveOAuthTokens({
				linearToken: data.access_token,
				linearRefreshToken: data.refresh_token,
				linearWorkspaceId: workspaceId,
				linearWorkspaceName: workspaceName,
			});

			console.log(
				`[EdgeWorker] ✅ Token refreshed successfully for workspace ${workspaceId}`,
			);
			return { success: true, newToken: data.access_token };
		} catch (error) {
			console.error("[EdgeWorker] Token refresh error:", error);
			return { success: false };
		}
	}
}
