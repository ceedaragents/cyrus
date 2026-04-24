import { z } from "zod";

/**
 * Sandbox filesystem permissions for an environment.
 *
 * Maps to the subset of `@anthropic-ai/claude-agent-sdk` SandboxSettings
 * that are safe to persist in a JSON file (no callbacks, no runtime objects).
 */
const EnvironmentSandboxSchema = z.object({
	enabled: z.boolean().optional(),
	filesystem: z
		.object({
			allowRead: z.array(z.string()).optional(),
			denyRead: z.array(z.string()).optional(),
			allowWrite: z.array(z.string()).optional(),
			denyWrite: z.array(z.string()).optional(),
		})
		.optional(),
});

/**
 * Minimal plugin reference (path on disk). Matches the `{ type: "local", path }`
 * shape used by `SdkPluginConfig` in the Claude Agent SDK.
 */
const EnvironmentPluginSchema = z.object({
	type: z.literal("local").optional(),
	path: z.string(),
});

/**
 * Environment config — a scoped, bindable bundle of prompt, tools,
 * permissions, and resources for an agent session.
 *
 * Stored as JSON at `<cyrusHome>/environments/<name>.json`.
 * Referenced from a Linear issue description via `env=<name>` or `[env=<name>]`.
 * Once a session is bound to an environment, the binding persists across
 * restarts via `CyrusAgentSession.environmentName`.
 */
export const EnvironmentConfigSchema = z.object({
	/** Optional display name. Defaults to the filename stem. */
	name: z.string().optional(),

	/** Freeform human description. */
	description: z.string().optional(),

	/**
	 * System prompt appended to the agent's base prompt. Overrides the
	 * label-derived system prompt when set.
	 */
	systemPrompt: z.string().optional(),

	/**
	 * Path to a text file whose contents are used as the appended system
	 * prompt. Convenience alternative to inlining a large prompt into JSON.
	 * Ignored when `systemPrompt` is also set.
	 */
	systemPromptPath: z.string().optional(),

	/**
	 * Tool allowlist. When set, overrides the repository-level
	 * `allowedTools` for the session. Supports Claude tool names
	 * (`Read`, `Bash(...)`, etc.) and MCP tool identifiers (`mcp__<server>__<tool>`).
	 */
	allowedTools: z.array(z.string()).optional(),

	/** Tool denylist. When set, overrides the repository-level `disallowedTools`. */
	disallowedTools: z.array(z.string()).optional(),

	/**
	 * Path (or list of paths) to MCP server config files to merge into the
	 * session. When set, replaces the repository's `mcpConfigPath` for the
	 * duration of the session.
	 */
	mcpConfigPath: z.union([z.string(), z.array(z.string())]).optional(),

	/**
	 * Sandbox filesystem permissions overrides. Shallow-merged with the
	 * global sandbox settings from EdgeConfig.
	 */
	sandbox: EnvironmentSandboxSchema.optional(),

	/**
	 * Plugin references (path-based). Replaces the auto-discovered skill
	 * plugins for the session when set (empty array disables plugins).
	 */
	plugins: z.array(EnvironmentPluginSchema).optional(),

	/**
	 * Additional skill directories to surface as plugins. Each entry is
	 * normalized into a plugin reference when the environment is applied.
	 */
	skills: z.array(z.string()).optional(),

	/**
	 * Repository IDs whose on-disk paths should be granted read access for
	 * this session. Each ID is looked up in the configured repositories
	 * and the repository's `repositoryPath` (typically under
	 * `~/.cyrus/repos/`) is added to the session's `allowedDirectories`.
	 * Unknown IDs are silently skipped. Does not create worktrees — use
	 * `gitWorktrees` for that.
	 */
	repositories: z.array(z.string()).optional(),

	/**
	 * Repository IDs for which git worktrees should be created when the
	 * session starts. Zero or more entries.
	 *
	 * - 0 entries (`[]`): a plain workspace folder is created with no
	 *   worktree (useful for research/read-only sessions).
	 * - 1 entry: a single git worktree is created at the repository's
	 *   workspace base dir (current single-repo behavior).
	 * - 2+ entries: a parent folder containing per-repo worktree subdirs
	 *   is created (existing multi-repo workspace behavior).
	 *
	 * When omitted, the routed repositories (from description tags,
	 * labels, projects, or teams) are used — preserving current behavior.
	 * Unknown IDs are silently skipped.
	 */
	gitWorktrees: z.array(z.string()).optional(),
});

export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
