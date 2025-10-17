import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PathUpdateRequest, StoredTransportConfig } from "./types.js";

/**
 * Manages configuration persistence in ~/.cyrus
 */
export class ConfigManager {
	private configPath: string;
	private config: StoredTransportConfig;

	constructor(cyrusHome: string) {
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
	load(): StoredTransportConfig {
		if (existsSync(this.configPath)) {
			try {
				const content = readFileSync(this.configPath, "utf-8");
				return JSON.parse(content);
			} catch (error) {
				console.error("Failed to load transport config:", error);
				return {};
			}
		}
		return {};
	}

	/**
	 * Save configuration to disk
	 */
	save(): void {
		try {
			this.config.lastUpdated = new Date().toISOString();
			const content = JSON.stringify(this.config, null, 2);
			writeFileSync(this.configPath, content, "utf-8");
		} catch (error) {
			console.error("Failed to save transport config:", error);
			throw error;
		}
	}

	/**
	 * Get the current configuration
	 */
	get(): StoredTransportConfig {
		return { ...this.config };
	}

	/**
	 * Update customer ID
	 */
	setCustomerId(customerId: string): void {
		this.config.customerId = customerId;
		this.save();
	}

	/**
	 * Update Cloudflare token
	 */
	setCloudflareToken(token: string): void {
		this.config.cloudflareToken = token;
		this.save();
	}

	/**
	 * Update tunnel URL
	 */
	setTunnelUrl(url: string): void {
		this.config.tunnelUrl = url;
		this.save();
	}

	/**
	 * Update authentication key
	 */
	setAuthKey(key: string): void {
		this.config.authKey = key;
		this.save();
	}

	/**
	 * Update paths configuration
	 */
	updatePaths(paths: PathUpdateRequest): void {
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
				throw new Error(
					`cyrus-workspaces path does not exist: ${resolvedPath}`,
				);
			}
			this.config.paths.cyrusWorkspaces = resolvedPath;
		}

		this.save();
	}

	/**
	 * Update GitHub credentials
	 */
	setGitHubCredentials(credentials: {
		appId: string;
		privateKey: string;
		installationId: string;
	}): void {
		this.config.githubCredentials = credentials;
		this.save();
	}

	/**
	 * Update Linear credentials
	 */
	setLinearCredentials(credentials: {
		token: string;
		workspaceId: string;
		workspaceName: string;
	}): void {
		this.config.linearCredentials = credentials;
		this.save();
	}

	/**
	 * Update Claude API key
	 */
	setClaudeApiKey(apiKey: string): void {
		this.config.claudeApiKey = apiKey;
		this.save();
	}

	/**
	 * Update repositories configuration
	 */
	setRepositories(repositories: any[]): void {
		this.config.repositories = repositories;
		this.save();
	}

	/**
	 * Clear all configuration
	 */
	clear(): void {
		this.config = {};
		this.save();
	}

	/**
	 * Check if configuration is valid for starting
	 */
	isValid(): boolean {
		return !!(this.config.customerId && this.config.authKey);
	}

	/**
	 * Get missing configuration fields
	 */
	getMissingFields(): string[] {
		const missing: string[] = [];

		if (!this.config.customerId) missing.push("customerId");
		if (!this.config.authKey) missing.push("authKey");

		return missing;
	}
}
