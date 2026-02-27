import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG_FILENAME } from "cyrus-core";

/**
 * GET /api/admin/status — extended status info
 */
export function handleGetStatus(cyrusHome: string, version?: string) {
	return async () => {
		let repoCount = 0;
		try {
			const configPath = resolve(cyrusHome, DEFAULT_CONFIG_FILENAME);
			const raw = readFileSync(configPath, "utf-8");
			const config = JSON.parse(raw) as { repositories?: unknown[] };
			repoCount = config.repositories?.length ?? 0;
		} catch {
			// Config not found — report 0 repos
		}

		return {
			success: true,
			data: {
				version: version ?? process.env.npm_package_version ?? "unknown",
				repoCount,
				uptime: process.uptime(),
				nodeVersion: process.version,
				platform: process.platform,
			},
		};
	};
}
