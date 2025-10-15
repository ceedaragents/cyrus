/**
 * Cyrus Configuration Handler
 *
 * Handles updates to the Cyrus configuration file (config.json).
 * Ported from the Go update-server implementation.
 *
 * @module config-handler
 *
 * @example
 * ```typescript
 * import { handleCyrusConfig } from './handlers/config-handler';
 *
 * const payload = {
 *   repositories: [
 *     {
 *       id: 'repo-1',
 *       name: 'my-project',
 *       repositoryPath: '/home/user/projects/my-project',
 *       baseBranch: 'main',
 *       linearWorkspaceId: 'workspace-123',
 *       linearToken: 'lin_api_xxx',
 *       isActive: true,
 *     },
 *   ],
 *   backupConfig: true,
 * };
 *
 * await handleCyrusConfig(payload, '/home/user/.cyrus');
 * ```
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { CyrusConfigPayload, RepositoryConfigItem } from "../types";

/**
 * Default values for repository configuration fields
 */
const DEFAULT_WORKSPACE_BASE_DIR = "/home/cyrus/cyrus-workspaces";
const DEFAULT_ALLOWED_TOOLS = [
	"Read(**)",
	"Edit(**)",
	"Task",
	"WebFetch",
	"WebSearch",
	"TodoRead",
	"TodoWrite",
	"NotebookRead",
	"NotebookEdit",
	"Batch",
	"Bash",
];
const DEFAULT_LABEL_PROMPTS = {
	debugger: ["Bug"],
	builder: ["Feature"],
	scoper: ["PRD"],
};

/**
 * Default values for global configuration fields
 */
const DEFAULT_DISALLOWED_TOOLS = ["Bash(sudo:*)"];
const DEFAULT_NGROK_AUTH_TOKEN = "";
const DEFAULT_STRIPE_CUSTOMER_ID = "cus_8172616126";
const DEFAULT_MODEL = "opus";
const DEFAULT_FALLBACK_MODEL = "sonnet";
const DEFAULT_GLOBAL_SETUP_SCRIPT = "/opt/cyrus/scripts/global-setup.sh";

/**
 * Interface for the complete config.json structure
 */
interface CyrusConfig {
	repositories: Record<string, unknown>[];
	disallowedTools: string[];
	ngrokAuthToken: string;
	stripeCustomerId: string;
	defaultModel: string;
	defaultFallbackModel: string;
	global_setup_script: string;
}

/**
 * Validates that a repository has all required fields
 * @param repo - Repository configuration to validate
 * @throws Error if required fields are missing
 */
function validateRepository(repo: RepositoryConfigItem): void {
	if (!repo.id || !repo.name || !repo.repositoryPath || !repo.baseBranch) {
		throw new Error(
			"Repository missing required fields: id, name, repositoryPath, or baseBranch",
		);
	}
}

/**
 * Applies default values to a repository configuration
 * @param repo - Repository configuration item
 * @returns Repository configuration with defaults applied
 */
function applyRepositoryDefaults(
	repo: RepositoryConfigItem,
): Record<string, unknown> {
	const repoConfig: Record<string, unknown> = {
		id: repo.id,
		name: repo.name,
		repositoryPath: repo.repositoryPath,
		baseBranch: repo.baseBranch,
	};

	// Add Linear fields if provided
	if (repo.linearWorkspaceId) {
		repoConfig.linearWorkspaceId = repo.linearWorkspaceId;
	}
	if (repo.linearToken) {
		repoConfig.linearToken = repo.linearToken;
	}

	// Apply defaults for optional fields
	repoConfig.workspaceBaseDir =
		repo.workspaceBaseDir || DEFAULT_WORKSPACE_BASE_DIR;

	// isActive defaults to the provided value or false
	repoConfig.isActive = repo.isActive ?? false;

	// AllowedTools with default if not provided
	repoConfig.allowedTools =
		repo.allowedTools && repo.allowedTools.length > 0
			? repo.allowedTools
			: DEFAULT_ALLOWED_TOOLS;

	// McpConfigPath (array of MCP config file paths)
	if (repo.mcpConfigPath && repo.mcpConfigPath.length > 0) {
		repoConfig.mcpConfigPath = repo.mcpConfigPath;
	}

	// TeamKeys (can be empty array)
	repoConfig.teamKeys = repo.teamKeys ?? [];

	// LabelPrompts with defaults
	repoConfig.labelPrompts =
		repo.labelPrompts && Object.keys(repo.labelPrompts).length > 0
			? repo.labelPrompts
			: DEFAULT_LABEL_PROMPTS;

	return repoConfig;
}

/**
 * Builds the complete Cyrus configuration object with defaults
 * @param payload - The payload containing repositories and configuration
 * @returns Complete configuration object
 */
function buildConfig(payload: CyrusConfigPayload): CyrusConfig {
	// Apply defaults to repositories
	const repositories = payload.repositories.map((repo) => {
		validateRepository(repo);
		return applyRepositoryDefaults(repo);
	});

	// Build the config object with required fields and defaults
	const config: CyrusConfig = {
		repositories,
		disallowedTools:
			payload.disallowedTools && payload.disallowedTools.length > 0
				? payload.disallowedTools
				: DEFAULT_DISALLOWED_TOOLS,
		ngrokAuthToken: payload.ngrokAuthToken ?? DEFAULT_NGROK_AUTH_TOKEN,
		stripeCustomerId: payload.stripeCustomerId ?? DEFAULT_STRIPE_CUSTOMER_ID,
		defaultModel: payload.defaultModel ?? DEFAULT_MODEL,
		defaultFallbackModel:
			payload.defaultFallbackModel ?? DEFAULT_FALLBACK_MODEL,
		global_setup_script:
			payload.global_setup_script ?? DEFAULT_GLOBAL_SETUP_SCRIPT,
	};

	return config;
}

/**
 * Creates a backup of the existing config.json file
 * @param cyrusHome - Path to the Cyrus home directory (e.g., ~/.cyrus)
 * @returns Path to the backup file, or null if no config existed
 */
async function backupConfig(cyrusHome: string): Promise<string | null> {
	const configPath = join(cyrusHome, "config.json");
	const backupDir = join(cyrusHome, "backups");

	// Ensure backup directory exists
	await fs.mkdir(backupDir, { recursive: true, mode: 0o755 });

	// Check if config exists
	try {
		await fs.access(configPath);
	} catch {
		// No existing config to backup
		return null;
	}

	// Read existing config
	const data = await fs.readFile(configPath, "utf-8");

	// Create backup with timestamp
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const backupPath = join(backupDir, `config-${timestamp}.json`);

	// Write backup
	await fs.writeFile(backupPath, data, { mode: 0o644 });

	console.log(`Created config backup at ${backupPath}`);
	return backupPath;
}

/**
 * Handles Cyrus configuration update
 * Optionally backs up existing config, writes new config, and sets permissions
 *
 * @param payload - The configuration payload
 * @param cyrusHome - Path to the Cyrus home directory (e.g., ~/.cyrus)
 * @throws Error if configuration update fails
 */
export async function handleCyrusConfig(
	payload: CyrusConfigPayload,
	cyrusHome: string,
): Promise<void> {
	// Backup existing config if requested
	if (payload.backupConfig) {
		try {
			await backupConfig(cyrusHome);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.warn(`Warning: Failed to backup config: ${errorMessage}`);
			// Continue with update even if backup fails
		}
	}

	// Build the complete configuration
	const config = buildConfig(payload);

	// Ensure the .cyrus directory exists
	await fs.mkdir(cyrusHome, { recursive: true, mode: 0o755 });

	// Write config file
	const configPath = join(cyrusHome, "config.json");
	const configData = JSON.stringify(config, null, 2);
	await fs.writeFile(configPath, configData, { mode: 0o644 });

	console.log(
		`Successfully updated Cyrus configuration with ${payload.repositories.length} repositories`,
	);
}
