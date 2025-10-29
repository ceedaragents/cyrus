import type { Issue } from "@linear/sdk";
import type { EdgeWorkerConfig, RepositoryConfig } from "cyrus-core";
import { EdgeWorker } from "cyrus-edge-worker";
import { DEFAULT_SERVER_PORT, parsePort } from "../config/constants.js";
import type { Workspace } from "../config/types.js";
import type { ConfigService } from "./ConfigService.js";
import type { GitService } from "./GitService.js";
import type { Logger } from "./Logger.js";

/**
 * Service responsible for EdgeWorker and Cloudflare tunnel management
 */
export class WorkerService {
	private edgeWorker: EdgeWorker | null = null;
	private isShuttingDown = false;

	constructor(
		private configService: ConfigService,
		private gitService: GitService,
		private cyrusHome: string,
		private logger: Logger,
	) {}

	/**
	 * Get the EdgeWorker instance
	 */
	getEdgeWorker(): EdgeWorker | null {
		return this.edgeWorker;
	}

	/**
	 * Get the server port from EdgeWorker
	 */
	getServerPort(): number {
		return this.edgeWorker?.getServerPort() || DEFAULT_SERVER_PORT;
	}

	/**
	 * Start setup waiting mode - server infrastructure only, no EdgeWorker
	 * Used after initial authentication while waiting for server configuration
	 */
	async startSetupWaitingMode(): Promise<void> {
		const { SharedApplicationServer } = await import("cyrus-edge-worker");
		const { ConfigUpdater } = await import("cyrus-config-updater");

		// Determine server configuration
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		const serverPort = parsePort(
			process.env.CYRUS_SERVER_PORT,
			DEFAULT_SERVER_PORT,
		);
		const serverHost = isExternalHost ? "0.0.0.0" : "localhost";

		// Create and start SharedApplicationServer
		const server = new SharedApplicationServer(serverPort, serverHost);
		server.initializeFastify();

		// Register ConfigUpdater routes
		const configUpdater = new ConfigUpdater(
			server.getFastifyInstance(),
			this.cyrusHome,
			process.env.CYRUS_API_KEY || "",
		);
		configUpdater.register();

		this.logger.info("✅ Config updater registered");
		this.logger.info(
			"   Routes: /api/update/cyrus-config, /api/update/cyrus-env,",
		);
		this.logger.info(
			"           /api/update/repository, /api/test-mcp, /api/configure-mcp",
		);

		// Start the server (this also starts Cloudflare tunnel if CLOUDFLARE_TOKEN is set)
		await server.start();

		this.logger.raw("");
		this.logger.divider(70);
		this.logger.info("⏳ Waiting for configuration from server...");
		this.logger.info(`🔗 Server running on port ${serverPort}`);

		if (process.env.CLOUDFLARE_TOKEN) {
			this.logger.info("🌩️  Cloudflare tunnel: Active");
		}

		this.logger.info("📡 Config updater: Ready");
		this.logger.raw("");
		this.logger.info("Your Cyrus instance is ready to receive configuration.");
		this.logger.info("Complete setup at: https://www.atcyrus.com/onboarding");
		this.logger.divider(70);
	}

	/**
	 * Start the EdgeWorker with given configuration
	 */
	async startEdgeWorker(params: {
		repositories: RepositoryConfig[];
		ngrokAuthToken?: string;
		onOAuthCallback?: (
			token: string,
			workspaceId: string,
			workspaceName: string,
		) => Promise<void>;
	}): Promise<void> {
		const { repositories, ngrokAuthToken, onOAuthCallback } = params;

		// Determine if using external host
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";

		// Load config once for model defaults
		const edgeConfig = this.configService.load();

		// Create EdgeWorker configuration
		const config: EdgeWorkerConfig = {
			repositories,
			cyrusHome: this.cyrusHome,
			defaultAllowedTools:
				process.env.ALLOWED_TOOLS?.split(",").map((t) => t.trim()) || [],
			defaultDisallowedTools:
				process.env.DISALLOWED_TOOLS?.split(",").map((t) => t.trim()) ||
				undefined,
			// Model configuration: environment variables take precedence over config file
			defaultModel: process.env.CYRUS_DEFAULT_MODEL || edgeConfig.defaultModel,
			defaultFallbackModel:
				process.env.CYRUS_DEFAULT_FALLBACK_MODEL ||
				edgeConfig.defaultFallbackModel,
			webhookBaseUrl: process.env.CYRUS_BASE_URL,
			serverPort: parsePort(process.env.CYRUS_SERVER_PORT, DEFAULT_SERVER_PORT),
			serverHost: isExternalHost ? "0.0.0.0" : "localhost",
			ngrokAuthToken,
			features: {
				enableContinuation: true,
			},
			handlers: {
				createWorkspace: async (
					issue: Issue,
					repository: RepositoryConfig,
				): Promise<Workspace> => {
					return this.gitService.createGitWorktree(
						issue,
						repository,
						edgeConfig.global_setup_script,
					);
				},
				onOAuthCallback,
			},
		};

		// Create and start EdgeWorker
		this.edgeWorker = new EdgeWorker(config);

		// Set config path for dynamic reloading
		const configPath = this.configService.getConfigPath();
		this.edgeWorker.setConfigPath(configPath);

		// Set up event handlers
		this.setupEventHandlers();

		// Start the worker
		await this.edgeWorker.start();

		this.logger.success("Edge worker started successfully");
		this.logger.info(`Managing ${repositories.length} repositories:`);
		repositories.forEach((repo) => {
			this.logger.info(`  - ${repo.name} (${repo.repositoryPath})`);
		});
	}

	/**
	 * Set up event handlers for EdgeWorker
	 */
	private setupEventHandlers(): void {
		if (!this.edgeWorker) return;

		// Session events
		this.edgeWorker.on(
			"session:started",
			(issueId: string, _issue: Issue, repositoryId: string) => {
				this.logger.info(
					`Started session for issue ${issueId} in repository ${repositoryId}`,
				);
			},
		);

		this.edgeWorker.on(
			"session:ended",
			(issueId: string, exitCode: number | null, repositoryId: string) => {
				this.logger.info(
					`Session for issue ${issueId} ended with exit code ${exitCode} in repository ${repositoryId}`,
				);
			},
		);

		// Connection events
		this.edgeWorker.on("connected", (token: string) => {
			this.logger.success(
				`Connected to proxy with token ending in ...${token.slice(-4)}`,
			);
		});

		this.edgeWorker.on("disconnected", (token: string, reason?: string) => {
			this.logger.error(
				`Disconnected from proxy (token ...${token.slice(-4)}): ${
					reason || "Unknown reason"
				}`,
			);
		});

		// Error events
		this.edgeWorker.on("error", (error: Error) => {
			this.logger.error(`EdgeWorker error: ${error.message}`);
		});
	}

	/**
	 * Stop the EdgeWorker
	 */
	async stop(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		this.logger.info("\nShutting down edge worker...");

		// Stop edge worker (includes stopping shared application server and Cloudflare tunnel)
		if (this.edgeWorker) {
			await this.edgeWorker.stop();
		}

		this.logger.info("Shutdown complete");
	}
}
