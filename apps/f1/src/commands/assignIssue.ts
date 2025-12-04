/**
 * Assign Issue command - Assign an issue to a user
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { formatKeyValue } from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface AssignIssueResult {
	id: string;
	identifier: string;
	assigneeId: string;
	assigneeName: string;
}

interface AssignIssueParams {
	issueId: string;
	assigneeId: string;
}

export function createAssignIssueCommand(): Command {
	const cmd = new Command("assign-issue");

	cmd
		.description("Assign an issue to a user")
		.requiredOption("-i, --issue-id <id>", "Issue ID to assign")
		.requiredOption("-a, --assignee-id <id>", "User ID to assign to")
		.action(async (options: { issueId: string; assigneeId: string }) => {
			printRpcUrl();

			const params: AssignIssueParams = {
				issueId: options.issueId,
				assigneeId: options.assigneeId,
			};

			try {
				const result = await rpcCall<AssignIssueResult>("assignIssue", params);

				console.log(success("Issue assigned successfully"));
				console.log(`  ${formatKeyValue("Issue ID", result.id)}`);
				console.log(`  ${formatKeyValue("Identifier", result.identifier)}`);
				console.log(`  ${formatKeyValue("Assigned To", result.assigneeName)}`);
				console.log(`  ${formatKeyValue("Assignee ID", result.assigneeId)}`);
			} catch (err) {
				if (err instanceof Error) {
					console.error(error(`Failed to assign issue: ${err.message}`));
					console.error("  Please check that:");
					console.error("    - The issue ID exists");
					console.error("    - The assignee ID is valid");
					console.error("    - The F1 server is running");
					process.exit(1);
				}
				throw err;
			}
		});

	return cmd;
}
