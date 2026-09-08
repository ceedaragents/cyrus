import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	type Dirent,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

interface CodexSkillSource {
	name: string;
	path: string;
}

/**
 * Structural subset of the SDK plugin config we read here. Typed locally to
 * avoid a direct dependency on the Claude Agent SDK from this package.
 */
interface LocalPluginLike {
	type?: string;
	path?: unknown;
}

/** Inputs the skill stager needs from a runner config. */
export interface SkillStagingInput {
	workingDirectory?: string;
	additionalDirectories?: string[];
	skills?: string[] | "all";
	plugins?: LocalPluginLike[];
}

/**
 * Stages managed + repo-local skills into Codex's native repository skill
 * discovery layout (`<workingDirectory>/.agents/skills/<name>` symlinks) before
 * a run, and removes them afterwards. Single responsibility: skill symlink
 * lifecycle. Holds no session state.
 */
export class CodexSkillStager {
	private stagedSkillPaths: string[] = [];
	private stagedSkillNames: string[] = [];

	constructor(private readonly input: SkillStagingInput) {}

	/** Names of skills currently staged (for the session init message). */
	getStagedSkillNames(): string[] {
		return [...this.stagedSkillNames];
	}

	/** Stage allowed skills as symlinks. Idempotent: clears prior staging first. */
	stage(): void {
		this.cleanup();

		const skillSources = this.discoverSkillSources();
		if (skillSources.length === 0) {
			return;
		}

		const skillsRoot = this.resolveManagedSkillsRoot();
		if (!skillsRoot) {
			return;
		}
		mkdirSync(skillsRoot, { recursive: true });
		this.ensureManagedSkillsIgnored();

		for (const source of skillSources) {
			const target = join(skillsRoot, source.name);
			if (!this.stageSkillDirectory(source, target)) {
				continue;
			}
			this.stagedSkillPaths.push(target);
			this.stagedSkillNames.push(source.name);
		}
	}

	/** Remove all staged skill symlinks. Best-effort; never throws. */
	cleanup(): void {
		for (const target of this.stagedSkillPaths) {
			try {
				if (this.isStagedSkillPath(target)) {
					rmSync(target, { recursive: true, force: true });
				}
			} catch {
				// Best-effort cleanup: never mask the session result.
			}
		}
		this.stagedSkillPaths = [];
		this.stagedSkillNames = [];
	}

	private discoverSkillSources(): CodexSkillSource[] {
		const configuredSkills = this.input.skills;
		const allowedSkillNames =
			Array.isArray(configuredSkills) && configuredSkills.length > 0
				? new Set(configuredSkills)
				: null;
		if (Array.isArray(configuredSkills) && configuredSkills.length === 0) {
			return [];
		}

		const sources: CodexSkillSource[] = [];
		const seen = new Set<string>();
		const addFromSkillsDirectory = (skillsDirectory: string): void => {
			for (const source of this.readSkillSources(skillsDirectory)) {
				if (allowedSkillNames && !allowedSkillNames.has(source.name)) {
					continue;
				}
				if (seen.has(source.name)) {
					continue;
				}
				seen.add(source.name);
				sources.push(source);
			}
		};

		for (const plugin of this.input.plugins ?? []) {
			if (plugin.type !== "local" || typeof plugin.path !== "string") {
				continue;
			}
			addFromSkillsDirectory(join(plugin.path, "skills"));
		}

		for (const directory of this.getRepoLocalSkillRoots()) {
			addFromSkillsDirectory(join(directory, ".claude", "skills"));
		}

		return sources;
	}

	private resolveManagedSkillsRoot(): string | undefined {
		const workingDirectory = this.input.workingDirectory;
		if (!workingDirectory) {
			return undefined;
		}
		return join(workingDirectory, ".agents", "skills");
	}

	private ensureManagedSkillsIgnored(): void {
		const workingDirectory = this.input.workingDirectory;
		if (!workingDirectory) {
			return;
		}

		try {
			const rawExcludePath = execFileSync(
				"git",
				["rev-parse", "--git-path", "info/exclude"],
				{
					cwd: workingDirectory,
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "ignore"],
				},
			).trim();
			if (!rawExcludePath) {
				return;
			}
			const excludePath = isAbsolute(rawExcludePath)
				? rawExcludePath
				: join(workingDirectory, rawExcludePath);

			mkdirSync(dirname(excludePath), { recursive: true });
			const existing = existsSync(excludePath)
				? readFileSync(excludePath, "utf-8")
				: "";
			if (existing.split(/\r?\n/).includes(".agents/")) {
				return;
			}

			const prefix =
				existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
			appendFileSync(excludePath, `${prefix}.agents/\n`);
		} catch {
			// Non-git chat workspaces and restricted git metadata are fine; cleanup
			// still removes staged symlinks, and the exclude is only for git hygiene.
		}
	}

	private getRepoLocalSkillRoots(): string[] {
		const roots = new Set<string>();
		if (this.input.workingDirectory) {
			roots.add(this.input.workingDirectory);
		}
		for (const directory of this.input.additionalDirectories ?? []) {
			if (directory) {
				roots.add(directory);
			}
		}
		return [...roots];
	}

	private readSkillSources(skillsDirectory: string): CodexSkillSource[] {
		let entries: Dirent[];
		try {
			entries = readdirSync(skillsDirectory, { withFileTypes: true });
		} catch {
			return [];
		}

		return entries
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => ({
				name: entry.name,
				path: join(skillsDirectory, entry.name),
			}))
			.filter((source) => existsSync(join(source.path, "SKILL.md")));
	}

	private stageSkillDirectory(
		source: CodexSkillSource,
		target: string,
	): boolean {
		if (existsSync(target)) {
			console.warn(
				`[CodexRunner] Skipping managed skill '${source.name}' because ${target} already exists`,
			);
			return false;
		}

		try {
			symlinkSync(source.path, target, "dir");
			return true;
		} catch (error) {
			console.warn(
				`[CodexRunner] Failed to stage managed skill '${source.name}' for Codex: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	private isStagedSkillPath(path: string): boolean {
		try {
			const stat = lstatSync(path);
			return stat.isDirectory() || stat.isSymbolicLink();
		} catch {
			return false;
		}
	}
}
