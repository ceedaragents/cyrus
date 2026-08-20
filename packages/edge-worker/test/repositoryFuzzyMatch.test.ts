import type { RepositoryConfig } from "cyrus-core";
import { describe, expect, it } from "vitest";
import { findBestFuzzyRepoMatch } from "../src/repositoryFuzzyMatch.js";

function repo(overrides: Partial<RepositoryConfig> = {}): RepositoryConfig {
	return {
		id: overrides.id ?? overrides.name ?? "repo-id",
		name: "repo",
		repositoryPath: "/tmp/repo",
		baseBranch: "main",
		workspaceBaseDir: "/tmp/worktrees",
		...overrides,
	};
}

describe("findBestFuzzyRepoMatch", () => {
	it("matches a project name that is an exact (case-insensitive) match for a repo name", () => {
		const neo = repo({ id: "1", name: "neo" });
		const other = repo({ id: "2", name: "orchestral" });

		expect(findBestFuzzyRepoMatch("neo", [neo, other])).toBe(neo);
	});

	it("matches ignoring case and punctuation differences", () => {
		const vidya = repo({ id: "1", name: "vidya" });
		const other = repo({ id: "2", name: "sleek" });

		expect(findBestFuzzyRepoMatch("Vidya", [vidya, other])).toBe(vidya);
	});

	it("matches against the GitHub URL slug when the repo name differs from the project name", () => {
		const obsidianRepo = repo({
			id: "1",
			name: "obsidian-myst",
			githubUrl: "https://github.com/codegod100/obsidian-myst",
		});
		const other = repo({ id: "2", name: "freeq" });

		expect(
			findBestFuzzyRepoMatch("myst obsidian plugin", [obsidianRepo, other]),
		).toBe(obsidianRepo);
	});

	it("returns null when no candidate scores above the confidence threshold", () => {
		const repos = [
			repo({ id: "1", name: "cyrus" }),
			repo({ id: "2", name: "neo" }),
		];

		expect(findBestFuzzyRepoMatch("latha.org", repos)).toBeNull();
	});

	it("returns null when two repos are near-equally plausible matches (ambiguous)", () => {
		const repos = [
			repo({ id: "1", name: "freeq" }),
			repo({ id: "2", name: "freeq-discord" }),
		];

		// "freeq-discord" scores lower than an exact "freeq" match, so this
		// case alone isn't ambiguous — assert the unambiguous winner here,
		// and cover a genuinely ambiguous pair below.
		expect(findBestFuzzyRepoMatch("freeq", repos)?.name).toBe("freeq");

		const ambiguousRepos = [
			repo({ id: "1", name: "web-app" }),
			repo({ id: "2", name: "app-web" }),
		];
		expect(findBestFuzzyRepoMatch("web app", ambiguousRepos)).toBeNull();
	});

	it("returns null for an empty repo list", () => {
		expect(findBestFuzzyRepoMatch("neo", [])).toBeNull();
	});
});
