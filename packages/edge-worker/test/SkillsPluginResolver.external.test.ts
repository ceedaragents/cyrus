import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ILogger } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillsPluginResolver } from "../src/SkillsPluginResolver.js";

function createTestLogger(): ILogger {
	return {
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
		withContext: () => createTestLogger(),
	} as unknown as ILogger;
}

async function writeUserPluginManifest(cyrusHome: string): Promise<void> {
	const manifestDir = join(cyrusHome, "user-skills-plugin", ".claude-plugin");
	await mkdir(manifestDir, { recursive: true });
	await writeFile(
		join(manifestDir, "plugin.json"),
		JSON.stringify({ name: "user-skills", description: "" }),
		"utf-8",
	);
}

async function writeSkill(pluginRoot: string, name: string): Promise<void> {
	const skillDir = join(pluginRoot, "skills", name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		join(skillDir, "SKILL.md"),
		`---\nname: ${name}\ndescription: test ${name}\n---\n\nbody\n`,
		"utf-8",
	);
}

/**
 * Create an external plugin at `<cyrusHome>/plugins/<dirName>` with a
 * `.claude-plugin/plugin.json` manifest, unless `withManifest` is false.
 */
async function writeExternalPlugin(
	cyrusHome: string,
	dirName: string,
	options: { withManifest?: boolean; skills?: string[] } = {},
): Promise<string> {
	const { withManifest = true, skills = [] } = options;
	const pluginRoot = join(cyrusHome, "plugins", dirName);
	await mkdir(pluginRoot, { recursive: true });
	if (withManifest) {
		const manifestDir = join(pluginRoot, ".claude-plugin");
		await mkdir(manifestDir, { recursive: true });
		await writeFile(
			join(manifestDir, "plugin.json"),
			JSON.stringify({ name: dirName, description: `test ${dirName}` }),
			"utf-8",
		);
	}
	for (const skill of skills) {
		await writeSkill(pluginRoot, skill);
	}
	return pluginRoot;
}

describe("SkillsPluginResolver external plugin discovery", () => {
	let home: string;
	let outside: string;
	let resolver: SkillsPluginResolver;

	beforeEach(async () => {
		const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		home = join(tmpdir(), `cyrus-external-home-${stamp}`);
		outside = join(tmpdir(), `cyrus-external-outside-${stamp}`);
		await mkdir(home, { recursive: true });
		await mkdir(outside, { recursive: true });
		resolver = new SkillsPluginResolver(home, createTestLogger());
	});

	afterEach(async () => {
		for (const dir of [home, outside]) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("resolves plugins from ~/.cyrus/plugins that carry a manifest", async () => {
		const pluginRoot = await writeExternalPlugin(home, "sesai", {
			skills: ["plan-writing"],
		});

		const plugins = await resolver.resolve();

		expect(plugins.map((p) => p.path)).toContain(pluginRoot);
	});

	it("includes external plugin skills in the discovered skill names", async () => {
		await writeExternalPlugin(home, "sesai", {
			skills: ["plan-writing", "linear-workflow"],
		});

		const plugins = await resolver.resolve();
		const names = await resolver.discoverSkillNames(plugins, {
			repositoryId: "repo-a",
		});

		expect(names).toContain("plan-writing");
		expect(names).toContain("linear-workflow");
	});

	it("skips directories without a plugin manifest", async () => {
		const pluginRoot = await writeExternalPlugin(home, "half-copied", {
			withManifest: false,
			skills: ["orphan-skill"],
		});

		const plugins = await resolver.resolve();
		const names = await resolver.discoverSkillNames(plugins);

		expect(plugins.map((p) => p.path)).not.toContain(pluginRoot);
		expect(names).not.toContain("orphan-skill");
	});

	it("resolves no external plugins when ~/.cyrus/plugins is absent", async () => {
		const plugins = await resolver.resolve();

		expect(plugins).toEqual([]);
	});

	it("follows a symlinked plugin directory", async () => {
		const realRoot = join(outside, "sesai-clone");
		await mkdir(join(realRoot, ".claude-plugin"), { recursive: true });
		await writeFile(
			join(realRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "sesai", description: "" }),
			"utf-8",
		);
		await writeSkill(realRoot, "plan-writing");
		await mkdir(join(home, "plugins"), { recursive: true });
		await symlink(realRoot, join(home, "plugins", "sesai"));

		const plugins = await resolver.resolve();
		const names = await resolver.discoverSkillNames(plugins);

		expect(names).toContain("plan-writing");
	});

	it("orders plugins user, then external alphabetically, then internal", async () => {
		await writeUserPluginManifest(home);
		await writeExternalPlugin(home, "zeta");
		await writeExternalPlugin(home, "alpha");

		const plugins = await resolver.resolve();

		expect(plugins.map((p) => p.path)).toEqual([
			join(home, "user-skills-plugin"),
			join(home, "plugins", "alpha"),
			join(home, "plugins", "zeta"),
		]);
	});
});
