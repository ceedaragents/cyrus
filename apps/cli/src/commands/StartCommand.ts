import open from "open";
import { CLIPrompts } from "../ui/CLIPrompts.js";
import { BaseCommand } from "./ICommand.js";

/**
 * Start command - main entry point for starting the edge worker
 */
export class StartCommand extends BaseCommand {
	async execute(_args: string[]): Promise<void> {
		try {
			const proxyUrl = this.app.getProxyUrl();

			// Load edge configuration
			let edgeConfig = this.app.config.load();
			const repositories = edgeConfig.repositories || [];

			// Check if using default proxy URL without a customer ID
			const isUsingDefaultProxy = this.app.isUsingDefaultProxy();
			const hasCustomerId = !!edgeConfig.stripeCustomerId;

			if (isUsingDefaultProxy && !hasCustomerId) {
				await this.handleProPlanPrompt();
				// Reload config after potential customer ID addition
				edgeConfig = this.app.config.load();
			}

			// If using default proxy and has customer ID, validate subscription
			if (isUsingDefaultProxy && edgeConfig.stripeCustomerId) {
				try {
					await this.app.subscription.validateAndHandleSubscription(
						edgeConfig.stripeCustomerId,
					);
				} catch (error) {
					this.logger.warn("Warning: Could not validate subscription");
					this.logDivider();
					this.logger.error(
						`Unable to connect to subscription service: ${(error as Error).message}`,
					);
					process.exit(1);
				}
			}

			// Check if using Cloudflare tunnel mode (Pro plan)
			const isLegacy = edgeConfig.isLegacy !== false; // Default to true if not set

			if (!isLegacy) {
				// Pro plan with Cloudflare tunnel
				this.logger.info("\n💎 Pro Plan Detected");
				this.logDivider();
				this.logger.info("Using Cloudflare tunnel for secure connectivity");

				// Start Cloudflare tunnel client (will validate credentials and start)
				try {
					await this.app.worker.startCloudflareClient({});
					return; // Exit early - Cloudflare client handles everything
				} catch (error) {
					this.logError((error as Error).message);
					process.exit(1);
				}
			}

			// Legacy mode - validate we have repositories
			if (repositories.length === 0) {
				this.logError("No repositories configured");
				this.logger.info(
					"\nRepositories must be configured in ~/.cyrus/config.json",
				);
				this.logger.info(
					"See https://github.com/ceedaragents/cyrus#configuration for details",
				);
				process.exit(1);
			}

			// Start the edge worker (legacy mode)
			await this.app.worker.startEdgeWorker({
				proxyUrl,
				repositories,
			});

			// Display plan status
			this.logger.raw("");
			this.logger.divider(70);
			if (isUsingDefaultProxy && edgeConfig.stripeCustomerId) {
				this.logger.info("💎 Plan: Cyrus Pro");
				this.logger.info(`📋 Customer ID: ${edgeConfig.stripeCustomerId}`);
				this.logger.info('💳 Manage subscription: Run "cyrus billing"');
			} else if (!isUsingDefaultProxy) {
				this.logger.info("🛠️  Plan: Community (Self-hosted proxy)");
				this.logger.info(`🔗 Proxy URL: ${proxyUrl}`);
			}
			this.logger.divider(70);

			// Display OAuth information after EdgeWorker is started
			const serverPort = this.app.worker.getServerPort();
			const oauthCallbackBaseUrl =
				process.env.CYRUS_BASE_URL || `http://localhost:${serverPort}`;
			this.logger.info(`\n🔐 OAuth server running on port ${serverPort}`);
			this.logger.info(`👉 To authorize Linear (new workspace or re-auth):`);
			this.logger.info(
				`   ${proxyUrl}/oauth/authorize?callback=${oauthCallbackBaseUrl}/callback`,
			);
			this.logger.divider(70);

			// Setup signal handlers
			this.app.setupSignalHandlers();
		} catch (error: any) {
			this.logger.error(`Failed to start edge application: ${error.message}`);

			// Provide more specific guidance for common errors
			if (error.message?.includes("Failed to connect any repositories")) {
				this.logger.info("\n💡 This usually happens when:");
				this.logger.info("   - All Linear OAuth tokens have expired");
				this.logger.info("   - The Linear API is temporarily unavailable");
				this.logger.info("   - Your network connection is having issues");
				this.logger.info(
					"\nPlease check your edge configuration and try again.",
				);
			}

			await this.app.shutdown();
			process.exit(1);
		}
	}

	/**
	 * Handle Pro plan prompt for users without customer ID
	 */
	private async handleProPlanPrompt(): Promise<void> {
		this.logger.info("\n🎯 Pro Plan Required");
		this.logDivider();
		this.logger.info("You are using the default Cyrus proxy URL.");
		this.logger.info("\nWith Cyrus Pro you get:");
		this.logger.info("• No-hassle configuration");
		this.logger.info("• Priority support");
		this.logger.info("• Help fund product development");
		this.logger.info("\nChoose an option:");
		this.logger.info("1. Start a free trial");
		this.logger.info("2. I have a customer ID to enter");
		this.logger.info("3. Setup your own proxy (advanced)");
		this.logger.info("4. Exit");

		const choice = await CLIPrompts.ask("\nYour choice (1-4): ");

		if (choice === "1") {
			this.logger.info("\n👉 Opening your browser to start a free trial...");
			this.logger.info("Visit: https://www.atcyrus.com/pricing");
			await open("https://www.atcyrus.com/pricing");
			process.exit(0);
		} else if (choice === "2") {
			this.logger.info(
				"\n📋 After completing payment, you'll see your customer ID on the success page.",
			);
			this.logger.info(
				'It starts with "cus_" and can be copied from the website.',
			);

			const customerId = await CLIPrompts.ask(
				"\nPaste your customer ID here: ",
			);

			this.app.subscription.validateCustomerId(customerId);
			this.app.config.update((config) => {
				config.stripeCustomerId = customerId;
				return config;
			});

			this.logSuccess("Customer ID saved successfully!");
			this.logger.info("Continuing with startup...\n");
		} else if (choice === "3") {
			this.logger.info("\n🔧 Self-Hosted Proxy Setup");
			this.logDivider();
			this.logger.info(
				"Configure your own Linear app and proxy to have full control over your stack.",
			);
			this.logger.info("\nDocumentation:");
			this.logger.info(
				"• Linear OAuth setup: https://linear.app/developers/agents",
			);
			this.logger.info(
				"• Proxy implementation: https://github.com/ceedaragents/cyrus/tree/main/apps/proxy-worker",
			);
			this.logger.info(
				"\nOnce deployed, set the PROXY_URL environment variable:",
			);
			this.logger.info("export PROXY_URL=https://your-proxy-url.com");
			process.exit(0);
		} else {
			this.logger.info("\nExiting...");
			process.exit(0);
		}
	}
}
