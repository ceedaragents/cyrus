import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillLoader } from "../../src/skills/SkillLoader.js";

const createMockLogger = () => ({
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	withContext: vi.fn().mockReturnThis(),
	getLevel: vi.fn().mockReturnValue(0),
	setLevel: vi.fn(),
});

describe("SkillLoader", () => {
	let loader: SkillLoader;
	let testDir: string;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(async () => {
		logger = createMockLogger();
		loader = new SkillLoader(logger);
		testDir = join(tmpdir(), `skill-loader-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("loads a skill with basic frontmatter", async () => {
		const skillDir = join(testDir, "google");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: google
description: Search the web for information.
allowed-tools: WebSearch, WebFetch
---
# Google

Search the web for information.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			name: "google",
			description: "Search the web for information.",
			allowedTools: ["WebSearch", "WebFetch"],
			routing: { strategy: "always" },
			instructions: expect.stringContaining("# Google"),
		});
	});

	it("loads a skill with routing configuration", async () => {
		const skillDir = join(testDir, "security");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: security-review
description: Security code review skill.
allowed-tools: Read, Grep, Glob
routing: label
routing-labels: security, review, audit
---
# Security Review

Review code for security issues.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			name: "security-review",
			description: "Security code review skill.",
			allowedTools: ["Read", "Grep", "Glob"],
			routing: {
				strategy: "label",
				labels: ["security", "review", "audit"],
			},
		});
	});

	it("loads multiple skills from directory", async () => {
		// Skill 1
		const skill1Dir = join(testDir, "google");
		await mkdir(skill1Dir, { recursive: true });
		await writeFile(
			join(skill1Dir, "SKILL.md"),
			`---
name: google
description: Web search.
---
Search the web.
`,
		);

		// Skill 2
		const skill2Dir = join(testDir, "deploy");
		await mkdir(skill2Dir, { recursive: true });
		await writeFile(
			join(skill2Dir, "SKILL.md"),
			`---
name: deploy
description: Deployment skill.
routing: team
routing-teams: CYPACK, CYHOST
---
Deploy to production.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(2);
		const names = skills.map((s) => s.name).sort();
		expect(names).toEqual(["deploy", "google"]);
	});

	it("skips directories without SKILL.md", async () => {
		const emptyDir = join(testDir, "no-skill-here");
		await mkdir(emptyDir, { recursive: true });

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(0);
	});

	it("returns empty array for non-existent directory", async () => {
		const skills = await loader.loadSkills("/non/existent/path");

		expect(skills).toHaveLength(0);
		expect(logger.debug).toHaveBeenCalledWith(
			expect.stringContaining("not found"),
		);
	});

	it("skips skills without name in frontmatter", async () => {
		const skillDir = join(testDir, "bad-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
description: No name field
---
Missing name.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Missing 'name'"),
		);
	});

	it("skips files without frontmatter", async () => {
		const skillDir = join(testDir, "no-frontmatter");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`# Just a regular markdown file
No frontmatter here.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(0);
	});

	it("defaults to 'always' strategy for unknown routing value", async () => {
		const skillDir = join(testDir, "bad-routing");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: test
description: Test skill.
routing: unknown_strategy
---
Test.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(1);
		expect(skills[0]?.routing.strategy).toBe("always");
	});

	it("parses keyword routing strategy", async () => {
		const skillDir = join(testDir, "keyword-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: perf
description: Performance optimization.
routing: keyword
routing-keywords: performance, optimization, speed
---
Optimize performance.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			routing: {
				strategy: "keyword",
				keywords: ["performance", "optimization", "speed"],
			},
		});
	});

	it("parses repository routing strategy", async () => {
		const skillDir = join(testDir, "repo-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: repo-specific
description: Only for specific repos.
routing: repository
routing-repositories: cyrus, cyrus-hosted
---
Repo-specific instructions.
`,
		);

		const skills = await loader.loadSkills(testDir);

		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			routing: {
				strategy: "repository",
				repositories: ["cyrus", "cyrus-hosted"],
			},
		});
	});

	describe("parseSkillFile", () => {
		it("handles empty instructions body", () => {
			const result = loader.parseSkillFile(
				`---
name: minimal
description: Minimal skill.
---
`,
				"/test/SKILL.md",
			);

			expect(result).toMatchObject({
				name: "minimal",
				description: "Minimal skill.",
				instructions: "",
			});
		});

		it("preserves sourcePath", () => {
			const path = "/home/user/.cyrus/skills/test/SKILL.md";
			const result = loader.parseSkillFile(
				`---
name: test
description: Test.
---
Content.
`,
				path,
			);

			expect(result?.sourcePath).toBe(path);
		});
	});
});
