import { BaseCommand } from "./ICommand.js";

/**
 * Set customer ID command - set Stripe customer ID for Pro plan
 */
export class SetCustomerIdCommand extends BaseCommand {
	async execute(args: string[]): Promise<void> {
		// Get customer ID from command line args
		const customerId = args[0];

		if (!customerId) {
			this.logError("Please provide a customer ID");
			console.log("Usage: cyrus set-customer-id cus_XXXXX");
			process.exit(1);
		}

		this.app.subscription.validateCustomerId(customerId);

		try {
			// Check if using default proxy
			const isUsingDefaultProxy = this.app.isUsingDefaultProxy();

			// Validate subscription for default proxy users
			if (isUsingDefaultProxy) {
				await this.app.subscription.validateAndHandleSubscription(customerId);
			}

			// Update customer ID in config
			this.app.config.update((config) => {
				config.stripeCustomerId = customerId;
				return config;
			});

			this.logSuccess("Customer ID saved successfully!");
			this.logDivider();
			console.log(`Customer ID: ${customerId}`);
			if (isUsingDefaultProxy) {
				console.log("\nYou now have access to Cyrus Pro features.");
			}
			console.log('Run "cyrus" to start the edge worker.');
		} catch (error) {
			this.logError(`Failed to save customer ID: ${(error as Error).message}`);
			process.exit(1);
		}
	}
}
