import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ApiResponse, CyrusConfigPayload } from "../types.js";

/**
 * Handle Cyrus configuration update
 * Updates the ~/.cyrus/config.json file with the provided configuration
 */
export async function handleCyrusConfig(
	payload: CyrusConfigPayload,
	cyrusHome: string,
): Promise<ApiResponse> {
	try {
		// Validate payload
		if (!payload.repositories || !Array.isArray(payload.repositories)) {
			return {
				success: false,
				error: "Configuration update requires repositories array",
				details:
					"The repositories field must be provided as an array, even if empty.",
			};
		}

		// Validate each repository has required fields
		for (const repo of payload.repositories) {
			if (!repo.id || !repo.name || !repo.repositoryPath || !repo.baseBranch) {
				const missingFields: string[] = [];
				if (!repo.id) missingFields.push("id");
				if (!repo.name) missingFields.push("name");
				if (!repo.repositoryPath) missingFields.push("repositoryPath");
				if (!repo.baseBranch) missingFields.push("baseBranch");

				return {
					success: false,
					error: "Repository configuration is incomplete",
					details: `Repository "${repo.name || "unknown"}" is missing required fields: ${missingFields.join(", ")}`,
				};
			}
		}

		const configPath = join(cyrusHome, "config.json");

		// Ensure the .cyrus directory exists
		const configDir = dirname(configPath);
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true });
		}

		// Build the config object with repositories and optional settings
		const repositories = payload.repositories.map((repo) => {
			const repoConfig: any = {
				id: repo.id,
				name: repo.name,
				repositoryPath: repo.repositoryPath,
				baseBranch: repo.baseBranch,
			};

			// Add optional GitHub URL
			if (repo.githubUrl) {
				repoConfig.githubUrl = repo.githubUrl;
			}

			// Add optional Linear fields
			if (repo.linearWorkspaceId) {
				repoConfig.linearWorkspaceId = repo.linearWorkspaceId;
			}
			if (repo.linearToken) {
				repoConfig.linearToken = repo.linearToken;
			}

			// Set workspaceBaseDir (use provided or default to ~/.cyrus/workspaces)
			repoConfig.workspaceBaseDir =
				repo.workspaceBaseDir || join(cyrusHome, "workspaces");

			// Set isActive (defaults to true)
			repoConfig.isActive = repo.isActive !== false;

			// Optional arrays and objects
			if (repo.allowedTools && repo.allowedTools.length > 0) {
				repoConfig.allowedTools = repo.allowedTools;
			}

			if (repo.mcpConfigPath && repo.mcpConfigPath.length > 0) {
				repoConfig.mcpConfigPath = repo.mcpConfigPath;
			}

			if (repo.teamKeys) {
				repoConfig.teamKeys = repo.teamKeys;
			} else {
				repoConfig.teamKeys = [];
			}

			if (repo.routingLabels && repo.routingLabels.length > 0) {
				repoConfig.routingLabels = repo.routingLabels;
			}

			if (repo.projectKeys && repo.projectKeys.length > 0) {
				repoConfig.projectKeys = repo.projectKeys;
			}

			if (repo.labelPrompts && Object.keys(repo.labelPrompts).length > 0) {
				repoConfig.labelPrompts = repo.labelPrompts;
			}

			return repoConfig;
		});

		// Build complete config
		const config: any = {
			repositories,
		};

		// Add optional global settings
		if (payload.disallowedTools && payload.disallowedTools.length > 0) {
			config.disallowedTools = payload.disallowedTools;
		}

		if (payload.ngrokAuthToken) {
			config.ngrokAuthToken = payload.ngrokAuthToken;
		}

		if (payload.stripeCustomerId) {
			config.stripeCustomerId = payload.stripeCustomerId;
		}

		if (payload.defaultModel) {
			config.defaultModel = payload.defaultModel;
		}

		if (payload.defaultFallbackModel) {
			config.defaultFallbackModel = payload.defaultFallbackModel;
		}

		if (payload.global_setup_script) {
			config.global_setup_script = payload.global_setup_script;
		}

		if (payload.linearWorkspaceSlug) {
			config.linearWorkspaceSlug = payload.linearWorkspaceSlug;
		}

		// Backup existing config if requested
		if (payload.backupConfig && existsSync(configPath)) {
			try {
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				const backupPath = join(cyrusHome, `config.backup-${timestamp}.json`);
				const existingConfig = readFileSync(configPath, "utf-8");
				writeFileSync(backupPath, existingConfig, "utf-8");
			} catch (backupError) {
				// Log but don't fail - backup is not critical
				console.warn(
					`Failed to backup config: ${backupError instanceof Error ? backupError.message : String(backupError)}`,
				);
			}
		}

		// Write config file
		try {
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

			return {
				success: true,
				message: "Cyrus configuration updated successfully",
				data: {
					configPath,
					repositoriesCount: repositories.length,
					restartCyrus: payload.restartCyrus || false,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: "Failed to save configuration file",
				details: `Could not write configuration to ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	} catch (error) {
		return {
			success: false,
			error: "Configuration update failed",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Read current Cyrus configuration
 */
export function readCyrusConfig(cyrusHome: string): any {
	const configPath = join(cyrusHome, "config.json");

	if (!existsSync(configPath)) {
		return { repositories: [] };
	}

	try {
		const data = readFileSync(configPath, "utf-8");
		return JSON.parse(data);
	} catch {
		return { repositories: [] };
	}
}
