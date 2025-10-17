import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import type { ConfigManager } from "../ConfigManager.js";
import type {
	GitHubCredentialsUpdate,
	HandlerResult,
	LinearCredentialsUpdate,
	PathUpdateRequest,
} from "../types.js";

export interface ConfigUpdateHandlerConfig {
	configManager: ConfigManager;
}

/**
 * Handles configuration update requests from cyrus-hosted
 */
export class ConfigUpdateHandler extends EventEmitter {
	private configManager: ConfigManager;

	constructor(config: ConfigUpdateHandlerConfig) {
		super();
		this.configManager = config.configManager;
	}

	/**
	 * Handle paths update request
	 */
	async handlePaths(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult> {
		try {
			const update: PathUpdateRequest = JSON.parse(body);

			// Validate paths
			const errors: string[] = [];

			if (update.cyrusApp) {
				const resolvedPath = resolve(update.cyrusApp);
				if (!existsSync(resolvedPath)) {
					errors.push(`cyrus-app path does not exist: ${resolvedPath}`);
				}
			}

			if (update.cyrusWorkspaces) {
				const resolvedPath = resolve(update.cyrusWorkspaces);
				if (!existsSync(resolvedPath)) {
					errors.push(`cyrus-workspaces path does not exist: ${resolvedPath}`);
				}
			}

			if (errors.length > 0) {
				return {
					status: 400,
					body: {
						success: false,
						errors,
					},
				};
			}

			// Update configuration
			this.configManager.updatePaths(update);

			// Emit configuration update event
			this.emit("config:updated", "paths");

			console.log("[ConfigUpdateHandler] Paths updated:", update);

			return {
				status: 200,
				body: {
					success: true,
					message: "Paths updated successfully",
					paths: update,
				},
			};
		} catch (error) {
			console.error("[ConfigUpdateHandler] Failed to update paths:", error);
			return {
				status: 500,
				body: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	/**
	 * Handle GitHub credentials update
	 */
	async handleGitHubCredentials(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult> {
		try {
			const credentials: GitHubCredentialsUpdate = JSON.parse(body);

			// Validate required fields
			if (
				!credentials.appId ||
				!credentials.privateKey ||
				!credentials.installationId
			) {
				return {
					status: 400,
					body: {
						success: false,
						error: "Missing required fields: appId, privateKey, installationId",
					},
				};
			}

			// Update configuration
			this.configManager.setGitHubCredentials(credentials);

			// Emit configuration update event
			this.emit("config:updated", "github");

			console.log("[ConfigUpdateHandler] GitHub credentials updated");

			return {
				status: 200,
				body: {
					success: true,
					message: "GitHub credentials updated successfully",
				},
			};
		} catch (error) {
			console.error(
				"[ConfigUpdateHandler] Failed to update GitHub credentials:",
				error,
			);
			return {
				status: 500,
				body: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	/**
	 * Handle Linear credentials update
	 */
	async handleLinearCredentials(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult> {
		try {
			const credentials: LinearCredentialsUpdate = JSON.parse(body);

			// Validate required fields
			if (
				!credentials.token ||
				!credentials.workspaceId ||
				!credentials.workspaceName
			) {
				return {
					status: 400,
					body: {
						success: false,
						error: "Missing required fields: token, workspaceId, workspaceName",
					},
				};
			}

			// Update configuration
			this.configManager.setLinearCredentials(credentials);

			// Emit configuration update event
			this.emit("config:updated", "linear");

			console.log("[ConfigUpdateHandler] Linear credentials updated");

			return {
				status: 200,
				body: {
					success: true,
					message: "Linear credentials updated successfully",
				},
			};
		} catch (error) {
			console.error(
				"[ConfigUpdateHandler] Failed to update Linear credentials:",
				error,
			);
			return {
				status: 500,
				body: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	/**
	 * Handle Claude API key update
	 */
	async handleClaudeApiKey(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult> {
		try {
			const { apiKey } = JSON.parse(body);

			if (!apiKey) {
				return {
					status: 400,
					body: {
						success: false,
						error: "Missing Claude API key",
					},
				};
			}

			// Update configuration
			this.configManager.setClaudeApiKey(apiKey);

			// Emit configuration update event
			this.emit("config:updated", "claude");

			console.log("[ConfigUpdateHandler] Claude API key updated");

			return {
				status: 200,
				body: {
					success: true,
					message: "Claude API key updated successfully",
				},
			};
		} catch (error) {
			console.error(
				"[ConfigUpdateHandler] Failed to update Claude API key:",
				error,
			);
			return {
				status: 500,
				body: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	/**
	 * Handle repositories configuration update
	 */
	async handleRepositories(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult> {
		try {
			const { repositories } = JSON.parse(body);

			if (!Array.isArray(repositories)) {
				return {
					status: 400,
					body: {
						success: false,
						error: "Invalid repositories format",
					},
				};
			}

			// Update configuration
			this.configManager.setRepositories(repositories);

			// Emit configuration update event
			this.emit("config:updated", "repositories");

			console.log(
				`[ConfigUpdateHandler] Repositories updated: ${repositories.length} repositories`,
			);

			return {
				status: 200,
				body: {
					success: true,
					message: `${repositories.length} repositories updated successfully`,
				},
			};
		} catch (error) {
			console.error(
				"[ConfigUpdateHandler] Failed to update repositories:",
				error,
			);
			return {
				status: 500,
				body: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	/**
	 * Handle get configuration request
	 */
	async handleGetConfig(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult> {
		try {
			const config = this.configManager.get();

			// Remove sensitive data from response
			const sanitizedConfig = {
				...config,
				githubCredentials: config.githubCredentials
					? {
							appId: config.githubCredentials.appId,
							installationId: config.githubCredentials.installationId,
							// Don't send private key
						}
					: undefined,
				linearCredentials: config.linearCredentials
					? {
							workspaceId: config.linearCredentials.workspaceId,
							workspaceName: config.linearCredentials.workspaceName,
							// Don't send token
						}
					: undefined,
				claudeApiKey: config.claudeApiKey ? "***" : undefined,
				authKey: "***", // Don't send auth key
			};

			return {
				status: 200,
				body: {
					success: true,
					config: sanitizedConfig,
				},
			};
		} catch (error) {
			console.error(
				"[ConfigUpdateHandler] Failed to get configuration:",
				error,
			);
			return {
				status: 500,
				body: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}
}
