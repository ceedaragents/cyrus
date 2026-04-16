/**
 * Shared session environment and MCP config utilities.
 *
 * These helpers DRY up logic that was previously duplicated between
 * ClaudeRunner (query options) and EdgeWorker (warmup / startup).
 */

/**
 * Cyrus-specific env vars injected into every Claude Code subprocess.
 * Both `ClaudeRunner.start()` and `EdgeWorker.warmupRecentSessions()`
 * must use the same set — keep this as the single source of truth.
 */
export const CYRUS_SESSION_ENV = {
	CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
	CLAUDE_CODE_ENABLE_TASKS: "true",
	CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
	CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
} as const;

/**
 * Build the base `env` object for a Claude SDK session.
 *
 * Forwards only a minimal set of parent-process env vars (PATH + auth tokens)
 * plus the Cyrus session flags above. Callers can spread additional vars on top
 * (e.g., `MCP_CONNECTION_NONBLOCKING` for warmup, repository .env for live runs).
 */
export function buildBaseSessionEnv(
	extra?: Record<string, string>,
): Record<string, string> {
	return {
		...(process.env.PATH && { PATH: process.env.PATH }),
		...(process.env.ANTHROPIC_API_KEY && {
			ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
		}),
		...(process.env.CLAUDE_CODE_OAUTH_TOKEN && {
			CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
		}),
		...(process.env.ANTHROPIC_AUTH_TOKEN && {
			ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
		}),
		CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
		...CYRUS_SESSION_ENV,
		...extra,
	};
}

/**
 * Normalize MCP server configs loaded from JSON files.
 *
 * Config files (.mcp.json, mcp-*.json) often omit the `type` field,
 * but the SDK requires an explicit discriminator for non-stdio transports.
 * If a config has a `url` but no `type`, set `type = "http"`.
 *
 * Mutates the input records in place.
 */
export function normalizeMcpHttpTransport(
	servers: Record<string, Record<string, unknown>>,
): void {
	for (const cfg of Object.values(servers)) {
		if (!cfg.type && typeof cfg.url === "string") {
			cfg.type = "http";
		}
	}
}
