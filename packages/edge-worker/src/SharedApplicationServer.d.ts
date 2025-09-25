import { type IncomingMessage, type ServerResponse } from "node:http";
/**
 * OAuth callback handler interface
 */
export type OAuthCallbackHandler = (
	token: string,
	workspaceId: string,
	workspaceName: string,
) => Promise<void>;
/**
 * OAuth callback state for tracking flows
 */
export interface OAuthCallback {
	resolve: (credentials: {
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}) => void;
	reject: (error: Error) => void;
	id: string;
}
/**
 * Shared application server that handles both webhooks and OAuth callbacks on a single port
 * Consolidates functionality from SharedWebhookServer and CLI OAuth server
 */
export declare class SharedApplicationServer {
	private server;
	private webhookHandlers;
	private linearWebhookHandlers;
	private oauthCallbacks;
	private oauthCallbackHandler;
	private oauthStates;
	private port;
	private host;
	private isListening;
	private ngrokListener;
	private ngrokAuthToken;
	private ngrokUrl;
	private proxyUrl;
	constructor(
		port?: number,
		host?: string,
		ngrokAuthToken?: string,
		proxyUrl?: string,
	);
	/**
	 * Start the shared application server
	 */
	start(): Promise<void>;
	/**
	 * Stop the shared application server
	 */
	stop(): Promise<void>;
	/**
	 * Get the port number the server is listening on
	 */
	getPort(): number;
	/**
	 * Get the base URL for the server (ngrok URL if available, otherwise local URL)
	 */
	getBaseUrl(): string;
	/**
	 * Start ngrok tunnel for the server
	 */
	private startNgrokTunnel;
	/**
	 * Register a webhook handler for a specific token
	 * Supports two signatures:
	 * 1. For ndjson-client: (token, secret, handler)
	 * 2. For linear-webhook-client: (token, handler) where handler takes (req, res)
	 */
	registerWebhookHandler(
		token: string,
		secretOrHandler:
			| string
			| ((req: IncomingMessage, res: ServerResponse) => Promise<void>),
		handler?: (body: string, signature: string, timestamp?: string) => boolean,
	): void;
	/**
	 * Unregister a webhook handler
	 */
	unregisterWebhookHandler(token: string): void;
	/**
	 * Register an OAuth callback handler
	 */
	registerOAuthCallbackHandler(handler: OAuthCallbackHandler): void;
	/**
	 * Start OAuth flow and return promise that resolves when callback is received
	 */
	startOAuthFlow(proxyUrl: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}>;
	/**
	 * Get the public URL (ngrok URL if available, otherwise base URL)
	 */
	getPublicUrl(): string;
	/**
	 * Get the webhook URL for registration with proxy
	 */
	getWebhookUrl(): string;
	/**
	 * Get the OAuth callback URL for registration with proxy
	 */
	getOAuthCallbackUrl(): string;
	/**
	 * Handle incoming requests (both webhooks and OAuth callbacks)
	 */
	private handleRequest;
	/**
	 * Handle incoming webhook requests
	 */
	private handleWebhookRequest;
	/**
	 * Handle OAuth callback requests
	 */
	private handleOAuthCallback;
	/**
	 * Handle OAuth authorization requests for direct Linear OAuth
	 */
	private handleOAuthAuthorize;
	/**
	 * Handle direct Linear OAuth callback (exchange code for token)
	 */
	private handleDirectLinearCallback;
	/**
	 * Exchange authorization code for access token
	 */
	private exchangeCodeForToken;
	/**
	 * Get workspace information using access token
	 */
	private getWorkspaceInfo;
}
//# sourceMappingURL=SharedApplicationServer.d.ts.map
