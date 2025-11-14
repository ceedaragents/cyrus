import { rpc } from "../client/RPCClient.js";
import type { Issue } from "../types/index.js";
import { c } from "../utils/colors.js";
import { printJSON } from "../utils/formatter.js";

/**
 * Create issue command options
 */
export interface CreateIssueOptions {
	title: string;
	description?: string;
	assigneeId?: string;
	teamId?: string;
	stateId?: string;
}

/**
 * Create a new issue
 */
export async function createIssue(options: CreateIssueOptions): Promise<void> {
	const result = await rpc<Issue>("createIssue", {
		title: options.title,
		description: options.description,
		options: {
			assigneeId: options.assigneeId,
			teamId: options.teamId,
			stateId: options.stateId,
		},
	});

	if (result.success && result.data) {
		const issue = result.data;
		console.log(c.success(`\n✅ Issue Created: ${c.bold(issue.identifier)}\n`));
		printJSON(issue);
		console.log();
		console.log(c.dim("💡 Next steps:"));
		console.log(
			c.dim(
				`   • Start session: ${c.command(`f1 startSession --issue-id ${issue.id}`)}`,
			),
		);
		console.log(
			c.dim(
				`   • Assign issue: ${c.command(`f1 assignIssue --issue-id ${issue.id} --assignee-id <user-id>`)}`,
			),
		);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Assign issue options
 */
export interface AssignIssueOptions {
	issueId: string;
	assigneeId?: string;
}

/**
 * Assign an issue to a user
 */
export async function assignIssue(options: AssignIssueOptions): Promise<void> {
	const result = await rpc("assignIssue", {
		issueId: options.issueId,
		assigneeId: options.assigneeId || null,
	});

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}
