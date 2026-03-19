import { readdir, readFile, stat } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillLoader } from "../../src/skills/SkillLoader.js";

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	readdir: vi.fn(),
	stat: vi.fn(),
}));

const mockStat = vi.mocked(stat);
const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);

describe("SkillLoader", () => {
	const mockLogger: any = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		withContext: vi.fn().mockReturnThis(),
		getLevel: vi.fn(),
		setLevel: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("parseSkillFile (via loadDefaultSkills)", () => {
		it("extracts name from filename by stripping .md extension", async () => {
			const loader = new SkillLoader(mockLogger);

			// Mock the default skills directory to exist
			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValue(["verify-and-ship.md"] as any);
			mockReadFile.mockResolvedValue(
				"# Verify and Ship\n\nRun all quality checks.",
			);

			const skills = await loader.loadDefaultSkills();

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("verify-and-ship");
		});

		it("extracts description from first markdown heading", async () => {
			const loader = new SkillLoader(mockLogger);

			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValue(["implementation.md"] as any);
			mockReadFile.mockResolvedValue(
				"# Implementation Guide\n\nFollow these steps to implement changes.",
			);

			const skills = await loader.loadDefaultSkills();

			expect(skills).toHaveLength(1);
			expect(skills[0].description).toBe("Implementation Guide");
		});

		it("falls back to filename as description when no heading exists", async () => {
			const loader = new SkillLoader(mockLogger);

			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValue(["summarize.md"] as any);
			mockReadFile.mockResolvedValue(
				"No heading here, just content about summarizing.",
			);

			const skills = await loader.loadDefaultSkills();

			expect(skills).toHaveLength(1);
			expect(skills[0].description).toBe("summarize");
		});

		it("preserves the full content of the skill file", async () => {
			const loader = new SkillLoader(mockLogger);
			const content =
				"# My Skill\n\nDetailed instructions for the skill.\n\n## Steps\n\n1. Do this\n2. Do that";

			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValue(["my-skill.md"] as any);
			mockReadFile.mockResolvedValue(content);

			const skills = await loader.loadDefaultSkills();

			expect(skills[0].content).toBe(content);
		});

		it("sets the correct source for each skill origin", async () => {
			const loader = new SkillLoader(mockLogger);

			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValue(["skill-a.md"] as any);
			mockReadFile.mockResolvedValue("# Skill A\n\nContent");

			const defaultSkills = await loader.loadDefaultSkills();
			expect(defaultSkills[0].source).toBe("default");

			const globalSkills = await loader.loadGlobalSkills("/home/user/.cyrus");
			expect(globalSkills[0].source).toBe("global");

			const repoSkills = await loader.loadRepositorySkills("/repo");
			// Repository skills are loaded from two dirs; with our mock both return the same
			expect(repoSkills.length).toBeGreaterThanOrEqual(1);
			expect(repoSkills[0].source).toBe("repository");
		});
	});

	describe("loadSkillsFromDirectory", () => {
		it("returns empty array for non-existent directory", async () => {
			const loader = new SkillLoader(mockLogger);

			// stat throws when directory doesn't exist
			mockStat.mockRejectedValue(
				new Error("ENOENT: no such file or directory"),
			);

			const skills = await loader.loadGlobalSkills(
				"/home/user/.cyrus-nonexistent",
			);

			expect(skills).toEqual([]);
		});

		it("returns empty array when path is not a directory", async () => {
			const loader = new SkillLoader(mockLogger);

			mockStat.mockResolvedValue({ isDirectory: () => false } as any);

			const skills = await loader.loadGlobalSkills("/home/user/.cyrus");

			expect(skills).toEqual([]);
		});

		it("only loads .md files, ignoring other file types", async () => {
			const loader = new SkillLoader(mockLogger);

			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValue([
				"skill-a.md",
				"skill-b.txt",
				"skill-c.md",
				"README",
				".gitkeep",
			] as any);
			mockReadFile.mockResolvedValue("# Skill\n\nContent");

			const skills = await loader.loadGlobalSkills("/home/user/.cyrus");

			expect(skills).toHaveLength(2);
			expect(skills.map((s) => s.name)).toEqual(["skill-a", "skill-c"]);
		});

		it("warns when a skill file fails to read", async () => {
			const loader = new SkillLoader(mockLogger);

			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValue(["good.md", "broken.md"] as any);
			mockReadFile.mockImplementation(async (path: any) => {
				if (String(path).includes("broken")) {
					throw new Error("EACCES: permission denied");
				}
				return "# Good Skill\n\nContent";
			});

			const skills = await loader.loadGlobalSkills("/home/user/.cyrus");

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("good");
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("broken.md"),
			);
		});

		it("works without a logger", async () => {
			const loader = new SkillLoader(); // no logger

			mockStat.mockRejectedValue(new Error("ENOENT"));

			// Should not throw even without logger
			const skills = await loader.loadGlobalSkills("/nonexistent");
			expect(skills).toEqual([]);
		});
	});

	describe("loadRepositorySkills", () => {
		it("merges skills from .claude/skills/ and skills/, with .claude taking precedence", async () => {
			const loader = new SkillLoader(mockLogger);

			// We need to handle different directories
			const _callIndex = 0;
			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockImplementation(async (dirPath: any) => {
				const path = String(dirPath);
				if (path.includes(".claude/skills")) {
					return ["shared.md", "claude-only.md"] as any;
				}
				if (path.endsWith("/skills")) {
					return ["shared.md", "root-only.md"] as any;
				}
				return [] as any;
			});
			mockReadFile.mockImplementation(async (filePath: any) => {
				const path = String(filePath);
				if (path.includes(".claude/skills/shared.md")) {
					return "# Shared (from .claude)\n\nClaude version";
				}
				if (path.includes(".claude/skills/claude-only.md")) {
					return "# Claude Only\n\nClaude-only skill";
				}
				if (path.includes("skills/shared.md")) {
					return "# Shared (from root)\n\nRoot version";
				}
				if (path.includes("skills/root-only.md")) {
					return "# Root Only\n\nRoot-only skill";
				}
				return "";
			});

			const skills = await loader.loadRepositorySkills("/repo");

			// Should have 3 skills: shared (from .claude), claude-only, root-only
			expect(skills).toHaveLength(3);

			const sharedSkill = skills.find((s) => s.name === "shared");
			expect(sharedSkill?.description).toBe("Shared (from .claude)");

			const claudeOnly = skills.find((s) => s.name === "claude-only");
			expect(claudeOnly).toBeDefined();

			const rootOnly = skills.find((s) => s.name === "root-only");
			expect(rootOnly).toBeDefined();
		});
	});

	describe("resolveSkills", () => {
		/**
		 * Helper: configure mocks so each directory returns specific skill files.
		 */
		function setupSkillSources(sources: {
			default?: Record<string, string>;
			global?: Record<string, string>;
			repo?: Record<string, string>;
		}) {
			mockStat.mockResolvedValue({ isDirectory: () => true } as any);
			mockReaddir.mockImplementation(async (dirPath: any) => {
				const path = String(dirPath);
				if (path.includes("prompts/skills") && sources.default) {
					return Object.keys(sources.default).map((n) => `${n}.md`) as any;
				}
				if (
					path.includes(".cyrus/skills") &&
					!path.includes(".claude") &&
					sources.global
				) {
					return Object.keys(sources.global).map((n) => `${n}.md`) as any;
				}
				if (
					(path.includes(".claude/skills") || path.endsWith("/skills")) &&
					sources.repo
				) {
					return Object.keys(sources.repo).map((n) => `${n}.md`) as any;
				}
				return [] as any;
			});
			mockReadFile.mockImplementation(async (filePath: any) => {
				const path = String(filePath);
				const filename = path.split("/").pop()?.replace(".md", "") ?? "";

				if (path.includes("prompts/skills") && sources.default?.[filename]) {
					return sources.default[filename];
				}
				if (
					path.includes(".cyrus/skills") &&
					!path.includes(".claude") &&
					sources.global?.[filename]
				) {
					return sources.global[filename];
				}
				if (sources.repo?.[filename]) {
					return sources.repo[filename];
				}
				return "";
			});
		}

		it("resolves skills with priority: repository > global > default", async () => {
			const loader = new SkillLoader(mockLogger);

			setupSkillSources({
				default: { implementation: "# Default Implementation\n\nDefault" },
				global: { implementation: "# Global Implementation\n\nGlobal" },
				repo: { implementation: "# Repo Implementation\n\nRepo" },
			});

			const resolved = await loader.resolveSkills(
				["implementation"],
				"/repo",
				"/home/user/.cyrus",
			);

			expect(resolved).toHaveLength(1);
			// Repository should win
			expect(resolved[0].description).toBe("Repo Implementation");
			expect(resolved[0].source).toBe("repository");
		});

		it("falls back to global when no repository skill exists", async () => {
			const loader = new SkillLoader(mockLogger);

			setupSkillSources({
				default: { implementation: "# Default Impl\n\nDefault" },
				global: { implementation: "# Global Impl\n\nGlobal" },
			});

			const resolved = await loader.resolveSkills(
				["implementation"],
				"/repo",
				"/home/user/.cyrus",
			);

			expect(resolved).toHaveLength(1);
			expect(resolved[0].description).toBe("Global Impl");
			expect(resolved[0].source).toBe("global");
		});

		it("falls back to default when no global or repository skill exists", async () => {
			const loader = new SkillLoader(mockLogger);

			setupSkillSources({
				default: { implementation: "# Default Impl\n\nDefault" },
			});

			const resolved = await loader.resolveSkills(
				["implementation"],
				"/repo",
				"/home/user/.cyrus",
			);

			expect(resolved).toHaveLength(1);
			expect(resolved[0].description).toBe("Default Impl");
			expect(resolved[0].source).toBe("default");
		});

		it("returns skills in the specified order", async () => {
			const loader = new SkillLoader(mockLogger);

			setupSkillSources({
				default: {
					summarize: "# Summarize\n\nSummarize content",
					implementation: "# Implementation\n\nImplement changes",
					"verify-and-ship": "# Verify and Ship\n\nRun quality checks",
				},
			});

			const resolved = await loader.resolveSkills(
				["verify-and-ship", "implementation", "summarize"],
				"/repo",
				"/home/user/.cyrus",
			);

			expect(resolved).toHaveLength(3);
			expect(resolved[0].name).toBe("verify-and-ship");
			expect(resolved[1].name).toBe("implementation");
			expect(resolved[2].name).toBe("summarize");
		});

		it("warns about missing skills and excludes them from results", async () => {
			const loader = new SkillLoader(mockLogger);

			setupSkillSources({
				default: {
					implementation: "# Implementation\n\nContent",
				},
			});

			const resolved = await loader.resolveSkills(
				["implementation", "nonexistent-skill"],
				"/repo",
				"/home/user/.cyrus",
			);

			expect(resolved).toHaveLength(1);
			expect(resolved[0].name).toBe("implementation");
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("nonexistent-skill"),
			);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("not found in any source"),
			);
		});

		it("returns empty array when all requested skills are missing", async () => {
			const loader = new SkillLoader(mockLogger);

			// No skills in any directory
			mockStat.mockRejectedValue(new Error("ENOENT"));

			const resolved = await loader.resolveSkills(
				["missing-a", "missing-b"],
				"/repo",
				"/home/user/.cyrus",
			);

			expect(resolved).toEqual([]);
			expect(mockLogger.warn).toHaveBeenCalledTimes(2);
		});

		it("returns empty array when given empty skillNames", async () => {
			const loader = new SkillLoader(mockLogger);

			setupSkillSources({
				default: { implementation: "# Implementation\n\nContent" },
			});

			const resolved = await loader.resolveSkills(
				[],
				"/repo",
				"/home/user/.cyrus",
			);

			expect(resolved).toEqual([]);
		});
	});

	describe("assembleSkillPrompt", () => {
		it("wraps each skill in <skill> XML tags", () => {
			const loader = new SkillLoader(mockLogger);

			const prompt = loader.assembleSkillPrompt(
				[
					{
						name: "implementation",
						description: "Implementation Guide",
						content: "# Implementation Guide\n\nDo the work.",
						source: "default",
					},
				],
				"## Workflow\n\n1. Implement\n2. Ship",
			);

			expect(prompt).toContain('<skill name="implementation">');
			expect(prompt).toContain("# Implementation Guide\n\nDo the work.");
			expect(prompt).toContain("</skill>");
		});

		it("prepends workflow guidance before skill blocks", () => {
			const loader = new SkillLoader(mockLogger);
			const guidance = "## Workflow\n\n1. First step\n2. Second step";

			const prompt = loader.assembleSkillPrompt(
				[
					{
						name: "my-skill",
						description: "My Skill",
						content: "# My Skill\n\nContent here",
						source: "default",
					},
				],
				guidance,
			);

			// Workflow guidance should come before skill content
			const guidanceIndex = prompt.indexOf(guidance);
			const skillIndex = prompt.indexOf('<skill name="my-skill">');
			expect(guidanceIndex).toBeLessThan(skillIndex);
			expect(guidanceIndex).toBe(0);
		});

		it("assembles multiple skills in order", () => {
			const loader = new SkillLoader(mockLogger);

			const prompt = loader.assembleSkillPrompt(
				[
					{
						name: "skill-a",
						description: "Skill A",
						content: "# Skill A\n\nFirst skill",
						source: "default",
					},
					{
						name: "skill-b",
						description: "Skill B",
						content: "# Skill B\n\nSecond skill",
						source: "global",
					},
				],
				"## Guidance",
			);

			const indexA = prompt.indexOf('<skill name="skill-a">');
			const indexB = prompt.indexOf('<skill name="skill-b">');
			expect(indexA).toBeLessThan(indexB);
		});

		it("produces trimmed output with no trailing whitespace", () => {
			const loader = new SkillLoader(mockLogger);

			const prompt = loader.assembleSkillPrompt(
				[
					{
						name: "test",
						description: "Test",
						content: "# Test\n\nContent",
						source: "default",
					},
				],
				"## Guidance",
			);

			expect(prompt).toBe(prompt.trim());
		});

		it("handles empty skills array", () => {
			const loader = new SkillLoader(mockLogger);

			const prompt = loader.assembleSkillPrompt(
				[],
				"## Workflow\n\nDo the work.",
			);

			expect(prompt).toBe("## Workflow\n\nDo the work.");
			expect(prompt).not.toContain("<skill");
		});
	});
});
