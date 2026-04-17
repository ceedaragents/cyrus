/**
 * Shared session environment and MCP config utilities.
 *
 * These helpers DRY up logic that was previously duplicated between
 * ClaudeRunner (query options) and EdgeWorker (warmup / startup).
 */

/**
 * Auth-related env vars forwarded from the parent process.
 * The SDK subprocess needs these for API calls.
 */
const AUTH_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"ANTHROPIC_AUTH_TOKEN",
] as const;

/**
 * Cyrus-specific env vars injected into every Claude Code subprocess.
 * Both `ClaudeRunner.start()` and `EdgeWorker.warmupRecentSessions()`
 * must use the same set — keep this as the single source of truth.
 *
 * Note: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is NOT included here because it
 * must be set conditionally — on Linux, the bubblewrap sandbox it triggers
 * requires socat + bwrap + unprivileged user namespaces. ClaudeRunner checks
 * these requirements via checkLinuxSandboxRequirements() and only sets the
 * flag when they are met. On macOS (e.g. warmup path) callers can add it
 * unconditionally since the SDK uses platform-native sandboxing.
 *
 * - MCP_CONNECTION_NONBLOCKING lets MCP servers connect in the background so
 *   both cold-start and pre-warm sessions return faster.
 */
export const CYRUS_SESSION_ENV = {
	CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
	CLAUDE_CODE_ENABLE_TASKS: "true",
	CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
	CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
	MCP_CONNECTION_NONBLOCKING: "true",
} as const;

/**
 * Build the base `env` object for a Claude SDK session.
 *
 * Forwards PATH + auth tokens from the parent process and applies the
 * shared Cyrus session flags.
 * Callers can spread additional vars on top (e.g., repository .env for live runs).
 */
export function buildBaseSessionEnv(
	extra?: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {};

	// Forward PATH
	if (process.env.PATH) {
		env.PATH = process.env.PATH;
	}

	// Forward auth credentials — callers are expected to also set
	// CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 (conditionally, based on sandbox
	// requirements) to prevent these from leaking into Bash subprocesses.
	for (const key of AUTH_ENV_KEYS) {
		if (process.env[key]) {
			env[key] = process.env[key];
		}
	}

	return {
		...env,
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
