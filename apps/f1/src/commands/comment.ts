import { rpc } from "../client/RPCClient.js";
import { c } from "../utils/colors.js";
import { printJSON } from "../utils/formatter.js";

/**
 * Create comment options
 */
export interface CreateCommentOptions {
	issueId: string;
	body: string;
	mentionAgent?: boolean;
}

/**
 * Create a comment on an issue
 */
export async function createComment(
	options: CreateCommentOptions,
): Promise<void> {
	const result = await rpc("createComment", {
		issueId: options.issueId,
		body: options.body,
		mentionAgent: options.mentionAgent === true,
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
