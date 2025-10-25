/**
 * HTTP methods
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Request object
 */
export interface HttpRequest {
	method: HttpMethod;
	url: string;
	headers: Record<string, string>;
	body?: string | Buffer;
	query?: Record<string, string>;
	params?: Record<string, string>;
}

/**
 * Response object
 */
export interface HttpResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string | Buffer;
}

/**
 * Route handler
 */
export type RouteHandler = (
	request: HttpRequest,
) => Promise<HttpResponse> | HttpResponse;

/**
 * Webhook handler
 */
export type WebhookHandler = (
	body: string,
	signature: string,
	timestamp?: string,
) => boolean;

/**
 * OAuth callback handler
 */
export type OAuthCallbackHandler = (
	code: string,
	state: string,
) => Promise<{ token: string; workspaceId: string }>;

/**
 * Tunnel configuration
 */
export interface TunnelConfig {
	authToken?: string;
	region?: string;
	customDomain?: string;
}

/**
 * Server status
 */
export interface ServerStatus {
	isRunning: boolean;
	port: number;
	host: string;
	url: string;
	tunnelUrl?: string;
}

/**
 * Main interface for HTTP server
 *
 * This interface provides methods for starting, stopping, and configuring
 * an HTTP server, including route management and tunneling support.
 */
export interface IHTTPServer {
	/**
	 * Lifecycle management
	 */

	/**
	 * Start the server
	 */
	start(): Promise<void>;

	/**
	 * Stop the server
	 */
	stop(): Promise<void>;

	/**
	 * Check if server is running
	 * @returns True if server is running
	 */
	isRunning(): boolean;

	/**
	 * Get server status
	 * @returns Server status information
	 */
	getStatus(): ServerStatus;

	/**
	 * Configuration
	 */

	/**
	 * Set port
	 * @param port - Port number
	 */
	setPort(port: number): void;

	/**
	 * Set host
	 * @param host - Host address
	 */
	setHost(host: string): void;

	/**
	 * Get port
	 * @returns Port number
	 */
	getPort(): number;

	/**
	 * Get host
	 * @returns Host address
	 */
	getHost(): string;

	/**
	 * Route management
	 */

	/**
	 * Register route handler
	 * @param method - HTTP method
	 * @param path - Route path
	 * @param handler - Handler function
	 */
	registerRoute(method: HttpMethod, path: string, handler: RouteHandler): void;

	/**
	 * Unregister route
	 * @param method - HTTP method
	 * @param path - Route path
	 */
	unregisterRoute(method: HttpMethod, path: string): void;

	/**
	 * Tunneling
	 */

	/**
	 * Enable tunnel (ngrok, cloudflare, etc)
	 * @param config - Tunnel configuration
	 * @returns Tunnel URL
	 */
	enableTunnel(config: TunnelConfig): Promise<string>;

	/**
	 * Disable tunnel
	 */
	disableTunnel(): Promise<void>;

	/**
	 * Get tunnel URL
	 * @returns Tunnel URL or null if not enabled
	 */
	getTunnelUrl(): string | null;

	/**
	 * Helper methods
	 */

	/**
	 * Get server URL (http://host:port)
	 * @returns Server URL
	 */
	getUrl(): string;

	/**
	 * Get webhook URL
	 * @returns Webhook URL
	 */
	getWebhookUrl(): string;

	/**
	 * Get OAuth callback URL
	 * @returns OAuth callback URL
	 */
	getOAuthCallbackUrl(): string;
}

/**
 * Extended interface for webhook server
 *
 * This interface extends IHTTPServer with webhook-specific functionality
 * including signature verification and webhook handler management.
 */
export interface IWebhookServer extends IHTTPServer {
	/**
	 * Register webhook handler for specific token
	 * @param token - Webhook token identifier
	 * @param secret - Webhook secret for signature verification
	 * @param handler - Handler function
	 */
	registerWebhookHandler(
		token: string,
		secret: string,
		handler: WebhookHandler,
	): void;

	/**
	 * Unregister webhook handler
	 * @param token - Webhook token identifier
	 */
	unregisterWebhookHandler(token: string): void;

	/**
	 * Verify webhook signature
	 * @param body - Webhook body
	 * @param signature - Webhook signature
	 * @param secret - Webhook secret
	 * @returns True if signature is valid
	 */
	verifyWebhookSignature(
		body: string,
		signature: string,
		secret: string,
	): boolean;

	/**
	 * Get webhook verification status
	 * @returns Webhook status information
	 */
	getWebhookStatus(): {
		registeredTokens: number;
		lastWebhookAt?: Date;
	};
}

/**
 * Extended interface for OAuth server
 *
 * This interface extends IHTTPServer with OAuth-specific functionality
 * including OAuth flow management and callback handling.
 */
export interface IOAuthServer extends IHTTPServer {
	/**
	 * Register OAuth callback handler
	 * @param handler - OAuth callback handler function
	 */
	registerOAuthCallback(handler: OAuthCallbackHandler): void;

	/**
	 * Start OAuth flow
	 * @param proxyUrl - URL of the OAuth proxy server
	 * @returns OAuth authorization URL
	 */
	startOAuthFlow(proxyUrl: string): Promise<string>;

	/**
	 * Get OAuth authorization URL
	 * @param proxyUrl - URL of the OAuth proxy server
	 * @param callbackUrl - URL to redirect after authorization
	 * @returns OAuth authorization URL
	 */
	getOAuthUrl(proxyUrl: string, callbackUrl: string): string;

	/**
	 * Get OAuth status
	 * @returns OAuth status information
	 */
	getOAuthStatus(): {
		activeFlows: number;
		lastCallbackAt?: Date;
	};
}
