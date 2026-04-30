import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

/**
 * Build disallowed Read patterns for everything in the user's home directory
 * that is not on the path to the cwd or any of the additional allowed paths.
 *
 * For each ancestor directory, we enumerate its children and deny Read access
 * to any that are not ancestors of, or equal to, one of the allowed paths.
 * This prevents Claude from reading sensitive home directory files (SSH keys,
 * AWS credentials, git config, etc.) while still allowing access to the
 * worktree, the attachments directory, repository base paths, and any other
 * directories Claude legitimately needs to read.
 *
 * Example: cwd = /Users/alice/.cyrus/worktrees/ENG-1/repo
 *          additionalAllowedPaths = [/Users/alice/.cyrus/ENG-1/attachments]
 * Allows:  ~/.cyrus/worktrees/ENG-1/repo  (cwd)
 *          ~/.cyrus/ENG-1/attachments      (additional allowed path)
 * Denies:  ~/.ssh/**, ~/.aws/**, ~/.gitconfig, ~/Documents/**, etc.
 *          and siblings at each intermediate level that lead nowhere useful.
 *
 * Claude Code requires an extra leading / for absolute paths in tool patterns.
 * See: https://docs.anthropic.com/en/docs/claude-code/settings#read-edit
 *
 * IMPORTANT — relationship to `buildPackageManagerHomeAllowances()`:
 * This denylist and the OS-level sandbox `allowRead` list built in
 * `packages/edge-worker/src/RunnerConfigBuilder.ts` are INTENTIONALLY
 * INDEPENDENT. They serve different consumers:
 *   - This list feeds the SDK's `disallowedTools` (Claude's tool-permission
 *     layer). It controls what Claude's own `Read`/`Edit` tool calls may
 *     touch.
 *   - `buildPackageManagerHomeAllowances()` feeds `sandbox.filesystem.allowRead`
 *     (OS-level). It controls what unsandboxed children like `npm`, `git`,
 *     and `gh` may touch when they execute on Claude's behalf.
 * The same path can legitimately appear in both: e.g. `~/.gitconfig` is in
 * the OS allow-list (so `git` can read it) AND denied here (so Claude's
 * `Read` tool cannot). That is the point — defense-in-depth.
 * If you change one, do not assume the other tracks it. See CLAUDE.md § 6.
 *
 * KNOWN SDK LIMITATION — Glob/Grep enumeration leak:
 * The SDK only honors `Read(...)` patterns in `disallowedTools`; it does NOT
 * honor `Glob(...)` or `Grep(...)` patterns. The SDK does check Glob/Grep's
 * input `path` arg against `Read(...)` denies, but it does NOT apply those
 * denies to the entries Glob returns from its recursive walk. So when
 * `additionalAllowedPaths` includes a path whose parent has denied siblings
 * (e.g. allowing `~/cyrus-app/cyrus` makes `~/cyrus-app` a "passthrough"
 * parent that this function leaves un-denied — see the algorithm below),
 * `Glob(path="~/cyrus-app", pattern="**")` will return entries from
 * `~/cyrus-app/cyrus-hosted/`, `~/cyrus-app/documentation/`, etc. The
 * downstream `Read` of any leaked path is still denied — but file/directory
 * NAMES leak. Adding `Glob(...)`/`Grep(...)` patterns here is a no-op; the
 * realistic mitigation is workspace layout (avoid passthrough parents with
 * denied siblings).
 */
export function buildHomeDirectoryDisallowedTools(
	cwd: string,
	additionalAllowedPaths: string[] = [],
): string[] {
	const home = homedir();

	// Collect all paths that should be accessible, as segment arrays relative to home.
	// Ignore any paths that are outside the home directory.
	const allRelPaths: string[][] = [cwd, ...additionalAllowedPaths]
		.map((p) => resolve(p))
		.map((p) => relative(home, p))
		.filter((rel) => !rel.startsWith("..") && rel !== "")
		.map((rel) => rel.split("/").filter(Boolean));

	if (allRelPaths.length === 0) {
		return [];
	}

	const disallowed: string[] = [];

	// Recursively process a directory. `relevantPaths` contains the remaining
	// path segments (relative to `dir`) for each allowed destination.
	// An entry in `dir` is denied if it is not an ancestor of any allowed path.
	function processDir(dir: string, relevantPaths: string[][]): void {
		// Build the set of child names that lead toward at least one allowed path.
		const allowedNames = new Set(
			relevantPaths.map((segs) => segs[0]).filter(Boolean),
		);

		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = join(dir, entry);

			if (allowedNames.has(entry)) {
				// This entry leads toward one or more allowed paths.
				// Strip the leading segment and collect remaining paths.
				const childPaths = relevantPaths
					.filter((segs) => segs[0] === entry)
					.map((segs) => segs.slice(1));

				// If any child path is now empty, this entry IS one of the allowed
				// destinations — its entire subtree is accessible, so don't deny it
				// and don't recurse further (there are no restricted siblings inside).
				if (childPaths.some((segs) => segs.length === 0)) {
					continue;
				}

				// Otherwise this is just a passthrough directory — recurse to deny
				// its siblings that don't lead anywhere useful.
				processDir(fullPath, childPaths);
				continue;
			}

			// This entry is not on the path to any allowed destination — deny it.
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
	}

	processDir(home, allRelPaths);

	return disallowed;
}
