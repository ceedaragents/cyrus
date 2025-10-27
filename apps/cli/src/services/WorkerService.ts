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
	private cloudflareClient: any = null;
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
	 * Start the EdgeWorker with given configuration
	 */
	async startEdgeWorker(params: {
		proxyUrl: string;
		repositories: RepositoryConfig[];
		ngrokAuthToken?: string;
		onOAuthCallback?: (
			token: string,
			workspaceId: string,
			workspaceName: string,
		) => Promise<void>;
	}): Promise<void> {
		const { proxyUrl, repositories, ngrokAuthToken, onOAuthCallback } = params;

		// Determine if using external host
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";

		// Load config once for model defaults
		const edgeConfig = this.configService.load();

		// Create EdgeWorker configuration
		const config: EdgeWorkerConfig = {
			proxyUrl,
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
		this.logger.info(`Configured proxy URL: ${config.proxyUrl}`);
		this.logger.info(`Managing ${repositories.length} repositories:`);
		repositories.forEach((repo) => {
			this.logger.info(`  - ${repo.name} (${repo.repositoryPath})`);
		});
	}

	/**
	 * Start Cloudflare tunnel client (Pro plan only)
	 */
	async startCloudflareClient(params: {
		onWebhook?: (payload: any) => void;
		onConfigUpdate?: () => void;
		onError?: (error: Error) => void;
	}): Promise<void> {
		const { onWebhook, onConfigUpdate, onError } = params;

		// Validate required environment variables
		const cloudflareToken = process.env.CLOUDFLARE_TOKEN;
		const cyrusApiKey = process.env.CYRUS_API_KEY;

		if (!cloudflareToken || !cyrusApiKey) {
			const missing = [];
			if (!cloudflareToken) missing.push("CLOUDFLARE_TOKEN");
			if (!cyrusApiKey) missing.push("CYRUS_API_KEY");

			throw new Error(
				`Missing required credentials: ${missing.join(", ")}. ` +
					`Please run: cyrus auth <auth-key>. ` +
					`Get your auth key from: https://www.atcyrus.com/onboarding/auth-cyrus`,
			);
		}

		this.logger.info("\n🌩️  Starting Cloudflare Tunnel Client");
		this.logger.divider(50);

		try {
			const { CloudflareTunnelClient } = await import(
				"cyrus-cloudflare-tunnel-client"
			);

			const client = new CloudflareTunnelClient({
				cyrusHome: this.cyrusHome,
				onWebhook:
					onWebhook ||
					((payload) => {
						this.logger.info("\n📨 Webhook received from Linear");
						this.logger.info(`Action: ${payload.action || "Unknown"}`);
						this.logger.info(`Type: ${payload.type || "Unknown"}`);
						// TODO: Forward webhook to EdgeWorker or handle directly
					}),
				onConfigUpdate:
					onConfigUpdate ||
					(() => {
						this.logger.info("\n🔄 Configuration updated from cyrus-hosted");
					}),
				onError:
					onError ||
					((error) => {
						this.logger.error(`\nCloudflare client error: ${error.message}`);
					}),
				onReady: (tunnelUrl) => {
					this.logger.success("Cloudflare tunnel established");
					this.logger.info(`🔗 Tunnel URL: ${tunnelUrl}`);
					this.logger.divider(50);
					this.logger.info("\n💎 Pro Plan Active - Using Cloudflare Tunnel");
					this.logger.info(
						"🚀 Cyrus is now ready to receive webhooks and config updates",
					);
					this.logger.divider(50);
				},
			});

			// Start the tunnel with Cloudflare token and API key
			await client.startTunnel(cloudflareToken, cyrusApiKey);

			// Store client for cleanup (Application handles signal handlers)
			this.cloudflareClient = client;
		} catch (error) {
			throw new Error(
				`Failed to start Cloudflare tunnel: ${(error as Error).message}. ` +
					`If you're having issues, try re-authenticating with: cyrus auth <auth-key>`,
			);
		}
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

		// Stop edge worker (includes stopping shared application server)
		if (this.edgeWorker) {
			await this.edgeWorker.stop();
		}

		// Stop Cloudflare client if running
		if (this.cloudflareClient) {
			this.logger.info("\n🛑 Shutting down Cloudflare tunnel...");
			this.cloudflareClient.disconnect();
		}

		this.logger.info("Shutdown complete");
	}
}
