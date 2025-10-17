import type { LinearWebhook, RepositoryConfig } from "cyrus-core";
/**
 * Configuration for the Cloudflare Transport Client
 */
export interface CloudflareTransportConfig {
    /** Home directory for Cyrus configuration (default: ~/.cyrus) */
    cyrusHome: string;
    /** Stripe customer ID for validation */
    customerId?: string;
    /** Shared authentication key for request validation */
    authKey?: string;
    /** Local port for HTTP server (default: 3457) */
    port?: number;
    /** URL of the cyrus-hosted service */
    hostedUrl?: string;
    /** Whether to auto-start the tunnel on initialization */
    autoStart?: boolean;
}
/**
 * Stored transport configuration in ~/.cyrus
 */
export interface StoredTransportConfig {
    /** Stripe customer ID */
    customerId?: string;
    /** Cloudflare tunnel token received from cyrus-hosted */
    cloudflareToken?: string;
    /** Active tunnel URL */
    tunnelUrl?: string;
    /** Shared authentication key */
    authKey?: string;
    /** User-defined paths */
    paths?: {
        cyrusApp?: string;
        cyrusWorkspaces?: string;
    };
    /** Repository configurations */
    repositories?: RepositoryConfig[];
    /** Linear credentials */
    linearCredentials?: {
        token: string;
        workspaceId: string;
        workspaceName: string;
    };
    /** GitHub app credentials */
    githubCredentials?: {
        appId: string;
        privateKey: string;
        installationId: string;
    };
    /** Claude API key */
    claudeApiKey?: string;
    /** Last updated timestamp */
    lastUpdated?: string;
}
/**
 * Customer validation request
 */
export interface CustomerValidationRequest {
    customerId: string;
    version?: string;
    environment?: string;
}
/**
 * Customer validation response from cyrus-hosted
 */
export interface CustomerValidationResponse {
    success: boolean;
    cloudflareToken?: string;
    authKey?: string;
    message?: string;
}
/**
 * Configuration update request
 */
export interface ConfigUpdateRequest {
    type: 'github' | 'linear' | 'claude' | 'paths' | 'repositories';
    data: any;
    timestamp?: string;
}
/**
 * Path update request
 */
export interface PathUpdateRequest {
    cyrusApp?: string;
    cyrusWorkspaces?: string;
}
/**
 * GitHub credentials update
 */
export interface GitHubCredentialsUpdate {
    appId: string;
    privateKey: string;
    installationId: string;
}
/**
 * Linear credentials update
 */
export interface LinearCredentialsUpdate {
    token: string;
    workspaceId: string;
    workspaceName: string;
}
/**
 * Events emitted by the transport client
 */
export interface CloudflareTransportEvents {
    /** Emitted when tunnel is established */
    connected: () => void;
    /** Emitted when tunnel disconnects */
    disconnected: (reason?: string) => void;
    /** Emitted when a webhook is received */
    webhook: (webhook: LinearWebhook) => void;
    /** Emitted when configuration is updated */
    'config:updated': (type: string) => void;
    /** Emitted on errors */
    error: (error: Error) => void;
    /** Emitted when tunnel URL is available */
    'tunnel:ready': (url: string) => void;
}
/**
 * HTTP request handler result
 */
export interface HandlerResult {
    status: number;
    body: any;
    headers?: Record<string, string>;
}
/**
 * Tunnel status information
 */
export interface TunnelStatus {
    active: boolean;
    url?: string;
    connectedAt?: Date;
    lastError?: string;
}
//# sourceMappingURL=types.d.ts.map