/**
 * Credential types
 */
export type CredentialType = "oauth" | "api_key" | "token";

/**
 * Credential information
 */
export interface Credential {
	id: string;
	type: CredentialType;
	token: string;
	workspaceId: string;
	workspaceName?: string;
	expiresAt?: number;
	createdAt: number;
	validatedAt?: number;
	isValid?: boolean;
}

/**
 * OAuth credentials from provider
 */
export interface OAuthCredentials {
	token: string;
	workspaceId: string;
	workspaceName: string;
	refreshToken?: string;
	expiresIn?: number;
}

/**
 * Subscription information
 */
export interface SubscriptionInfo {
	hasActiveSubscription: boolean;
	status: "active" | "cancelled" | "expired" | "pending";
	customerId: string;
	plan?: string;
	renewalDate?: Date;
	isReturningCustomer?: boolean;
}

/**
 * Token validation result
 */
export interface TokenValidation {
	isValid: boolean;
	error?: string;
	expiresAt?: number;
	workspace?: {
		id: string;
		name: string;
	};
}

/**
 * Main interface for authentication
 *
 * This interface provides methods for OAuth flows, token management,
 * credential storage, and subscription management.
 */
export interface IAuthProvider {
	/**
	 * OAuth flow
	 */

	/**
	 * Initiate OAuth flow
	 * @param proxyUrl - URL of the OAuth proxy server
	 * @returns OAuth credentials
	 */
	startOAuthFlow(proxyUrl: string): Promise<OAuthCredentials>;

	/**
	 * Handle OAuth callback
	 * @param code - OAuth authorization code
	 * @param state - OAuth state parameter
	 * @returns OAuth credentials
	 */
	handleOAuthCallback(code: string, state: string): Promise<OAuthCredentials>;

	/**
	 * Get OAuth authorization URL
	 * @param proxyUrl - URL of the OAuth proxy server
	 * @param callbackUrl - URL to redirect after authorization
	 * @returns OAuth authorization URL
	 */
	getOAuthUrl(proxyUrl: string, callbackUrl: string): string;

	/**
	 * Token management
	 */

	/**
	 * Validate a token
	 * @param token - Token to validate
	 * @returns Validation result
	 */
	validateToken(token: string): Promise<TokenValidation>;

	/**
	 * Refresh an expired token
	 * @param token - Token to refresh
	 * @returns New token
	 */
	refreshToken(token: string): Promise<string>;

	/**
	 * Revoke a token (logout)
	 * @param token - Token to revoke
	 */
	revokeToken(token: string): Promise<void>;

	/**
	 * Check if token is expired
	 * @param credential - Credential to check
	 * @returns True if token is expired
	 */
	isTokenExpired(credential: Credential): boolean;

	/**
	 * Credential storage
	 */

	/**
	 * Store credentials
	 * @param key - Unique identifier for the credentials
	 * @param credentials - Credential data to store
	 */
	storeCredentials(key: string, credentials: Credential): Promise<void>;

	/**
	 * Retrieve credentials by key
	 * @param key - Unique identifier for the credentials
	 * @returns Credential data or null if not found
	 */
	retrieveCredentials(key: string): Promise<Credential | null>;

	/**
	 * List all stored credentials
	 * @returns Array of all credentials
	 */
	listCredentials(): Promise<Credential[]>;

	/**
	 * Delete credentials
	 * @param key - Unique identifier for the credentials
	 */
	deleteCredentials(key: string): Promise<void>;

	/**
	 * Find credentials by workspace
	 * @param workspaceId - Workspace identifier
	 * @returns Array of credentials for the workspace
	 */
	findCredentialsByWorkspace(workspaceId: string): Promise<Credential[]>;

	/**
	 * Subscription management
	 */

	/**
	 * Check subscription status
	 * @param customerId - Customer identifier
	 * @returns Subscription information
	 */
	checkSubscription(customerId: string): Promise<SubscriptionInfo>;

	/**
	 * Validate subscription (returns boolean)
	 * @param customerId - Customer identifier
	 * @returns True if subscription is active
	 */
	validateSubscription(customerId: string): Promise<boolean>;

	/**
	 * Store customer ID for subscription
	 * @param customerId - Customer identifier
	 */
	storeCustomerId(customerId: string): Promise<void>;

	/**
	 * Get stored customer ID
	 * @returns Customer ID or null if not found
	 */
	getCustomerId(): Promise<string | null>;
}
