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
			allowedTools: ["Read(src/**)", "Edit(src/**)", "Bash(git:*)", "Bash"],
			disallowedTools: ["Read(.env*)", "Bash(rm:*)"],
		});

		const config = (runner as any).buildCursorPermissionsConfig();

		expect(config).toEqual({
			permissions: {
				allow: ["Read(src/**)", "Write(src/**)", "Shell(git)", "Shell(*)"],
				deny: ["Read(.env*)", "Shell(rm)"],
			},
		});
	});

	it("writes .cursor/cli.json before execution and updates mapped permissions", async () => {
		const workingDirectory = createTempDir();
		process.env.CYRUS_CURSOR_MOCK = "1";

		const runner = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory,
			allowedTools: ["Read(src/**)", "Edit(src/**)", "Bash(git:*)"],
			disallowedTools: ["Bash(rm:*)"],
		});

		await runner.start("test permissions sync");

		const configPath = join(workingDirectory, ".cursor", "cli.json");
		const config = JSON.parse(readFileSync(configPath, "utf8"));

		expect(config.permissions.allow).toEqual([
			"Read(src/**)",
			"Write(src/**)",
			"Shell(git)",
		]);
		expect(config.permissions.deny).toEqual(["Shell(rm)"]);
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
			disallowedTools: ["Bash(rm:*)", "Edit(secrets/**)"],
		});
		await secondRun.start("second run");

		const configPath = join(workingDirectory, ".cursor", "cli.json");
		const config = JSON.parse(readFileSync(configPath, "utf8"));

		expect(config.permissions.allow).toEqual([]);
		expect(config.permissions.deny).toEqual(["Shell(rm)", "Write(secrets/**)"]);
	});
});
