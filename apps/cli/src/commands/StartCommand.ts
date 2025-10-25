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
					console.error("\n⚠️ Warning: Could not validate subscription");
					this.logDivider();
					console.error(
						"Unable to connect to subscription service:",
						(error as Error).message,
					);
					process.exit(1);
				}
			}

			// Check if using Cloudflare tunnel mode (Pro plan)
			const isLegacy = edgeConfig.isLegacy !== false; // Default to true if not set

			if (!isLegacy) {
				// Pro plan with Cloudflare tunnel
				console.log("\n💎 Pro Plan Detected");
				this.logDivider();
				console.log("Using Cloudflare tunnel for secure connectivity");

				// Start Cloudflare tunnel client (will validate credentials and start)
				await this.app.worker.startCloudflareClient({});
				return; // Exit early - Cloudflare client handles everything
			}

			// Legacy mode - validate we have repositories
			if (repositories.length === 0) {
				this.logError("No repositories configured");
				console.log(
					"\nRepositories must be configured in ~/.cyrus/config.json",
				);
				console.log(
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
			console.log(`\n${"─".repeat(70)}`);
			if (isUsingDefaultProxy && edgeConfig.stripeCustomerId) {
				console.log("💎 Plan: Cyrus Pro");
				console.log(`📋 Customer ID: ${edgeConfig.stripeCustomerId}`);
				console.log('💳 Manage subscription: Run "cyrus billing"');
			} else if (!isUsingDefaultProxy) {
				console.log("🛠️  Plan: Community (Self-hosted proxy)");
				console.log(`🔗 Proxy URL: ${proxyUrl}`);
			}
			console.log("─".repeat(70));

			// Display OAuth information after EdgeWorker is started
			const serverPort = this.app.worker.getServerPort();
			const oauthCallbackBaseUrl =
				process.env.CYRUS_BASE_URL || `http://localhost:${serverPort}`;
			console.log(`\n🔐 OAuth server running on port ${serverPort}`);
			console.log(`👉 To authorize Linear (new workspace or re-auth):`);
			console.log(
				`   ${proxyUrl}/oauth/authorize?callback=${oauthCallbackBaseUrl}/callback`,
			);
			console.log("─".repeat(70));

			// Setup signal handlers
			this.app.setupSignalHandlers();
		} catch (error: any) {
			console.error("\n❌ Failed to start edge application:", error.message);

			// Provide more specific guidance for common errors
			if (error.message?.includes("Failed to connect any repositories")) {
				console.error("\n💡 This usually happens when:");
				console.error("   - All Linear OAuth tokens have expired");
				console.error("   - The Linear API is temporarily unavailable");
				console.error("   - Your network connection is having issues");
				console.error("\nPlease check your edge configuration and try again.");
			}

			await this.app.shutdown();
			process.exit(1);
		}
	}

	/**
	 * Handle Pro plan prompt for users without customer ID
	 */
	private async handleProPlanPrompt(): Promise<void> {
		console.log("\n🎯 Pro Plan Required");
		this.logDivider();
		console.log("You are using the default Cyrus proxy URL.");
		console.log("\nWith Cyrus Pro you get:");
		console.log("• No-hassle configuration");
		console.log("• Priority support");
		console.log("• Help fund product development");
		console.log("\nChoose an option:");
		console.log("1. Start a free trial");
		console.log("2. I have a customer ID to enter");
		console.log("3. Setup your own proxy (advanced)");
		console.log("4. Exit");

		const choice = await CLIPrompts.ask("\nYour choice (1-4): ");

		if (choice === "1") {
			console.log("\n👉 Opening your browser to start a free trial...");
			console.log("Visit: https://www.atcyrus.com/pricing");
			await open("https://www.atcyrus.com/pricing");
			process.exit(0);
		} else if (choice === "2") {
			console.log(
				"\n📋 After completing payment, you'll see your customer ID on the success page.",
			);
			console.log('It starts with "cus_" and can be copied from the website.');

			const customerId = await CLIPrompts.ask(
				"\nPaste your customer ID here: ",
			);

			this.app.subscription.validateCustomerId(customerId);
			this.app.config.update((config) => {
				config.stripeCustomerId = customerId;
				return config;
			});

			this.logSuccess("Customer ID saved successfully!");
			console.log("Continuing with startup...\n");
		} else if (choice === "3") {
			console.log("\n🔧 Self-Hosted Proxy Setup");
			this.logDivider();
			console.log(
				"Configure your own Linear app and proxy to have full control over your stack.",
			);
			console.log("\nDocumentation:");
			console.log("• Linear OAuth setup: https://linear.app/developers/agents");
			console.log(
				"• Proxy implementation: https://github.com/ceedaragents/cyrus/tree/main/apps/proxy-worker",
			);
			console.log("\nOnce deployed, set the PROXY_URL environment variable:");
			console.log("export PROXY_URL=https://your-proxy-url.com");
			process.exit(0);
		} else {
			console.log("\nExiting...");
			process.exit(0);
		}
	}
}
