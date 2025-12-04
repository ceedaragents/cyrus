/**
 * Stop Session command - Stop an active session
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface StopSessionResult {
	success: boolean;
	message: string;
}

interface StopSessionParams {
	sessionId: string;
}

export function createStopSessionCommand(): Command {
	const cmd = new Command("stop-session");

	cmd
		.description("Stop an active session")
		.requiredOption("-s, --session-id <id>", "Session ID to stop")
		.action(async (options: { sessionId: string }) => {
			printRpcUrl();

			const params: StopSessionParams = {
				sessionId: options.sessionId,
			};

			try {
				const result = await rpcCall<StopSessionResult>("stopSession", params);

				console.log(success("Session stopped successfully"));
				console.log(`  ${result.message}`);
			} catch (err) {
				if (err instanceof Error) {
					console.error(error(`Failed to stop session: ${err.message}`));
					console.error("  Please check that:");
					console.error("    - The session ID exists");
					console.error("    - The session is still active");
					console.error("    - The F1 server is running");
					process.exit(1);
				}
				throw err;
			}
		});

	return cmd;
}
