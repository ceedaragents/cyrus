import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

/**
 * Subscription status response from cyrus-hosted
 */
export interface SubscriptionStatusResponse {
	hasActiveSubscription: boolean;
	status: string;
	requiresPayment: boolean;
	isReturningCustomer?: boolean;
	cloudflareToken?: string;
	apiKey?: string;
}

/**
 * Configuration for the Cloudflare tunnel client
 */
export interface CloudflareTunnelClientConfig {
	customerId: string; // Stripe customer ID
	cyrusHome: string; // ~/.cyrus directory path
	onWebhook?: (payload: LinearWebhookPayload) => void; // Callback for webhooks
	onConfigUpdate?: () => void; // Callback when config is updated
	onError?: (error: Error) => void; // Error callback
	onReady?: (tunnelUrl: string) => void; // Called when tunnel is ready
}

/**
 * Repository configuration payload
 */
export interface RepositoryPayload {
	repoUrl: string; // Git clone URL
	name?: string; // Optional repository name (extracted from URL if not provided)
}

/**
 * Cyrus config update payload
 */
export interface CyrusConfigPayload {
	repositories: Array<{
		id: string;
		name: string;
		repositoryPath: string;
		baseBranch: string;
		linearWorkspaceId?: string;
		linearToken?: string;
		workspaceBaseDir?: string;
		isActive?: boolean;
		allowedTools?: string[];
		mcpConfigPath?: string[];
		teamKeys?: string[];
		labelPrompts?: Record<string, string[]>;
	}>;
	disallowedTools?: string[];
	ngrokAuthToken?: string;
	stripeCustomerId?: string;
	defaultModel?: string;
	defaultFallbackModel?: string;
	global_setup_script?: string;
}

/**
 * Cyrus environment variables payload (for Claude token)
 */
export interface CyrusEnvPayload {
	ANTHROPIC_API_KEY?: string;
	[key: string]: string | undefined;
}

/**
 * MCP server configuration
 */
export interface McpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	transport?: "stdio" | "sse";
	headers?: Record<string, string>;
}

/**
 * Test MCP connection payload
 */
export interface TestMcpPayload {
	transportType: "stdio" | "sse";
	serverUrl?: string | null;
	command?: string | null;
	commandArgs?: Array<{ value: string; order: number }> | null;
	headers?: Array<{ name: string; value: string }> | null;
	envVars?: Array<{ key: string; value: string }> | null;
}

/**
 * Configure MCP servers payload
 */
export interface ConfigureMcpPayload {
	mcpServers: Record<string, McpServerConfig>;
}

/**
 * Event emitted by CloudflareTunnelClient
 */
export interface CloudflareTunnelClientEvents {
	connect: () => void;
	disconnect: (reason: string) => void;
	webhook: (payload: LinearWebhookPayload) => void;
	configUpdate: () => void;
	error: (error: Error) => void;
	ready: (tunnelUrl: string) => void;
}

/**
 * Error response to send back to cyrus-hosted
 */
export interface ErrorResponse {
	success: false;
	error: string;
	details?: string;
}

/**
 * Success response to send back to cyrus-hosted
 */
export interface SuccessResponse {
	success: true;
	message: string;
	data?: any;
}

export type ApiResponse = SuccessResponse | ErrorResponse;
