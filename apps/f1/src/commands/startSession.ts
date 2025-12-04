/**
 * Start Session command - Start an agent session on an issue
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { formatKeyValue } from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface StartSessionResult {
	sessionId: string;
	issueId: string;
	status: string;
	startedAt: string;
}

interface StartSessionParams {
	issueId: string;
}

export function createStartSessionCommand(): Command {
	const cmd = new Command("start-session");

	cmd
		.description("Start an agent session on an issue")
		.requiredOption("-i, --issue-id <id>", "Issue ID to start session on")
		.action(async (options: { issueId: string }) => {
			printRpcUrl();

			const params: StartSessionParams = {
				issueId: options.issueId,
			};

			try {
				const result = await rpcCall<StartSessionResult>(
					"startSession",
					params,
				);

				console.log(success("Session started successfully"));
				console.log(`  ${formatKeyValue("Session ID", result.sessionId)}`);
				console.log(`  ${formatKeyValue("Issue ID", result.issueId)}`);
				console.log(`  ${formatKeyValue("Status", result.status)}`);
				console.log(`  ${formatKeyValue("Started At", result.startedAt)}`);
			} catch (err) {
				if (err instanceof Error) {
					console.error(error(`Failed to start session: ${err.message}`));
					console.error("  Please check that:");
					console.error("    - The issue ID exists");
					console.error(
						"    - There isn't already an active session on this issue",
					);
					console.error("    - The F1 server is running");
					process.exit(1);
				}
				throw err;
			}
		});

	return cmd;
}
