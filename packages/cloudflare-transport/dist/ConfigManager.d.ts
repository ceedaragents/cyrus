import type { StoredTransportConfig, PathUpdateRequest } from "./types.js";
/**
 * Manages configuration persistence in ~/.cyrus
 */
export declare class ConfigManager {
    private configPath;
    private config;
    constructor(cyrusHome: string);
    /**
     * Load configuration from disk
     */
    load(): StoredTransportConfig;
    /**
     * Save configuration to disk
     */
    save(): void;
    /**
     * Get the current configuration
     */
    get(): StoredTransportConfig;
    /**
     * Update customer ID
     */
    setCustomerId(customerId: string): void;
    /**
     * Update Cloudflare token
     */
    setCloudflareToken(token: string): void;
    /**
     * Update tunnel URL
     */
    setTunnelUrl(url: string): void;
    /**
     * Update authentication key
     */
    setAuthKey(key: string): void;
    /**
     * Update paths configuration
     */
    updatePaths(paths: PathUpdateRequest): void;
    /**
     * Update GitHub credentials
     */
    setGitHubCredentials(credentials: {
        appId: string;
        privateKey: string;
        installationId: string;
    }): void;
    /**
     * Update Linear credentials
     */
    setLinearCredentials(credentials: {
        token: string;
        workspaceId: string;
        workspaceName: string;
    }): void;
    /**
     * Update Claude API key
     */
    setClaudeApiKey(apiKey: string): void;
    /**
     * Update repositories configuration
     */
    setRepositories(repositories: any[]): void;
    /**
     * Clear all configuration
     */
    clear(): void;
    /**
     * Check if configuration is valid for starting
     */
    isValid(): boolean;
    /**
     * Get missing configuration fields
     */
    getMissingFields(): string[];
}
//# sourceMappingURL=ConfigManager.d.ts.map