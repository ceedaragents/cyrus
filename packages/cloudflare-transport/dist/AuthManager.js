import { createHmac, randomBytes } from "node:crypto";
/**
 * Manages authentication for incoming requests
 */
export class AuthManager {
	authKey;
	constructor(authKey) {
		this.authKey = authKey || this.generateKey();
	}
	/**
	 * Generate a new authentication key
	 */
	generateKey() {
		return randomBytes(32).toString("hex");
	}
	/**
	 * Get the current authentication key
	 */
	getKey() {
		return this.authKey;
	}
	/**
	 * Update the authentication key
	 */
	setKey(key) {
		this.authKey = key;
	}
	/**
	 * Validate request authorization header
	 */
	validateRequest(headers) {
		const authHeader = headers.authorization || headers.Authorization;
		if (!authHeader || typeof authHeader !== "string") {
			return false;
		}
		// Expect: Bearer <key>
		const parts = authHeader.split(" ");
		if (parts.length !== 2 || parts[0] !== "Bearer") {
			return false;
		}
		return parts[1] === this.authKey;
	}
	/**
	 * Validate Linear webhook signature
	 */
	validateWebhookSignature(body, signature, secret) {
		if (!signature) {
			return false;
		}
		try {
			// Linear uses HMAC-SHA256 for webhook signatures
			const expectedSignature = createHmac("sha256", secret)
				.update(body)
				.digest("hex");
			// Constant-time comparison to prevent timing attacks
			return this.timingSafeEqual(signature, expectedSignature);
		} catch (error) {
			console.error("Webhook signature validation error:", error);
			return false;
		}
	}
	/**
	 * Timing-safe string comparison
	 */
	timingSafeEqual(a, b) {
		if (a.length !== b.length) {
			return false;
		}
		let result = 0;
		for (let i = 0; i < a.length; i++) {
			result |= a.charCodeAt(i) ^ b.charCodeAt(i);
		}
		return result === 0;
	}
	/**
	 * Create authorization header for outgoing requests
	 */
	createAuthHeader() {
		return `Bearer ${this.authKey}`;
	}
}
