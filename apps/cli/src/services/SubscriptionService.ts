/**
 * Service responsible for subscription and billing operations
 */
export class SubscriptionService {
	/**
	 * Check subscription status with the Cyrus API
	 */
	async checkSubscriptionStatus(customerId: string): Promise<{
		hasActiveSubscription: boolean;
		status: string;
		requiresPayment: boolean;
		isReturningCustomer?: boolean;
	}> {
		const response = await fetch(
			`https://www.atcyrus.com/api/subscription-status?customerId=${encodeURIComponent(customerId)}`,
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.ok) {
			if (response.status === 400) {
				const data = (await response.json()) as { error?: string };
				throw new Error(data.error || "Invalid customer ID format");
			}
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = (await response.json()) as {
			hasActiveSubscription: boolean;
			status: string;
			requiresPayment: boolean;
			isReturningCustomer?: boolean;
		};
		return data;
	}

	/**
	 * Validate customer ID format
	 */
	validateCustomerId(customerId: string): void {
		if (!customerId.startsWith("cus_")) {
			throw new Error('Customer IDs should start with "cus_"');
		}
	}

	/**
	 * Handle subscription validation failure
	 */
	handleSubscriptionFailure(subscriptionStatus: {
		hasActiveSubscription: boolean;
		status: string;
		requiresPayment: boolean;
		isReturningCustomer?: boolean;
	}): never {
		console.error("\n❌ Subscription Invalid");
		console.log("─".repeat(50));

		if (subscriptionStatus.isReturningCustomer) {
			console.log("Your subscription has expired or been cancelled.");
			console.log(`Status: ${subscriptionStatus.status}`);
			console.log(
				"\nPlease visit https://www.atcyrus.com/pricing to reactivate your subscription.",
			);
		} else {
			console.log("No active subscription found for this customer ID.");
			console.log(
				"\nPlease visit https://www.atcyrus.com/pricing to start a subscription.",
			);
			console.log("Once you obtain a valid customer ID,");
			console.log("Run: cyrus set-customer-id cus_XXXXX");
		}

		process.exit(1);
	}

	/**
	 * Validate subscription and handle failures
	 */
	async validateAndHandleSubscription(customerId: string): Promise<void> {
		console.log("\n🔐 Validating subscription...");
		try {
			const subscriptionStatus = await this.checkSubscriptionStatus(customerId);

			if (subscriptionStatus.requiresPayment) {
				this.handleSubscriptionFailure(subscriptionStatus);
			}

			console.log(`✅ Subscription active (${subscriptionStatus.status})`);
		} catch (error) {
			console.error("\n❌ Failed to validate subscription");
			console.log(`Error: ${(error as Error).message}`);
			console.log(
				'Run "cyrus set-customer-id cus_XXXXX" with a valid customer ID',
			);
			process.exit(1);
		}
	}
}
