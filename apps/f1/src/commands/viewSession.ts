/**
 * View Session command - View session details and activities
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import {
	formatKeyValue,
	formatTimestamp,
	printTable,
} from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface Activity {
	id: string;
	type: string;
	content: string;
	createdAt: number;
}

interface Session {
	sessionId: string;
	issueId: string;
	status: string;
	createdAt: number;
	updatedAt: number;
}

interface ViewSessionResult {
	session: Session;
	activities: Activity[];
	totalCount: number;
	hasMore: boolean;
}

interface ViewSessionParams {
	sessionId: string;
	limit?: number;
	offset?: number;
	search?: string;
}

export function createViewSessionCommand(): Command {
	const cmd = new Command("view-session");

	cmd
		.description("View session details and activities")
		.requiredOption("-s, --session-id <id>", "Session ID to view")
		.option(
			"-l, --limit <number>",
			"Maximum number of activities to return",
			"50",
		)
		.option("-o, --offset <number>", "Number of activities to skip", "0")
		.option("--search <query>", "Search for activities containing this text")
		.action(
			async (options: {
				sessionId: string;
				limit: string;
				offset: string;
				search?: string;
			}) => {
				printRpcUrl();

				const params: ViewSessionParams = {
					sessionId: options.sessionId,
					limit: parseInt(options.limit, 10),
					offset: parseInt(options.offset, 10),
				};

				if (options.search) {
					params.search = options.search;
				}

				try {
					const result = await rpcCall<ViewSessionResult>(
						"viewSession",
						params,
					);

					console.log(success("Session Details"));
					console.log(
						`  ${formatKeyValue("Session ID", result.session.sessionId)}`,
					);
					console.log(
						`  ${formatKeyValue("Issue ID", result.session.issueId)}`,
					);
					console.log(`  ${formatKeyValue("Status", result.session.status)}`);
					console.log(
						`  ${formatKeyValue("Created", formatTimestamp(new Date(result.session.createdAt).toISOString()))}`,
					);
					console.log(
						`  ${formatKeyValue("Updated", formatTimestamp(new Date(result.session.updatedAt).toISOString()))}`,
					);
					console.log(
						`  ${formatKeyValue("Total Activities", result.totalCount)}`,
					);

					if (result.activities.length > 0) {
						console.log("\n  Activities:");
						const rows = result.activities.map((activity) => [
							formatTimestamp(new Date(activity.createdAt).toISOString()),
							activity.type,
							activity.content.slice(0, 60) +
								(activity.content.length > 60 ? "..." : ""),
						]);
						printTable(["Timestamp", "Type", "Message"], rows);

						if (result.totalCount > result.activities.length) {
							console.log(
								`\n  Showing ${result.activities.length} of ${result.totalCount} activities`,
							);
							console.log(`  Use --limit and --offset to view more`);
						}
					} else {
						console.log("\n  No activities found");
					}
				} catch (err) {
					if (err instanceof Error) {
						console.error(error(`Failed to view session: ${err.message}`));
						console.error("  Please check that:");
						console.error("    - The session ID exists");
						console.error("    - The F1 server is running");
						process.exit(1);
					}
					throw err;
				}
			},
		);

	return cmd;
}
