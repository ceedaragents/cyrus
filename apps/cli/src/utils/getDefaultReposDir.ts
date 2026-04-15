import { join } from "node:path";
import { DEFAULT_REPOS_DIR } from "cyrus-core";

export function getDefaultReposDir(cyrusHome: string): string {
	return (
		process.env.CYRUS_REPOS_DIR?.trim() || join(cyrusHome, DEFAULT_REPOS_DIR)
	);
}
