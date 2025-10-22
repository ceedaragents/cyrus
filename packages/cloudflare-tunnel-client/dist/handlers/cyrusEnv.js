import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/**
 * Handle Cyrus environment variables update
 * Primarily used to update/provide the Claude API token
 */
export async function handleCyrusEnv(payload, cyrusHome) {
	try {
		// Validate payload
		if (!payload || typeof payload !== "object") {
			return {
				success: false,
				error: "Invalid payload: environment variables object is required",
			};
		}
		// Ensure at least one environment variable is provided
		const envVars = Object.entries(payload).filter(
			([_, value]) => value !== undefined,
		);
		if (envVars.length === 0) {
			return {
				success: false,
				error: "No environment variables provided",
			};
		}
		const envPath = join(cyrusHome, ".env");
		// Ensure the .cyrus directory exists
		const envDir = dirname(envPath);
		if (!existsSync(envDir)) {
			mkdirSync(envDir, { recursive: true });
		}
		// Read existing env file if it exists
		const existingEnv = {};
		if (existsSync(envPath)) {
			try {
				const content = readFileSync(envPath, "utf-8");
				const lines = content.split("\n");
				for (const line of lines) {
					const trimmed = line.trim();
					// Skip empty lines and comments
					if (!trimmed || trimmed.startsWith("#")) {
						continue;
					}
					const equalIndex = trimmed.indexOf("=");
					if (equalIndex > 0) {
						const key = trimmed.substring(0, equalIndex);
						const value = trimmed.substring(equalIndex + 1);
						existingEnv[key] = value;
					}
				}
			} catch {
				// Ignore errors reading existing file - we'll create a new one
			}
		}
		// Merge new variables (new values override existing ones)
		for (const [key, value] of envVars) {
			if (value !== undefined) {
				existingEnv[key] = value;
			}
		}
		// Build new env file content
		const envContent = Object.entries(existingEnv)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n");
		// Write env file
		try {
			writeFileSync(envPath, `${envContent}\n`, "utf-8");
			return {
				success: true,
				message: "Environment variables updated successfully",
				data: {
					envPath,
					variablesUpdated: envVars.map(([key]) => key),
				},
			};
		} catch (error) {
			return {
				success: false,
				error: "Failed to write environment file",
				details: error instanceof Error ? error.message : String(error),
			};
		}
	} catch (error) {
		return {
			success: false,
			error: "Failed to process environment variables update",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
//# sourceMappingURL=cyrusEnv.js.map
