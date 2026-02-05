import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import AdmZip from "adm-zip";
import type { SdkPluginConfig } from "cyrus-claude-runner";
import { createLogger, type ILogger, type RepositoryConfig } from "cyrus-core";

/**
 * Plugin manifest structure (plugin.json)
 */
export interface PluginManifest {
	name: string;
	version?: string;
	description?: string;
	author?: string;
}

/**
 * Result of plugin installation
 */
export interface PluginInstallResult {
	success: boolean;
	pluginName?: string;
	pluginPath?: string;
	error?: string;
}

/**
 * Result of plugin validation
 */
export interface PluginValidationResult {
	isValid: boolean;
	error?: string;
	manifest?: PluginManifest;
}

/**
 * Input for plugin installation endpoint
 */
export interface PluginInstallInput {
	/** Name of the plugin (used as directory name if not in manifest) */
	name?: string;
	/** Base64-encoded zip file content */
	zipContent?: string;
	/** URL to download the plugin from */
	sourceUrl?: string;
}

/**
 * Service responsible for plugin management including installation,
 * validation, and resolution based on issue labels.
 */
export class PluginService {
	private logger: ILogger;
	private pluginsDir: string;

	constructor(cyrusHome: string, logger?: ILogger) {
		this.logger = logger ?? createLogger({ component: "PluginService" });
		this.pluginsDir = join(cyrusHome, "plugins");
	}

	/**
	 * Get the plugins directory path
	 */
	getPluginsDirectory(): string {
		return this.pluginsDir;
	}

	/**
	 * Ensure the plugins directory exists
	 */
	async ensurePluginsDirectory(): Promise<void> {
		if (!existsSync(this.pluginsDir)) {
			await mkdir(this.pluginsDir, { recursive: true });
			this.logger.info(`📁 Created plugins directory: ${this.pluginsDir}`);
		}
	}

	/**
	 * Validate a plugin directory structure.
	 * A valid plugin must have .claude-plugin/plugin.json
	 */
	async validatePlugin(pluginPath: string): Promise<PluginValidationResult> {
		const resolvedPath = this.resolvePath(pluginPath);

		// Check if directory exists
		if (!existsSync(resolvedPath)) {
			return {
				isValid: false,
				error: `Plugin directory does not exist: ${resolvedPath}`,
			};
		}

		// Check if it's a directory
		const stat = statSync(resolvedPath);
		if (!stat.isDirectory()) {
			return {
				isValid: false,
				error: `Plugin path is not a directory: ${resolvedPath}`,
			};
		}

		// Check for .claude-plugin/plugin.json
		const manifestPath = join(resolvedPath, ".claude-plugin", "plugin.json");
		if (!existsSync(manifestPath)) {
			return {
				isValid: false,
				error: `Plugin manifest not found: ${manifestPath}. Plugins must have .claude-plugin/plugin.json`,
			};
		}

		// Parse and validate manifest
		try {
			const manifestContent = await readFile(manifestPath, "utf-8");
			const manifest = JSON.parse(manifestContent) as PluginManifest;

			if (!manifest.name) {
				return {
					isValid: false,
					error: "Plugin manifest missing required 'name' field",
				};
			}

			return {
				isValid: true,
				manifest,
			};
		} catch (error) {
			return {
				isValid: false,
				error: `Failed to parse plugin manifest: ${(error as Error).message}`,
			};
		}
	}

	/**
	 * Install a plugin from base64-encoded zip content
	 */
	async installFromZip(
		zipContent: string,
		providedName?: string,
	): Promise<PluginInstallResult> {
		await this.ensurePluginsDirectory();

		try {
			// Decode base64 content
			const zipBuffer = Buffer.from(zipContent, "base64");

			// Create a temporary extraction directory
			const tempDir = join(this.pluginsDir, `.temp-${Date.now()}`);
			await mkdir(tempDir, { recursive: true });

			try {
				// Extract zip
				const zip = new AdmZip(zipBuffer);
				zip.extractAllTo(tempDir, true);

				// Find the plugin root (it might be nested in a directory)
				const pluginRoot = await this.findPluginRoot(tempDir);
				if (!pluginRoot) {
					return {
						success: false,
						error:
							"Could not find plugin root. Ensure the zip contains .claude-plugin/plugin.json",
					};
				}

				// Validate the extracted plugin
				const validation = await this.validatePlugin(pluginRoot);
				if (!validation.isValid) {
					return {
						success: false,
						error: validation.error,
					};
				}

				// Determine final plugin name and path
				const pluginName =
					providedName || validation.manifest?.name || basename(pluginRoot);
				const finalPath = join(this.pluginsDir, pluginName);

				// Remove existing plugin if present
				if (existsSync(finalPath)) {
					this.logger.info(`🔄 Replacing existing plugin: ${pluginName}`);
					await rm(finalPath, { recursive: true, force: true });
				}

				// Move plugin to final location
				const { rename, cp } = await import("node:fs/promises");
				if (pluginRoot === tempDir) {
					// Plugin is at temp root, just rename
					await rename(tempDir, finalPath);
				} else {
					// Plugin is nested, copy it
					await cp(pluginRoot, finalPath, { recursive: true });
					await rm(tempDir, { recursive: true, force: true });
				}

				this.logger.info(`✅ Plugin installed: ${pluginName} at ${finalPath}`);

				return {
					success: true,
					pluginName,
					pluginPath: finalPath,
				};
			} catch (extractError) {
				// Clean up temp directory on error
				await rm(tempDir, { recursive: true, force: true }).catch(() => {});
				throw extractError;
			}
		} catch (error) {
			const message = `Failed to install plugin: ${(error as Error).message}`;
			this.logger.error(`❌ ${message}`);
			return {
				success: false,
				error: message,
			};
		}
	}

	/**
	 * Install a plugin from a URL
	 */
	async installFromUrl(
		sourceUrl: string,
		providedName?: string,
	): Promise<PluginInstallResult> {
		try {
			this.logger.info(`📥 Downloading plugin from: ${sourceUrl}`);

			const response = await fetch(sourceUrl);
			if (!response.ok) {
				return {
					success: false,
					error: `Failed to download plugin: HTTP ${response.status}`,
				};
			}

			const arrayBuffer = await response.arrayBuffer();
			const zipContent = Buffer.from(arrayBuffer).toString("base64");

			return await this.installFromZip(zipContent, providedName);
		} catch (error) {
			const message = `Failed to download plugin: ${(error as Error).message}`;
			this.logger.error(`❌ ${message}`);
			return {
				success: false,
				error: message,
			};
		}
	}

	/**
	 * List all installed plugins
	 */
	async listPlugins(): Promise<
		Array<{ name: string; path: string; manifest: PluginManifest | null }>
	> {
		if (!existsSync(this.pluginsDir)) {
			return [];
		}

		const entries = readdirSync(this.pluginsDir);
		const plugins: Array<{
			name: string;
			path: string;
			manifest: PluginManifest | null;
		}> = [];

		for (const entry of entries) {
			// Skip hidden and temp directories
			if (entry.startsWith(".")) {
				continue;
			}

			const pluginPath = join(this.pluginsDir, entry);
			const stat = statSync(pluginPath);

			if (!stat.isDirectory()) {
				continue;
			}

			const validation = await this.validatePlugin(pluginPath);
			plugins.push({
				name: entry,
				path: pluginPath,
				manifest: validation.isValid ? (validation.manifest ?? null) : null,
			});
		}

		return plugins;
	}

	/**
	 * Delete a plugin by name
	 */
	async deletePlugin(
		pluginName: string,
	): Promise<{ success: boolean; error?: string }> {
		const pluginPath = join(this.pluginsDir, pluginName);

		if (!existsSync(pluginPath)) {
			return {
				success: false,
				error: `Plugin not found: ${pluginName}`,
			};
		}

		try {
			await rm(pluginPath, { recursive: true, force: true });
			this.logger.info(`🗑️ Deleted plugin: ${pluginName}`);
			return { success: true };
		} catch (error) {
			const message = `Failed to delete plugin: ${(error as Error).message}`;
			this.logger.error(`❌ ${message}`);
			return {
				success: false,
				error: message,
			};
		}
	}

	/**
	 * Resolve plugins for an issue based on its labels.
	 * Returns an array of SdkPluginConfig ready to pass to the Claude SDK.
	 *
	 * @param labels - The issue's labels (from Linear)
	 * @param repository - The repository configuration containing plugin settings
	 * @returns Array of SdkPluginConfig for the Claude SDK
	 */
	resolvePluginsForLabels(
		labels: string[],
		repository: RepositoryConfig,
	): SdkPluginConfig[] {
		const plugins: SdkPluginConfig[] = [];
		const addedPaths = new Set<string>();

		// Lowercase labels for case-insensitive matching
		const lowercaseLabels = labels.map((l) => l.toLowerCase());

		// Process pluginRouting configuration
		if (repository.pluginRouting) {
			for (const [labelName, pluginPaths] of Object.entries(
				repository.pluginRouting,
			)) {
				if (lowercaseLabels.includes(labelName.toLowerCase())) {
					for (const pluginPath of pluginPaths) {
						const resolvedPath = this.resolvePath(pluginPath);
						if (!addedPaths.has(resolvedPath)) {
							addedPaths.add(resolvedPath);
							plugins.push({ type: "local", path: resolvedPath });
							this.logger.debug(
								`📦 Added plugin from routing (label: ${labelName}): ${resolvedPath}`,
							);
						}
					}
				}
			}
		}

		// Process plugins array configuration
		if (repository.plugins) {
			for (const pluginConfig of repository.plugins) {
				// Skip inactive plugins
				if (pluginConfig.isActive === false) {
					continue;
				}

				// Check if any of the plugin's labels match
				const hasMatchingLabel = pluginConfig.labels.some((configLabel) =>
					lowercaseLabels.includes(configLabel.toLowerCase()),
				);

				if (hasMatchingLabel) {
					const resolvedPath = this.resolvePath(pluginConfig.path);
					if (!addedPaths.has(resolvedPath)) {
						addedPaths.add(resolvedPath);
						plugins.push({ type: "local", path: resolvedPath });
						this.logger.debug(
							`📦 Added plugin from config (name: ${pluginConfig.name}): ${resolvedPath}`,
						);
					}
				}
			}
		}

		if (plugins.length > 0) {
			this.logger.info(
				`📦 Resolved ${plugins.length} plugin(s) for labels: [${labels.join(", ")}]`,
			);
		}

		return plugins;
	}

	/**
	 * Resolve a path that may contain ~ prefix
	 */
	private resolvePath(path: string): string {
		if (path.startsWith("~/")) {
			return resolve(homedir(), path.slice(2));
		}
		return resolve(path);
	}

	/**
	 * Find the plugin root directory within an extracted zip.
	 * The plugin root is the directory containing .claude-plugin/plugin.json
	 */
	private async findPluginRoot(extractedDir: string): Promise<string | null> {
		// Check if extracted dir itself is the plugin root
		if (existsSync(join(extractedDir, ".claude-plugin", "plugin.json"))) {
			return extractedDir;
		}

		// Check immediate subdirectories (common for GitHub archives)
		const entries = readdirSync(extractedDir);
		for (const entry of entries) {
			const subPath = join(extractedDir, entry);
			const stat = statSync(subPath);
			if (
				stat.isDirectory() &&
				existsSync(join(subPath, ".claude-plugin", "plugin.json"))
			) {
				return subPath;
			}
		}

		return null;
	}
}

/**
 * Constants for plugin-related paths
 */
export const PLUGINS_DIRECTORY = "plugins";
export const PLUGIN_MANIFEST_PATH = ".claude-plugin/plugin.json";
