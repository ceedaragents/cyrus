import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LinearClient } from "@linear/sdk";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import type {
	ClaudeRunnerConfig,
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
	Comment,
	CyrusAgentSession,
	EdgeWorkerConfig,
	Issue,
	IssueMinimal,
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	// LinearIssueAssignedWebhook,
	// LinearIssueCommentMentionWebhook,
	// LinearIssueNewCommentWebhook,
	LinearIssueUnassignedWebhook,
	LinearWebhookAgentSession,
	LinearWebhookComment,
	LinearWebhookGuidanceRule,
	LinearWebhookIssue,
	RepositoryConfig,
	SerializableEdgeWorkerState,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
} from "cyrus-core";
import {
	AgentActivityContentType,
	type AgentEvent,
	CLIIssueTrackerService,
	CLIRPCServer,
	DEFAULT_PROXY_URL,
	type IAgentEventTransport,
	type IIssueTrackerService,
	isAgentSessionCreatedEvent,
	isAgentSessionPromptedEvent,
	isCommentMentionEvent,
	isIssueAssignedEvent,
	isIssueUnassignedEvent,
	isNewCommentEvent,
	PersistenceManager,
	resolvePath,
} from "cyrus-core";
import { LinearIssueTrackerService } from "cyrus-linear-event-transport";
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
import { SharedApplicationServer } from "./SharedApplicationServer.js";
import { createBasicIssueTrackerServer } from "./tools/basic-issue-tracker.js";
import { createIssueTrackerToolsServer } from "./tools/index.js";
import type { EdgeWorkerEvents, LinearAgentSessionData } from "./types.js";

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
	private agentSessionManagers: Map<string, AgentSessionManager> = new Map(); // Maps repository ID to AgentSessionManager, which manages ClaudeRunners for a repo
	private issueTrackers: Map<string, IIssueTrackerService> = new Map(); // one issue tracker per 'repository'
	private agentEventTransport: IAgentEventTransport | null = null; // Single event transport for webhook delivery
	private configUpdater: ConfigUpdater | null = null; // Single config updater for configuration updates
	private persistenceManager: PersistenceManager;
	private sharedApplicationServer: SharedApplicationServer;
	private cyrusHome: string;
	private childToParentAgentSession: Map<string, string> = new Map(); // Maps child agentSessionId to parent agentSessionId
	private procedureRouter: ProcedureRouter; // Intelligent workflow routing
	private configWatcher?: FSWatcher; // File watcher for config.json
	private configPath?: string; // Path to config.json file

	constructor(config: EdgeWorkerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		this.persistenceManager = new PersistenceManager(
			join(this.cyrusHome, "state"),
		);

		// Initialize procedure router with haiku model for fast classification
		this.procedureRouter = new ProcedureRouter({
			cyrusHome: this.cyrusHome,
			model: "haiku",
			timeoutMs: 10000,
		});

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

				// Create issue tracker service based on platform configuration
				let issueTracker: IIssueTrackerService;
				if (config.platform === "cli") {
					// CLI mode: create CLI issue tracker
					const agentHandle = config.agentHandle || "@cyrus";
					const agentUserId = config.agentUserId || "cli-agent-user";
					issueTracker = new CLIIssueTrackerService({
						agentHandle,
						agentUserId,
					});
					console.log(
						`[EdgeWorker] Created CLI issue tracker for ${repo.name} with agent handle: ${agentHandle}`,
					);
				} else {
					// Linear mode (default): create Linear client and issue tracker
					const linearClient = new LinearClient({
						accessToken: repo.linearToken,
					});
					issueTracker = new LinearIssueTrackerService(linearClient);
				}
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
					async (linearAgentActivitySessionId: string) => {
						console.log(
							`[Subroutine Transition] Advancing to next subroutine for session ${linearAgentActivitySessionId}`,
						);

						// Get the session
						const session = agentSessionManager.getSession(
							linearAgentActivitySessionId,
						);
						if (!session) {
							console.error(
								`[Subroutine Transition] Session ${linearAgentActivitySessionId} not found`,
							);
							return;
						}

						// Get next subroutine (advancement already handled by AgentSessionManager)
						const nextSubroutine =
							this.procedureRouter.getCurrentSubroutine(session);

						if (!nextSubroutine) {
							console.log(
								`[Subroutine Transition] Procedure complete for session ${linearAgentActivitySessionId}`,
							);
							return;
						}

						console.log(
							`[Subroutine Transition] Next subroutine: ${nextSubroutine.name}`,
						);

						// Get workspace slug from session metadata for proper @mention formatting
						const workspaceSlug = session.metadata?.workspaceSlug;

						// Load subroutine prompt
						let subroutinePrompt: string | null;
						try {
							subroutinePrompt = await this.loadSubroutinePrompt(
								nextSubroutine,
								workspaceSlug,
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
							await this.resumeClaudeSession(
								session,
								repo,
								linearAgentActivitySessionId,
								agentSessionManager,
								subroutinePrompt,
								"", // No attachment manifest
								false, // Not a new session
								[], // No additional allowed directories
								nextSubroutine.maxTurns, // Use subroutine-specific maxTurns
							);
							console.log(
								`[Subroutine Transition] Successfully resumed session for ${nextSubroutine.name} subroutine${nextSubroutine.maxTurns ? ` (maxTurns=${nextSubroutine.maxTurns})` : ""}`,
							);
						} catch (error) {
							console.error(
								`[Subroutine Transition] Failed to resume session for ${nextSubroutine.name} subroutine:`,
								error,
							);
						}
					},
					this.procedureRouter,
					this.sharedApplicationServer,
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

		// Get any issue tracker to create the event transport (all use same Linear credentials)
		const issueTracker = this.issueTrackers.values().next().value;
		if (!issueTracker) {
			throw new Error("No issue tracker available to create event transport");
		}

		// Create platform-specific event transport config
		const platform = this.config.platform || "linear";
		const eventTransportConfig =
			platform === "linear"
				? verificationMode === "direct"
					? {
							platform: "linear" as const,
							fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
							verificationMode: "direct" as const,
							secret,
						}
					: {
							platform: "linear" as const,
							fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
							verificationMode: "proxy" as const,
							secret,
						}
				: {
						platform: "cli" as const,
						fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
					};

		this.agentEventTransport =
			issueTracker.createEventTransport(eventTransportConfig);

		// Listen for agent events
		this.agentEventTransport.on("event", (event: AgentEvent) => {
			// Get all active repositories for event handling
			const repos = Array.from(this.repositories.values());
			this.handleAgentEvent(event, repos);
		});

		// Listen for errors
		this.agentEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		// Register the /webhook endpoint
		this.agentEventTransport.register();

		console.log(`✅ Event transport registered (${verificationMode} mode)`);
		console.log(
			`   Webhook endpoint: ${this.sharedApplicationServer.getWebhookUrl()}`,
		);

		// If platform is CLI mode, set up RPC server
		if (this.config.platform === "cli") {
			// Get the first CLI issue tracker (should only be one in CLI mode)
			for (const repoId of this.repositories.keys()) {
				const cliIssueTracker = this.issueTrackers.get(repoId);
				if (
					cliIssueTracker &&
					cliIssueTracker instanceof CLIIssueTrackerService
				) {
					const rpcServer = new CLIRPCServer(
						this.sharedApplicationServer.getFastifyInstance(),
						cliIssueTracker,
					);
					rpcServer.register();
					console.log("✅ CLI RPC server registered");
					console.log(
						`   RPC endpoint: http://localhost:${this.sharedApplicationServer.getPort()}/cli/rpc`,
					);
					console.log(`   Agent handle: ${cliIssueTracker.getAgentHandle()}`);
					break; // Only set up one RPC server
				}
			}
		}

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

		// get all claudeRunners
		const claudeRunners: ClaudeRunner[] = [];
		for (const agentSessionManager of this.agentSessionManagers.values()) {
			claudeRunners.push(...agentSessionManager.getAllClaudeRunners());
		}

		// Kill all Claude processes with null checking
		for (const runner of claudeRunners) {
			if (runner) {
				try {
					runner.stop();
				} catch (error) {
					console.error("Error stopping Claude runner:", error);
				}
			}
		}

		// Clear event transport (no explicit cleanup needed, routes are removed when server stops)
		this.agentEventTransport = null;
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
				await issueTracker.createAgentActivity(parentSessionId, {
					type: AgentActivityContentType.Thought,
					body: resultThought,
				});

				console.log(
					`[Parent Session Resume] Posted child result receipt thought for parent session ${parentSessionId}`,
				);
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

				// Create Linear client
				const linearClient = new LinearClient({
					accessToken: repo.linearToken,
				});
				// Create issue tracker service (Linear adapter)
				const issueTracker = new LinearIssueTrackerService(linearClient);
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
					undefined, // No resumeNextSubroutine callback for dynamically added repos
					this.procedureRouter,
					this.sharedApplicationServer,
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

				// If token changed, recreate Linear client
				if (oldRepo.linearToken !== repo.linearToken) {
					console.log(`  🔑 Token changed, recreating Linear client`);
					const linearClient = new LinearClient({
						accessToken: repo.linearToken,
					});
					// Create issue tracker service (Linear adapter)
					const issueTracker = new LinearIssueTrackerService(linearClient);
					this.issueTrackers.set(repo.id, issueTracker);
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

							// Get the Claude runner for this session
							const runner = manager?.getClaudeRunner(
								session.linearAgentActivitySessionId,
							);
							if (runner) {
								// Stop the Claude process
								runner.stop();
								console.log(
									`  ✅ Stopped Claude runner for session ${session.linearAgentActivitySessionId}`,
								);
							}

							// Post cancellation message to Linear
							const issueTracker = this.issueTrackers.get(repo.id);
							if (issueTracker) {
								await issueTracker.createAgentActivity(
									session.linearAgentActivitySessionId,
									{
										type: AgentActivityContentType.Response,
										body: `**Repository Removed from Configuration**\n\nThis repository (\`${repo.name}\`) has been removed from the Cyrus configuration. All active sessions for this repository have been stopped.\n\nIf you need to continue working on this issue, please contact your administrator to restore the repository configuration.`,
									},
								);
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
	 * Handle agent events from event transport - platform-agnostic event handling
	 */
	private async handleAgentEvent(
		event: AgentEvent,
		repos: RepositoryConfig[],
	): Promise<void> {
		// Log verbose event info if enabled
		if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
			console.log(
				`[handleAgentEvent] Full event payload:`,
				JSON.stringify(event, null, 2),
			);
		}

		// Find the appropriate repository for this event
		const repository = await this.findRepositoryForEvent(event, repos);
		if (!repository) {
			if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
				console.log(
					`[handleAgentEvent] No repository configured for event from workspace ${event.organizationId}`,
				);
				console.log(
					`[handleAgentEvent] Available repositories:`,
					repos.map((r) => ({
						name: r.name,
						workspaceId: r.linearWorkspaceId,
						teamKeys: r.teamKeys,
						routingLabels: r.routingLabels,
					})),
				);
			}
			return;
		}

		try {
			// Handle specific event types with proper typing
			// NOTE: Traditional events (assigned, comment) are disabled in favor of agent session events
			if (isIssueAssignedEvent(event)) {
				return;
			} else if (isCommentMentionEvent(event)) {
				return;
			} else if (isNewCommentEvent(event)) {
				return;
			} else if (isIssueUnassignedEvent(event)) {
				// Keep unassigned event active
				await this.handleIssueUnassignedWebhook(event, repository);
			} else if (isAgentSessionCreatedEvent(event)) {
				await this.handleAgentSessionCreatedWebhook(event, repository);
			} else if (isAgentSessionPromptedEvent(event)) {
				await this.handleUserPostedAgentActivity(event, repository);
			} else {
				if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
					console.log(
						`[handleAgentEvent] Unhandled event type: ${(event as any).action} for repository ${repository.name}`,
					);
				}
			}
		} catch (error) {
			console.error(
				`[handleAgentEvent] Failed to process event: ${(event as any).action} for repository ${repository.name}`,
				error,
			);
			// Don't re-throw event processing errors to prevent application crashes
			// The error has been logged and individual event failures shouldn't crash the entire system
		}
	}

	/**
	 * Handle issue unassignment webhook
	 */
	private async handleIssueUnassignedWebhook(
		webhook: LinearIssueUnassignedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
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
	 * Find the repository configuration for a webhook
	 * Now supports async operations for label-based and project-based routing
	 * Priority: routingLabels > projectKeys > teamKeys
	 */
	private async findRepositoryForEvent(
		event: AgentEvent,
		repos: RepositoryConfig[],
	): Promise<RepositoryConfig | null> {
		const workspaceId = event.organizationId;
		if (!workspaceId) return repos[0] || null; // Fallback to first repo if no workspace ID

		// Handle CLI platform events (special case before Linear routing)
		// CLI events have organizationId: "cli-org" and need platform-based routing
		if (workspaceId === "cli-org") {
			// In CLI mode, return first repository (platform is global, not per-repo)
			if (this.config.platform === "cli" && repos[0]) {
				console.log(
					`[EdgeWorker] Repository selected: ${repos[0].name} (CLI platform routing)`,
				);
				return repos[0];
			}
			// Fallback: if not in CLI mode but received CLI event, use first repo
			console.log(
				`[EdgeWorker] CLI event received but platform is not CLI, using fallback`,
			);
			return repos[0] || null;
		}

		// Get issue information from webhook
		let issueId: string | undefined;
		let teamKey: string | undefined;
		let issueIdentifier: string | undefined;

		// Handle agent session webhooks which have different structure
		if (isAgentSessionCreatedEvent(event)) {
			issueId = (event as any).agentSession?.issue?.id;
			teamKey = (event as any).agentSession?.issue?.team?.key;
			issueIdentifier = (event as any).agentSession?.issue?.identifier;
		} else if (isAgentSessionPromptedEvent(event)) {
			issueId = (event as any).agentSession?.issue?.id;
			teamKey = (event as any).agentSession?.issue?.team?.key;
			issueIdentifier = (event as any).agentSession?.issue?.identifier;
		} else {
			issueId = (event as any).notification?.issue?.id;
			teamKey = (event as any).notification?.issue?.team?.key;
			issueIdentifier = (event as any).notification?.issue?.identifier;
		}

		// Filter repos by workspace first
		const workspaceRepos = repos.filter(
			(repo) => repo.linearWorkspaceId === workspaceId,
		);
		if (workspaceRepos.length === 0) return null;

		// Priority 1: Check routing labels (highest priority)
		const reposWithRoutingLabels = workspaceRepos.filter(
			(repo) => repo.routingLabels && repo.routingLabels.length > 0,
		);

		if (reposWithRoutingLabels.length > 0 && issueId && workspaceRepos[0]) {
			// We need an issue tracker to fetch labels
			// Use the first workspace repo's issue tracker temporarily
			const issueTracker = this.issueTrackers.get(workspaceRepos[0].id);

			if (issueTracker) {
				try {
					// Fetch the issue to get labels
					const issue = await issueTracker.fetchIssue(issueId);
					const labelsConnection = await issue.labels();
					const labelNames = labelsConnection?.nodes?.map((l) => l.name) || [];

					// Check each repo with routing labels
					for (const repo of reposWithRoutingLabels) {
						if (
							repo.routingLabels?.some((routingLabel) =>
								labelNames.includes(routingLabel),
							)
						) {
							console.log(
								`[EdgeWorker] Repository selected: ${repo.name} (label-based routing)`,
							);
							return repo;
						}
					}
				} catch (error) {
					console.error(
						`[EdgeWorker] Failed to fetch labels for routing:`,
						error,
					);
					// Continue to project-based routing
				}
			}
		}

		// Priority 2: Check project-based routing
		if (issueId) {
			const projectBasedRepo = await this.findRepositoryByProject(
				issueId,
				workspaceRepos,
			);
			if (projectBasedRepo) {
				console.log(
					`[EdgeWorker] Repository selected: ${projectBasedRepo.name} (project-based routing)`,
				);
				return projectBasedRepo;
			}
		}

		// Priority 3: Check team-based routing
		if (teamKey) {
			const repo = workspaceRepos.find((r) => r.teamKeys?.includes(teamKey));
			if (repo) {
				console.log(
					`[EdgeWorker] Repository selected: ${repo.name} (team-based routing)`,
				);
				return repo;
			}
		}

		// Try parsing issue identifier as fallback for team routing
		if (issueIdentifier?.includes("-")) {
			const prefix = issueIdentifier.split("-")[0];
			if (prefix) {
				const repo = workspaceRepos.find((r) => r.teamKeys?.includes(prefix));
				if (repo) {
					console.log(
						`[EdgeWorker] Repository selected: ${repo.name} (team prefix routing)`,
					);
					return repo;
				}
			}
		}

		// Workspace fallback - find first repo without routing configuration
		const catchAllRepo = workspaceRepos.find(
			(repo) =>
				(!repo.teamKeys || repo.teamKeys.length === 0) &&
				(!repo.routingLabels || repo.routingLabels.length === 0) &&
				(!repo.projectKeys || repo.projectKeys.length === 0),
		);

		if (catchAllRepo) {
			console.log(
				`[EdgeWorker] Repository selected: ${catchAllRepo.name} (workspace catch-all)`,
			);
			return catchAllRepo;
		}

		// Final fallback to first workspace repo
		const fallbackRepo = workspaceRepos[0] || null;
		if (fallbackRepo) {
			console.log(
				`[EdgeWorker] Repository selected: ${fallbackRepo.name} (workspace fallback)`,
			);
		}
		return fallbackRepo;
	}

	/**
	 * Helper method to find repository by project name
	 */
	private async findRepositoryByProject(
		issueId: string,
		repos: RepositoryConfig[],
	): Promise<RepositoryConfig | null> {
		// Try each repository that has projectKeys configured
		for (const repo of repos) {
			if (!repo.projectKeys || repo.projectKeys.length === 0) continue;

			try {
				const fullIssue = await this.fetchFullIssueDetails(issueId, repo.id);
				const project = await fullIssue?.project;
				if (!project || !project.name) {
					console.warn(
						`[EdgeWorker] No project name found for issue ${issueId} in repository ${repo.name}`,
					);
					continue;
				}

				const projectName = project.name;
				if (repo.projectKeys.includes(projectName)) {
					console.log(
						`[EdgeWorker] Matched issue ${issueId} to repository ${repo.name} via project: ${projectName}`,
					);
					return repo;
				}
			} catch (error) {
				// Continue to next repository if this one fails
				console.debug(
					`[EdgeWorker] Failed to fetch project for issue ${issueId} from repository ${repo.name}:`,
					error,
				);
			}
		}

		return null;
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
	): Promise<LinearAgentSessionData> {
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

		// Store workspace slug in session metadata for use in subroutine prompts
		if (!session.metadata) {
			session.metadata = {};
		}
		if (fullIssue.url) {
			session.metadata.workspaceSlug = this.extractWorkspaceSlug(fullIssue.url);
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
		const allowedDirectories: string[] = [attachmentsDir];

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
	 * . Can happen due to being 'delegated' or @ mentioned in a new thread
	 * @param webhook
	 * @param repository Repository configuration
	 */
	private async handleAgentSessionCreatedWebhook(
		webhook: LinearAgentSessionCreatedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		console.log(
			`[EdgeWorker] Handling agent session created: ${webhook.agentSession.issue.identifier}`,
		);
		const { agentSession, guidance } = webhook;
		const linearAgentActivitySessionId = agentSession.id;
		const { issue } = agentSession;

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

		const commentBody = agentSession.comment?.body;
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
		const labelsConnection = await fullIssue.labels();
		const labelNames = labelsConnection?.nodes?.map((l) => l.name) || [];

		// Check for label overrides BEFORE AI routing
		const debuggerConfig = repository.labelPrompts?.debugger;
		const debuggerLabels = Array.isArray(debuggerConfig)
			? debuggerConfig
			: debuggerConfig?.labels;
		const hasDebuggerLabel = debuggerLabels?.some((label) =>
			labelNames.includes(label),
		);

		const orchestratorConfig = repository.labelPrompts?.orchestrator;
		const orchestratorLabels = Array.isArray(orchestratorConfig)
			? orchestratorConfig
			: orchestratorConfig?.labels;
		const hasOrchestratorLabel = orchestratorLabels?.some((label) =>
			labelNames.includes(label),
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
				guidance,
				agentSession,
				labels: labelNames,
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
					labelNames,
					repository,
				);
				systemPromptVersion = systemPromptResult?.version;
				promptType = systemPromptResult?.type;

				// Post thought about system prompt selection
				if (assembly.systemPrompt) {
					await this.postSystemPromptSelectionThought(
						linearAgentActivitySessionId,
						labelNames,
						repository.id,
					);
				}
			}

			// Build allowed tools list with Linear MCP tools (now with prompt type context)
			const allowedTools = this.buildAllowedTools(repository, promptType);
			const disallowedTools = this.buildDisallowedTools(repository, promptType);

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

			// Create Claude runner with system prompt from assembly
			const runnerConfig = this.buildClaudeRunnerConfig(
				session,
				repository,
				linearAgentActivitySessionId,
				assembly.systemPrompt,
				allowedTools,
				allowedDirectories,
				disallowedTools,
				undefined, // resumeSessionId
				labelNames, // Pass labels for model override
			);
			const runner = new ClaudeRunner(runnerConfig);

			// Store runner by comment ID
			agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner);

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
			if (systemPromptVersion) {
				runner.updatePromptVersions({
					systemPromptVersion,
				});
			}

			// Log metadata for debugging
			console.log(
				`[EdgeWorker] Initial prompt built successfully - components: ${assembly.metadata.components.join(", ")}, type: ${assembly.metadata.promptType}, length: ${assembly.userPrompt.length} characters`,
			);

			console.log(`[EdgeWorker] Starting Claude streaming session`);
			const sessionInfo = await runner.startStreaming(assembly.userPrompt);
			console.log(
				`[EdgeWorker] Claude streaming session started: ${sessionInfo.sessionId}`,
			);
			// Note: AgentSessionManager will be initialized automatically when the first system message
			// is received via handleClaudeMessage() callback
		} catch (error) {
			console.error(`[EdgeWorker] Error in prompt building/starting:`, error);
			throw error;
		}
	}

	/**
	 * Handle new comment on issue (updated for comment-based sessions)
	 * @param issue Linear issue object from webhook data
	 * @param comment Linear comment object from webhook data
	 * @param repository Repository configuration
	 */
	private async handleUserPostedAgentActivity(
		webhook: LinearAgentSessionPromptedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		// Look for existing session for this comment thread
		const { agentSession } = webhook;
		const linearAgentActivitySessionId = agentSession.id;
		const { issue } = agentSession;

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
		let fullIssue: Issue | null = null;

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
			// Check streaming status first to determine the message
			const isCurrentlyStreaming =
				session?.claudeRunner?.isStreaming() || false;

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
				"Unexpected: There was no issue tracker for the repository with id",
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

		try {
			// Fetch comment with user data using concrete typed method
			const comment = await issueTracker.fetchCommentWithAttachments(commentId);

			// Extract comment metadata for multi-player context
			const user = await comment.user;
			if (user) {
				commentAuthor = user.name || user.email || "Unknown";
			}
			commentTimestamp = comment.createdAt
				? comment.createdAt.toISOString()
				: new Date().toISOString();

			// Count existing attachments
			const existingFiles = await readdir(attachmentsDir).catch(() => []);
			const existingAttachmentCount = existingFiles.filter(
				(file) => file.startsWith("attachment_") || file.startsWith("image_"),
			).length;

			// Download new attachments from the comment
			const downloadResult = await this.downloadCommentAttachments(
				comment.body,
				attachmentsDir,
				repository.linearToken,
				existingAttachmentCount,
			);

			if (downloadResult.totalNewAttachments > 0) {
				attachmentManifest = this.generateNewAttachmentManifest(downloadResult);
			}
		} catch (error) {
			console.error("Failed to fetch comments for attachments:", error);
		}

		const promptBody = webhook.agentActivity.content.body;
		const stopSignal = webhook.agentActivity.signal === "stop";

		// Handle stop signal
		if (stopSignal) {
			console.log(
				`[EdgeWorker] Received stop signal for agent activity session ${linearAgentActivitySessionId}`,
			);

			// Stop the existing runner if it's active
			const existingRunner = session.claudeRunner;
			if (existingRunner) {
				existingRunner.stop();
				console.log(
					`[EdgeWorker] Stopped Claude session for agent activity session ${linearAgentActivitySessionId}`,
				);
			}
			const issueTitle = issue.title || "this issue";
			const stopConfirmation = `I've stopped working on ${issueTitle} as requested.\n\n**Stop Signal:** Received from ${webhook.agentSession.creator?.name || "user"}\n**Action Taken:** All ongoing work has been halted`;

			await agentSessionManager.createResponseActivity(
				linearAgentActivitySessionId,
				stopConfirmation,
			);

			return; // Exit early - stop signal handled
		}

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
	 * Handle issue unassignment
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 */
	private async handleIssueUnassigned(
		issue: LinearWebhookIssue,
		repository: RepositoryConfig,
	): Promise<void> {
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			console.log(
				"No agentSessionManager for unassigned issue, so no sessions to stop",
			);
			return;
		}

		// Get all Claude runners for this specific issue
		const claudeRunners = agentSessionManager.getClaudeRunnersForIssue(
			issue.id,
		);

		// Stop all Claude runners for this issue
		const activeThreadCount = claudeRunners.length;
		for (const runner of claudeRunners) {
			console.log(
				`[EdgeWorker] Stopping Claude runner for issue ${issue.identifier}`,
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
	 * TODO: improve this
	 */
	private async handleClaudeError(error: Error): Promise<void> {
		console.error("Unhandled claude error:", error);
	}

	/**
	 * Replace MCP tool placeholders in prompt content with actual tool names.
	 * This allows prompts to be platform-agnostic and work with different MCP servers.
	 */
	private replaceToolPlaceholders(
		promptContent: string,
		platform: "linear" | "cli",
	): string {
		// Define tool name mappings based on platform
		// Note: The namespace prefix (mcp__<server-name>__) is controlled by the MCP server
		// configuration in configureMcpServers(). We use:
		// - "issue-tracker" for basic tools → mcp__issue-tracker__*
		// - "issue-tracker-ext" for extended tools → mcp__issue-tracker-ext__*
		const toolMappings =
			platform === "linear"
				? {
						// Linear platform: Linear HTTP MCP server + Cyrus extension
						// Basic issue tracker tools from Linear HTTP MCP
						TOOL_CREATE_ISSUE: "mcp__issue-tracker__create_issue",
						TOOL_GET_ISSUE: "mcp__issue-tracker__get_issue",
						TOOL_UPDATE_ISSUE: "mcp__issue-tracker__update_issue",
						TOOL_LIST_ISSUES: "mcp__issue-tracker__list_issues",
						// Extended tools from Cyrus MCP extension
						TOOL_AGENT_SESSION_CREATE:
							"mcp__issue-tracker-ext__issue_tracker_agent_session_create",
						TOOL_AGENT_SESSION_CREATE_ON_COMMENT:
							"mcp__issue-tracker-ext__issue_tracker_agent_session_create_on_comment",
						TOOL_AGENT_GIVE_FEEDBACK:
							"mcp__issue-tracker-ext__issue_tracker_agent_give_feedback",
						TOOL_GET_CHILD_ISSUES:
							"mcp__issue-tracker-ext__issue_tracker_get_child_issues",
						TOOL_UPLOAD_FILE:
							"mcp__issue-tracker-ext__issue_tracker_upload_file",
					}
				: {
						// CLI platform: Uses CLI-specific implementations
						TOOL_CREATE_ISSUE: "mcp__issue-tracker__create_issue",
						TOOL_GET_ISSUE: "mcp__issue-tracker__get_issue",
						TOOL_UPDATE_ISSUE: "mcp__issue-tracker__update_issue",
						TOOL_LIST_ISSUES: "mcp__issue-tracker__list_issues",
						TOOL_AGENT_SESSION_CREATE:
							"mcp__issue-tracker-ext__issue_tracker_agent_session_create",
						TOOL_AGENT_SESSION_CREATE_ON_COMMENT:
							"mcp__issue-tracker-ext__issue_tracker_agent_session_create_on_comment",
						TOOL_AGENT_GIVE_FEEDBACK:
							"mcp__issue-tracker-ext__issue_tracker_agent_give_feedback",
						TOOL_GET_CHILD_ISSUES:
							"mcp__issue-tracker-ext__issue_tracker_get_child_issues",
						TOOL_UPLOAD_FILE:
							"mcp__issue-tracker-ext__issue_tracker_upload_file",
					};

		// Replace all placeholders
		let result = promptContent;
		for (const [placeholder, toolName] of Object.entries(toolMappings)) {
			result = result.replaceAll(`{{${placeholder}}}`, toolName);
		}

		return result;
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
					let promptContent = await readFile(promptPath, "utf-8");

					// Replace MCP tool placeholders with actual tool names
					promptContent = this.replaceToolPlaceholders(
						promptContent,
						this.config.platform || "linear",
					);

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
		issue: Issue,
		repository: RepositoryConfig,
		attachmentManifest: string = "",
		guidance?: LinearWebhookGuidanceRule[],
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

			// Get issue tracker for this repository
			const issueTracker = this.issueTrackers.get(repository.id);
			if (!issueTracker) {
				console.error(`No issue tracker found for repository ${repository.id}`);
				throw new Error(
					`No issue tracker found for repository ${repository.id}`,
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
		issue: Issue,
		agentSession: LinearWebhookAgentSession,
		attachmentManifest: string = "",
		guidance?: LinearWebhookGuidanceRule[],
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
	private formatAgentGuidance(guidance?: LinearWebhookGuidanceRule[]): string {
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
		issue: Issue,
		repository: RepositoryConfig,
	): Promise<string> {
		// Start with the repository's default base branch
		let baseBranch = repository.baseBranch;

		// Check if issue has a parent
		try {
			const parentId = issue.parentId;
			if (parentId) {
				console.log(
					`[EdgeWorker] Issue ${await issue.identifier} has parent: ${parentId}`,
				);

				// Get parent's branch name - fetch the parent issue
				const parent = await this.issueTrackers
					.get(repository.id)
					?.fetchIssue(parentId);
				if (!parent) {
					console.warn(`[EdgeWorker] Could not fetch parent issue ${parentId}`);
					return baseBranch; // Fall back to default
				}
				const parentRawBranchName =
					parent.branchName ||
					`${await parent.identifier}-${(await parent.title)
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
			const parent = await comment.parentId;
			if (!parent) {
				// This is a root comment
				rootComments.push(comment);
				threads.set(comment.id, { root: comment, replies: [] });
			}
		}

		// Second pass: assign replies to their threads
		for (const comment of comments) {
			const parentComment = await comment.parent;
			if (parentComment?.id) {
				const thread = threads.get(parentComment.id);
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
		newComment?: LinearWebhookComment,
		attachmentManifest: string = "",
		guidance?: LinearWebhookGuidanceRule[],
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
		if (this.agentEventTransport) {
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
		return this.agentEventTransport;
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
	 * @param repositoryId Repository ID for Linear client lookup
	 */

	private async moveIssueToStartedState(
		issue: Issue,
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
				(a, b) => (a.position ?? 0) - (b.position ?? 0),
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
	//     issueId,
	//     body
	//   }
	//   await issueTracker.createComment(commentData)
	// }

	/**
	 * Post a comment to Linear
	 */
	private async postComment(
		_issueId: string,
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
		await issueTracker.createComment(_issueId, commentInput);
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
			// Delegate to IIssueTrackerService for platform-agnostic attachment fetching
			let nativeAttachments: Array<{ title: string; url: string }> = [];
			if (issueTracker && issue.id) {
				console.log(
					`[EdgeWorker] Fetching native attachments for issue ${issue.identifier}`,
				);
				nativeAttachments = await issueTracker.fetchIssueAttachments(issue.id);
				if (nativeAttachments.length > 0) {
					console.log(
						`[EdgeWorker] Found ${nativeAttachments.length} native attachments`,
					);
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
		const mcpConfig: Record<string, McpServerConfig> = {};

		// Only inject Linear MCP servers if platform is "linear" and token exists
		if (this.config.platform !== "cli" && repository.linearToken) {
			// Linear HTTP MCP server provides basic issue tracker tools
			// https://linear.app/docs/mcp
			mcpConfig["issue-tracker"] = {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: {
					Authorization: `Bearer ${repository.linearToken}`,
				},
			};
		}

		// Configure issue-tracker-ext (extended tools) based on platform
		if (this.config.platform !== "cli" && repository.linearToken) {
			// Linear mode: Linear HTTP MCP provides basic tools, SDK provides extended tools
			mcpConfig["issue-tracker-ext"] = createCyrusToolsServer(
				repository.linearToken,
				{
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
							if (manager.hasClaudeRunner(childSessionId)) {
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
								await issueTracker.createAgentActivity(childSessionId, {
									type: AgentActivityContentType.Thought,
									body: feedbackThought,
								});

								console.log(
									`[EdgeWorker] Posted feedback receipt thought for child session ${childSessionId}`,
								);
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
				},
			);
		}

		// Configure CLI-specific issue tracker tools when platform is "cli"
		if (this.config.platform === "cli") {
			// CLI mode provides SDK-based issue tracker tools using in-memory storage
			const issueTracker = this.issueTrackers.get(repository.id);
			if (issueTracker && issueTracker instanceof CLIIssueTrackerService) {
				// Basic issue tracker tools (replicate Linear MCP's core tools)
				mcpConfig["issue-tracker"] =
					createBasicIssueTrackerServer(issueTracker);

				// Extended issue tracker tools (platform-agnostic tools for session management)
				mcpConfig["issue-tracker-ext"] = createIssueTrackerToolsServer(issueTracker, {
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
							if (manager.hasClaudeRunner(childSessionId)) {
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

						// Post thought to CLI showing feedback receipt
						const cliIssueTracker = this.issueTrackers.get(childRepo.id);
						if (cliIssueTracker) {
							const feedbackThought = parentIssueId
								? `Received feedback from orchestrator (${parentIssueId}):\n\n---\n\n${message}\n\n---`
								: `Received feedback from orchestrator:\n\n---\n\n${message}\n\n---`;

							try {
								await cliIssueTracker.createAgentActivity(childSessionId, {
									type: AgentActivityContentType.Thought,
									body: feedbackThought,
								});

								console.log(
									`[EdgeWorker] Posted feedback receipt thought for child session ${childSessionId}`,
								);
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
				});
			}
		}

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
		fullIssue: Issue,
		repository: RepositoryConfig,
		promptBody: string,
		attachmentManifest?: string,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<string> {
		// Fetch labels for system prompt determination
		const labelsConnection = await fullIssue.labels();
		const labelNames = labelsConnection?.nodes?.map((l) => l.name) || [];

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
			labels: labelNames,
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
			// Extract workspace slug from issue URL for proper @mention formatting
			const workspaceSlug = input.fullIssue.url
				? this.extractWorkspaceSlug(input.fullIssue.url)
				: undefined;

			const subroutinePrompt = await this.loadSubroutinePrompt(
				currentSubroutine,
				workspaceSlug,
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
	 * Extract the workspace slug from a Linear issue URL
	 * URL format: https://linear.app/{workspace}/issue/{identifier}/...
	 */
	private extractWorkspaceSlug(issueUrl: string): string {
		try {
			const url = new URL(issueUrl);
			const pathParts = url.pathname.split("/").filter((p) => p);
			// First part after the domain is the workspace slug
			return pathParts[0] || "linear";
		} catch (_error) {
			console.warn(
				`[EdgeWorker] Failed to parse issue URL ${issueUrl}, using default workspace`,
			);
			return "linear";
		}
	}

	/**
	 * Load a subroutine prompt file
	 * Extracted helper to make prompt assembly more readable
	 */
	private async loadSubroutinePrompt(
		subroutine: SubroutineDefinition,
		workspaceSlug?: string,
	): Promise<string | null> {
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
		issue: Issue,
		repository: RepositoryConfig,
		promptType: PromptType,
		attachmentManifest?: string,
		guidance?: LinearWebhookGuidanceRule[],
		agentSession?: LinearWebhookAgentSession,
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
	 * Build Claude runner configuration with common settings
	 */
	private buildClaudeRunnerConfig(
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
	): ClaudeRunnerConfig {
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

		// Check for model override labels (case-insensitive)
		let modelOverride: string | undefined;
		let fallbackModelOverride: string | undefined;

		if (labels && labels.length > 0) {
			const lowercaseLabels = labels.map((label) => label.toLowerCase());

			// Check for model override labels: opus, sonnet, haiku
			if (lowercaseLabels.includes("opus")) {
				modelOverride = "opus";
				console.log(
					`[EdgeWorker] Model override via label: opus (for session ${linearAgentActivitySessionId})`,
				);
			} else if (lowercaseLabels.includes("sonnet")) {
				modelOverride = "sonnet";
				console.log(
					`[EdgeWorker] Model override via label: sonnet (for session ${linearAgentActivitySessionId})`,
				);
			} else if (lowercaseLabels.includes("haiku")) {
				modelOverride = "haiku";
				console.log(
					`[EdgeWorker] Model override via label: haiku (for session ${linearAgentActivitySessionId})`,
				);
			}

			// If a model override is found, also set a reasonable fallback
			if (modelOverride) {
				// Set fallback to the next lower tier: opus->sonnet, sonnet->haiku, haiku->sonnet
				if (modelOverride === "opus") {
					fallbackModelOverride = "sonnet";
				} else if (modelOverride === "sonnet") {
					fallbackModelOverride = "haiku";
				} else {
					fallbackModelOverride = "sonnet"; // haiku falls back to sonnet since same model retry doesn't help
				}
			}
		}

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
			model: modelOverride || repository.model || this.config.defaultModel,
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

		if (maxTurns !== undefined) {
			(config as any).maxTurns = maxTurns;
		}

		return config;
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

		// Issue tracker MCP tools that should always be available
		// Both Linear and CLI modes provide TWO MCP servers:
		// - "issue-tracker" for basic tools (create_comment, create_issue, get_issue, list_labels, list_teams)
		// - "issue-tracker-ext" for extended tools (upload_file, agent_session_create, agent_give_feedback, get_child_issues)
		// See: https://docs.anthropic.com/en/docs/claude-code/iam#tool-specific-permission-rules
		const issueTrackerMcpTools = [
			"mcp__issue-tracker",
			"mcp__issue-tracker-ext",
		];

		// Combine and deduplicate
		const allTools = [...new Set([...baseTools, ...issueTrackerMcpTools])];

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

		return {
			agentSessions,
			agentSessionEntries,
			childToParentAgentSession,
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

			await issueTracker.createAgentActivity(linearAgentActivitySessionId, {
				type: AgentActivityContentType.Thought,
				body: "I've received your request and I'm starting to work on it. Let me analyze the issue and prepare my approach.",
			});
			console.log(
				`[EdgeWorker] Posted instant acknowledgment thought for session ${linearAgentActivitySessionId}`,
			);
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

			await issueTracker.createAgentActivity(linearAgentActivitySessionId, {
				type: AgentActivityContentType.Thought,
				body: "Resuming from child session",
			});
			console.log(
				`[EdgeWorker] Posted parent resumption acknowledgment thought for session ${linearAgentActivitySessionId}`,
			);
		} catch (error) {
			console.error(
				`[EdgeWorker] Error posting parent resumption acknowledgment:`,
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
	): Promise<void> {
		// Initialize procedure metadata using intelligent routing
		if (!session.metadata) {
			session.metadata = {};
		}

		// Post ephemeral "Routing..." thought
		await agentSessionManager.postRoutingThought(linearAgentActivitySessionId);

		// Route based on the prompt content
		const routingDecision = await this.procedureRouter.determineRoutine(
			promptBody.trim(),
		);
		const selectedProcedure = routingDecision.procedure;

		// Initialize procedure metadata in session (resets currentSubroutine)
		this.procedureRouter.initializeProcedureMetadata(
			session,
			selectedProcedure,
		);

		// Post procedure selection result (replaces ephemeral routing thought)
		await agentSessionManager.postProcedureSelectionThought(
			linearAgentActivitySessionId,
			selectedProcedure.name,
			routingDecision.classification,
		);

		// Log routing decision
		console.log(
			`[EdgeWorker] Routing decision for ${linearAgentActivitySessionId}:`,
		);
		console.log(`  Classification: ${routingDecision.classification}`);
		console.log(`  Procedure: ${selectedProcedure.name}`);
		console.log(`  Reasoning: ${routingDecision.reasoning}`);
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
		// Check if runner is actively streaming before routing
		const existingRunner = session.claudeRunner;
		const isStreaming = existingRunner?.isStreaming() || false;

		// Always route procedure for new input, UNLESS actively streaming
		if (!isStreaming) {
			await this.rerouteProcedureForSession(
				session,
				linearAgentActivitySessionId,
				agentSessionManager,
				promptBody,
			);
			console.log(`[EdgeWorker] Routed procedure for ${logContext}`);
		} else {
			console.log(
				`[EdgeWorker] Skipping routing for ${linearAgentActivitySessionId} (${logContext}) - runner is actively streaming`,
			);
		}

		// Handle streaming case - add message to existing stream
		if (existingRunner?.isStreaming()) {
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

		await this.resumeClaudeSession(
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

			await issueTracker.createAgentActivity(linearAgentActivitySessionId, {
				type: AgentActivityContentType.Thought,
				body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`,
			});
			console.log(
				`[EdgeWorker] Posted system prompt selection thought for session ${linearAgentActivitySessionId} (${selectedPromptType} mode)`,
			);
		} catch (error) {
			console.error(
				`[EdgeWorker] Error posting system prompt selection thought:`,
				error,
			);
		}
	}

	/**
	 * Resume or create a Claude session with the given prompt
	 * This is the core logic for handling prompted agent activities
	 * @param session The Cyrus agent session
	 * @param repository The repository configuration
	 * @param linearAgentActivitySessionId The Linear agent session ID
	 * @param agentSessionManager The agent session manager
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest
	 * @param isNewSession Whether this is a new session
	 */
	async resumeClaudeSession(
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
		const existingRunner = session.claudeRunner;

		// If there's an existing streaming runner, add to it
		if (existingRunner?.isStreaming()) {
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}

			existingRunner.addStreamMessage(fullPrompt);
			return;
		}

		// Stop existing runner if it's not streaming
		if (existingRunner) {
			existingRunner.stop();
		}

		// Determine if we need a new Claude session
		const needsNewClaudeSession = isNewSession || !session.claudeSessionId;

		// Fetch full issue details
		const fullIssue = await this.fetchFullIssueDetails(
			session.issueId,
			repository.id,
		);
		if (!fullIssue) {
			console.error(
				`[resumeClaudeSession] Failed to fetch full issue details for ${session.issueId}`,
			);
			throw new Error(
				`Failed to fetch full issue details for ${session.issueId}`,
			);
		}

		// Fetch issue labels and determine system prompt
		const labelsConnection = await fullIssue.labels();
		const labelNames = labelsConnection?.nodes?.map((l) => l.name) || [];

		const systemPromptResult = await this.determineSystemPromptFromLabels(
			labelNames,
			repository,
		);
		const systemPrompt = systemPromptResult?.prompt;
		const promptType = systemPromptResult?.type;

		// Build allowed tools list
		const allowedTools = this.buildAllowedTools(repository, promptType);
		const disallowedTools = this.buildDisallowedTools(repository, promptType);

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
			...additionalAllowedDirectories,
		];

		// Create runner configuration
		const resumeSessionId = needsNewClaudeSession
			? undefined
			: session.claudeSessionId;

		const runnerConfig = this.buildClaudeRunnerConfig(
			session,
			repository,
			linearAgentActivitySessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			resumeSessionId,
			labelNames, // Pass labels for model override
			maxTurns, // Pass maxTurns if specified
		);

		const runner = new ClaudeRunner(runnerConfig);

		// Store runner
		agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner);

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

		// Start streaming session
		try {
			await runner.startStreaming(fullPrompt);
		} catch (error) {
			console.error(
				`[resumeClaudeSession] Failed to start streaming session for ${linearAgentActivitySessionId}:`,
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

			await issueTracker.createAgentActivity(linearAgentActivitySessionId, {
				type: AgentActivityContentType.Thought,
				body: message,
			});
			console.log(
				`[EdgeWorker] Posted instant prompted acknowledgment thought for session ${linearAgentActivitySessionId} (streaming: ${isStreaming})`,
			);
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
	): Promise<Issue | null> {
		const issueTracker = this.issueTrackers.get(repositoryId);
		if (!issueTracker) {
			console.warn(
				`[EdgeWorker] No issue tracker found for repository ${repositoryId}`,
			);
			return null;
		}

		try {
			console.log(`[EdgeWorker] Fetching full issue details for ${issueId}`);
			const fullIssue: Issue = await issueTracker.fetchIssue(issueId);
			console.log(
				`[EdgeWorker] Successfully fetched issue details for ${issueId}`,
			);

			// Check if issue has a parent
			try {
				const parentId = fullIssue.parentId;
				if (parentId) {
					console.log(`[EdgeWorker] Issue ${issueId} has parent: ${parentId}`);
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
}
