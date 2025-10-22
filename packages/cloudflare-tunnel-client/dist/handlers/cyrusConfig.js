import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/**
 * Handle Cyrus configuration update
 * Updates the ~/.cyrus/config.json file with the provided configuration
 */
export async function handleCyrusConfig(payload, cyrusHome) {
	try {
		// Validate payload
		if (!payload.repositories || !Array.isArray(payload.repositories)) {
			return {
				success: false,
				error: "Invalid payload: repositories array is required",
			};
		}
		// Validate each repository has required fields
		for (const repo of payload.repositories) {
			if (!repo.id || !repo.name || !repo.repositoryPath || !repo.baseBranch) {
				return {
					success: false,
					error:
						"Invalid repository configuration: id, name, repositoryPath, and baseBranch are required",
					details: `Repository: ${repo.name || "unknown"}`,
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
			const repoConfig = {
				id: repo.id,
				name: repo.name,
				repositoryPath: repo.repositoryPath,
				baseBranch: repo.baseBranch,
			};
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
			if (repo.labelPrompts && Object.keys(repo.labelPrompts).length > 0) {
				repoConfig.labelPrompts = repo.labelPrompts;
			}
			return repoConfig;
		});
		// Build complete config
		const config = {
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
		// Write config file
		try {
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
			return {
				success: true,
				message: "Cyrus configuration updated successfully",
				data: {
					configPath,
					repositoriesCount: repositories.length,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: "Failed to write configuration file",
				details: error instanceof Error ? error.message : String(error),
			};
		}
	} catch (error) {
		return {
			success: false,
			error: "Failed to process configuration update",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
/**
 * Read current Cyrus configuration
 */
export function readCyrusConfig(cyrusHome) {
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
//# sourceMappingURL=cyrusConfig.js.map
