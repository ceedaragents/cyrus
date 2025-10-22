const SUBSCRIPTION_API_URL = "https://www.atcyrus.com/api/subscription-status";
/**
 * Validates customer subscription and retrieves Cloudflare token
 */
export class SubscriptionValidator {
	/**
	 * Validate customer ID and get subscription status
	 */
	static async validate(customerId) {
		try {
			const url = `${SUBSCRIPTION_API_URL}?customerId=${encodeURIComponent(customerId)}`;
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(
					`Subscription validation failed: ${response.status} ${response.statusText}`,
				);
			}
			const data = await response.json();
			// Validate response structure
			if (typeof data.hasActiveSubscription !== "boolean") {
				throw new Error("Invalid response format from subscription API");
			}
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Failed to validate customer ID: ${error.message}`);
			}
			throw error;
		}
	}
	/**
	 * Check if subscription response indicates a valid active subscription
	 */
	static isValid(response) {
		return (
			response.hasActiveSubscription &&
			!response.requiresPayment &&
			!!response.cloudflareToken &&
			!!response.apiKey
		);
	}
}
//# sourceMappingURL=SubscriptionValidator.js.map
