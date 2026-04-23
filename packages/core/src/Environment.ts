import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { resolvePath } from "./config-types.js";
import {
	type EnvironmentConfig,
	EnvironmentConfigSchema,
} from "./environment-schema.js";

/**
 * Relative directory (under cyrusHome) where environment configs live.
 */
export const ENVIRONMENTS_DIRNAME = "environments";

/**
 * Error thrown when an environment config cannot be loaded or validated.
 */
export class EnvironmentLoadError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "EnvironmentLoadError";
	}
}

/**
 * Absolute path to the environments directory.
 */
export function getEnvironmentsDir(cyrusHome: string): string {
	return join(resolvePath(cyrusHome), ENVIRONMENTS_DIRNAME);
}

/**
 * Resolve the on-disk path for a given environment name.
 * Environment names must be safe filename stems (no path separators, no `..`).
 */
export function getEnvironmentPath(
	cyrusHome: string,
	environmentName: string,
): string {
	assertSafeEnvironmentName(environmentName);
	return join(getEnvironmentsDir(cyrusHome), `${environmentName}.json`);
}

/**
 * Validate that an environment name is a simple filename stem.
 * Rejects path separators, `..`, and empty strings.
 */
export function assertSafeEnvironmentName(name: string): void {
	if (!name || name.length === 0) {
		throw new EnvironmentLoadError("Environment name must not be empty");
	}
	if (
		name.includes("/") ||
		name.includes("\\") ||
		name === "." ||
		name === ".." ||
		name.includes("..")
	) {
		throw new EnvironmentLoadError(
			`Invalid environment name: ${JSON.stringify(name)}`,
		);
	}
}

/**
 * Load and validate an environment config by name.
 * Returns `null` if no environment file exists (caller decides whether that's
 * an error); throws `EnvironmentLoadError` for malformed JSON or schema
 * validation failures.
 */
export function loadEnvironment(
	cyrusHome: string,
	environmentName: string,
): EnvironmentConfig | null {
	const path = getEnvironmentPath(cyrusHome, environmentName);
	if (!existsSync(path)) {
		return null;
	}

	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new EnvironmentLoadError(
			`Failed to read environment file: ${path}`,
			err,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new EnvironmentLoadError(
			`Environment file is not valid JSON: ${path}`,
			err,
		);
	}

	const result = EnvironmentConfigSchema.safeParse(parsed);
	if (!result.success) {
		throw new EnvironmentLoadError(
			`Environment config failed validation (${path}): ${result.error.message}`,
			result.error,
		);
	}

	const config = result.data;
	if (!config.name) {
		config.name = environmentName;
	}
	return config;
}

/**
 * List all environment names available on disk (filename stems without `.json`).
 * Returns an empty list if the directory does not exist.
 */
export function listEnvironmentNames(cyrusHome: string): string[] {
	const dir = getEnvironmentsDir(cyrusHome);
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => basename(f, ".json"))
			.sort();
	} catch {
		return [];
	}
}
