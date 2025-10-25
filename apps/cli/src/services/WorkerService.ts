import type { Issue } from "@linear/sdk";
import type { EdgeWorkerConfig, RepositoryConfig } from "cyrus-core";
import { EdgeWorker } from "cyrus-edge-worker";
import { DEFAULT_SERVER_PORT, parsePort } from "../config/constants.js";
import type { Workspace } from "../config/types.js";
import type { ConfigService } from "./ConfigService.js";
import type { GitService } from "./GitService.js";

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

		console.log("\n✅ Edge worker started successfully");
		console.log(`Configured proxy URL: ${config.proxyUrl}`);
		console.log(`Managing ${repositories.length} repositories:`);
		repositories.forEach((repo) => {
			console.log(`  - ${repo.name} (${repo.repositoryPath})`);
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

		console.log("\n🌩️  Starting Cloudflare Tunnel Client");
		console.log("─".repeat(50));

		try {
			const { CloudflareTunnelClient } = await import(
				"cyrus-cloudflare-tunnel-client"
			);

			// Get auth key from config or environment
			// For now, we'll use the API key as the auth key since it's what we validate against
			const authKey = cyrusApiKey;

			const client = new CloudflareTunnelClient({
				authKey,
				cyrusHome: this.cyrusHome,
				onWebhook:
					onWebhook ||
					((payload) => {
						console.log("\n📨 Webhook received from Linear");
						console.log(`Action: ${payload.action || "Unknown"}`);
						console.log(`Type: ${payload.type || "Unknown"}`);
						// TODO: Forward webhook to EdgeWorker or handle directly
					}),
				onConfigUpdate:
					onConfigUpdate ||
					(() => {
						console.log("\n🔄 Configuration updated from cyrus-hosted");
					}),
				onError:
					onError ||
					((error) => {
						console.error("\n❌ Cloudflare client error:", error.message);
					}),
				onReady: (tunnelUrl) => {
					console.log("\n✅ Cloudflare tunnel established");
					console.log(`🔗 Tunnel URL: ${tunnelUrl}`);
					console.log("─".repeat(50));
					console.log("\n💎 Pro Plan Active - Using Cloudflare Tunnel");
					console.log(
						"🚀 Cyrus is now ready to receive webhooks and config updates",
					);
					console.log("─".repeat(50));
				},
			});

			// Authenticate and start the tunnel
			await client.authenticate();

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
				console.log(
					`Started session for issue ${issueId} in repository ${repositoryId}`,
				);
			},
		);

		this.edgeWorker.on(
			"session:ended",
			(issueId: string, exitCode: number | null, repositoryId: string) => {
				console.log(
					`Session for issue ${issueId} ended with exit code ${exitCode} in repository ${repositoryId}`,
				);
			},
		);

		// Connection events
		this.edgeWorker.on("connected", (token: string) => {
			console.log(
				`✅ Connected to proxy with token ending in ...${token.slice(-4)}`,
			);
		});

		this.edgeWorker.on("disconnected", (token: string, reason?: string) => {
			console.error(
				`❌ Disconnected from proxy (token ...${token.slice(-4)}): ${
					reason || "Unknown reason"
				}`,
			);
		});

		// Error events
		this.edgeWorker.on("error", (error: Error) => {
			console.error("EdgeWorker error:", error);
		});
	}

	/**
	 * Stop the EdgeWorker
	 */
	async stop(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		console.log("\nShutting down edge worker...");

		// Stop edge worker (includes stopping shared application server)
		if (this.edgeWorker) {
			await this.edgeWorker.stop();
		}

		// Stop Cloudflare client if running
		if (this.cloudflareClient) {
			console.log("\n🛑 Shutting down Cloudflare tunnel...");
			this.cloudflareClient.disconnect();
		}

		console.log("Shutdown complete");
	}
}
