import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertSafeEnvironmentName,
	ENVIRONMENTS_DIRNAME,
	EnvironmentLoadError,
	getEnvironmentPath,
	getEnvironmentsDir,
	listEnvironmentNames,
	loadEnvironment,
} from "../src/Environment.js";

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
