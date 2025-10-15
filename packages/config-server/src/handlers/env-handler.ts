/**
 * Environment Variable Handler
 *
 * Handles environment variable management for Cyrus:
 * 1. Updates env-manifest.yml with per-repository, per-file variables
 * 2. Updates Cyrus .env file with optional backup
 *
 * Ported from the Go update-server implementation.
 *
 * @module env-handler
 *
 * @example
 * ```typescript
 * import { handleUpdateEnvVariables, handleUpdateCyrusEnv } from './handlers/env-handler';
 *
 * // Update env manifest
 * const manifestPayload = {
 *   repository: 'my-repo',
 *   file_path: '.env',
 *   variables: [
 *     { key: 'API_KEY', value: 'secret123' },
 *     { key: 'DEBUG', value: 'true' }
 *   ],
 *   append: false
 * };
 * await handleUpdateEnvVariables(manifestPayload, '/opt/cyrus/env-manifest.yml');
 *
 * // Update Cyrus .env
 * const cyrusEnvPayload = {
 *   variables: { PORT: '3000', NODE_ENV: 'production' },
 *   backupEnv: true
 * };
 * await handleUpdateCyrusEnv(cyrusEnvPayload, '/home/user/.cyrus');
 * ```
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
	CyrusEnvPayload,
	EnvManifest,
	EnvVariablesPayload,
} from "../types";

/**
 * Validates the env variables payload
 * @param payload - The payload to validate
 * @throws Error if validation fails
 */
function validateEnvVariablesPayload(payload: EnvVariablesPayload): void {
	if (!payload.repository) {
		throw new Error("Repository name is required");
	}

	if (!payload.file_path) {
		throw new Error("File path is required");
	}

	// Allow empty variables in replace mode to clear all variables
	// In append mode, empty variables would be a no-op so we reject it
	if (payload.variables.length === 0 && payload.append) {
		throw new Error("No variables provided for append operation");
	}
}

/**
 * Updates the env-manifest.yml file with the new variables
 *
 * The manifest tracks environment variables per repository and per file,
 * with timestamps for each update.
 *
 * @param payload - The environment variables payload
 * @param manifestPath - Path to the env-manifest.yml file
 * @throws Error if manifest update fails
 */
export async function handleUpdateEnvVariables(
	payload: EnvVariablesPayload,
	manifestPath: string,
): Promise<void> {
	// Validate payload
	validateEnvVariablesPayload(payload);

	// Ensure the manifest directory exists
	const manifestDir = dirname(manifestPath);
	await fs.mkdir(manifestDir, { recursive: true, mode: 0o755 });

	// Load existing manifest or create new one
	let manifest: EnvManifest = {
		version: "1.0",
		repositories: {},
	};

	try {
		await fs.access(manifestPath);
		const data = await fs.readFile(manifestPath, "utf-8");
		const parsed = parseYaml(data);

		// Validate parsed manifest structure
		if (parsed && typeof parsed === "object") {
			manifest = parsed as EnvManifest;

			// Ensure version and repositories exist
			if (!manifest.version) {
				manifest.version = "1.0";
			}
			if (!manifest.repositories) {
				manifest.repositories = {};
			}
		}
	} catch (error) {
		// File doesn't exist or couldn't be read, use default manifest
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw new Error(
				`Failed to read manifest file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Ensure repository exists in manifest
	if (!manifest.repositories[payload.repository]) {
		manifest.repositories[payload.repository] = {
			env_files: {},
		};
	}

	// TypeScript non-null assertion is safe here because we just ensured it exists
	const repoConfig = manifest.repositories[payload.repository]!;
	if (!repoConfig.env_files) {
		repoConfig.env_files = {};
	}

	// Get or create env file config
	let envFileConfig = repoConfig.env_files[payload.file_path];
	if (!envFileConfig) {
		envFileConfig = {
			variables: {},
			last_updated: "",
		};
		repoConfig.env_files[payload.file_path] = envFileConfig;
	}

	// Update variables based on append flag
	if (!payload.append) {
		// Replace mode: completely replace all variables with the payload
		// This ensures deleted variables are removed
		// If payload.variables is empty, this will clear all variables
		envFileConfig.variables = {};
		for (const v of payload.variables) {
			if (v.key) {
				envFileConfig.variables[v.key] = v.value;
			}
		}
	} else {
		// Append mode: add/overwrite existing variables (keep others)
		for (const v of payload.variables) {
			if (v.key) {
				envFileConfig.variables[v.key] = v.value;
			}
		}
	}

	// Update last_updated timestamp
	envFileConfig.last_updated = new Date().toISOString();

	// Marshal and save the updated manifest
	const yamlData = stringifyYaml(manifest, {
		indent: 2,
		lineWidth: 0, // Don't wrap long lines
	});

	await fs.writeFile(manifestPath, yamlData, { mode: 0o644 });

	console.log(
		`Successfully updated ${payload.variables.length} environment variables for repository ${payload.repository}, file ${payload.file_path}`,
	);
}

/**
 * Parses a .env file into a key-value map
 * Handles various .env formats including comments and empty lines
 *
 * @param content - The .env file content
 * @returns Map of environment variables
 */
function parseEnvFile(content: string): Record<string, string> {
	const env: Record<string, string> = {};
	const lines = content.split("\n");

	for (const line of lines) {
		// Skip empty lines and comments
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		// Parse KEY=VALUE format
		const match = trimmed.match(/^([^=]+)=(.*)$/);
		if (match?.[1] && match[2] !== undefined) {
			const key = match[1].trim();
			let value = match[2].trim();

			// Remove surrounding quotes if present
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}

			env[key] = value;
		}
	}

	return env;
}

/**
 * Serializes environment variables to .env file format
 * Preserves quotes for values containing spaces or special characters
 *
 * @param env - Map of environment variables
 * @returns .env file content
 */
function serializeEnvFile(env: Record<string, string>): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(env)) {
		// Quote values that contain spaces or special characters
		// Include more characters that typically require quoting in .env files
		const needsQuotes = /[\s#"'$`\\:&?=]/.test(value);
		const formattedValue = needsQuotes
			? `"${value.replace(/"/g, '\\"')}"`
			: value;
		lines.push(`${key}=${formattedValue}`);
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Creates a backup of the existing .env file
 * @param cyrusAppDir - Path to the Cyrus app directory (e.g., ~/.cyrus)
 * @returns Path to the backup file, or null if no .env existed
 */
async function backupEnvFile(cyrusAppDir: string): Promise<string | null> {
	const envPath = join(cyrusAppDir, ".env");
	const backupDir = join(cyrusAppDir, "env-backups");

	// Ensure backup directory exists
	await fs.mkdir(backupDir, { recursive: true, mode: 0o755 });

	// Check if .env exists
	try {
		await fs.access(envPath);
	} catch {
		// No existing .env to backup
		return null;
	}

	// Read existing .env
	const data = await fs.readFile(envPath, "utf-8");

	// Create backup with timestamp
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const backupPath = join(backupDir, `.env-${timestamp}`);

	// Write backup
	await fs.writeFile(backupPath, data, { mode: 0o644 });

	console.log(`Created .env backup at ${backupPath}`);
	return backupPath;
}

/**
 * Updates the Cyrus .env file with new environment variables
 *
 * Merges new variables with existing ones, optionally creating a backup first.
 *
 * @param payload - The Cyrus env payload containing variables to update
 * @param cyrusAppDir - Path to the Cyrus app directory (e.g., ~/.cyrus)
 * @throws Error if .env update fails
 */
export async function handleUpdateCyrusEnv(
	payload: CyrusEnvPayload,
	cyrusAppDir: string,
): Promise<void> {
	// Backup existing .env if requested
	if (payload.backupEnv) {
		try {
			await backupEnvFile(cyrusAppDir);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.warn(`Warning: Failed to backup .env: ${errorMessage}`);
			// Continue with update even if backup fails
		}
	}

	// Ensure the Cyrus app directory exists
	await fs.mkdir(cyrusAppDir, { recursive: true, mode: 0o755 });

	const envPath = join(cyrusAppDir, ".env");

	// Load existing .env or create new one
	let existingEnv: Record<string, string> = {};
	try {
		await fs.access(envPath);
		const content = await fs.readFile(envPath, "utf-8");
		existingEnv = parseEnvFile(content);
	} catch (error) {
		// File doesn't exist, use empty env
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw new Error(
				`Failed to read .env file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Merge new variables with existing ones
	const mergedEnv = { ...existingEnv, ...payload.variables };

	// Serialize and write the updated .env
	const envContent = serializeEnvFile(mergedEnv);
	await fs.writeFile(envPath, envContent, { mode: 0o644 });

	console.log(
		`Successfully updated Cyrus .env with ${Object.keys(payload.variables).length} variables`,
	);
}
