import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SdkPluginConfig } from "cyrus-claude-runner";
import type { ILogger } from "cyrus-core";

/**
 * Session context used to evaluate per-skill scope restrictions. Each dimension
 * is optional — when omitted, scopes that depend on that dimension cannot match
 * (e.g. a session with no `linearTeamId` will not see skills scoped to a team).
 */
export interface SkillSessionContext {
	repositoryId?: string;
	linearTeamId?: string;
	linearLabelIds?: string[];
	/**
	 * Working-tree paths of the repositories participating in this session.
	 * Each repo's `<repoPath>/.claude/skills/*` directory names are unioned into
	 * the resolved skill whitelist so a repo can ship its own skills. Carries one
	 * path for single-repo / GitHub-mention sessions and every participating
	 * worktree for multi-repo sessions.
	 */
	repoPaths?: string[];
}

/**
 * Scope persisted alongside a user skill as `scope.json`. Mirrors the optional
 * fields on `UpdateSkillPayload` in `cyrus-config-updater`.
 */
interface SkillScope {
	repositoryIds?: string[];
	linearTeamIds?: string[];
	linearLabelIds?: string[];
}

/**
 * Resolves skills plugins for agent sessions.
 *
 * Three plugin sources are supported:
 * 1. Internal plugin — default Cyrus workflow skills deployed to ~/.cyrus/cyrus-skills-plugin/
 *    (editable by the user)
 * 2. User skills plugin — custom skills managed by the CYHOST UI at ~/.cyrus/user-skills-plugin/
 * 3. External plugins — full Claude Code plugins (skills, agents, commands) dropped
 *    into ~/.cyrus/plugins/<name>/, each identified by its own
 *    .claude-plugin/plugin.json manifest. A directory entry may be a symlink to a
 *    plugin repo cloned elsewhere on the host.
 *
 * All live outside the repository so they are never committed to the user's repo.
 *
 * Plugin ordering: user plugin, then external plugins (alphabetical), then the
 * internal plugin, so user-defined skills take precedence over external ones and
 * both take precedence over internal skills with the same name.
 */
export class SkillsPluginResolver {
	private readonly internalPluginPath: string;
	private readonly userPluginPath: string;
	private readonly userSkillsDir: string;
	private readonly externalPluginsDir: string;

	constructor(
		private readonly cyrusHome: string,
		private readonly logger: ILogger,
	) {
		this.internalPluginPath = join(this.cyrusHome, "cyrus-skills-plugin");
		this.userPluginPath = join(this.cyrusHome, "user-skills-plugin");
		this.userSkillsDir = join(this.userPluginPath, "skills");
		this.externalPluginsDir = join(this.cyrusHome, "plugins");
	}

	/**
	 * Ensure the user-skills plugin layout exists on disk.
	 *
	 * Called from EdgeWorker startup — idempotent check-and-create so the
	 * plugin is always ready before the first skill is synced, mirroring the
	 * pattern used for other Cyrus-managed directories (repos, worktrees,
	 * mcp-configs in `Application.ensureRequiredDirectories()`).
	 *
	 * Creates, if missing:
	 *   ~/.cyrus/user-skills-plugin/
	 *   ~/.cyrus/user-skills-plugin/skills/
	 *   ~/.cyrus/user-skills-plugin/.claude-plugin/plugin.json
	 *
	 * The manifest file is what the Claude Agent SDK uses to identify the
	 * directory as a plugin — without it, even a populated `skills/` tree is
	 * silently ignored by the SDK's plugin loader.
	 *
	 * Separated from resolve() to maintain Command-Query Separation:
	 * this method writes to the filesystem, resolve() only reads.
	 */
	async ensureUserPluginScaffolded(): Promise<void> {
		// Always ensure the skills directory exists — handlers/skills.ts also
		// mkdir's it recursively per-skill, but creating it eagerly here means
		// the layout is consistent even before the first sync.
		await mkdir(this.userSkillsDir, { recursive: true });

		const manifestDir = join(this.userPluginPath, ".claude-plugin");
		const manifestPath = join(manifestDir, "plugin.json");
		if (await this.exists(manifestPath)) {
			return;
		}

		await mkdir(manifestDir, { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify(
				{
					name: "user-skills",
					description: "User-created skills managed by Cyrus",
				},
				null,
				"\t",
			),
		);
		this.logger.info(
			`Scaffolded user-skills plugin manifest at ${manifestPath}`,
		);
	}

	/**
	 * Resolve all available skills plugins (user + internal).
	 *
	 * User plugin is listed first so user-defined skills take precedence
	 * over internal skills with the same name.
	 *
	 * Pure query — no filesystem side effects.
	 */
	async resolve(): Promise<SdkPluginConfig[]> {
		const plugins: SdkPluginConfig[] = [];

		// User plugin first — user skills override external and internal skills
		const user = await this.resolveUserPlugin();
		if (user) {
			plugins.push(user);
		}

		plugins.push(...(await this.resolveExternalPlugins()));

		const internal = await this.resolveInternalPlugin();
		if (internal) {
			plugins.push(internal);
		}

		await this.logConflicts(plugins);

		return plugins;
	}

	/**
	 * Discover all available skill names from the given plugin configs,
	 * optionally filtered by per-skill scope sidecars (scope.json) using the
	 * provided session context.
	 *
	 * Reads the `skills/` subdirectory of each plugin path and returns
	 * deduplicated skill names (user skills shadow internal ones due to
	 * insertion order of the Set).
	 *
	 * Filtering rules:
	 * - A skill with no `scope.json` (or an empty scope) is always available.
	 * - A skill with a populated scope is available only when every populated
	 *   dimension matches the session context (AND across dimensions, OR
	 *   within each list).
	 * - When `context` is omitted, no filtering is applied (all skills returned).
	 *
	 * Repo-local skills: when `context.repoPaths` is provided, each
	 * `<repoPath>/.claude/skills/*` directory name is also unioned in. These are
	 * implicitly scoped to the repository by virtue of living in it, so the
	 * `scope.json` filter is NOT applied to them. They are appended after the
	 * plugin skills, so a plugin skill of the same name takes precedence in the
	 * (display-order-sensitive) dedup.
	 */
	async discoverSkillNames(
		plugins: SdkPluginConfig[],
		context?: SkillSessionContext,
	): Promise<string[]> {
		const skillNames: string[] = [];

		for (const plugin of plugins) {
			const skillsDir = join(plugin.path, "skills");
			const entries = await this.readSkillDirEntries(skillsDir);

			for (const entry of entries) {
				if (context) {
					const scope = await this.loadSkillScope(skillsDir, entry);
					if (!this.scopeMatches(scope, context)) {
						this.logger.debug(
							`Skill "${entry}" excluded by scope filter for current session`,
						);
						continue;
					}
				}

				skillNames.push(entry);
			}
		}

		// Union repo-local skills shipped in each participating repo's working
		// tree. No scope.json filtering — presence in the repo is the scope.
		for (const repoPath of context?.repoPaths ?? []) {
			const skillsDir = join(repoPath, ".claude", "skills");
			const entries = await this.readSkillDirEntries(skillsDir);
			for (const entry of entries) {
				skillNames.push(entry);
			}
		}

		return [...new Set(skillNames)];
	}

	/**
	 * Read the immediate subdirectory (and symlink) names of a `skills/`
	 * directory. Returns an empty array when the directory is missing or
	 * unreadable, so callers can treat "no skills dir" as a no-op.
	 */
	private async readSkillDirEntries(skillsDir: string): Promise<string[]> {
		try {
			const entries = await readdir(skillsDir, { withFileTypes: true });
			return entries
				.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
				.map((entry) => entry.name);
		} catch {
			// Directory doesn't exist or isn't readable — skip
			return [];
		}
	}

	/**
	 * Read a skill's `scope.json` sidecar if present. Returns `null` when the
	 * sidecar is absent, empty, or unparseable — all of which mean "no scope
	 * restriction" (global skill).
	 */
	private async loadSkillScope(
		skillsDir: string,
		skillName: string,
	): Promise<SkillScope | null> {
		const scopePath = join(skillsDir, skillName, "scope.json");
		let raw: string;
		try {
			raw = await readFile(scopePath, "utf-8");
		} catch {
			return null;
		}

		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object") {
				return null;
			}
			const obj = parsed as Record<string, unknown>;
			const cleanList = (value: unknown): string[] | undefined => {
				if (!Array.isArray(value)) return undefined;
				const filtered = value.filter(
					(v): v is string => typeof v === "string" && v.length > 0,
				);
				return filtered.length > 0 ? filtered : undefined;
			};
			const scope: SkillScope = {};
			const repos = cleanList(obj.repositoryIds);
			const teams = cleanList(obj.linearTeamIds);
			const labels = cleanList(obj.linearLabelIds);
			if (repos) scope.repositoryIds = repos;
			if (teams) scope.linearTeamIds = teams;
			if (labels) scope.linearLabelIds = labels;
			if (
				!scope.repositoryIds &&
				!scope.linearTeamIds &&
				!scope.linearLabelIds
			) {
				return null;
			}
			return scope;
		} catch (error) {
			this.logger.warn(
				`Failed to parse scope.json for skill "${skillName}" — treating as global`,
				{ error: error instanceof Error ? error.message : String(error) },
			);
			return null;
		}
	}

	/**
	 * Evaluate scope against session context.
	 *
	 * A null/empty scope always matches. Otherwise every populated dimension
	 * on the scope must be satisfied by the session context (AND), where each
	 * dimension is satisfied when the context value is included in the
	 * configured list (OR within the dimension).
	 */
	private scopeMatches(
		scope: SkillScope | null,
		context: SkillSessionContext,
	): boolean {
		if (!scope) return true;

		if (scope.repositoryIds) {
			if (
				!context.repositoryId ||
				!scope.repositoryIds.includes(context.repositoryId)
			) {
				return false;
			}
		}

		if (scope.linearTeamIds) {
			if (
				!context.linearTeamId ||
				!scope.linearTeamIds.includes(context.linearTeamId)
			) {
				return false;
			}
		}

		if (scope.linearLabelIds) {
			const sessionLabels = context.linearLabelIds ?? [];
			if (
				sessionLabels.length === 0 ||
				!scope.linearLabelIds.some((id) => sessionLabels.includes(id))
			) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Build the skills guidance block appended to system prompts.
	 *
	 * Dynamically lists all available skills so that user-added custom
	 * skills appear in the guidance without code changes (OCP).
	 *
	 * Accepts pre-resolved plugins to avoid redundant filesystem access
	 * when resolve() is also called separately for the runner config.
	 */
	async buildSkillsGuidance(
		plugins?: SdkPluginConfig[],
		context?: SkillSessionContext,
	): Promise<string> {
		const resolvedPlugins = plugins ?? (await this.resolve());
		const availableSkills = await this.discoverSkillNames(
			resolvedPlugins,
			context,
		);

		if (availableSkills.length === 0) {
			return "";
		}

		const skillsList = availableSkills.map((s) => `\`${s}\``).join(", ");

		return (
			"\n\n## Skills\n\n" +
			`You have skills available via the Skill tool: ${skillsList}\n\n` +
			"Choose the appropriate skill based on the context:\n\n" +
			"- **Code changes requested** (feature, bug fix, refactor): Use `implementation` to write code, then `verify-and-ship` to run checks and create a PR, then `summarize` to narrate results.\n" +
			"- **Bug report or error**: Use `debug` to reproduce, root-cause, and fix, then `verify-and-ship`, then `summarize`.\n" +
			"- **Question or research request**: Use `investigate` to search the codebase and provide an answer, then `summarize`.\n" +
			"- **PR review feedback** (changes requested): Use `implementation` to address review comments, then `verify-and-ship`.\n\n" +
			"Analyze the issue description, labels, and any user comments to determine which workflow fits. " +
			"Do NOT skip the verify-and-ship step if you made code changes — it ensures quality checks pass and a PR is created."
		);
	}

	private async resolveInternalPlugin(): Promise<SdkPluginConfig | null> {
		if (await this.exists(this.internalPluginPath)) {
			this.logger.debug(
				`Using internal skills plugin at ${this.internalPluginPath}`,
			);
			return { type: "local", path: this.internalPluginPath };
		}
		this.logger.warn(
			`No internal skills plugin found at ${this.internalPluginPath}`,
		);
		return null;
	}

	/**
	 * Discover external plugins under `~/.cyrus/plugins/`.
	 *
	 * Each immediate subdirectory (or symlink) holding a
	 * `.claude-plugin/plugin.json` manifest is treated as a full local plugin —
	 * the SDK loads its skills, agents, and commands under the name declared in
	 * that manifest. Entries without a manifest are skipped with a warning so a
	 * half-copied plugin fails loudly rather than silently. Returned in
	 * alphabetical order for deterministic precedence.
	 */
	private async resolveExternalPlugins(): Promise<SdkPluginConfig[]> {
		let entries: string[];
		try {
			const dirents = await readdir(this.externalPluginsDir, {
				withFileTypes: true,
			});
			entries = dirents
				.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
				.map((entry) => entry.name)
				.sort();
		} catch {
			// ~/.cyrus/plugins/ doesn't exist — external plugins not in use
			return [];
		}

		const plugins: SdkPluginConfig[] = [];
		for (const name of entries) {
			const pluginPath = join(this.externalPluginsDir, name);
			const manifestPath = join(pluginPath, ".claude-plugin", "plugin.json");
			if (!(await this.exists(manifestPath))) {
				this.logger.warn(
					`Ignoring ${pluginPath}: no .claude-plugin/plugin.json manifest`,
				);
				continue;
			}
			this.logger.debug(`Using external plugin at ${pluginPath}`);
			plugins.push({ type: "local", path: pluginPath });
		}
		return plugins;
	}

	private async resolveUserPlugin(): Promise<SdkPluginConfig | null> {
		const manifestPath = join(
			this.userPluginPath,
			".claude-plugin",
			"plugin.json",
		);
		if (!(await this.exists(manifestPath))) {
			return null;
		}

		this.logger.debug(`Using user skills plugin at ${this.userPluginPath}`);
		return { type: "local", path: this.userPluginPath };
	}

	/**
	 * Detect and log skill name conflicts across plugins. Earlier plugins in
	 * the resolved order shadow later ones (user > external > internal).
	 */
	private async logConflicts(plugins: SdkPluginConfig[]): Promise<void> {
		if (plugins.length < 2) {
			return;
		}

		const seen = new Set<string>();
		for (const plugin of plugins) {
			const skillsDir = join(plugin.path, "skills");
			let names: string[] = [];
			try {
				const entries = await readdir(skillsDir, { withFileTypes: true });
				names = entries
					.filter((e) => e.isDirectory() || e.isSymbolicLink())
					.map((e) => e.name);
			} catch {
				// no skills dir — nothing to conflict
			}

			const conflicts = names.filter((s) => seen.has(s));
			if (conflicts.length > 0) {
				this.logger.info(
					`Skills in ${plugin.path} are shadowed by an earlier plugin: ${conflicts.join(", ")}`,
				);
			}
			for (const name of names) {
				seen.add(name);
			}
		}
	}

	private async exists(path: string): Promise<boolean> {
		try {
			await access(path);
			return true;
		} catch {
			return false;
		}
	}
}
