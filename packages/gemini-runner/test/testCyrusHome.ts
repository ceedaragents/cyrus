import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestCyrusHome(): string {
	return mkdtempSync(join(tmpdir(), "cyrus-gemini-runner-"));
}
