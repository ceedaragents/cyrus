import { BaseCommand } from "./ICommand.js";

/**
 * Maximum time (ms) to wait for the Linear API to respond before treating the
 * check as "could not determine". Without this bound a slow or unreachable
 * endpoint would hang the `await fetch(...)` indefinitely, and the whole
 * command would never return.
 */
export const TOKEN_CHECK_TIMEOUT_MS = 15_000;

/** Result of checking a single token. */
export type TokenCheckResult =
	| { status: "valid" }
	| { status: "invalid"; error: string }
	/**
	 * The check could not be completed (network error, timeout, unexpected
	 * response). This is explicitly NOT the same as an invalid token — the
	 * token may well be fine; we simply could not reach Linear to confirm.
	 */
	| { status: "unknown"; error: string };

/**
 * Helper function to check Linear token status.
 *
 * Uses an AbortController so a slow/blocked endpoint can never hang the
 * command — on timeout the check resolves to `unknown` rather than blocking
 * forever or masquerading as an invalid token.
 */
export async function checkLinearToken(
	token: string,
): Promise<TokenCheckResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TOKEN_CHECK_TIMEOUT_MS);

	try {
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: token,
			},
			body: JSON.stringify({
				query: "{ viewer { id email name } }",
			}),
			signal: controller.signal,
		});

		const data = (await response.json()) as any;

		if (data.errors) {
			return {
				status: "invalid",
				error: data.errors[0]?.message || "Unknown error",
			};
		}

		return { status: "valid" };
	} catch (error) {
		if ((error as Error).name === "AbortError") {
			return {
				status: "unknown",
				error: `Timed out after ${TOKEN_CHECK_TIMEOUT_MS}ms`,
			};
		}
		// A network-level failure (DNS, connection refused, TLS, etc.) means we
		// could not determine the token's validity — not that it is invalid.
		return { status: "unknown", error: (error as Error).message };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Check tokens command - check the status of all Linear tokens.
 *
 * Exit codes:
 *   0 - every configured token was validated successfully.
 *   1 - at least one token was rejected by Linear (genuinely invalid).
 *   2 - at least one token could not be checked (network error / timeout) and
 *       none were rejected — the caller should treat this as "unknown", not
 *       "dead".
 *
 * The command always exits explicitly. Node's global `fetch` keeps HTTP
 * keep-alive sockets in a connection pool that keep the event loop alive, so
 * without an explicit `process.exit` the process would linger after the checks
 * completed. Exiting deterministically also lets monitors distinguish an
 * invalid token from an unreachable network.
 */
export class CheckTokensCommand extends BaseCommand {
	async execute(_args: string[]): Promise<void> {
		if (!this.app.config.exists()) {
			this.logError("No edge configuration found. Please run setup first.");
			process.exit(1);
		}

		const config = this.app.config.load();

		console.log("Checking Linear tokens...\n");

		let anyInvalid = false;
		let anyUnknown = false;

		// Check tokens at the workspace level
		const checkedWorkspaces = new Set<string>();
		for (const repo of config.repositories) {
			const workspaceId = repo.linearWorkspaceId;
			if (!workspaceId) continue;
			if (checkedWorkspaces.has(workspaceId)) continue;
			checkedWorkspaces.add(workspaceId);

			const token = config.linearWorkspaces?.[workspaceId]?.linearToken;
			const workspaceName =
				config.linearWorkspaces?.[workspaceId]?.linearWorkspaceName ||
				workspaceId;
			process.stdout.write(`Workspace ${workspaceName}: `);
			if (!token) {
				console.log(`❌ No token configured`);
				anyInvalid = true;
				continue;
			}
			const result = await checkLinearToken(token);

			if (result.status === "valid") {
				console.log("✅ Valid");
			} else if (result.status === "invalid") {
				console.log(`❌ Invalid - ${result.error}`);
				anyInvalid = true;
			} else {
				console.log(`⚠️  Unknown (could not check) - ${result.error}`);
				anyUnknown = true;
			}
		}

		// Exit explicitly so lingering keep-alive sockets from `fetch` can't keep
		// the event loop alive and hang the command. An invalid token takes
		// precedence over an unknown one so a genuine failure is never masked.
		const exitCode = anyInvalid ? 1 : anyUnknown ? 2 : 0;
		process.exit(exitCode);
	}
}
