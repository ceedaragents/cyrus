import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepositoryConfig } from "../src/config-types.js";
import {
	assertSafeEnvironmentName,
	ENVIRONMENTS_DIRNAME,
	EnvironmentLoadError,
	getEnvironmentPath,
	getEnvironmentsDir,
	listEnvironmentNames,
	loadEnvironment,
	resolveEnvironmentReadOnlyRepoPaths,
	resolveEnvironmentWorktreeRepos,
} from "../src/Environment.js";
import type { EnvironmentConfig } from "../src/environment-schema.js";

describe("Environment loader", () => {
	let cyrusHome: string;

	beforeEach(() => {
		cyrusHome = mkdtempSync(join(tmpdir(), "cyrus-env-test-"));
	});

	afterEach(() => {
		rmSync(cyrusHome, { recursive: true, force: true });
	});

	function writeEnv(name: string, body: unknown): void {
		const dir = join(cyrusHome, ENVIRONMENTS_DIRNAME);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${name}.json`), JSON.stringify(body));
	}

	it("resolves the environments directory under cyrusHome", () => {
		expect(getEnvironmentsDir(cyrusHome)).toBe(
			join(cyrusHome, ENVIRONMENTS_DIRNAME),
		);
	});

	it("resolves the per-environment file path", () => {
		expect(getEnvironmentPath(cyrusHome, "prod")).toBe(
			join(cyrusHome, ENVIRONMENTS_DIRNAME, "prod.json"),
		);
	});

	it("returns null when the environment file does not exist", () => {
		expect(loadEnvironment(cyrusHome, "missing")).toBeNull();
	});

	it("returns an empty list when the environments dir is absent", () => {
		expect(listEnvironmentNames(cyrusHome)).toEqual([]);
	});

	it("loads and validates an environment file", () => {
		writeEnv("safe", {
			description: "read-only",
			allowedTools: ["Read", "Grep"],
			disallowedTools: ["Bash"],
		});

		const env = loadEnvironment(cyrusHome, "safe");
		expect(env).toEqual({
			name: "safe",
			description: "read-only",
			allowedTools: ["Read", "Grep"],
			disallowedTools: ["Bash"],
		});
	});

	it("preserves an explicit name field over the filename stem", () => {
		writeEnv("production", { name: "prod", description: "prod env" });
		const env = loadEnvironment(cyrusHome, "production");
		expect(env?.name).toBe("prod");
	});

	it("throws EnvironmentLoadError on invalid JSON", () => {
		const dir = join(cyrusHome, ENVIRONMENTS_DIRNAME);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "broken.json"), "{ not json");
		expect(() => loadEnvironment(cyrusHome, "broken")).toThrow(
			EnvironmentLoadError,
		);
	});

	it("throws EnvironmentLoadError on schema violations", () => {
		writeEnv("bad", { allowedTools: "not-an-array" });
		expect(() => loadEnvironment(cyrusHome, "bad")).toThrow(
			EnvironmentLoadError,
		);
	});

	it("lists environment names sorted alphabetically", () => {
		writeEnv("zebra", {});
		writeEnv("alpha", {});
		writeEnv("middle", {});
		expect(listEnvironmentNames(cyrusHome)).toEqual([
			"alpha",
			"middle",
			"zebra",
		]);
	});

	describe("assertSafeEnvironmentName", () => {
		it("accepts simple filename stems", () => {
			expect(() => assertSafeEnvironmentName("prod")).not.toThrow();
			expect(() => assertSafeEnvironmentName("read-only_v2")).not.toThrow();
			expect(() => assertSafeEnvironmentName("team.staging")).not.toThrow();
		});

		it("rejects empty strings", () => {
			expect(() => assertSafeEnvironmentName("")).toThrow(EnvironmentLoadError);
		});

		it("rejects path traversal and separators", () => {
			expect(() => assertSafeEnvironmentName("..")).toThrow(
				EnvironmentLoadError,
			);
			expect(() => assertSafeEnvironmentName("../etc/passwd")).toThrow(
				EnvironmentLoadError,
			);
			expect(() => assertSafeEnvironmentName("foo/bar")).toThrow(
				EnvironmentLoadError,
			);
			expect(() => assertSafeEnvironmentName("foo\\bar")).toThrow(
				EnvironmentLoadError,
			);
		});

		it("propagates the name check through getEnvironmentPath", () => {
			expect(() => getEnvironmentPath(cyrusHome, "../escape")).toThrow(
				EnvironmentLoadError,
			);
		});
	});
});

describe("resolveEnvironmentWorktreeRepos", () => {
	function repo(id: string, name: string): RepositoryConfig {
		return {
			id,
			name,
			repositoryPath: `/path/${id}`,
			baseBranch: "main",
			workspaceBaseDir: "/ws",
		} as RepositoryConfig;
	}

	const all: RepositoryConfig[] = [
		repo("a", "Repo A"),
		repo("b", "Repo B"),
		repo("c", "Repo C"),
	];

	it("returns the fallback when the environment is null", () => {
		const fallback = [all[0]!];
		expect(resolveEnvironmentWorktreeRepos(null, fallback, all)).toBe(fallback);
	});

	it("returns the fallback when env.gitWorktrees is undefined", () => {
		const env: EnvironmentConfig = { description: "no worktrees field" };
		const fallback = [all[0]!];
		expect(resolveEnvironmentWorktreeRepos(env, fallback, all)).toBe(fallback);
	});

	it("returns an empty list when env.gitWorktrees=[] (no worktrees)", () => {
		const env: EnvironmentConfig = { gitWorktrees: [] };
		expect(resolveEnvironmentWorktreeRepos(env, [all[0]!], all)).toEqual([]);
	});

	it("resolves a single worktree repo id", () => {
		const env: EnvironmentConfig = { gitWorktrees: ["b"] };
		expect(resolveEnvironmentWorktreeRepos(env, [all[0]!], all)).toEqual([
			all[1],
		]);
	});

	it("resolves N worktree repo ids preserving order", () => {
		const env: EnvironmentConfig = { gitWorktrees: ["c", "a"] };
		expect(resolveEnvironmentWorktreeRepos(env, [], all)).toEqual([
			all[2],
			all[0],
		]);
	});

	it("silently skips unknown repo ids", () => {
		const env: EnvironmentConfig = { gitWorktrees: ["a", "missing", "c"] };
		expect(resolveEnvironmentWorktreeRepos(env, [], all)).toEqual([
			all[0],
			all[2],
		]);
	});
});

describe("resolveEnvironmentReadOnlyRepoPaths", () => {
	function repo(id: string, path: string): RepositoryConfig {
		return {
			id,
			name: id,
			repositoryPath: path,
			baseBranch: "main",
			workspaceBaseDir: "/ws",
		} as RepositoryConfig;
	}

	const all: RepositoryConfig[] = [
		repo("docs", "/home/.cyrus/repos/docs"),
		repo("api", "/home/.cyrus/repos/api"),
	];

	it("returns an empty list when the environment is null", () => {
		expect(resolveEnvironmentReadOnlyRepoPaths(null, all)).toEqual([]);
	});

	it("returns an empty list when env.repositories is omitted", () => {
		expect(resolveEnvironmentReadOnlyRepoPaths({}, all)).toEqual([]);
	});

	it("returns an empty list for env.repositories=[]", () => {
		expect(
			resolveEnvironmentReadOnlyRepoPaths({ repositories: [] }, all),
		).toEqual([]);
	});

	it("resolves repo ids to their repositoryPath", () => {
		expect(
			resolveEnvironmentReadOnlyRepoPaths(
				{ repositories: ["docs", "api"] },
				all,
			),
		).toEqual(["/home/.cyrus/repos/docs", "/home/.cyrus/repos/api"]);
	});

	it("silently skips unknown repo ids", () => {
		expect(
			resolveEnvironmentReadOnlyRepoPaths(
				{ repositories: ["docs", "ghost"] },
				all,
			),
		).toEqual(["/home/.cyrus/repos/docs"]);
	});
});
