import { describe, expect, it } from "vitest";
import { buildPackageManagerHomeAllowances } from "../src/RunnerConfigBuilder.js";

describe("buildPackageManagerHomeAllowances", () => {
	it("includes the explicitly requested read-only config files", () => {
		const { read } = buildPackageManagerHomeAllowances();
		expect(read).toContain("~/.gitconfig");
		expect(read).toContain("~/.config/gh/hosts.yml");
	});

	it("includes the Claude SDK shell-snapshots dir so the bash wrapper can source it", () => {
		const { read, write } = buildPackageManagerHomeAllowances();
		expect(read).toContain("~/.claude/shell-snapshots");
		// Read-only — the SDK regenerates snapshots in the unsandboxed parent
		// process, so sandboxed children never need write access.
		expect(write).not.toContain("~/.claude/shell-snapshots");
	});

	it("covers caches/stores for every major node package manager", () => {
		const { read, write } = buildPackageManagerHomeAllowances();

		// npm
		expect(read).toContain("~/.npm");
		expect(write).toContain("~/.npm");

		// yarn (classic + berry)
		expect(read).toContain("~/.yarn");
		expect(write).toContain("~/.yarn");

		// pnpm — all three known layouts (generic store, Linux/XDG, macOS)
		for (const dir of [
			"~/.pnpm-store",
			"~/.local/share/pnpm",
			"~/.cache/pnpm",
			"~/Library/pnpm",
			"~/Library/Caches/pnpm",
		]) {
			expect(read).toContain(dir);
			expect(write).toContain(dir);
		}

		// bun
		expect(read).toContain("~/.bun");
		expect(write).toContain("~/.bun");

		// deno
		expect(read).toContain("~/.deno");
		expect(write).toContain("~/.deno");
	});

	it("does not grant write access to read-only config files", () => {
		const { write } = buildPackageManagerHomeAllowances();
		expect(write).not.toContain("~/.gitconfig");
		expect(write).not.toContain("~/.config/gh/hosts.yml");
		expect(write).not.toContain("~/.npmrc");
	});
});
