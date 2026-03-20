import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
	 * Resolve all available skills plugins (bundled + user).
	 */
	resolve(): SdkPluginConfig[] {
		const plugins: SdkPluginConfig[] = [];

		const bundled = this.resolveBundledPlugin();
		if (bundled) {
			plugins.push(bundled);
		}

		const user = this.resolveUserPlugin();
		if (user) {
			plugins.push(user);
		}

		return plugins;
	}

	private resolveBundledPlugin(): SdkPluginConfig | null {
		if (existsSync(this.bundledPluginPath)) {
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

	private resolveUserPlugin(): SdkPluginConfig | null {
		if (!existsSync(this.userSkillsDir)) {
			return null;
		}

		this.scaffoldManifestIfMissing();

		this.logger.debug(`Using user skills plugin at ${this.userPluginPath}`);
		return { type: "local", path: this.userPluginPath };
	}

	/**
	 * Auto-scaffold the `.claude-plugin/plugin.json` manifest if the
	 * user skills directory exists but the manifest is missing.
	 */
	private scaffoldManifestIfMissing(): void {
		const manifestDir = join(this.userPluginPath, ".claude-plugin");
		const manifestPath = join(manifestDir, "plugin.json");
		if (existsSync(manifestPath)) {
			return;
		}

		mkdirSync(manifestDir, { recursive: true });
		writeFileSync(
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
}

/**
 * Build the skills guidance block appended to system prompts.
 *
 * This is a standalone function so the guidance text can evolve
 * independently of the prompt-assembly logic.
 */
export function buildSkillsGuidance(): string {
	return (
		"\n\n## Skills\n\n" +
		"You have skills available via the Skill tool. Choose the appropriate skill based on the context:\n\n" +
		"- **Code changes requested** (feature, bug fix, refactor): Use `implementation` to write code, then `verify-and-ship` to run checks and create a PR, then `summarize` to post results.\n" +
		"- **Bug report or error**: Use `debug` to reproduce, root-cause, and fix, then `verify-and-ship`, then `summarize`.\n" +
		"- **Question or research request**: Use `investigate` to search the codebase and provide an answer, then `summarize`.\n" +
		"- **PR review feedback** (changes requested): Use `implementation` to address review comments, then `verify-and-ship`.\n\n" +
		"Analyze the issue description, labels, and any user comments to determine which workflow fits. " +
		"Do NOT skip the verify-and-ship step if you made code changes — it ensures quality checks pass and a PR is created."
	);
}
