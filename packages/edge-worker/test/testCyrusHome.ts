import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestCyrusHome(): string {
	const cyrusHome = mkdtempSync(join(tmpdir(), "cyrus-edge-worker-"));
	mkdirSync(join(cyrusHome, "logs", "default"), { recursive: true });
	return cyrusHome;
}
