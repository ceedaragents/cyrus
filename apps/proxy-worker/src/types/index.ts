import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

export interface Env {
	// KV Namespaces
	OAUTH_TOKENS: KVNamespace;
	OAUTH_STATE: KVNamespace;
	EDGE_TOKENS: KVNamespace;
	WORKSPACE_METADATA: KVNamespace;

	// Durable Objects
	EVENT_STREAM: DurableObjectNamespace;

	// Secrets (use wrangler secret put)
	LINEAR_CLIENT_ID: string;
	LINEAR_CLIENT_SECRET: string;
	LINEAR_WEBHOOK_SECRET: string;
	ENCRYPTION_KEY: string;

	// Environment variables
	OAUTH_REDIRECT_URI: string;
	SIMULATE_DISCONNECT?: string;
	DISCONNECT_AFTER_MS?: string;
}

export interface OAuthToken {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	obtainedAt: number;
	scope: string[];
	tokenType: string;
	userId: string;
	userEmail?: string;
	workspaceName?: string;
}

export interface EncryptedOAuthToken
	extends Omit<OAuthToken, "accessToken" | "refreshToken"> {
	accessToken: string; // encrypted
	refreshToken?: string; // encrypted
	iv: string;
}

export interface OAuthState {
	createdAt: number;
	redirectUri: string;
	metadata?: any;
}

export interface EdgeToken {
	workspaceIds: string[];
	createdAt: number;
	lastUsed: number;
	name?: string;
	permissions: string[];
}

export interface WorkspaceMetadata {
	id: string;
	name: string;
	urlKey: string;
	organizationId: string;
	teams: Array<{
		id: string;
		name: string;
		key: string;
	}>;
}

// Use Linear SDK webhook types directly
export type { LinearWebhookPayload } from "@linear/sdk/webhooks";

export interface EdgeEvent {
	id: string;
	type: "webhook" | "connection" | "heartbeat" | "error";
	timestamp: string;
	data?:
		| LinearWebhookPayload
		| {
				message: string;
				edge_id?: string;
				code?: string;
		  };
	status?: string;
	reason?: string;
	error?: string;
}
