import open from "open";
import { BaseCommand } from "./ICommand.js";

/**
 * Billing command - open the Stripe billing portal
 */
export class BillingCommand extends BaseCommand {
	async execute(_args: string[]): Promise<void> {
		if (!this.app.config.exists()) {
			this.logError(
				'No configuration found. Please run "cyrus" to set up first.',
			);
			process.exit(1);
		}

		const config = this.app.config.load();

		if (!config.stripeCustomerId) {
			console.log("\n🎯 No Pro Plan Active");
			this.logDivider();
			console.log("You don't have an active subscription.");
			console.log("Please start a free trial at:");
			console.log("\n  https://www.atcyrus.com/pricing\n");
			console.log(
				"After signing up, your customer ID will be saved automatically.",
			);
			process.exit(0);
		}

		console.log("\n🌐 Opening Billing Portal...");
		this.logDivider();

		try {
			// Open atcyrus.com with the customer ID to handle Stripe redirect
			const billingUrl = `https://www.atcyrus.com/billing/${config.stripeCustomerId}`;

			this.logSuccess("Opening billing portal in browser...");
			console.log(`\n👉 URL: ${billingUrl}\n`);

			// Open the billing portal URL in the default browser
			await open(billingUrl);

			console.log("The billing portal should now be open in your browser.");
			console.log(
				"You can manage your subscription, update payment methods, and download invoices.",
			);
		} catch (error) {
			this.logError(
				`Failed to open billing portal: ${(error as Error).message}`,
			);
			console.log("\nPlease visit: https://www.atcyrus.com/billing");
			console.log("Customer ID:", config.stripeCustomerId);
			process.exit(1);
		}
	}
}
