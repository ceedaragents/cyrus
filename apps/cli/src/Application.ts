import {
	existsSync,
	mkdirSync,
	unlinkSync,
	watch,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { RepositoryConfig } from "cyrus-core";
import { DEFAULT_PROXY_URL } from "cyrus-core";
import { SharedApplicationServer } from "cyrus-edge-worker";
import dotenv from "dotenv";
import { DEFAULT_SERVER_PORT, parsePort } from "./config/constants.js";
import { ConfigService } from "./services/ConfigService.js";
import { GitService } from "./services/GitService.js";
import { Logger } from "./services/Logger.js";
import { WorkerService } from "./services/WorkerService.js";

/**
 * Main application context providing access to services
 */
export class Application {
	public readonly config: ConfigService;
	public readonly git: GitService;
	public readonly worker: WorkerService;
	public readonly logger: Logger;
	private envWatcher?: ReturnType<typeof watch>;
	private configWatcher?: ReturnType<typeof watch>;
	private isInSetupWaitingMode = false;

	constructor(public readonly cyrusHome: string) {
		// Initialize logger first
		this.logger = new Logger();

		// Ensure required directories exist
		this.ensureRequiredDirectories();

		// Load environment variables from CYRUS_HOME/.env
		this.loadEnvFile();

		// Watch .env file for changes and reload
		this.setupEnvFileWatcher();

		// Initialize services
		this.config = new ConfigService(cyrusHome, this.logger);
		this.git = new GitService(this.logger);
		this.worker = new WorkerService(
			this.config,
			this.git,
			cyrusHome,
			this.logger,
		);
	}

	/**
	 * Load environment variables from ~/.cyrus/.env file
	 */
	private loadEnvFile(): void {
		const cyrusEnvPath = join(this.cyrusHome, ".env");
		if (existsSync(cyrusEnvPath)) {
			dotenv.config({ path: cyrusEnvPath, override: true });
			this.logger.info(`🔧 Loaded environment variables from ${cyrusEnvPath}`);
		}
	}

	/**
	 * Setup file watcher for .env file to reload on changes
	 */
	private setupEnvFileWatcher(): void {
		const cyrusEnvPath = join(this.cyrusHome, ".env");

		// Only watch if file exists
		if (!existsSync(cyrusEnvPath)) {
			return;
		}

		try {
			this.envWatcher = watch(cyrusEnvPath, (eventType) => {
				if (eventType === "change") {
					this.logger.info("🔄 .env file changed, reloading...");
					this.loadEnvFile();
				}
			});

			this.logger.info(`👀 Watching .env file for changes: ${cyrusEnvPath}`);
		} catch (error) {
			this.logger.error(`❌ Failed to watch .env file: ${error}`);
		}
	}

	/**
	 * Ensure required Cyrus directories exist
	 * Creates: ~/.cyrus/repos, ~/.cyrus/worktrees, ~/.cyrus/mcp-configs, ~/.cyrus/state
	 */
	private ensureRequiredDirectories(): void {
		const requiredDirs = ["repos", "worktrees", "mcp-configs", "state"];

		for (const dir of requiredDirs) {
			const dirPath = join(this.cyrusHome, dir);
			if (!existsSync(dirPath)) {
				try {
					mkdirSync(dirPath, { recursive: true });
					this.logger.info(`📁 Created directory: ${dirPath}`);
				} catch (error) {
					this.logger.error(
						`❌ Failed to create directory ${dirPath}: ${error}`,
					);
					throw error;
				}
			}
		}
	}

	/**
	 * Check if this is the initial setup (awaiting first repository configuration)
	 */
	isAwaitingInitialConfig(): boolean {
		const flagPath = join(this.cyrusHome, "state", "awaiting-initial-config");
		return existsSync(flagPath);
	}

	/**
	 * Set flag indicating we're awaiting initial repository configuration
	 */
	setAwaitingInitialConfig(): void {
		const flagPath = join(this.cyrusHome, "state", "awaiting-initial-config");
		writeFileSync(flagPath, new Date().toISOString(), "utf-8");
	}

	/**
	 * Clear the awaiting initial configuration flag
	 */
	private clearAwaitingInitialConfig(): void {
		const flagPath = join(this.cyrusHome, "state", "awaiting-initial-config");
		if (existsSync(flagPath)) {
			try {
				unlinkSync(flagPath);
				this.logger.info("✅ Cleared initial setup flag");
			} catch (error) {
				this.logger.error(`❌ Failed to clear initial setup flag: ${error}`);
			}
		}
	}

	/**
	 * Get proxy URL from environment or use default
	 */
	getProxyUrl(): string {
		return process.env.PROXY_URL || DEFAULT_PROXY_URL;
	}

	/**
	 * Check if using default proxy
	 */
	isUsingDefaultProxy(): boolean {
		return this.getProxyUrl() === DEFAULT_PROXY_URL;
	}

	/**
	 * Create a temporary SharedApplicationServer for OAuth
	 */
	async createTempServer(): Promise<SharedApplicationServer> {
		const serverPort = parsePort(
			process.env.CYRUS_SERVER_PORT,
			DEFAULT_SERVER_PORT,
		);
		return new SharedApplicationServer(serverPort);
	}

	/**
	 * Enable setup waiting mode and start watching config.json for repositories
	 */
	enableSetupWaitingMode(): void {
		this.isInSetupWaitingMode = true;
		this.startConfigWatcher();
	}

	/**
	 * Setup file watcher for config.json to detect when repositories are added
	 */
	private startConfigWatcher(): void {
		const configPath = this.config.getConfigPath();

		// Create empty config file if it doesn't exist
		if (!existsSync(configPath)) {
			try {
				const configDir = dirname(configPath);
				if (!existsSync(configDir)) {
					mkdirSync(configDir, { recursive: true });
				}
				// Create empty config with empty repositories array
				this.config.save({ repositories: [] });
				this.logger.info(`📝 Created empty config file: ${configPath}`);
			} catch (error) {
				this.logger.error(`❌ Failed to create config file: ${error}`);
				return;
			}
		}

		try {
			this.configWatcher = watch(configPath, async (eventType) => {
				if (eventType === "change" && this.isInSetupWaitingMode) {
					this.logger.info(
						"🔄 Configuration file changed, checking for repositories...",
					);

					// Reload config and check if repositories were added
					const edgeConfig = this.config.load();
					const repositories = edgeConfig.repositories || [];

					if (repositories.length > 0) {
						this.logger.success("✅ Configuration received!");
						this.logger.info(
							`📦 Starting edge worker with ${repositories.length} repository(ies)...`,
						);

						// Transition to normal operation mode
						await this.transitionToNormalMode(repositories);
					}
				}
			});

			this.logger.info(
				`👀 Watching config.json for repository configuration: ${configPath}`,
			);
		} catch (error) {
			this.logger.error(`❌ Failed to watch config.json: ${error}`);
		}
	}

	/**
	 * Transition from setup waiting mode to normal operation
	 */
	private async transitionToNormalMode(
		repositories: RepositoryConfig[],
	): Promise<void> {
		try {
			this.isInSetupWaitingMode = false;

			// Clear the initial setup flag since we now have repositories
			this.clearAwaitingInitialConfig();

			// Close config watcher
			if (this.configWatcher) {
				this.configWatcher.close();
				this.configWatcher = undefined;
			}

			// Stop the setup waiting mode server before starting EdgeWorker
			await this.worker.stopSetupWaitingMode();

			// Start the EdgeWorker with the new configuration
			await this.worker.startEdgeWorker({
				repositories,
			});

			// Display server information
			const serverPort = this.worker.getServerPort();

			this.logger.raw("");
			this.logger.divider(70);
			this.logger.success("Edge worker started successfully");
			this.logger.info(`🔗 Server running on port ${serverPort}`);

			if (process.env.CLOUDFLARE_TOKEN) {
				this.logger.info("🌩️  Cloudflare tunnel: Active");
			}

			this.logger.info(`\n📦 Managing ${repositories.length} repositories:`);
			repositories.forEach((repo) => {
				this.logger.info(`   • ${repo.name} (${repo.repositoryPath})`);
			});
			this.logger.divider(70);
		} catch (error) {
			this.logger.error(`❌ Failed to transition to normal mode: ${error}`);
			process.exit(1);
		}
	}

	/**
	 * Handle graceful shutdown
	 */
	async shutdown(): Promise<void> {
		// Close .env file watcher
		if (this.envWatcher) {
			this.envWatcher.close();
		}

		// Close config file watcher
		if (this.configWatcher) {
			this.configWatcher.close();
		}

		await this.worker.stop();
		process.exit(0);
	}

	/**
	 * Setup process signal handlers
	 */
	setupSignalHandlers(): void {
		process.on("SIGINT", () => {
			this.logger.info("\nReceived SIGINT, shutting down gracefully...");
			void this.shutdown();
		});

		process.on("SIGTERM", () => {
			this.logger.info("\nReceived SIGTERM, shutting down gracefully...");
			void this.shutdown();
		});

		// Handle uncaught exceptions and unhandled promise rejections
		process.on("uncaughtException", (error) => {
			this.logger.error(`🚨 Uncaught Exception: ${error.message}`);
			this.logger.error(`Error type: ${error.constructor.name}`);
			this.logger.error(`Stack: ${error.stack}`);
			this.logger.error(
				"This error was caught by the global handler, preventing application crash",
			);

			// Attempt graceful shutdown but don't wait indefinitely
			this.shutdown().finally(() => {
				this.logger.error("Process exiting due to uncaught exception");
				process.exit(1);
			});
		});

		process.on("unhandledRejection", (reason, promise) => {
			this.logger.error(`🚨 Unhandled Promise Rejection at: ${promise}`);
			this.logger.error(`Reason: ${reason}`);
			this.logger.error(
				"This rejection was caught by the global handler, continuing operation",
			);

			// Log stack trace if reason is an Error
			if (reason instanceof Error && reason.stack) {
				this.logger.error(`Stack: ${reason.stack}`);
			}

			// Log the error but don't exit the process for promise rejections
			// as they might be recoverable
		});
	}
}
