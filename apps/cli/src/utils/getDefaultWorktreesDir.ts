import { join } from "node:path";
import { DEFAULT_WORKTREES_DIR } from "cyrus-core";

export function getDefaultWorktreesDir(cyrusHome: string): string {
	return (
		process.env.CYRUS_WORKTREES_DIR?.trim() ||
		join(cyrusHome, DEFAULT_WORKTREES_DIR)
	);
}
