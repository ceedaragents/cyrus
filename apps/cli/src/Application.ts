import { existsSync } from "node:fs";
import { DEFAULT_PROXY_URL } from "cyrus-core";
import { SharedApplicationServer } from "cyrus-edge-worker";
import dotenv from "dotenv";
import { DEFAULT_SERVER_PORT, parsePort } from "./config/constants.js";
import { ConfigService } from "./services/ConfigService.js";
import { GitService } from "./services/GitService.js";
import { Logger } from "./services/Logger.js";
import { OAuthService } from "./services/OAuthService.js";
import { SubscriptionService } from "./services/SubscriptionService.js";
import { WorkerService } from "./services/WorkerService.js";

/**
 * Main application context providing access to services
 */
export class Application {
	public readonly config: ConfigService;
	public readonly oauth: OAuthService;
	public readonly git: GitService;
	public readonly subscription: SubscriptionService;
	public readonly worker: WorkerService;
	public readonly logger: Logger;

	constructor(public readonly cyrusHome: string) {
		// Initialize logger first
		this.logger = new Logger();
		// Load environment variables from CYRUS_HOME/.env
		const cyrusEnvPath = `${cyrusHome}/.env`;
		if (existsSync(cyrusEnvPath)) {
			dotenv.config({ path: cyrusEnvPath });
		}

		// Initialize services
		this.config = new ConfigService(cyrusHome, this.logger);
		this.git = new GitService(this.logger);
		this.subscription = new SubscriptionService(this.logger);

		// OAuth and Worker services need runtime configuration
		const serverPort = parsePort(
			process.env.CYRUS_SERVER_PORT,
			DEFAULT_SERVER_PORT,
		);
		const baseUrl = process.env.CYRUS_BASE_URL;

		this.oauth = new OAuthService(serverPort, baseUrl, this.logger);
		this.worker = new WorkerService(
			this.config,
			this.git,
			cyrusHome,
			this.logger,
		);
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
		return new SharedApplicationServer({ port: serverPort });
	}

	/**
	 * Handle graceful shutdown
	 */
	async shutdown(): Promise<void> {
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
