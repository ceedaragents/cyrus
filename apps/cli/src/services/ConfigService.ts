import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EdgeConfig } from "../config/types.js";

/**
 * Service responsible for configuration management
 * Handles loading, saving, and validation of edge configuration
 */
export class ConfigService {
	private configPath: string;

	constructor(cyrusHome: string) {
		this.configPath = resolve(cyrusHome, "config.json");
	}

	/**
	 * Get the configuration file path
	 */
	getConfigPath(): string {
		return this.configPath;
	}

	/**
	 * Load edge configuration from disk
	 */
	load(): EdgeConfig {
		let config: EdgeConfig = { repositories: [] };

		if (existsSync(this.configPath)) {
			try {
				const content = readFileSync(this.configPath, "utf-8");
				config = JSON.parse(content);
			} catch (e) {
				console.error("Failed to load edge config:", (e as Error).message);
			}
		}

		// Strip promptTemplatePath from all repositories to ensure built-in template is used
		if (config.repositories) {
			config.repositories = config.repositories.map((repo) => {
				const { promptTemplatePath, ...repoWithoutTemplate } = repo;
				if (promptTemplatePath) {
					console.log(
						`Ignoring custom prompt template for repository: ${repo.name} (using built-in template)`,
					);
				}
				return repoWithoutTemplate;
			});
		}

		return config;
	}

	/**
	 * Save edge configuration to disk
	 */
	save(config: EdgeConfig): void {
		const configDir = dirname(this.configPath);

		// Ensure the ~/.cyrus directory exists
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true });
		}

		writeFileSync(this.configPath, JSON.stringify(config, null, 2));
	}

	/**
	 * Update a specific field in the configuration
	 */
	update(updater: (config: EdgeConfig) => EdgeConfig): void {
		const config = this.load();
		const updated = updater(config);
		this.save(updated);
	}

	/**
	 * Check if configuration exists
	 */
	exists(): boolean {
		return existsSync(this.configPath);
	}
}
