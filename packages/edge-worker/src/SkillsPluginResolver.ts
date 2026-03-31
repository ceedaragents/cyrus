import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SdkPluginConfig } from "cyrus-claude-runner";
import type { ILogger } from "cyrus-core";

/**
 * Resolves skills plugins for agent sessions.
 *
 * Two plugin sources are supported:
 * 1. Bundled plugin — default Cyrus workflow skills shipped with the package
 * 2. User skills plugin — custom skills managed by the CYHOST UI
 *
 * User skills live outside the repository (in ~/.cyrus/user-skills-plugin/)
 * so they are never committed to the user's repo.
 *
 * Plugin ordering: user plugin is loaded before bundled plugin so that
 * user-defined skills take precedence over bundled skills with the same name.
 */
export class SkillsPluginResolver {
	private readonly bundledPluginPath: string;
	private readonly userPluginPath: string;
	private readonly userSkillsDir: string;

	constructor(
		private readonly cyrusHome: string,
		private readonly logger: ILogger,
	) {
		this.bundledPluginPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"cyrus-skills-plugin",
		);
		this.userPluginPath = join(this.cyrusHome, "user-skills-plugin");
		this.userSkillsDir = join(this.userPluginPath, "skills");
	}

	/**
	 * Ensure the user skills plugin directory is properly initialized.
	 * Call once during EdgeWorker startup — NOT on every session.
	 *
	 * Separated from resolve() to maintain Command-Query Separation:
	 * this method writes to the filesystem, resolve() only reads.
	 */
	async ensureUserPluginScaffolded(): Promise<void> {
		if (!(await this.exists(this.userSkillsDir))) {
			return;
		}

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
			`Auto-scaffolded user skills plugin manifest at ${manifestPath}`,
		);
	}

	/**
	 * Resolve all available skills plugins (user + bundled).
	 *
	 * User plugin is listed first so user-defined skills take precedence
	 * over bundled skills with the same name.
	 *
	 * Pure query — no filesystem side effects.
	 */
	async resolve(): Promise<SdkPluginConfig[]> {
		const plugins: SdkPluginConfig[] = [];

		// User plugin first — user skills override bundled skills
		const user = await this.resolveUserPlugin();
		if (user) {
			plugins.push(user);
		}

		const bundled = await this.resolveBundledPlugin();
		if (bundled) {
			plugins.push(bundled);
		}

		await this.logConflicts(plugins);

		return plugins;
	}

	/**
	 * Discover all available skill names from the given plugin configs.
	 *
	 * Reads the `skills/` subdirectory of each plugin path and returns
	 * deduplicated skill names (user skills shadow bundled ones due to
	 * insertion order of the Set).
	 */
	async discoverSkillNames(plugins: SdkPluginConfig[]): Promise<string[]> {
		const skillNames: string[] = [];

		for (const plugin of plugins) {
			const skillsDir = join(plugin.path, "skills");
			try {
				const entries = await readdir(skillsDir, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isDirectory()) {
						skillNames.push(entry.name);
					}
				}
			} catch {
				// Plugin directory doesn't exist or isn't readable — skip
			}
		}

		return [...new Set(skillNames)];
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
	async buildSkillsGuidance(plugins?: SdkPluginConfig[]): Promise<string> {
		const resolvedPlugins = plugins ?? (await this.resolve());
		const availableSkills = await this.discoverSkillNames(resolvedPlugins);

		if (availableSkills.length === 0) {
			return "";
		}

		const skillsList = availableSkills.map((s) => `\`${s}\``).join(", ");

		return (
			"\n\n## Skills\n\n" +
			`You have skills available via the Skill tool: ${skillsList}\n\n` +
			"Choose the appropriate skill based on the context:\n\n" +
			"- **Code changes requested** (feature, bug fix, refactor): Use `implementation` to write code, then `verify-and-ship` to run checks and create a PR, then `summarize` to post results.\n" +
			"- **Bug report or error**: Use `debug` to reproduce, root-cause, and fix, then `verify-and-ship`, then `summarize`.\n" +
			"- **Question or research request**: Use `investigate` to search the codebase and provide an answer, then `summarize`.\n" +
			"- **PR review feedback** (changes requested): Use `implementation` to address review comments, then `verify-and-ship`.\n\n" +
			"Analyze the issue description, labels, and any user comments to determine which workflow fits. " +
			"Do NOT skip the verify-and-ship step if you made code changes — it ensures quality checks pass and a PR is created."
		);
	}

	private async resolveBundledPlugin(): Promise<SdkPluginConfig | null> {
		if (await this.exists(this.bundledPluginPath)) {
			this.logger.debug(
				`Using bundled skills plugin at ${this.bundledPluginPath}`,
			);
			return { type: "local", path: this.bundledPluginPath };
		}
		this.logger.warn(
			`No bundled skills plugin found at ${this.bundledPluginPath}`,
		);
		return null;
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
	 * Detect and log skill name conflicts between user and bundled plugins.
	 */
	private async logConflicts(plugins: SdkPluginConfig[]): Promise<void> {
		if (plugins.length < 2) {
			return;
		}

		const skillSets: string[][] = [];
		for (const plugin of plugins) {
			const skillsDir = join(plugin.path, "skills");
			try {
				const entries = await readdir(skillsDir, { withFileTypes: true });
				skillSets.push(
					entries.filter((e) => e.isDirectory()).map((e) => e.name),
				);
			} catch {
				skillSets.push([]);
			}
		}

		// First set is user, second is bundled — find overlap
		if (skillSets.length >= 2 && skillSets[0] && skillSets[1]) {
			const userSkills = new Set(skillSets[0]);
			const conflicts = skillSets[1].filter((s) => userSkills.has(s));
			if (conflicts.length > 0) {
				this.logger.info(
					`User skills override bundled skills: ${conflicts.join(", ")}`,
				);
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
