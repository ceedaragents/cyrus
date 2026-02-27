import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG_FILENAME } from "cyrus-core";

/**
 * Mask a token string — show only last 4 characters.
 */
function maskToken(token: string | undefined): string {
	if (!token) return "";
	if (token.length <= 4) return "****";
	return `****${token.slice(-4)}`;
}

/**
 * GET /api/admin/config — return sanitized config (tokens masked)
 */
export function handleGetConfig(cyrusHome: string) {
	return async () => {
		const configPath = resolve(cyrusHome, DEFAULT_CONFIG_FILENAME);
		try {
			const raw = readFileSync(configPath, "utf-8");
			const config = JSON.parse(raw) as Record<string, unknown>;

			// Mask tokens in repositories
			const repos = config.repositories;
			if (Array.isArray(repos)) {
				for (const repo of repos) {
					if (repo && typeof repo === "object") {
						const r = repo as Record<string, unknown>;
						if (typeof r.linearToken === "string") {
							r.linearToken = maskToken(r.linearToken);
						}
						if (typeof r.linearRefreshToken === "string") {
							r.linearRefreshToken = maskToken(r.linearRefreshToken);
						}
					}
				}
			}

			// Mask ngrokAuthToken at top level
			if (typeof config.ngrokAuthToken === "string") {
				config.ngrokAuthToken = maskToken(config.ngrokAuthToken);
			}

			return { success: true, data: config };
		} catch (error) {
			return {
				success: false,
				error: "Failed to read config",
				details: error instanceof Error ? error.message : String(error),
			};
		}
	};
}
