/**
 * Create Issue command - Create a new issue
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { formatKeyValue } from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface Issue {
	id: string;
	identifier: string;
	title: string;
	url: string;
}

interface CreateIssueResult {
	issue: Issue;
}

interface CreateIssueParams {
	teamId: string;
	title: string;
	description?: string;
}

export function createCreateIssueCommand(): Command {
	const cmd = new Command("create-issue");

	cmd
		.description("Create a new issue")
		.requiredOption("-t, --title <title>", "Issue title")
		.option("-d, --description <description>", "Issue description")
		.option("-T, --team-id <teamId>", "Team ID (required)", "team-default")
		.action(
			async (options: {
				title: string;
				description?: string;
				teamId: string;
			}) => {
				printRpcUrl();

				const params: CreateIssueParams = {
					teamId: options.teamId,
					title: options.title,
				};

				if (options.description) {
					params.description = options.description;
				}

				try {
					const result = await rpcCall<CreateIssueResult>(
						"createIssue",
						params,
					);

					console.log(success("Issue created successfully"));
					console.log(`  ${formatKeyValue("ID", result.issue.id)}`);
					console.log(
						`  ${formatKeyValue("Identifier", result.issue.identifier)}`,
					);
					console.log(`  ${formatKeyValue("Title", result.issue.title)}`);
					console.log(`  ${formatKeyValue("URL", result.issue.url)}`);
				} catch (err) {
					if (err instanceof Error) {
						console.error(error(`Failed to create issue: ${err.message}`));
						console.error("  Please check that:");
						console.error("    - The F1 server is running");
						console.error("    - The title is not empty");
						process.exit(1);
					}
					throw err;
				}
			},
		);

	return cmd;
}
