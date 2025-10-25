import { existsSync } from "node:fs";
import { DEFAULT_PROXY_URL } from "cyrus-core";
import { SharedApplicationServer } from "cyrus-edge-worker";
import dotenv from "dotenv";
import { ConfigService } from "./services/ConfigService.js";
import { GitService } from "./services/GitService.js";
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

	constructor(public readonly cyrusHome: string) {
		// Load environment variables from CYRUS_HOME/.env
		const cyrusEnvPath = `${cyrusHome}/.env`;
		if (existsSync(cyrusEnvPath)) {
			dotenv.config({ path: cyrusEnvPath });
		}

		// Initialize services
		this.config = new ConfigService(cyrusHome);
		this.git = new GitService();
		this.subscription = new SubscriptionService();

		// OAuth and Worker services need runtime configuration
		const serverPort = process.env.CYRUS_SERVER_PORT
			? parseInt(process.env.CYRUS_SERVER_PORT, 10)
			: 3456;
		const baseUrl = process.env.CYRUS_BASE_URL;

		this.oauth = new OAuthService(serverPort, baseUrl);
		this.worker = new WorkerService(this.config, this.git, cyrusHome);
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
		const serverPort = process.env.CYRUS_SERVER_PORT
			? parseInt(process.env.CYRUS_SERVER_PORT, 10)
			: 3456;
		return new SharedApplicationServer(serverPort);
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
		process.on("SIGINT", () => this.shutdown());
		process.on("SIGTERM", () => this.shutdown());

		// Handle uncaught exceptions and unhandled promise rejections
		process.on("uncaughtException", (error) => {
			console.error("🚨 Uncaught Exception:", error.message);
			console.error("Error type:", error.constructor.name);
			console.error("Stack:", error.stack);
			console.error(
				"This error was caught by the global handler, preventing application crash",
			);

			// Attempt graceful shutdown but don't wait indefinitely
			this.shutdown().finally(() => {
				console.error("Process exiting due to uncaught exception");
				process.exit(1);
			});
		});

		process.on("unhandledRejection", (reason, promise) => {
			console.error("🚨 Unhandled Promise Rejection at:", promise);
			console.error("Reason:", reason);
			console.error(
				"This rejection was caught by the global handler, continuing operation",
			);

			// Log stack trace if reason is an Error
			if (reason instanceof Error && reason.stack) {
				console.error("Stack:", reason.stack);
			}

			// Log the error but don't exit the process for promise rejections
			// as they might be recoverable
		});
	}
}
