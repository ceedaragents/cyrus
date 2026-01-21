import { BaseCommand } from "./ICommand.js";

/**
 * Start command - main entry point for starting the edge worker
 */
export class StartCommand extends BaseCommand {
	async execute(_args: string[]): Promise<void> {
		try {
			// Load edge configuration
			const edgeConfig = this.app.config.load();
			const repositories = edgeConfig.repositories || [];

			// Check if we're in setup waiting mode (no repositories + CYRUS_SETUP_PENDING flag)
			if (
				repositories.length === 0 &&
				process.env.CYRUS_SETUP_PENDING === "true"
			) {
				// Enable setup waiting mode and start config watcher
				this.app.enableSetupWaitingMode();

				// Start setup waiting mode - server only, no EdgeWorker
				await this.app.worker.startSetupWaitingMode();

				// Setup signal handlers for graceful shutdown
				this.app.setupSignalHandlers();

				// Keep process alive and wait for configuration
				return;
			}

			// Check if we're in idle mode (no repositories, post-onboarding)
			if (repositories.length === 0) {
				// Enable idle mode and start config watcher
				this.app.enableIdleMode();

				// Start idle mode - server infrastructure only, no EdgeWorker
				await this.app.worker.startIdleMode();

				// Setup signal handlers for graceful shutdown
				this.app.setupSignalHandlers();

				// Keep process alive and wait for configuration
				return;
			}

			// Start the edge worker (SharedApplicationServer will start Cloudflare tunnel if CLOUDFLARE_TOKEN is set)
			await this.app.worker.startEdgeWorker({
				repositories,
			});

			// Display server information
			const serverPort = this.app.worker.getServerPort();

			this.logger.raw("");
			this.logger.divider(70);
			this.logger.success("Edge worker started successfully");
			this.logger.info(`📌 Version: ${this.app.version}`);
			this.logger.info(`🔗 Server running on port ${serverPort}`);

			if (process.env.CLOUDFLARE_TOKEN) {
				this.logger.info("🌩️  Cloudflare tunnel: Active");
			}

			this.logger.info(`\n📦 Managing ${repositories.length} repositories:`);
			repositories.forEach((repo) => {
				this.logger.info(`   • ${repo.name} (${repo.repositoryPath})`);
			});
			this.logger.divider(70);

			// Setup signal handlers for graceful shutdown
			this.app.setupSignalHandlers();
		} catch (error: any) {
			this.logger.error(`Failed to start edge application: ${error.message}`);

			await this.app.shutdown();
			process.exit(1);
		}
	}
}
