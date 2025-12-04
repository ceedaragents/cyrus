/**
 * Status command - Get server status information
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { formatKeyValue } from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface StatusResult {
	uptime: number;
	status: string;
	server: string;
}

export function createStatusCommand(): Command {
	const cmd = new Command("status");

	cmd
		.description("Display F1 server status and statistics")
		.action(async () => {
			printRpcUrl();

			try {
				const result = await rpcCall<StatusResult>("status");

				console.log(success("Server Status"));
				console.log(`  ${formatKeyValue("Status", result.status)}`);
				console.log(`  ${formatKeyValue("Server", result.server)}`);
				console.log(
					`  ${formatKeyValue("Uptime", `${Math.floor(result.uptime / 1000)}s`)}`,
				);
			} catch (err) {
				if (err instanceof Error) {
					console.error(error(`Status failed: ${err.message}`));
					process.exit(1);
				}
				throw err;
			}
		});

	return cmd;
}
