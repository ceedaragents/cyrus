import { EventEmitter } from "node:events";
import { existsSync, readFileSync, watch, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EdgeWorkerConfig, RepositoryConfig } from "./types.js";

/**
 * Events emitted by ConfigurationManager
 */
export interface ConfigurationManagerEvents {
	// Emitted when configuration is successfully reloaded
	"config:reloaded": (
		config: EdgeWorkerConfig,
		changes: ConfigurationChanges,
	) => void;

	// Emitted when configuration reload fails
	"config:error": (error: Error) => void;

	// Emitted when a configuration update is requested programmatically
	"config:updated": (config: EdgeWorkerConfig) => void;
}

/**
 * Describes the types of changes detected in a configuration reload
 */
export interface ConfigurationChanges {
	repositoriesAdded: RepositoryConfig[];
	repositoriesRemoved: RepositoryConfig[];
	repositoriesModified: RepositoryConfig[];
	otherChanges: boolean; // True if non-repository fields changed (models, tools, etc.)
}

export declare interface ConfigurationManager {
	on<K extends keyof ConfigurationManagerEvents>(
		event: K,
		listener: ConfigurationManagerEvents[K],
	): this;
	emit<K extends keyof ConfigurationManagerEvents>(
		event: K,
		...args: Parameters<ConfigurationManagerEvents[K]>
	): boolean;
}

/**
 * Manages dynamic configuration loading with file watching
 */
export class ConfigurationManager extends EventEmitter {
	private configPath: string;
	private currentConfig: EdgeWorkerConfig;
	private watcher: ReturnType<typeof watch> | null = null;
	private reloadDebounceTimer: NodeJS.Timeout | null = null;
	private readonly debounceMs = 500; // Wait 500ms after last file change before reloading

	constructor(configPath: string, initialConfig: EdgeWorkerConfig) {
		super();
		this.configPath = configPath;
		this.currentConfig = initialConfig;
	}

	/**
	 * Get the current active configuration
	 */
	getConfiguration(): EdgeWorkerConfig {
		return this.currentConfig;
	}

	/**
	 * Start watching the configuration file for changes
	 */
	startWatching(): void {
		if (this.watcher) {
			console.warn(
				"[ConfigurationManager] Already watching configuration file",
			);
			return;
		}

		try {
			console.log(
				`[ConfigurationManager] Starting to watch: ${this.configPath}`,
			);

			this.watcher = watch(this.configPath, (eventType) => {
				console.log(
					`[ConfigurationManager] File change detected: ${eventType}`,
				);

				// Debounce rapid file changes
				if (this.reloadDebounceTimer) {
					clearTimeout(this.reloadDebounceTimer);
				}

				this.reloadDebounceTimer = setTimeout(() => {
					this.reloadFromDisk();
				}, this.debounceMs);
			});

			console.log("[ConfigurationManager] File watcher started successfully");
		} catch (error) {
			console.error(
				"[ConfigurationManager] Failed to start file watcher:",
				error,
			);
			this.emit("config:error", error as Error);
		}
	}

	/**
	 * Stop watching the configuration file
	 */
	stopWatching(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
			console.log("[ConfigurationManager] File watcher stopped");
		}

		if (this.reloadDebounceTimer) {
			clearTimeout(this.reloadDebounceTimer);
			this.reloadDebounceTimer = null;
		}
	}

	/**
	 * Reload configuration from disk
	 */
	private reloadFromDisk(): void {
		try {
			console.log(
				"[ConfigurationManager] Reloading configuration from disk...",
			);

			if (!existsSync(this.configPath)) {
				throw new Error(`Configuration file not found: ${this.configPath}`);
			}

			const fileContent = readFileSync(this.configPath, "utf-8");
			const newConfig = JSON.parse(fileContent) as Partial<EdgeWorkerConfig>;

			// Validate the new configuration
			this.validateConfiguration(newConfig);

			// Merge with current config to preserve required fields
			const mergedConfig: EdgeWorkerConfig = {
				...this.currentConfig,
				...newConfig,
				repositories: newConfig.repositories || this.currentConfig.repositories,
			};

			// Detect changes
			const changes = this.detectChanges(this.currentConfig, mergedConfig);

			// Update current config
			this.currentConfig = mergedConfig;

			console.log("[ConfigurationManager] Configuration reloaded successfully");
			console.log(`[ConfigurationManager] Changes detected:`, {
				added: changes.repositoriesAdded.length,
				removed: changes.repositoriesRemoved.length,
				modified: changes.repositoriesModified.length,
				otherChanges: changes.otherChanges,
			});

			this.emit("config:reloaded", mergedConfig, changes);
		} catch (error) {
			console.error(
				"[ConfigurationManager] Failed to reload configuration:",
				error,
			);
			this.emit("config:error", error as Error);
		}
	}

	/**
	 * Force reload configuration from disk
	 */
	async reloadConfiguration(): Promise<void> {
		this.reloadFromDisk();
	}

	/**
	 * Update configuration programmatically and persist to disk
	 */
	async updateConfiguration(partial: Partial<EdgeWorkerConfig>): Promise<void> {
		try {
			console.log(
				"[ConfigurationManager] Updating configuration programmatically",
			);

			// Merge with current config
			const updatedConfig: EdgeWorkerConfig = {
				...this.currentConfig,
				...partial,
			};

			// Validate the updated configuration
			this.validateConfiguration(updatedConfig);

			// Persist to disk
			await this.saveConfiguration(updatedConfig);

			// Update in-memory config
			this.currentConfig = updatedConfig;

			console.log("[ConfigurationManager] Configuration updated successfully");
			this.emit("config:updated", updatedConfig);
		} catch (error) {
			console.error(
				"[ConfigurationManager] Failed to update configuration:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Save configuration to disk
	 */
	private async saveConfiguration(config: EdgeWorkerConfig): Promise<void> {
		try {
			// Ensure directory exists
			const configDir = dirname(this.configPath);
			await mkdir(configDir, { recursive: true });

			// Temporarily stop watching to avoid triggering our own change event
			const wasWatching = this.watcher !== null;
			if (wasWatching) {
				this.stopWatching();
			}

			// Write configuration to disk
			writeFileSync(this.configPath, JSON.stringify(config, null, 2));
			console.log(
				`[ConfigurationManager] Configuration saved to: ${this.configPath}`,
			);

			// Resume watching after a short delay
			if (wasWatching) {
				setTimeout(() => this.startWatching(), 1000);
			}
		} catch (error) {
			console.error(
				"[ConfigurationManager] Failed to save configuration:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Validate configuration structure and required fields
	 */
	private validateConfiguration(config: Partial<EdgeWorkerConfig>): void {
		// Check required fields
		if (
			config.repositories !== undefined &&
			!Array.isArray(config.repositories)
		) {
			throw new Error("Invalid configuration: repositories must be an array");
		}

		// Validate each repository
		if (config.repositories) {
			for (const repo of config.repositories) {
				if (!repo.id || typeof repo.id !== "string") {
					throw new Error(
						`Invalid repository configuration: missing or invalid id`,
					);
				}
				if (!repo.name || typeof repo.name !== "string") {
					throw new Error(
						`Invalid repository configuration: missing or invalid name for ${repo.id}`,
					);
				}
				if (!repo.repositoryPath || typeof repo.repositoryPath !== "string") {
					throw new Error(
						`Invalid repository configuration: missing or invalid repositoryPath for ${repo.id}`,
					);
				}
				if (!repo.linearToken || typeof repo.linearToken !== "string") {
					throw new Error(
						`Invalid repository configuration: missing or invalid linearToken for ${repo.id}`,
					);
				}
				if (
					!repo.linearWorkspaceId ||
					typeof repo.linearWorkspaceId !== "string"
				) {
					throw new Error(
						`Invalid repository configuration: missing or invalid linearWorkspaceId for ${repo.id}`,
					);
				}
			}
		}

		console.log("[ConfigurationManager] Configuration validation passed");
	}

	/**
	 * Detect changes between old and new configurations
	 */
	private detectChanges(
		oldConfig: EdgeWorkerConfig,
		newConfig: EdgeWorkerConfig,
	): ConfigurationChanges {
		const changes: ConfigurationChanges = {
			repositoriesAdded: [],
			repositoriesRemoved: [],
			repositoriesModified: [],
			otherChanges: false,
		};

		// Build maps for easy lookup
		const oldRepos = new Map(oldConfig.repositories.map((r) => [r.id, r]));
		const newRepos = new Map(newConfig.repositories.map((r) => [r.id, r]));

		// Find added repositories
		for (const [id, repo] of newRepos) {
			if (!oldRepos.has(id)) {
				changes.repositoriesAdded.push(repo);
			}
		}

		// Find removed and modified repositories
		for (const [id, oldRepo] of oldRepos) {
			if (!newRepos.has(id)) {
				changes.repositoriesRemoved.push(oldRepo);
			} else {
				const newRepo = newRepos.get(id)!;
				// Check if repository config has changed
				if (JSON.stringify(oldRepo) !== JSON.stringify(newRepo)) {
					changes.repositoriesModified.push(newRepo);
				}
			}
		}

		// Check for other changes (models, tools, etc.)
		const oldConfigWithoutRepos = { ...oldConfig, repositories: [] };
		const newConfigWithoutRepos = { ...newConfig, repositories: [] };
		if (
			JSON.stringify(oldConfigWithoutRepos) !==
			JSON.stringify(newConfigWithoutRepos)
		) {
			changes.otherChanges = true;
		}

		return changes;
	}

	/**
	 * Add a new repository to the configuration
	 */
	async addRepository(repository: RepositoryConfig): Promise<void> {
		const currentRepos = this.currentConfig.repositories || [];

		// Check if repository with this ID already exists
		if (currentRepos.find((r) => r.id === repository.id)) {
			throw new Error(`Repository with id ${repository.id} already exists`);
		}

		await this.updateConfiguration({
			repositories: [...currentRepos, repository],
		});
	}

	/**
	 * Remove a repository from the configuration
	 */
	async removeRepository(repositoryId: string): Promise<void> {
		const currentRepos = this.currentConfig.repositories || [];
		const updatedRepos = currentRepos.filter((r) => r.id !== repositoryId);

		if (updatedRepos.length === currentRepos.length) {
			throw new Error(`Repository with id ${repositoryId} not found`);
		}

		await this.updateConfiguration({
			repositories: updatedRepos,
		});
	}

	/**
	 * Update a specific repository in the configuration
	 */
	async updateRepository(
		repositoryId: string,
		updates: Partial<RepositoryConfig>,
	): Promise<void> {
		const currentRepos = this.currentConfig.repositories || [];
		const repoIndex = currentRepos.findIndex((r) => r.id === repositoryId);

		if (repoIndex === -1) {
			throw new Error(`Repository with id ${repositoryId} not found`);
		}

		const updatedRepos = [...currentRepos];
		updatedRepos[repoIndex] = {
			...currentRepos[repoIndex]!,
			...updates,
		};

		await this.updateConfiguration({
			repositories: updatedRepos,
		});
	}
}
