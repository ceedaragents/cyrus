import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const _base = mkdtempSync(join(tmpdir(), "cyrus-edge-worker-"));

/**
 * Unique per-run temp paths for tests. Uses mkdtempSync so simultaneous
 * test runs from different worktrees or processes use separate directories.
 * Also avoids EACCES on shared /tmp across multiple user accounts.
 */
export const TEST_CYRUS_HOME = join(_base, "cyrus-home");
export const TEST_CYRUS_CHAT = join(_base, "chat");
export const TEST_WORKING_DIR = join(_base, "workspace");
