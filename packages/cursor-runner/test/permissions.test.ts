import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildAutoDenyPatterns,
	buildCyrusPermissionsConfig,
} from "../src/permissions.js";

const tempDirs: string[] = [];

function tempWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "cyrus-perms-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("buildCyrusPermissionsConfig", () => {
	it("maps Claude-style tool patterns to Cursor hook patterns", () => {
		const ws = tempWorkspace();
		const cfg = buildCyrusPermissionsConfig({
			workspace: ws,
			allowedTools: [
				"Read(src/**)",
				"Edit(src/**)",
				"Bash(git:*)",
				"Bash",
				"mcp__trigger__search_docs",
				"mcp__linear",
			],
			disallowedTools: ["Read(.env*)", "Bash(rm:*)", "mcp__trigger__delete"],
		});

		expect(cfg.allow).toEqual(
			expect.arrayContaining([
				"Read(src/**)",
				"Write(src/**)",
				"Shell(git)",
				"Shell(git:*)",
				"Tool(Shell)",
				"Mcp(trigger:search_docs)",
				"Mcp(linear:*)",
			]),
		);
		expect(cfg.deny).toEqual(
			expect.arrayContaining([
				"Read(.env*)",
				"Shell(rm)",
				"Shell(rm:*)",
				"Mcp(trigger:delete)",
			]),
		);
	});

	it("scopes wildcard read/write to workspace via auto-deny", () => {
		const ws = tempWorkspace();
		const cfg = buildCyrusPermissionsConfig({
			workspace: ws,
			allowedTools: ["Read", "Edit", "Write"],
		});
		expect(cfg.allow).toEqual(
			expect.arrayContaining(["Tool(Read)", "Tool(Write)"]),
		);
		expect(cfg.deny).toEqual(
			expect.arrayContaining(["Read(/etc/**)", "Write(/etc/**)"]),
		);
	});

	it("returns no auto-deny patterns when only narrow Read/Write are allowed", () => {
		const ws = tempWorkspace();
		const cfg = buildCyrusPermissionsConfig({
			workspace: ws,
			allowedTools: ["Read(src/**)", "Write(src/**)"],
		});
		expect(cfg.deny).toEqual([]);
	});

	it("drops unrecognized patterns silently", () => {
		const ws = tempWorkspace();
		const cfg = buildCyrusPermissionsConfig({
			workspace: ws,
			allowedTools: ["NonsenseTool(garbage)", "Read(src/**)"],
		});
		expect(cfg.allow).toEqual(["Read(src/**)"]);
	});

	it("buildAutoDenyPatterns returns nothing when no broad allow is present", () => {
		const ws = tempWorkspace();
		expect(
			buildAutoDenyPatterns({ workspace: ws, allowedTools: ["Read(src/**)"] }),
		).toEqual([]);
	});
});
