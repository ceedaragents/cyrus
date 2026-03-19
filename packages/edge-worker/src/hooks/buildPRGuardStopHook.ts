/**
 * PR Guard Stop Hook
 *
 * A Claude Code Stop hook that ensures pull requests are created
 * when code changes exist before allowing the agent to stop.
 *
 * Uses the `stop_hook_active` flag to prevent infinite loops:
 * if the hook has already blocked once and the agent is trying to stop again,
 * we allow it through to avoid getting stuck.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
	HookCallbackMatcher,
	HookInput,
	StopHookInput,
	SyncHookJSONOutput,
} from "cyrus-claude-runner";
import type { ILogger } from "cyrus-core";

const execAsync = promisify(exec);

/**
 * Check if the working directory has code changes relative to the base branch.
 * Returns true if there are committed changes on the branch that differ from origin.
 */
async function hasCodeChanges(cwd: string): Promise<boolean> {
	try {
		// Check for uncommitted changes
		const { stdout: statusOut } = await execAsync(
			"git status --porcelain 2>/dev/null",
			{ cwd },
		);
		if (statusOut.trim().length > 0) {
			return true;
		}

		// Check for committed changes not on the default branch
		const { stdout: diffOut } = await execAsync(
			'git log --oneline origin/HEAD..HEAD 2>/dev/null || git log --oneline origin/main..HEAD 2>/dev/null || echo ""',
			{ cwd },
		);
		return diffOut.trim().length > 0;
	} catch {
		// If git commands fail, assume no changes
		return false;
	}
}

/**
 * Check if a pull request already exists for the current branch.
 */
async function hasPullRequest(cwd: string): Promise<boolean> {
	try {
		const { stdout } = await execAsync(
			"gh pr view --json url -q .url 2>/dev/null",
			{ cwd },
		);
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Build a Stop hook that blocks the agent from stopping
 * if code changes exist but no PR has been created.
 *
 * @param cwd - Working directory where git commands will be run
 * @param logger - Logger instance for debugging
 */
export function buildPRGuardStopHook(
	cwd: string,
	logger: ILogger,
): HookCallbackMatcher[] {
	return [
		{
			hooks: [
				async (
					input: HookInput,
					_toolUseID: string | undefined,
					_options: { signal: AbortSignal },
				): Promise<SyncHookJSONOutput> => {
					const stopInput = input as StopHookInput;

					// CRITICAL: Prevent infinite loops.
					// If stop_hook_active is true, the agent is already continuing
					// from a previous Stop hook block. Allow it to stop this time.
					if (stopInput.stop_hook_active) {
						logger.debug(
							"PR Guard: stop_hook_active=true, allowing stop to prevent infinite loop",
						);
						return {};
					}

					try {
						const changes = await hasCodeChanges(cwd);

						if (!changes) {
							logger.debug("PR Guard: no code changes detected, allowing stop");
							return {};
						}

						const prExists = await hasPullRequest(cwd);

						if (prExists) {
							logger.debug("PR Guard: PR already exists, allowing stop");
							return {};
						}

						logger.info(
							"PR Guard: code changes detected without PR, blocking stop",
						);
						return {
							decision: "block",
							reason:
								"You have code changes but haven't created a pull request yet. Please complete the following before finishing:\n" +
								"1. Stage and commit all changes with a clear commit message\n" +
								"2. Push to remote: `git push -u origin HEAD`\n" +
								"3. Create a PR with a proper description using `gh pr create`\n" +
								"Then you may complete your work.",
						};
					} catch (err) {
						// If checks fail, allow the stop rather than blocking indefinitely
						logger.warn(
							`PR Guard: error checking for changes/PR, allowing stop: ${err}`,
						);
						return {};
					}
				},
			],
		},
	];
}
