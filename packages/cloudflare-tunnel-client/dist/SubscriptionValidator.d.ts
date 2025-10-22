import type { SubscriptionStatusResponse } from "./types.js";
/**
 * Validates customer subscription and retrieves Cloudflare token
 */
export declare class SubscriptionValidator {
	/**
	 * Validate customer ID and get subscription status
	 */
	static validate(customerId: string): Promise<SubscriptionStatusResponse>;
	/**
	 * Check if subscription response indicates a valid active subscription
	 */
	static isValid(response: SubscriptionStatusResponse): boolean;
}
//# sourceMappingURL=SubscriptionValidator.d.ts.map
