/**
 * Status command - Get server status information
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { formatKeyValue } from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface StatusResult {
	uptime: number;
	activeConnections: number;
	totalRequests: number;
	version: string;
	platform: string;
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
				console.log(`  ${formatKeyValue("Version", result.version)}`);
				console.log(`  ${formatKeyValue("Platform", result.platform)}`);
				console.log(
					`  ${formatKeyValue("Uptime", `${Math.floor(result.uptime)}s`)}`,
				);
				console.log(
					`  ${formatKeyValue("Active Connections", result.activeConnections)}`,
				);
				console.log(
					`  ${formatKeyValue("Total Requests", result.totalRequests)}`,
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
