import type { IncomingHttpHeaders } from "node:http";
/**
 * Manages authentication for incoming requests
 */
export declare class AuthManager {
	private authKey;
	constructor(authKey?: string);
	/**
	 * Generate a new authentication key
	 */
	generateKey(): string;
	/**
	 * Get the current authentication key
	 */
	getKey(): string;
	/**
	 * Update the authentication key
	 */
	setKey(key: string): void;
	/**
	 * Validate request authorization header
	 */
	validateRequest(headers: IncomingHttpHeaders): boolean;
	/**
	 * Validate Linear webhook signature
	 */
	validateWebhookSignature(
		body: string,
		signature: string | undefined,
		secret: string,
	): boolean;
	/**
	 * Timing-safe string comparison
	 */
	private timingSafeEqual;
	/**
	 * Create authorization header for outgoing requests
	 */
	createAuthHeader(): string;
}
//# sourceMappingURL=AuthManager.d.ts.map
