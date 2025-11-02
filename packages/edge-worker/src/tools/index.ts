import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CLIIssueTrackerService, Issue } from "cyrus-core";
import { z } from "zod";

/**
 * Options for creating CLI tools with session management capabilities
 */
export interface CLIToolsOptions {
	/**
	 * Callback to register a child-to-parent session mapping
	 * Called when a new agent session is created
	 */
	onSessionCreated?: (childSessionId: string, parentSessionId: string) => void;

	/**
	 * Callback to deliver feedback to a parent session
	 * Called when feedback is given to a child session
	 */
	onFeedbackDelivery?: (
		childSessionId: string,
		message: string,
	) => Promise<boolean>;

	/**
	 * The ID of the current parent session (if any)
	 */
	parentSessionId?: string;
}

/**
 * Create an SDK MCP server with CLI-specific tools that use CLIIssueTrackerService
 * instead of LinearClient. This provides the same tool interface as cyrus-tools
 * but works with the in-memory CLI issue tracker.
 */
export function createCLIToolsServer(
	issueTrackerService: CLIIssueTrackerService,
	options: CLIToolsOptions = {},
) {
	const uploadFileTool = tool(
		"issue_tracker_upload_file",
		"Upload a file for use in issue descriptions or comments. In CLI mode, files are copied to a local directory.",
		{
			filePath: z.string().describe("The absolute path to the file to upload"),
			filename: z
				.string()
				.optional()
				.describe("Optional custom filename (defaults to original filename)"),
		},
		async ({ filePath, filename }) => {
			try {
				// For CLI mode, we'll implement a simple file copy to a local uploads directory
				// This allows testing file upload workflows without needing cloud storage
				const fs = await import("fs-extra");
				const path = await import("node:path");

				const stats = await fs.stat(filePath);
				if (!stats.isFile()) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Path ${filePath} is not a file`,
								}),
							},
						],
					};
				}

				const finalFilename = filename || path.basename(filePath);
				const uploadsDir = path.join(process.cwd(), ".cli-uploads");
				await fs.ensureDir(uploadsDir);

				const destPath = path.join(uploadsDir, finalFilename);
				await fs.copyFile(filePath, destPath);

				// Return a file:// URL for the uploaded file
				const fileUrl = `file://${destPath}`;

				console.log(
					`[CLITools] File uploaded: ${finalFilename} -> ${destPath}`,
				);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								assetUrl: fileUrl,
								filename: finalFilename,
								size: stats.size,
								localPath: destPath,
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const agentSessionTool = tool(
		"issue_tracker_agent_session_create",
		"Create an agent session on an issue to track AI/bot activity.",
		{
			issueId: z
				.string()
				.describe(
					'The ID or identifier of the issue (e.g., "ABC-123" or UUID)',
				),
			externalLink: z
				.string()
				.optional()
				.describe(
					"Optional URL of an external agent-hosted page associated with this session",
				),
		},
		async ({ issueId, externalLink }) => {
			try {
				console.log(`[CLITools] Creating agent session for issue ${issueId}`);

				const result = await issueTrackerService.createAgentSessionOnIssue({
					issueId,
					...(externalLink && { externalLink }),
				});

				const agentSessionId = result.agentSessionId;
				console.log(
					`[CLITools] Agent session created successfully: ${agentSessionId}`,
				);

				// Register the child-to-parent mapping if we have a parent session
				if (options.parentSessionId && options.onSessionCreated) {
					console.log(
						`[CLITools] Mapping child session ${agentSessionId} to parent ${options.parentSessionId}`,
					);
					options.onSessionCreated(agentSessionId, options.parentSessionId);
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: result.success,
								agentSessionId,
								lastSyncId: result.lastSyncId,
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const agentSessionOnCommentTool = tool(
		"issue_tracker_agent_session_create_on_comment",
		"Create an agent session on a root comment (not a reply) to trigger a sub-agent for processing.",
		{
			commentId: z
				.string()
				.describe(
					"The ID of the root comment (not a reply) to create the session on",
				),
			externalLink: z
				.string()
				.optional()
				.describe(
					"Optional URL of an external agent-hosted page associated with this session",
				),
		},
		async ({ commentId, externalLink }) => {
			try {
				console.log(
					`[CLITools] Creating agent session for comment ${commentId}`,
				);

				const result = await issueTrackerService.createAgentSessionOnComment({
					commentId,
					...(externalLink && { externalLink }),
				});

				const agentSessionId = result.agentSessionId;
				console.log(
					`[CLITools] Agent session created successfully on comment: ${agentSessionId}`,
				);

				// Register the child-to-parent mapping if we have a parent session
				if (options.parentSessionId && options.onSessionCreated) {
					console.log(
						`[CLITools] Mapping child session ${agentSessionId} to parent ${options.parentSessionId}`,
					);
					options.onSessionCreated(agentSessionId, options.parentSessionId);
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: result.success,
								agentSessionId,
								lastSyncId: result.lastSyncId,
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const giveFeedbackTool = tool(
		"issue_tracker_agent_give_feedback",
		"Provide feedback to a child agent session to continue its processing.",
		{
			agentSessionId: z
				.string()
				.describe("The ID of the child agent session to provide feedback to"),
			message: z
				.string()
				.describe("The feedback message to send to the child agent session"),
		},
		async ({ agentSessionId, message }) => {
			// Validate parameters
			if (!agentSessionId) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: "agentSessionId is required",
							}),
						},
					],
				};
			}

			if (!message) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: "message is required",
							}),
						},
					],
				};
			}

			// Deliver the feedback through the callback if provided
			if (options.onFeedbackDelivery) {
				console.log(
					`[CLITools] Delivering feedback to child session ${agentSessionId}`,
				);
				try {
					const delivered = await options.onFeedbackDelivery(
						agentSessionId,
						message,
					);
					if (delivered) {
						console.log(
							`[CLITools] Feedback delivered successfully to parent session`,
						);
					} else {
						console.log(
							`[CLITools] No parent session found for child ${agentSessionId}`,
						);
					}
				} catch (error) {
					console.error(`[CLITools] Failed to deliver feedback:`, error);
				}
			}

			// Return success - feedback has been queued for delivery
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: true,
						}),
					},
				],
			};
		},
	);

	const getChildIssuesTool = tool(
		"issue_tracker_get_child_issues",
		"Get all child issues (sub-issues) for a given issue. Takes an issue identifier and returns a list of child issue ids and their titles.",
		{
			issueId: z
				.string()
				.describe(
					"The ID or identifier of the parent issue (e.g., 'TEAM-91' or UUID)",
				),
			limit: z
				.number()
				.optional()
				.describe(
					"Maximum number of child issues to return (default: 50, max: 250)",
				),
			includeCompleted: z
				.boolean()
				.optional()
				.describe("Whether to include completed child issues (default: true)"),
			includeArchived: z
				.boolean()
				.optional()
				.describe("Whether to include archived child issues (default: false)"),
		},
		async ({
			issueId,
			limit = 50,
			includeCompleted = true,
			includeArchived = false,
		}) => {
			try {
				// Validate and clamp limit
				const finalLimit = Math.min(Math.max(1, limit), 250);

				console.log(
					`[CLITools] Getting child issues for ${issueId} (limit: ${finalLimit})`,
				);

				// Fetch the parent issue first
				const issue = await issueTrackerService.fetchIssue(issueId);

				if (!issue) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Issue ${issueId} not found`,
								}),
							},
						],
					};
				}

				// Get child issues using the fetchIssueChildren method
				const childrenResult = await issueTrackerService.fetchIssueChildren(
					issueId,
					{
						limit: finalLimit,
						includeArchived,
						includeCompleted,
					},
				);

				// The children are already filtered by the service based on includeCompleted
				const children: Issue[] = childrenResult.children;

				// Helper function to get priority label
				const getPriorityLabel = (priority?: number): string | null => {
					if (priority === undefined) return null;
					const labels = ["No priority", "Urgent", "High", "Normal", "Low"];
					return labels[priority] || null;
				};

				// Format child issue data
				const childrenData = children.map((child: Issue) => {
					// Handle state - it could be a Promise or undefined in the type system,
					// but in practice it should be resolved by the service
					const state =
						child.state instanceof Promise ? undefined : child.state;
					const assignee =
						child.assignee instanceof Promise ? undefined : child.assignee;

					return {
						id: child.id,
						identifier: child.identifier,
						title: child.title,
						state: state?.name || "Unknown",
						stateType: state?.type || null,
						assignee: assignee?.name || null,
						assigneeId: assignee?.id || null,
						priority: child.priority || 0,
						priorityLabel: getPriorityLabel(child.priority),
						createdAt: child.createdAt,
						updatedAt: child.updatedAt,
						url: child.url,
						archivedAt: child.archivedAt || null,
					};
				});

				console.log(
					`[CLITools] Found ${childrenData.length} child issues for ${issueId}`,
				);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									success: true,
									parentIssue: {
										id: issue.id,
										identifier: issue.identifier,
										title: issue.title,
										url: issue.url,
									},
									childCount: childrenData.length,
									children: childrenData,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				console.error(
					`[CLITools] Error getting child issues for ${issueId}:`,
					error,
				);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	return createSdkMcpServer({
		name: "issue-tracker",
		version: "1.0.0",
		tools: [
			uploadFileTool,
			agentSessionTool,
			agentSessionOnCommentTool,
			giveFeedbackTool,
			getChildIssuesTool,
		],
	});
}
