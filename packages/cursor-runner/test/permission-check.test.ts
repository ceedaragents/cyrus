import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER = join(HERE, "..", "src", "permission-check.mjs");

interface RunArgs {
	allow?: string[];
	deny?: string[];
	payload: Record<string, unknown>;
}

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function runHelper(args: RunArgs): { decision: any; stderr: string } {
	const dir = mkdtempSync(join(tmpdir(), "perm-check-"));
	tempDirs.push(dir);
	const cursorDir = join(dir, ".cursor");
	require("node:fs").mkdirSync(cursorDir, { recursive: true });
	const helperCopy = join(cursorDir, "cyrus-permission-check.mjs");
	require("node:fs").copyFileSync(HELPER, helperCopy);
	require("node:fs").chmodSync(helperCopy, 0o755);
	writeFileSync(
		join(cursorDir, "cyrus-permissions.json"),
		JSON.stringify({
			workspace: dir,
			allow: args.allow ?? [],
			deny: args.deny ?? [],
		}),
	);

	const proc = spawnSync(process.execPath, [helperCopy], {
		input: JSON.stringify(args.payload),
		encoding: "utf8",
	});
	let decision: any = null;
	try {
		decision = JSON.parse(proc.stdout || "{}");
	} catch {
		decision = { _raw: proc.stdout };
	}
	return { decision, stderr: proc.stderr };
}

describe("permission-check helper", () => {
	it("allows by default when no patterns configured", () => {
		const { decision } = runHelper({
			payload: { hook_event_name: "preToolUse", tool_name: "Read" },
		});
		expect(decision.permission).toBe("allow");
	});

	it("denies a deny-listed shell command", () => {
		const { decision } = runHelper({
			deny: ["Shell(rm)"],
			payload: {
				hook_event_name: "beforeShellExecution",
				command: "rm -rf /tmp/x",
			},
		});
		expect(decision.permission).toBe("deny");
	});

	it("denies an unmatched call when an allow list is set", () => {
		const { decision } = runHelper({
			allow: ["Shell(ls)"],
			payload: {
				hook_event_name: "beforeShellExecution",
				command: "cat README.md",
			},
		});
		expect(decision.permission).toBe("deny");
	});

	it("allows when allow list matches", () => {
		const { decision } = runHelper({
			allow: ["Shell(ls)", "Shell(ls:*)"],
			payload: {
				hook_event_name: "beforeShellExecution",
				command: "ls -la",
			},
		});
		expect(decision.permission).toBe("allow");
	});

	it("denies a beforeReadFile of a denied path", () => {
		const { decision } = runHelper({
			deny: ["Read(secret.txt)"],
			payload: {
				hook_event_name: "beforeReadFile",
				file_path: "secret.txt",
			},
		});
		expect(decision.permission).toBe("deny");
	});

	it("denies an MCP call by Mcp() pattern", () => {
		const { decision } = runHelper({
			deny: ["Mcp(linear:delete_issue)"],
			payload: {
				hook_event_name: "beforeMCPExecution",
				tool_name: "linear:delete_issue",
			},
		});
		expect(decision.permission).toBe("deny");
	});

	it("never returns ask", () => {
		const { decision } = runHelper({
			allow: ["Tool(Read)"],
			payload: { hook_event_name: "preToolUse", tool_name: "Read" },
		});
		expect(decision.permission).toBe("allow");
		expect(decision.permission).not.toBe("ask");
	});
});
