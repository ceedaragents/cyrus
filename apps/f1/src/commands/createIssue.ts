/**
 * Create Issue command - Create a new issue
 */

import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { formatKeyValue } from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface CreateIssueResult {
	id: string;
	title: string;
	identifier: string;
	url: string;
}

interface CreateIssueParams {
	title: string;
	description?: string;
}

export function createCreateIssueCommand(): Command {
	const cmd = new Command("create-issue");

	cmd
		.description("Create a new issue")
		.requiredOption("-t, --title <title>", "Issue title")
		.option("-d, --description <description>", "Issue description")
		.action(async (options: { title: string; description?: string }) => {
			printRpcUrl();

			const params: CreateIssueParams = {
				title: options.title,
			};

			if (options.description) {
				params.description = options.description;
			}

			try {
				const result = await rpcCall<CreateIssueResult>("createIssue", params);

				console.log(success("Issue created successfully"));
				console.log(`  ${formatKeyValue("ID", result.id)}`);
				console.log(`  ${formatKeyValue("Identifier", result.identifier)}`);
				console.log(`  ${formatKeyValue("Title", result.title)}`);
				console.log(`  ${formatKeyValue("URL", result.url)}`);
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
		});

	return cmd;
}
