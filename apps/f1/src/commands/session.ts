import { rpc } from "../client/RPCClient.js";
import type {
	Activity,
	ActivityDisplayOptions,
	AgentSession,
} from "../types/index.js";
import { c } from "../utils/colors.js";
import { displayActivities, printJSON } from "../utils/formatter.js";

/**
 * Start session on issue
 */
export async function startSession(issueId: string): Promise<void> {
	const result = await rpc<{ agentSessionId: string }>(
		"startAgentSessionOnIssue",
		{
			issueId,
		},
	);

	if (result.success && result.data) {
		const sessionId = result.data.agentSessionId;
		console.log(c.success(`\n✅ Session Started: ${c.bold(sessionId)}\n`));
		console.log(c.dim("💡 Next steps:"));
		console.log(
			c.dim(
				`   • View progress: ${c.command(`f1 viewSession --session-id ${sessionId}`)}`,
			),
		);
		console.log(
			c.dim(
				`   • Send message: ${c.command(`f1 promptSession --session-id ${sessionId} --message "..."`)}`,
			),
		);
		console.log(
			c.dim(
				`   • Stop session: ${c.command(`f1 stopSession --session-id ${sessionId}`)}`,
			),
		);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Start session on comment
 */
export async function startSessionOnComment(commentId: string): Promise<void> {
	const result = await rpc("startAgentSessionOnComment", { commentId });

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * View session options
 */
export interface ViewSessionOptions {
	sessionId: string;
	limit?: number;
	offset?: number;
	search?: string;
	full?: boolean;
	previewLength?: number;
	summary?: boolean;
}

/**
 * View an agent session
 */
export async function viewSession(options: ViewSessionOptions): Promise<void> {
	const result = await rpc<{ session: AgentSession; activities: Activity[] }>(
		"viewAgentSession",
		{
			sessionId: options.sessionId,
		},
	);

	if (result.success && result.data) {
		const { session, activities } = result.data;

		// Status badge with emoji
		let statusBadge: string;
		switch (session.status) {
			case "executing":
				statusBadge = `🟢 ${c.success(session.status)}`;
				break;
			case "pending":
				statusBadge = `⚪ ${c.dim(session.status)}`;
				break;
			case "waiting":
				statusBadge = `🟡 ${c.warning(session.status)}`;
				break;
			case "stopped":
			case "failed":
				statusBadge = `🔴 ${c.error(session.status)}`;
				break;
			default:
				statusBadge = c.value(session.status);
		}

		console.log(c.success("\n✅ Agent Session\n"));
		console.log(`   ${c.bold("ID:")} ${c.value(session.id)}`);
		console.log(`   ${c.bold("Status:")} ${statusBadge}`);
		console.log(`   ${c.bold("Type:")} ${c.value(session.type)}`);
		console.log(`   ${c.bold("Issue ID:")} ${c.value(session.issueId)}`);
		if (session.commentId) {
			console.log(`   ${c.bold("Comment ID:")} ${c.value(session.commentId)}`);
		}
		console.log(
			`   ${c.bold("Activities:")} ${c.value(String(activities.length))} total`,
		);

		// Show last activity time to indicate if actively working
		if (activities.length > 0) {
			const lastActivity = [...activities].sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			)[0];
			if (!lastActivity) {
				throw new Error("No last activity found");
			}
			const lastUpdate = new Date(lastActivity.createdAt);
			const now = new Date();
			const secAgo = Math.floor((now.getTime() - lastUpdate.getTime()) / 1000);
			const timeAgo =
				secAgo < 60
					? `${secAgo}s ago`
					: secAgo < 3600
						? `${Math.floor(secAgo / 60)}m ago`
						: `${Math.floor(secAgo / 3600)}h ago`;
			console.log(`   ${c.bold("Last Activity:")} ${c.dim(timeAgo)}`);
		}

		console.log(
			`   ${c.bold("Created:")} ${c.dim(new Date(session.createdAt).toLocaleString())}`,
		);
		console.log(
			`   ${c.bold("Updated:")} ${c.dim(new Date(session.updatedAt).toLocaleString())}`,
		);

		// If --summary flag, find and display final response prominently
		if (options.summary) {
			const responseActivity = [...activities]
				.sort(
					(a, b) =>
						new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
				)
				.find((a) => a.content?.type === "response");

			if (responseActivity) {
				console.log();
				console.log(c.success("📋 Final Response Summary"));
				console.log();
				const body = responseActivity.content?.body || "(no content)";
				console.log(
					body
						.split("\n")
						.map((line) => `   ${line}`)
						.join("\n"),
				);
				console.log();
			} else {
				console.log();
				console.log(c.dim("   No final response found yet."));
				console.log();
			}
		}

		// Display paginated activities
		const displayOptions: ActivityDisplayOptions = {
			limit: options.limit,
			offset: options.offset,
			search: options.search,
			full: options.full,
			previewLength: options.previewLength,
		};
		displayActivities(activities, displayOptions);
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Prompt session options
 */
export interface PromptSessionOptions {
	sessionId: string;
	message: string;
}

/**
 * Send a prompt to an agent session
 */
export async function promptSession(
	options: PromptSessionOptions,
): Promise<void> {
	const result = await rpc("promptAgentSession", {
		sessionId: options.sessionId,
		message: options.message,
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

/**
 * Stop an agent session
 */
export async function stopSession(sessionId: string): Promise<void> {
	const result = await rpc("stopAgentSession", { sessionId });

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Get activity options
 */
export interface GetActivityOptions {
	sessionId: string;
	activityId: string;
}

/**
 * Get a single activity's details
 */
export async function getActivity(options: GetActivityOptions): Promise<void> {
	const result = await rpc<Activity>("getActivity", {
		sessionId: options.sessionId,
		activityId: options.activityId,
	});

	if (result.success && result.data) {
		const activity = result.data;
		console.log(c.success("\n✅ Activity Details\n"));
		console.log(`   ${c.bold("ID:")} ${c.value(activity.id)}`);
		console.log(
			`   ${c.bold("Type:")} ${c.value(activity.content?.type || "unknown")}`,
		);
		console.log(
			`   ${c.bold("Created:")} ${c.dim(new Date(activity.createdAt).toLocaleString())}`,
		);
		if (activity.signal) {
			console.log(
				`   ${c.bold("Signal:")} ${c.warning(activity.signal.toUpperCase())}`,
			);
		}
		console.log();
		console.log(c.bold("Body:"));
		console.log();
		const body = activity.content?.body || "(no content)";
		console.log(
			body
				.split("\n")
				.map((line) => `   ${line}`)
				.join("\n"),
		);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}
