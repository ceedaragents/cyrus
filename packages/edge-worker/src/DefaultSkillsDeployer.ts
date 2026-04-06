import { access, cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ILogger } from "cyrus-core";

/**
 * Deploys bundled default skills to the cyrusHome directory.
 *
 * On first startup, copies all bundled skill directories from the package
 * into `~/.cyrus/cyrus-skills-plugin/skills/` so that users can inspect
 * and customize them. Subsequent startups skip the copy if the plugin
 * directory already exists.
 *
 * Single Responsibility: this class only handles the one-time deployment
 * of default skills from the package to the user's home directory.
 */
export class DefaultSkillsDeployer {
	private readonly bundledSkillsPath: string;
	private readonly bundledSkillsFallbackPath: string;
	private readonly deployedPluginPath: string;
	private readonly deployedSkillsPath: string;
	private readonly manifestDir: string;
	private readonly manifestPath: string;

	constructor(
		private readonly cyrusHome: string,
		private readonly logger: ILogger,
	) {
		// In production (dist/), skills are copied alongside the compiled JS by
		// the copy-prompts build step. In development (src/), the skills live at
		// the package root as symlinks. We resolve at construction time so
		// ensureDeployed() uses whichever path actually exists.
		const currentDir = dirname(fileURLToPath(import.meta.url));
		this.bundledSkillsPath = join(currentDir, "cyrus-skills-plugin", "skills");
		this.bundledSkillsFallbackPath = join(
			currentDir,
			"..",
			"cyrus-skills-plugin",
			"skills",
		);
		this.deployedPluginPath = join(this.cyrusHome, "cyrus-skills-plugin");
		this.deployedSkillsPath = join(this.deployedPluginPath, "skills");
		this.manifestDir = join(this.deployedPluginPath, ".claude-plugin");
		this.manifestPath = join(this.manifestDir, "plugin.json");
	}

	/**
	 * Ensure default skills are deployed to cyrusHome.
	 *
	 * If `~/.cyrus/cyrus-skills-plugin/` does not exist, creates it and
	 * copies all bundled skills into it. If it already exists, does nothing
	 * — the user may have customized the skills.
	 */
	async ensureDeployed(): Promise<void> {
		if (await this.exists(this.deployedPluginPath)) {
			this.logger.debug(
				`Default skills plugin already exists at ${this.deployedPluginPath}`,
			);
			return;
		}

		// Resolve the bundled skills source: prefer the sibling path (production
		// dist/ layout) and fall back to the parent path (development src/ layout).
		let sourcePath: string | undefined;
		if (await this.exists(this.bundledSkillsPath)) {
			sourcePath = this.bundledSkillsPath;
		} else if (await this.exists(this.bundledSkillsFallbackPath)) {
			sourcePath = this.bundledSkillsFallbackPath;
		}

		if (!sourcePath) {
			this.logger.warn(
				`Bundled skills not found at ${this.bundledSkillsPath} or ${this.bundledSkillsFallbackPath} — cannot deploy defaults`,
			);
			return;
		}

		// Create plugin directory structure
		await mkdir(this.deployedSkillsPath, { recursive: true });

		// Write plugin manifest
		await mkdir(this.manifestDir, { recursive: true });
		await writeFile(
			this.manifestPath,
			JSON.stringify(
				{
					name: "cyrus-skills",
					description: "Default Cyrus workflow skills for agent sessions",
				},
				null,
				"\t",
			),
		);

		// Copy each skill directory from bundled to deployed.
		// Entries may be directories or symlinks to directories (dev vs build).
		const entries = await readdir(sourcePath, {
			withFileTypes: true,
		});
		let deployedCount = 0;
		for (const entry of entries) {
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				const src = join(sourcePath, entry.name);
				const dest = join(this.deployedSkillsPath, entry.name);
				await cp(src, dest, { recursive: true, dereference: true });
				deployedCount++;
			}
		}

		this.logger.info(
			`Deployed default skills to ${this.deployedPluginPath} (${deployedCount} skills)`,
		);
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
