import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
/**
 * Manages configuration persistence in ~/.cyrus
 */
export class ConfigManager {
    configPath;
    config;
    constructor(cyrusHome) {
        // Ensure cyrus home directory exists
        const resolvedHome = resolve(cyrusHome);
        if (!existsSync(resolvedHome)) {
            mkdirSync(resolvedHome, { recursive: true });
        }
        this.configPath = join(resolvedHome, "transport-config.json");
        this.config = this.load();
    }
    /**
     * Load configuration from disk
     */
    load() {
        if (existsSync(this.configPath)) {
            try {
                const content = readFileSync(this.configPath, "utf-8");
                return JSON.parse(content);
            }
            catch (error) {
                console.error("Failed to load transport config:", error);
                return {};
            }
        }
        return {};
    }
    /**
     * Save configuration to disk
     */
    save() {
        try {
            this.config.lastUpdated = new Date().toISOString();
            const content = JSON.stringify(this.config, null, 2);
            writeFileSync(this.configPath, content, "utf-8");
        }
        catch (error) {
            console.error("Failed to save transport config:", error);
            throw error;
        }
    }
    /**
     * Get the current configuration
     */
    get() {
        return { ...this.config };
    }
    /**
     * Update customer ID
     */
    setCustomerId(customerId) {
        this.config.customerId = customerId;
        this.save();
    }
    /**
     * Update Cloudflare token
     */
    setCloudflareToken(token) {
        this.config.cloudflareToken = token;
        this.save();
    }
    /**
     * Update tunnel URL
     */
    setTunnelUrl(url) {
        this.config.tunnelUrl = url;
        this.save();
    }
    /**
     * Update authentication key
     */
    setAuthKey(key) {
        this.config.authKey = key;
        this.save();
    }
    /**
     * Update paths configuration
     */
    updatePaths(paths) {
        if (!this.config.paths) {
            this.config.paths = {};
        }
        if (paths.cyrusApp !== undefined) {
            // Validate and resolve the path
            const resolvedPath = resolve(paths.cyrusApp);
            if (!existsSync(resolvedPath)) {
                throw new Error(`cyrus-app path does not exist: ${resolvedPath}`);
            }
            this.config.paths.cyrusApp = resolvedPath;
        }
        if (paths.cyrusWorkspaces !== undefined) {
            // Validate and resolve the path
            const resolvedPath = resolve(paths.cyrusWorkspaces);
            if (!existsSync(resolvedPath)) {
                throw new Error(`cyrus-workspaces path does not exist: ${resolvedPath}`);
            }
            this.config.paths.cyrusWorkspaces = resolvedPath;
        }
        this.save();
    }
    /**
     * Update GitHub credentials
     */
    setGitHubCredentials(credentials) {
        this.config.githubCredentials = credentials;
        this.save();
    }
    /**
     * Update Linear credentials
     */
    setLinearCredentials(credentials) {
        this.config.linearCredentials = credentials;
        this.save();
    }
    /**
     * Update Claude API key
     */
    setClaudeApiKey(apiKey) {
        this.config.claudeApiKey = apiKey;
        this.save();
    }
    /**
     * Update repositories configuration
     */
    setRepositories(repositories) {
        this.config.repositories = repositories;
        this.save();
    }
    /**
     * Clear all configuration
     */
    clear() {
        this.config = {};
        this.save();
    }
    /**
     * Check if configuration is valid for starting
     */
    isValid() {
        return !!(this.config.customerId &&
            this.config.authKey);
    }
    /**
     * Get missing configuration fields
     */
    getMissingFields() {
        const missing = [];
        if (!this.config.customerId)
            missing.push("customerId");
        if (!this.config.authKey)
            missing.push("authKey");
        return missing;
    }
}
