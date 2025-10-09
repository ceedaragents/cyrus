import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
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

	// Emitted when reload fails and rollback occurs
	"config:rollback": (error: Error, restoredConfig: EdgeWorkerConfig) => void;
}

/**
 * Describes the types of changes detected in a configuration reload
 */
export interface ConfigurationChanges {
	repositoriesAdded: RepositoryConfig[];
	repositoriesRemoved: RepositoryConfig[];
	repositoriesModified: RepositoryModification[];
	otherChanges: boolean; // True if non-repository fields changed (models, tools, etc.)
}

/**
 * Describes a modification to a repository
 */
export interface RepositoryModification {
	repository: RepositoryConfig;
	oldRepository: RepositoryConfig;
	tokenChanged: boolean;
	// Add other specific change flags as needed
}

/**
 * Configuration reload status
 */
export interface ConfigurationStatus {
	lastReloadTime: Date | null;
	lastReloadSuccess: boolean;
	lastReloadError: string | null;
	reloadCount: number;
	currentVersion: number;
	watcherActive: boolean;
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
	private previousConfig: EdgeWorkerConfig | null = null; // For rollback
	private watcher: FSWatcher | null = null;
	private ignoreNextChange = false; // Flag to ignore self-triggered changes
	private readonly maxBackups = 10; // Keep last 10 backups
	private status: ConfigurationStatus = {
		lastReloadTime: null,
		lastReloadSuccess: true,
		lastReloadError: null,
		reloadCount: 0,
		currentVersion: 1,
		watcherActive: false,
	};

	constructor(configPath: string, initialConfig: EdgeWorkerConfig) {
		super();
		this.configPath = configPath;
		this.currentConfig = initialConfig;
		this.previousConfig = JSON.parse(JSON.stringify(initialConfig)); // Deep copy
	}

	/**
	 * Get the current active configuration
	 */
	getConfiguration(): EdgeWorkerConfig {
		return this.currentConfig;
	}

	/**
	 * Get configuration status for health checks
	 */
	getStatus(): ConfigurationStatus {
		return {
			...this.status,
			watcherActive: this.watcher !== null,
		};
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

			// Use chokidar for more reliable file watching
			this.watcher = chokidarWatch(this.configPath, {
				persistent: true,
				ignoreInitial: true,
				// Wait for write to complete before triggering
				awaitWriteFinish: {
					stabilityThreshold: 500, // Wait 500ms for file to stabilize
					pollInterval: 100, // Check every 100ms
				},
			});

			this.watcher.on("change", (path) => {
				console.log(`[ConfigurationManager] File change detected: ${path}`);

				// Check if we should ignore this change (self-triggered)
				if (this.ignoreNextChange) {
					console.log("[ConfigurationManager] Ignoring self-triggered change");
					this.ignoreNextChange = false;
					return;
				}

				this.reloadFromDisk();
			});

			this.watcher.on("error", (error) => {
				console.error("[ConfigurationManager] Watcher error:", error);
				this.emit("config:error", error as Error);
				// Attempt to restart watcher
				this.restartWatcher();
			});

			this.status.watcherActive = true;
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
	 * Restart the file watcher (e.g., after an error)
	 */
	private async restartWatcher(): Promise<void> {
		console.log("[ConfigurationManager] Attempting to restart watcher...");
		this.stopWatching();
		// Wait a bit before restarting
		await new Promise((resolve) => setTimeout(resolve, 1000));
		this.startWatching();
	}

	/**
	 * Stop watching the configuration file
	 */
	stopWatching(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
			this.status.watcherActive = false;
			console.log("[ConfigurationManager] File watcher stopped");
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

			// Store previous config for potential rollback
			this.previousConfig = JSON.parse(JSON.stringify(this.currentConfig));

			// Update current config BEFORE emitting to listeners
			// This allows listeners to see the new config, but we can rollback if they fail
			this.currentConfig = mergedConfig;
			this.status.currentVersion++;

			console.log("[ConfigurationManager] Configuration reloaded successfully");
			console.log(`[ConfigurationManager] Changes detected:`, {
				added: changes.repositoriesAdded.length,
				removed: changes.repositoriesRemoved.length,
				modified: changes.repositoriesModified.length,
				otherChanges: changes.otherChanges,
			});

			// Update status
			this.status.lastReloadTime = new Date();
			this.status.lastReloadSuccess = true;
			this.status.lastReloadError = null;
			this.status.reloadCount++;

			// Create backup of current config
			this.createBackup().catch((err) => {
				console.warn("[ConfigurationManager] Failed to create backup:", err);
			});

			// Emit to listeners (EdgeWorker will handle application)
			this.emit("config:reloaded", mergedConfig, changes);
		} catch (error) {
			console.error(
				"[ConfigurationManager] Failed to reload configuration:",
				error,
			);

			// Update status
			this.status.lastReloadTime = new Date();
			this.status.lastReloadSuccess = false;
			this.status.lastReloadError = (error as Error).message;

			this.emit("config:error", error as Error);
		}
	}

	/**
	 * Rollback to previous configuration (called by EdgeWorker if reload application fails)
	 */
	async rollback(error: Error): Promise<void> {
		if (!this.previousConfig) {
			console.error(
				"[ConfigurationManager] Cannot rollback: no previous configuration",
			);
			return;
		}

		console.log(
			"[ConfigurationManager] Rolling back to previous configuration...",
		);

		// Restore previous config
		this.currentConfig = JSON.parse(JSON.stringify(this.previousConfig));

		// Save to disk (with ignore flag to prevent re-triggering reload)
		this.ignoreNextChange = true;
		await this.saveConfigurationToDisk(this.currentConfig);

		console.log("[ConfigurationManager] Rollback completed");
		this.emit("config:rollback", error, this.currentConfig);
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
			this.ignoreNextChange = true; // Don't trigger reload for our own write
			await this.saveConfigurationToDisk(updatedConfig);

			// Update in-memory config
			this.currentConfig = updatedConfig;
			this.status.currentVersion++;

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
	 * Save configuration to disk (atomic write)
	 */
	private async saveConfigurationToDisk(
		config: EdgeWorkerConfig,
	): Promise<void> {
		try {
			// Ensure directory exists
			const configDir = dirname(this.configPath);
			await mkdir(configDir, { recursive: true });

			// Atomic write: write to temp file first, then move
			const tempPath = `${this.configPath}.tmp`;
			writeFileSync(tempPath, JSON.stringify(config, null, 2));

			// Atomic move (rename)
			await copyFile(tempPath, this.configPath);

			// Clean up temp file
			try {
				const fs = await import("node:fs/promises");
				await fs.unlink(tempPath);
			} catch (_err) {
				// Ignore cleanup errors
			}

			console.log(
				`[ConfigurationManager] Configuration saved to: ${this.configPath}`,
			);
		} catch (error) {
			console.error(
				"[ConfigurationManager] Failed to save configuration:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Create a backup of the current configuration
	 */
	private async createBackup(): Promise<void> {
		try {
			const backupDir = join(dirname(this.configPath), "backups");
			await mkdir(backupDir, { recursive: true });

			// Create backup with timestamp and version
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const backupPath = join(
				backupDir,
				`config-v${this.status.currentVersion}-${timestamp}.json`,
			);

			await copyFile(this.configPath, backupPath);

			// Clean up old backups (keep last N)
			await this.cleanupOldBackups(backupDir);

			console.log(`[ConfigurationManager] Created backup: ${backupPath}`);
		} catch (error) {
			// Don't throw - backups are nice-to-have
			console.warn("[ConfigurationManager] Failed to create backup:", error);
		}
	}

	/**
	 * Clean up old backup files, keeping only the most recent N
	 */
	private async cleanupOldBackups(backupDir: string): Promise<void> {
		try {
			const fs = await import("node:fs/promises");
			const files = await fs.readdir(backupDir);
			const backupFiles = files
				.filter((f) => f.startsWith("config-v") && f.endsWith(".json"))
				.map((f) => join(backupDir, f));

			if (backupFiles.length > this.maxBackups) {
				// Sort by modification time (oldest first)
				const stats = await Promise.all(
					backupFiles.map(async (f) => ({
						path: f,
						mtime: (await fs.stat(f)).mtime,
					})),
				);
				stats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

				// Delete oldest files
				const toDelete = stats.slice(0, stats.length - this.maxBackups);
				for (const file of toDelete) {
					await fs.unlink(file.path);
					console.log(
						`[ConfigurationManager] Deleted old backup: ${file.path}`,
					);
				}
			}
		} catch (error) {
			console.warn(
				"[ConfigurationManager] Failed to cleanup old backups:",
				error,
			);
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
					// Detect specific changes
					const tokenChanged = oldRepo.linearToken !== newRepo.linearToken;

					changes.repositoriesModified.push({
						repository: newRepo,
						oldRepository: oldRepo,
						tokenChanged,
					});
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
