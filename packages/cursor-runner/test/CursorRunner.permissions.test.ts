import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CursorRunner } from "../src/CursorRunner.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cursor-runner-perms-"));
	tempDirs.push(dir);
	return dir;
}

describe("CursorRunner permissions mapping", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		delete process.env.CYRUS_CURSOR_MOCK;
	});

	it("maps Claude-style tool permissions to Cursor CLI permissions", () => {
		const runner = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory: "/tmp/repo",
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

		const config = (runner as any).buildCursorPermissionsConfig();

		expect(config).toEqual({
			permissions: {
				allow: [
					"Read(src/**)",
					"Write(src/**)",
					"Shell(git)",
					"Shell(*)",
					"Mcp(trigger:search_docs)",
					"Mcp(linear:*)",
				],
				deny: ["Read(.env*)", "Shell(rm)", "Mcp(trigger:delete)"],
			},
		});
	});

	it("scopes wildcard read/write permissions to workspace paths", () => {
		const runner = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory: "/tmp/repo",
			allowedTools: ["Read", "Edit", "Write", "TodoWrite"],
		});

		const config = (runner as any).buildCursorPermissionsConfig();

		expect(config).toEqual({
			permissions: {
				allow: ["Read(./**)", "Write(./**)"],
				deny: [],
			},
		});
	});

	it("writes .cursor/cli.json before execution and updates mapped permissions", async () => {
		const workingDirectory = createTempDir();
		process.env.CYRUS_CURSOR_MOCK = "1";

		const runner = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory,
			allowedTools: [
				"Read(src/**)",
				"Edit(src/**)",
				"Bash(git:*)",
				"mcp__trigger__search_docs",
			],
			disallowedTools: ["Bash(rm:*)", "mcp__trigger__delete"],
		});

		await runner.start("test permissions sync");

		const configPath = join(workingDirectory, ".cursor", "cli.json");
		const config = JSON.parse(readFileSync(configPath, "utf8"));

		expect(config.permissions.allow).toEqual([
			"Read(src/**)",
			"Write(src/**)",
			"Shell(git)",
			"Mcp(trigger:search_docs)",
		]);
		expect(config.permissions.deny).toEqual([
			"Shell(rm)",
			"Mcp(trigger:delete)",
		]);
	});

	it("rewrites .cursor/cli.json between runs when tool permissions change", async () => {
		const workingDirectory = createTempDir();
		process.env.CYRUS_CURSOR_MOCK = "1";

		const firstRun = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory,
			allowedTools: ["Read(src/**)", "Bash(git:*)"],
			disallowedTools: [],
		});
		await firstRun.start("first run");

		const secondRun = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory,
			allowedTools: [],
			disallowedTools: [
				"Bash(rm:*)",
				"Edit(secrets/**)",
				"mcp__linear__create_issue",
			],
		});
		await secondRun.start("second run");

		const configPath = join(workingDirectory, ".cursor", "cli.json");
		const config = JSON.parse(readFileSync(configPath, "utf8"));

		expect(config.permissions.allow).toEqual([]);
		expect(config.permissions.deny).toEqual([
			"Shell(rm)",
			"Write(secrets/**)",
			"Mcp(linear:create_issue)",
		]);
	});
});
