import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

/**
 * Build disallowed Read patterns for everything in the user's home directory
 * that is not on the path from home to the given cwd.
 *
 * For each ancestor directory between home and cwd, we enumerate its siblings
 * and deny Read access to them. This prevents Claude from reading sensitive
 * home directory files (SSH keys, AWS credentials, git config, etc.) while
 * still allowing access to the worktree and any directories that contain it.
 *
 * Example: cwd = /Users/alice/.cyrus/worktrees/ENG-1/repo
 * Disallows: Read(//Users/alice/.ssh/**), Read(//Users/alice/.aws/**),
 *            Read(//Users/alice/.gitconfig), Read(//Users/alice/Documents/**)
 *            ... and siblings at each level down to the worktree.
 *
 * Claude Code requires an extra leading / for absolute paths in tool patterns.
 * See: https://docs.anthropic.com/en/docs/claude-code/settings#read-edit
 */
export function buildHomeDirectoryDisallowedTools(cwd: string): string[] {
	const home = homedir();
	const absoluteCwd = resolve(cwd);

	// Only applies when cwd is inside the home directory
	const relFromHome = relative(home, absoluteCwd);
	if (relFromHome.startsWith("..") || relFromHome === "") {
		return [];
	}

	const disallowed: string[] = [];
	const segments = relFromHome.split("/").filter(Boolean);

	let currentDir = home;
	for (const allowedSegment of segments) {
		let entries: string[];
		try {
			entries = readdirSync(currentDir);
		} catch {
			break;
		}

		for (const entry of entries) {
			if (entry === allowedSegment) continue;

			const fullPath = join(currentDir, entry);
			let isDir = false;
			try {
				isDir = statSync(fullPath).isDirectory();
			} catch {
				continue;
			}

			// Extra / prefix required for absolute paths in Claude Code tool patterns
			const claudePath = `/${fullPath}`;
			disallowed.push(isDir ? `Read(${claudePath}/**)` : `Read(${claudePath})`);
		}

		currentDir = join(currentDir, allowedSegment);
	}

	return disallowed;
}
