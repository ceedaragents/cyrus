import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type Comment,
	LinearClient,
	type Issue as LinearIssue,
} from "@linear/sdk";
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
	getAllTools,
	getCoordinatorTools,
	getReadOnlyTools,
	getSafeTools,
} from "cyrus-claude-runner";
import type {
	CyrusAgentSession,
	IssueMinimal,
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	// LinearIssueAssignedWebhook,
	// LinearIssueCommentMentionWebhook,
	// LinearIssueNewCommentWebhook,
	LinearIssueUnassignedWebhook,
	LinearWebhook,
	LinearWebhookAgentSession,
	LinearWebhookComment,
	LinearWebhookIssue,
	SerializableEdgeWorkerState,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
} from "cyrus-core";
import {
	isAgentSessionCreatedWebhook,
	isAgentSessionPromptedWebhook,
	isIssueAssignedWebhook,
	isIssueCommentMentionWebhook,
	isIssueNewCommentWebhook,
	isIssueUnassignedWebhook,
	PersistenceManager,
} from "cyrus-core";
import { LinearWebhookClient } from "cyrus-linear-webhook-client";
import { NdjsonClient } from "cyrus-ndjson-client";
import { fileTypeFromBuffer } from "file-type";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { SharedApplicationServer } from "./SharedApplicationServer.js";
import type {
	EdgeWorkerConfig,
	EdgeWorkerEvents,
	LinearAgentSessionData,
	RepositoryConfig,
} from "./types.js";

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

const LAST_MESSAGE_MARKER =
	"\n\nIMPORTANT: When providing your final summary response, include the special marker ___LAST_MESSAGE_MARKER___ at the very beginning of your message. This marker will be automatically removed before posting.";

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
	private linearClients: Map<string, LinearClient> = new Map(); // one linear client per 'repository'
	private ndjsonClients: Map<string, NdjsonClient | LinearWebhookClient> =
		new Map(); // listeners for webhook events, one per linear token
	private persistenceManager: PersistenceManager;
	private sharedApplicationServer: SharedApplicationServer;
	private cyrusHome: string;
	private childToParentAgentSession: Map<string, string> = new Map(); // Maps child agentSessionId to parent agentSessionId

	constructor(config: EdgeWorkerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		this.persistenceManager = new PersistenceManager(
			join(this.cyrusHome, "state"),
		);

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
			config.ngrokAuthToken,
			config.proxyUrl,
		);

		// Register OAuth callback handler if provided
		if (config.handlers?.onOAuthCallback) {
			this.sharedApplicationServer.registerOAuthCallbackHandler(
				config.handlers.onOAuthCallback,
			);
		}

		// Initialize repositories
		for (const repo of config.repositories) {
			if (repo.isActive !== false) {
				this.repositories.set(repo.id, repo);

				// Create Linear client for this repository's workspace
				const linearClient = new LinearClient({
					accessToken: repo.linearToken,
				});
				this.linearClients.set(repo.id, linearClient);

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
					linearClient,
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
					async (
						parentSessionId: string,
						prompt: string,
						childSessionId: string,
					) => {
						console.log(
							`[Parent Session Resume] Child session completed, resuming parent session ${parentSessionId}`,
						);

						// Get the parent session and repository
						// This works because by the time this callback runs, agentSessionManager is fully initialized
						console.log(
							`[Parent Session Resume] Retrieving parent session ${parentSessionId} from agent session manager`,
						);
						const parentSession =
							agentSessionManager.getSession(parentSessionId);
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

						// Resume the parent session with the child's result
						console.log(
							`[Parent Session Resume] Resuming parent Claude session with child results`,
						);
						try {
							await this.resumeClaudeSession(
								parentSession,
								repo,
								parentSessionId,
								agentSessionManager,
								prompt,
								"", // No attachment manifest for child results
								false, // Not a new session
								childWorkspaceDirs, // Add child workspace directories to parent's allowed directories
							);
							console.log(
								`[Parent Session Resume] Successfully resumed parent session ${parentSessionId} with child results`,
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
					},
				);
				this.agentSessionManagers.set(repo.id, agentSessionManager);
			}
		}

		// Group repositories by token to minimize NDJSON connections
		const tokenToRepos = new Map<string, RepositoryConfig[]>();
		for (const repo of this.repositories.values()) {
			const repos = tokenToRepos.get(repo.linearToken) || [];
			repos.push(repo);
			tokenToRepos.set(repo.linearToken, repos);
		}

		// Create one NDJSON client per unique token using shared application server
		for (const [token, repos] of tokenToRepos) {
			if (!repos || repos.length === 0) continue;
			const firstRepo = repos[0];
			if (!firstRepo) continue;
			const primaryRepoId = firstRepo.id;

			// Determine which client to use based on environment variable
			const useLinearDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS === "true";

			const clientConfig = {
				proxyUrl: config.proxyUrl,
				token: token,
				name: repos.map((r) => r.name).join(", "), // Pass repository names
				transport: "webhook" as const,
				// Use shared application server instead of individual servers
				useExternalWebhookServer: true,
				externalWebhookServer: this.sharedApplicationServer,
				webhookPort: serverPort, // All clients use same port
				webhookPath: "/webhook",
				webhookHost: serverHost,
				...(config.baseUrl && { webhookBaseUrl: config.baseUrl }),
				// Legacy fallback support
				...(!config.baseUrl &&
					config.webhookBaseUrl && { webhookBaseUrl: config.webhookBaseUrl }),
				onConnect: () => this.handleConnect(primaryRepoId, repos),
				onDisconnect: (reason?: string) =>
					this.handleDisconnect(primaryRepoId, repos, reason),
				onError: (error: Error) => this.handleError(error),
			};

			// Create the appropriate client based on configuration
			const ndjsonClient = useLinearDirectWebhooks
				? new LinearWebhookClient({
						...clientConfig,
						onWebhook: (payload) =>
							this.handleWebhook(payload as unknown as LinearWebhook, repos),
					})
				: new NdjsonClient(clientConfig);

			// Set up webhook handler for NdjsonClient (LinearWebhookClient uses onWebhook in constructor)
			if (!useLinearDirectWebhooks) {
				(ndjsonClient as NdjsonClient).on("webhook", (data) =>
					this.handleWebhook(data as LinearWebhook, repos),
				);
			}

			// Optional heartbeat logging (only for NdjsonClient)
			if (process.env.DEBUG_EDGE === "true" && !useLinearDirectWebhooks) {
				(ndjsonClient as NdjsonClient).on("heartbeat", () => {
					console.log(
						`❤️ Heartbeat received for token ending in ...${token.slice(-4)}`,
					);
				});
			}

			// Store with the first repo's ID as the key (for error messages)
			// But also store the token mapping for lookup
			this.ndjsonClients.set(primaryRepoId, ndjsonClient);
		}
	}

	/**
	 * Start the edge worker
	 */
	async start(): Promise<void> {
		// Load persisted state for each repository
		await this.loadPersistedState();

		// Start shared application server first
		await this.sharedApplicationServer.start();

		// Connect all NDJSON clients
		const connections = Array.from(this.ndjsonClients.entries()).map(
			async ([repoId, client]) => {
				try {
					await client.connect();
				} catch (error: any) {
					const repoConfig = this.config.repositories.find(
						(r) => r.id === repoId,
					);
					const repoName = repoConfig?.name || repoId;

					// Check if it's an authentication error
					if (error.isAuthError || error.code === "LINEAR_AUTH_FAILED") {
						console.error(
							`\n❌ Linear authentication failed for repository: ${repoName}`,
						);
						console.error(
							`   Workspace: ${repoConfig?.linearWorkspaceName || repoConfig?.linearWorkspaceId || "Unknown"}`,
						);
						console.error(`   Error: ${error.message}`);
						console.error(`\n   To fix this issue:`);
						console.error(`   1. Run: cyrus refresh-token`);
						console.error(`   2. Complete the OAuth flow in your browser`);
						console.error(
							`   3. The configuration will be automatically updated\n`,
						);
						console.error(
							`   You can also check all tokens with: cyrus check-tokens\n`,
						);

						// Continue with other repositories instead of failing completely
						return { repoId, success: false, error };
					}

					// For other errors, still log but with less guidance
					console.error(`\n❌ Failed to connect repository: ${repoName}`);
					console.error(`   Error: ${error.message}\n`);
					return { repoId, success: false, error };
				}
				return { repoId, success: true };
			},
		);

		const results = await Promise.all(connections);
		const failures = results.filter((r) => !r.success);

		if (failures.length === this.ndjsonClients.size) {
			// All connections failed
			throw new Error(
				"Failed to connect any repositories. Please check your configuration and Linear tokens.",
			);
		} else if (failures.length > 0) {
			// Some connections failed
			console.warn(
				`\n⚠️  Connected ${results.length - failures.length} out of ${results.length} repositories`,
			);
			console.warn(`   The following repositories could not be connected:`);
			failures.forEach((f) => {
				const repoConfig = this.config.repositories.find(
					(r) => r.id === f.repoId,
				);
				console.warn(`   - ${repoConfig?.name || f.repoId}`);
			});
			console.warn(
				`\n   Cyrus will continue running with the available repositories.\n`,
			);
		}
	}

	/**
	 * Stop the edge worker
	 */
	async stop(): Promise<void> {
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

		// Disconnect all NDJSON clients
		for (const client of this.ndjsonClients.values()) {
			client.disconnect();
		}

		// Stop shared application server
		await this.sharedApplicationServer.stop();
	}

	/**
	 * Handle connection established
	 */
	private handleConnect(clientId: string, repos: RepositoryConfig[]): void {
		// Get the token for backward compatibility with events
		const token = repos[0]?.linearToken || clientId;
		this.emit("connected", token);
		// Connection logged by CLI app event handler
	}

	/**
	 * Handle disconnection
	 */
	private handleDisconnect(
		clientId: string,
		repos: RepositoryConfig[],
		reason?: string,
	): void {
		// Get the token for backward compatibility with events
		const token = repos[0]?.linearToken || clientId;
		this.emit("disconnected", token, reason);
	}

	/**
	 * Handle errors
	 */
	private handleError(error: Error): void {
		this.emit("error", error);
		this.config.handlers?.onError?.(error);
	}

	/**
	 * Handle webhook events from proxy - now accepts native webhook payloads
	 */
	private async handleWebhook(
		webhook: LinearWebhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		// Log verbose webhook info if enabled
		if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
			console.log(
				`[handleWebhook] Full webhook payload:`,
				JSON.stringify(webhook, null, 2),
			);
		}

		// Find the appropriate repository for this webhook
		const repository = await this.findRepositoryForWebhook(webhook, repos);
		if (!repository) {
			if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
				console.log(
					`[handleWebhook] No repository configured for webhook from workspace ${webhook.organizationId}`,
				);
				console.log(
					`[handleWebhook] Available repositories:`,
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
			// Handle specific webhook types with proper typing
			// NOTE: Traditional webhooks (assigned, comment) are disabled in favor of agent session events
			if (isIssueAssignedWebhook(webhook)) {
				return;
			} else if (isIssueCommentMentionWebhook(webhook)) {
				return;
			} else if (isIssueNewCommentWebhook(webhook)) {
				return;
			} else if (isIssueUnassignedWebhook(webhook)) {
				// Keep unassigned webhook active
				await this.handleIssueUnassignedWebhook(webhook, repository);
			} else if (isAgentSessionCreatedWebhook(webhook)) {
				await this.handleAgentSessionCreatedWebhook(webhook, repository);
			} else if (isAgentSessionPromptedWebhook(webhook)) {
				await this.handleUserPostedAgentActivity(webhook, repository);
			} else {
				if (process.env.CYRUS_WEBHOOK_DEBUG === "true") {
					console.log(
						`[handleWebhook] Unhandled webhook type: ${(webhook as any).action} for repository ${repository.name}`,
					);
				}
			}
		} catch (error) {
			console.error(
				`[handleWebhook] Failed to process webhook: ${(webhook as any).action} for repository ${repository.name}`,
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
	private async findRepositoryForWebhook(
		webhook: LinearWebhook,
		repos: RepositoryConfig[],
	): Promise<RepositoryConfig | null> {
		const workspaceId = webhook.organizationId;
		if (!workspaceId) return repos[0] || null; // Fallback to first repo if no workspace ID

		// Get issue information from webhook
		let issueId: string | undefined;
		let teamKey: string | undefined;
		let issueIdentifier: string | undefined;

		// Handle agent session webhooks which have different structure
		if (
			isAgentSessionCreatedWebhook(webhook) ||
			isAgentSessionPromptedWebhook(webhook)
		) {
			issueId = webhook.agentSession?.issue?.id;
			teamKey = webhook.agentSession?.issue?.team?.key;
			issueIdentifier = webhook.agentSession?.issue?.identifier;
		} else {
			issueId = webhook.notification?.issue?.id;
			teamKey = webhook.notification?.issue?.team?.key;
			issueIdentifier = webhook.notification?.issue?.identifier;
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
			// We need a Linear client to fetch labels
			// Use the first workspace repo's client temporarily
			const linearClient = this.linearClients.get(workspaceRepos[0].id);

			if (linearClient) {
				try {
					// Fetch the issue to get labels
					const issue = await linearClient.issue(issueId);
					const labels = await this.fetchIssueLabels(issue);

					// Check each repo with routing labels
					for (const repo of reposWithRoutingLabels) {
						if (
							repo.routingLabels?.some((routingLabel) =>
								labels.includes(routingLabel),
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
		const { agentSession } = webhook;
		const linearAgentActivitySessionId = agentSession.id;
		const { issue } = agentSession;

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

		// Fetch labels (needed for both model selection and system prompt determination)
		const labels = await this.fetchIssueLabels(fullIssue);

		// Only determine system prompt for delegation (not mentions) or when /label-based-prompt is requested
		let systemPrompt: string | undefined;
		let systemPromptVersion: string | undefined;
		let promptType:
			| "debugger"
			| "builder"
			| "scoper"
			| "orchestrator"
			| undefined;

		if (!isMentionTriggered || isLabelBasedPromptRequested) {
			// Determine system prompt based on labels (delegation case or /label-based-prompt command)
			const systemPromptResult = await this.determineSystemPromptFromLabels(
				labels,
				repository,
			);
			systemPrompt = systemPromptResult?.prompt;
			systemPromptVersion = systemPromptResult?.version;
			promptType = systemPromptResult?.type;

			// Post thought about system prompt selection
			if (systemPrompt) {
				await this.postSystemPromptSelectionThought(
					linearAgentActivitySessionId,
					labels,
					repository.id,
				);
			}
		} else {
			console.log(
				`[EdgeWorker] Skipping system prompt for mention-triggered session ${linearAgentActivitySessionId}`,
			);
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

		// Create Claude runner with attachment directory access and optional system prompt
		const runnerConfig = this.buildClaudeRunnerConfig(
			session,
			repository,
			linearAgentActivitySessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			undefined, // resumeSessionId
			labels, // Pass labels for model override
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

		// Build and start Claude with initial prompt using full issue (streaming mode)
		console.log(
			`[EdgeWorker] Building initial prompt for issue ${fullIssue.identifier}`,
		);
		try {
			// Choose the appropriate prompt builder based on trigger type and system prompt
			const promptResult =
				isMentionTriggered && isLabelBasedPromptRequested
					? await this.buildLabelBasedPrompt(
							fullIssue,
							repository,
							attachmentResult.manifest,
						)
					: isMentionTriggered
						? await this.buildMentionPrompt(
								fullIssue,
								agentSession,
								attachmentResult.manifest,
							)
						: systemPrompt
							? await this.buildLabelBasedPrompt(
									fullIssue,
									repository,
									attachmentResult.manifest,
								)
							: await this.buildPromptV2(
									fullIssue,
									repository,
									undefined,
									attachmentResult.manifest,
								);

			const { prompt, version: userPromptVersion } = promptResult;

			// Update runner with version information
			if (userPromptVersion || systemPromptVersion) {
				runner.updatePromptVersions({
					userPromptVersion,
					systemPromptVersion,
				});
			}

			const promptType =
				isMentionTriggered && isLabelBasedPromptRequested
					? "label-based-prompt-command"
					: isMentionTriggered
						? "mention"
						: systemPrompt
							? "label-based"
							: "fallback";
			console.log(
				`[EdgeWorker] Initial prompt built successfully using ${promptType} workflow, length: ${prompt.length} characters`,
			);
			console.log(`[EdgeWorker] Starting Claude streaming session`);
			const sessionInfo = await runner.startStreaming(prompt);
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
			const { fullIssue: newFullIssue } = sessionData;
			session = sessionData.session;

			// Save state and emit events for new session
			await this.savePersistedState();
			this.emit(
				"session:started",
				newFullIssue.id,
				newFullIssue,
				repository.id,
			);
			this.config.handlers?.onSessionStart?.(
				newFullIssue.id,
				newFullIssue,
				repository.id,
			);
		}

		// Ensure session is not null after creation/retrieval
		if (!session) {
			throw new Error(
				`Failed to get or create session for agent activity session ${linearAgentActivitySessionId}`,
			);
		}

		// Nothing before this should create latency or be async, so that these remain instant and low-latency for user experience
		const existingRunner = session.claudeRunner;
		if (!isNewSession) {
			// Only post acknowledgment for existing sessions (new sessions already handled it above)
			await this.postInstantPromptedAcknowledgment(
				linearAgentActivitySessionId,
				repository.id,
				existingRunner?.isStreaming() || false,
			);
		}

		// Get Linear client for this repository
		const linearClient = this.linearClients.get(repository.id);
		if (!linearClient) {
			console.error(
				"Unexpected: There was no LinearClient for the repository with id",
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
		try {
			const result = await linearClient.client.rawRequest(
				`
          query GetComment($id: String!) {
            comment(id: $id) {
              id
              body
              createdAt
              updatedAt
              user {
                name
                id
              }
            }
          }
        `,
				{ id: commentId },
			);

			// Count existing attachments
			const existingFiles = await readdir(attachmentsDir).catch(() => []);
			const existingAttachmentCount = existingFiles.filter(
				(file) => file.startsWith("attachment_") || file.startsWith("image_"),
			).length;

			// Download new attachments from the comment
			const downloadResult = await this.downloadCommentAttachments(
				(result.data as any).comment.body,
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

		// Check if there's an existing runner for this comment thread
		if (existingRunner?.isStreaming()) {
			// Add comment with attachment manifest to existing stream
			console.log(
				`[EdgeWorker] Adding comment to existing stream for agent activity session ${linearAgentActivitySessionId}`,
			);

			// Append attachment manifest to the prompt if we have one
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}
			fullPrompt = `${fullPrompt}${LAST_MESSAGE_MARKER}`;

			existingRunner.addStreamMessage(fullPrompt);
			return; // Exit early - comment has been added to stream
		}

		// Use the new resumeClaudeSession function
		try {
			await this.resumeClaudeSession(
				session,
				repository,
				linearAgentActivitySessionId,
				agentSessionManager,
				promptBody,
				attachmentManifest,
				isNewSession,
				[], // No additional allowed directories for regular continuation
			);
		} catch (error) {
			console.error("Failed to continue conversation:", error);
			// Remove any partially created session
			// this.sessionManager.removeSession(threadRootCommentId)
			// this.commentToRepo.delete(threadRootCommentId)
			// this.commentToIssue.delete(threadRootCommentId)
			// // Start fresh for root comments, or fall back to issue assignment
			// if (isRootComment) {
			//   await this.handleNewRootComment(issue, comment, repository)
			// } else {
			//   await this.handleIssueAssigned(issue, repository)
			// }
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
	 * @returns Formatted prompt string
	 */
	private async buildLabelBasedPrompt(
		issue: LinearIssue,
		repository: RepositoryConfig,
		attachmentManifest: string = "",
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
			const linearClient = this.linearClients.get(repository.id);
			if (!linearClient) {
				console.error(`No LinearClient found for repository ${repository.id}`);
				throw new Error(
					`No LinearClient found for repository ${repository.id}`,
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
				const teamsConnection = await linearClient.teams();
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
				const labelsConnection = await linearClient.issueLabels();
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

			if (attachmentManifest) {
				console.log(
					`[EdgeWorker] Adding attachment manifest to label-based prompt, length: ${attachmentManifest.length} characters`,
				);
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			prompt = `${prompt}${LAST_MESSAGE_MARKER}`;
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
	 * @returns The constructed prompt and optional version tag
	 */
	private async buildMentionPrompt(
		issue: LinearIssue,
		agentSession: LinearWebhookAgentSession,
		attachmentManifest: string = "",
	): Promise<{ prompt: string; version?: string }> {
		try {
			console.log(
				`[EdgeWorker] Building mention prompt for issue ${issue.identifier}`,
			);

			// Get the mention comment body
			const mentionContent = agentSession.comment?.body || "";

			// Build a simple prompt focused on the mention
			let prompt = `You were mentioned in a Linear comment. Please help with the following request.

<linear_issue>
  <id>${issue.id}</id>
  <identifier>${issue.identifier}</identifier>
  <title>${issue.title}</title>
  <url>${issue.url}</url>
</linear_issue>

<mention_request>
${mentionContent}
</mention_request>

IMPORTANT: You were specifically mentioned in the comment above. Focus on addressing the specific question or request in the mention. You can use the Linear MCP tools to fetch additional context about the issue if needed.`;

			// Append attachment manifest if any
			if (attachmentManifest) {
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			prompt = `${prompt}${LAST_MESSAGE_MARKER}`;
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
	 * @returns Formatted prompt string
	 */
	private async buildPromptV2(
		issue: LinearIssue,
		repository: RepositoryConfig,
		newComment?: LinearWebhookComment,
		attachmentManifest: string = "",
	): Promise<{ prompt: string; version?: string }> {
		console.log(
			`[EdgeWorker] buildPromptV2 called for issue ${issue.identifier}${newComment ? " with new comment" : ""}`,
		);

		try {
			// Use custom template if provided (repository-specific takes precedence)
			let templatePath =
				repository.promptTemplatePath ||
				this.config.features?.promptTemplatePath;

			// If no custom template, use the v2 template
			if (!templatePath) {
				const __filename = fileURLToPath(import.meta.url);
				const __dirname = dirname(__filename);
				templatePath = resolve(__dirname, "../prompt-template-v2.md");
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
			const linearClient = this.linearClients.get(repository.id);
			let commentThreads = "No comments yet.";

			if (linearClient && issue.id) {
				try {
					console.log(
						`[EdgeWorker] Fetching comments for issue ${issue.identifier}`,
					);
					const comments = await linearClient.comments({
						filter: { issue: { id: { eq: issue.id } } },
					});

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
				if (linearClient) {
					try {
						const fullComment = await linearClient.comment({
							id: newComment.id,
						});
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
				// Remove the new comment section entirely
				prompt = prompt.replace(/{{#if new_comment}}[\s\S]*?{{\/if}}/g, "");
			}

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

			prompt = `${prompt}${LAST_MESSAGE_MARKER}`;

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

${newComment ? `New comment to address:\n${newComment.body}\n\n` : ""}Please analyze this issue and help implement a solution. ${LAST_MESSAGE_MARKER}`;

			return { prompt: fallbackPrompt, version: undefined };
		}
	}

	/**
	 * Get connection status by repository ID
	 */
	getConnectionStatus(): Map<string, boolean> {
		const status = new Map<string, boolean>();
		for (const [repoId, client] of this.ndjsonClients) {
			status.set(repoId, client.isConnected());
		}
		return status;
	}

	/**
	 * Get NDJSON client by token (for testing purposes)
	 * @internal
	 */
	_getClientByToken(token: string): any {
		for (const [repoId, client] of this.ndjsonClients) {
			const repo = this.repositories.get(repoId);
			if (repo?.linearToken === token) {
				return client;
			}
		}
		return undefined;
	}

	/**
	 * Start OAuth flow using the shared application server
	 */
	async startOAuthFlow(proxyUrl?: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}> {
		const oauthProxyUrl = proxyUrl || this.config.proxyUrl;
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
		issue: LinearIssue,
		repositoryId: string,
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				console.warn(
					`No Linear client found for repository ${repositoryId}, skipping state update`,
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
			const teamStates = await linearClient.workflowStates({
				filter: { team: { id: { eq: team.id } } },
			});

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

			await linearClient.updateIssue(issue.id, {
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
	//   // Get the Linear client for this repository
	//   const linearClient = this.linearClients.get(repositoryId)
	//   if (!linearClient) {
	//     throw new Error(`No Linear client found for repository ${repositoryId}`)
	//   }
	//   const commentData = {
	//     issueId,
	//     body
	//   }
	//   await linearClient.createComment(commentData)
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
		// Get the Linear client for this repository
		const linearClient = this.linearClients.get(repositoryId);
		if (!linearClient) {
			throw new Error(`No Linear client found for repository ${repositoryId}`);
		}
		const commentData: { issueId: string; body: string; parentId?: string } = {
			issueId,
			body,
		};
		// Add parent ID if provided (for reply)
		if (parentId) {
			commentData.parentId = parentId;
		}
		await linearClient.createComment(commentData);
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
			const linearClient = this.linearClients.get(repository.id);

			// Fetch native Linear attachments (e.g., Sentry links)
			const nativeAttachments: Array<{ title: string; url: string }> = [];
			if (linearClient && issue.id) {
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
					const comments = await linearClient.comments({
						filter: { issue: { id: { eq: issue.id } } },
					});
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
		const mcpConfig: Record<string, McpServerConfig> = {
			linear: {
				type: "stdio",
				command: "npx",
				args: ["-y", "@tacticlaunch/mcp-linear"],
				env: {
					LINEAR_API_TOKEN: repository.linearToken,
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

					// Format the feedback as a prompt for the child session with enhanced markdown formatting
					const feedbackPrompt = `## Received feedback from orchestrator\n\n---\n\n${message}\n\n---`;

					// Resume the CHILD session with the feedback from the parent
					// Important: We don't await the full session completion to avoid timeouts.
					// The feedback is delivered immediately when the session starts, so we can
					// return success right away while the session continues in the background.
					this.resumeClaudeSession(
						childSession,
						childRepo,
						childSessionId,
						childAgentSessionManager,
						feedbackPrompt,
						"", // No attachment manifest for feedback
						false, // Not a new session
						[], // No additional allowed directories for feedback
					)
						.then(() => {
							console.log(
								`[EdgeWorker] Child session ${childSessionId} completed processing feedback`,
							);
						})
						.catch((error) => {
							console.error(
								`[EdgeWorker] Failed to complete child session with feedback:`,
								error,
							);
						});

					// Return success immediately after initiating the session
					console.log(
						`[EdgeWorker] Feedback delivered successfully to child session ${childSessionId}`,
					);
					return true;
				},
			}),
		};

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
	 * Build prompt for a session - handles both new and existing sessions
	 */
	private async buildSessionPrompt(
		isNewSession: boolean,
		fullIssue: LinearIssue,
		repository: RepositoryConfig,
		promptBody: string,
		attachmentManifest?: string,
	): Promise<string> {
		if (isNewSession) {
			// For completely new sessions, create a complete initial prompt
			const promptResult = await this.buildPromptV2(
				fullIssue,
				repository,
				undefined,
				attachmentManifest,
			);
			// Add the user's comment to the initial prompt
			return `${promptResult.prompt}\n\nUser comment: ${promptBody}`;
		} else {
			// For existing sessions, just use the comment with attachment manifest
			const manifestSuffix = attachmentManifest
				? `\n\n${attachmentManifest}`
				: "";
			return `${promptBody}${manifestSuffix}${LAST_MESSAGE_MARKER}`;
		}
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
			appendSystemPrompt: (systemPrompt || "") + LAST_MESSAGE_MARKER,
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
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				console.warn(
					`[EdgeWorker] No Linear client found for repository ${repositoryId}`,
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

			const result = await linearClient.createAgentActivity(activityInput);
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
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				console.warn(
					`[EdgeWorker] No Linear client found for repository ${repositoryId}`,
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

			const result = await linearClient.createAgentActivity(activityInput);
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
	 * Post thought about system prompt selection based on labels
	 */
	private async postSystemPromptSelectionThought(
		linearAgentActivitySessionId: string,
		labels: string[],
		repositoryId: string,
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				console.warn(
					`[EdgeWorker] No Linear client found for repository ${repositoryId}`,
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

			const result = await linearClient.createAgentActivity(activityInput);
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
	): Promise<void> {
		// Check for existing runner
		const existingRunner = session.claudeRunner;

		// If there's an existing streaming runner, add to it
		if (existingRunner?.isStreaming()) {
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}
			fullPrompt = `${fullPrompt}${LAST_MESSAGE_MARKER}`;

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
		const labels = await this.fetchIssueLabels(fullIssue);

		const systemPromptResult = await this.determineSystemPromptFromLabels(
			labels,
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
		const runnerConfig = this.buildClaudeRunnerConfig(
			session,
			repository,
			linearAgentActivitySessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			needsNewClaudeSession ? undefined : session.claudeSessionId,
			labels, // Pass labels for model override
		);

		const runner = new ClaudeRunner(runnerConfig);

		// Store runner
		agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner);

		// Save state
		await this.savePersistedState();

		// Prepare the full prompt
		const fullPrompt = await this.buildSessionPrompt(
			isNewSession,
			fullIssue,
			repository,
			promptBody,
			attachmentManifest,
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
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				console.warn(
					`[EdgeWorker] No Linear client found for repository ${repositoryId}`,
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

			const result = await linearClient.createAgentActivity(activityInput);
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
		const linearClient = this.linearClients.get(repositoryId);
		if (!linearClient) {
			console.warn(
				`[EdgeWorker] No Linear client found for repository ${repositoryId}`,
			);
			return null;
		}

		try {
			console.log(`[EdgeWorker] Fetching full issue details for ${issueId}`);
			const fullIssue = await linearClient.issue(issueId);
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
}
