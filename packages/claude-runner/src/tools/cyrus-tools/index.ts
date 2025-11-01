import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/**
 * Options for creating Cyrus tools with session management capabilities
 */
export interface CyrusToolsOptions {
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

	/**
	 * Optional custom adapter for agent platform operations
	 * If not provided, will default to creating LinearAgentPlatformAdapter dynamically
	 */
	adapter?: any;
}

/**
 * Create an SDK MCP server with the inline Cyrus tools
 */
export function createCyrusToolsServer(
	linearApiToken: string,
	options: CyrusToolsOptions = {},
) {
	// Lazy load the LinearAgentPlatformAdapter to avoid circular dependency
	let adapter = options.adapter;

	if (!adapter) {
		// Dynamically import only if needed, to avoid circular dependency with cyrus-core
		const initAdapter = async () => {
			const { LinearAgentPlatformAdapter } = await import("cyrus-core");
			return new LinearAgentPlatformAdapter({ apiToken: linearApiToken });
		};

		// For now, we create a wrapper that will call initAdapter when needed
		// This is necessary because we can't use top-level await
		let cachedAdapter: any | null = null;

		const getAdapter = async () => {
			if (!cachedAdapter) {
				cachedAdapter = await initAdapter();
			}
			return cachedAdapter;
		};

		// Create a proxy adapter that defers initialization
		adapter = {
			async getIssue(issueId: string) {
				return (await getAdapter()).getIssue(issueId);
			},
			async getChildIssues(issueId: string, options?: any) {
				return (await getAdapter()).getChildIssues(issueId, options);
			},
			async getComment(commentId: string) {
				return (await getAdapter()).getComment(commentId);
			},
			async createSessionOnIssue(issueId: string, externalLink?: string) {
				return (await getAdapter()).createSessionOnIssue(issueId, externalLink);
			},
			async createSessionOnComment(commentId: string, externalLink?: string) {
				return (await getAdapter()).createSessionOnComment(
					commentId,
					externalLink,
				);
			},
			async updateSessionStatus(
				sessionId: string,
				status: string,
				metadata?: Record<string, unknown>,
			) {
				return (await getAdapter()).updateSessionStatus(
					sessionId,
					status,
					metadata,
				);
			},
			async postAgentActivity(
				sessionId: string,
				content: string,
				contentType:
					| "prompt"
					| "observation"
					| "action"
					| "error"
					| "elicitation"
					| "response",
			) {
				return (await getAdapter()).postAgentActivity(
					sessionId,
					content,
					contentType,
				);
			},
			async uploadFile(
				filePath: string,
				filename?: string,
				contentType?: string,
				makePublic?: boolean,
			) {
				return (await getAdapter()).uploadFile(
					filePath,
					filename,
					contentType,
					makePublic,
				);
			},
			async giveFeedback(sessionId: string, message: string) {
				return (await getAdapter()).giveFeedback(sessionId, message);
			},
		} as any;
	}

	// Create tools with bound adapter
	const uploadTool = tool(
		"linear_upload_file",
		"Upload a file to Linear. Returns an asset URL that can be used in issue descriptions or comments.",
		{
			filePath: z.string().describe("The absolute path to the file to upload"),
			filename: z
				.string()
				.optional()
				.describe(
					"The filename to use in Linear (optional, defaults to basename of filePath)",
				),
			contentType: z
				.string()
				.optional()
				.describe(
					"MIME type of the file (optional, auto-detected if not provided)",
				),
			makePublic: z
				.boolean()
				.optional()
				.describe(
					"Whether to make the file publicly accessible (default: false)",
				),
		},
		async ({ filePath, filename, contentType, makePublic }) => {
			try {
				// Use adapter for file upload
				const result = await adapter.uploadFile(
					filePath,
					filename,
					contentType,
					makePublic,
				);

				if (!result.success) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: result.error || "Failed to upload file",
								}),
							},
						],
					};
				}

				// Return the asset URL and metadata
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								assetUrl: result.assetUrl,
								filename: result.filename,
								size: result.size,
								contentType: result.contentType,
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
		"linear_agent_session_create",
		"Create an agent session on a Linear issue to track AI/bot activity.",
		{
			issueId: z
				.string()
				.describe(
					'The ID or identifier of the Linear issue (e.g., "ABC-123" or UUID)',
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
				// Use adapter for session creation
				const result = await adapter.createSessionOnIssue(
					issueId,
					externalLink,
				);

				if (!result.success) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: result.error || "Failed to create agent session",
								}),
							},
						],
					};
				}

				const agentSessionId = result.agentSessionId;
				console.log(`Agent session created successfully: ${agentSessionId}`);

				// Register the child-to-parent mapping if we have a parent session
				if (options.parentSessionId && options.onSessionCreated) {
					const parentSessionId = options.parentSessionId!;
					console.log(
						`[CyrusTools] Mapping child session ${agentSessionId} to parent ${parentSessionId}`,
					);
					options.onSessionCreated(agentSessionId, parentSessionId);
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
		"linear_agent_session_create_on_comment",
		"Create an agent session on a Linear root comment (not a reply) to trigger a sub-agent for processing child issues or tasks. See Linear API docs: https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/inputs/AgentSessionCreateOnComment",
		{
			commentId: z
				.string()
				.describe(
					"The ID of the Linear root comment (not a reply) to create the session on",
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
				// Use adapter for session creation on comment
				const result = await adapter.createSessionOnComment(
					commentId,
					externalLink,
				);

				if (!result.success) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error:
										result.error || "Failed to create agent session on comment",
								}),
							},
						],
					};
				}

				const agentSessionId = result.agentSessionId;
				console.log(
					`Agent session created successfully on comment: ${agentSessionId}`,
				);

				// Register the child-to-parent mapping if we have a parent session
				if (options.parentSessionId && options.onSessionCreated) {
					const parentSessionId = options.parentSessionId!;
					console.log(
						`[CyrusTools] Mapping child session ${agentSessionId} to parent ${parentSessionId}`,
					);
					options.onSessionCreated(agentSessionId, parentSessionId);
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
		"linear_agent_give_feedback",
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
					`[CyrusTools] Delivering feedback to child session ${agentSessionId}`,
				);
				try {
					const delivered = await options.onFeedbackDelivery(
						agentSessionId,
						message,
					);
					if (delivered) {
						console.log(
							`[CyrusTools] Feedback delivered successfully to parent session`,
						);
					} else {
						console.log(
							`[CyrusTools] No parent session found for child ${agentSessionId}`,
						);
					}
				} catch (error) {
					console.error(`[CyrusTools] Failed to deliver feedback:`, error);
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
		"linear_get_child_issues",
		"Get all child issues (sub-issues) for a given Linear issue. Takes an issue identifier like 'CYHOST-91' and returns a list of child issue ids and their titles.",
		{
			issueId: z
				.string()
				.describe(
					"The ID or identifier of the parent issue (e.g., 'CYHOST-91' or UUID)",
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
				// Use adapter to fetch parent issue and child issues
				const parentIssue = await adapter.getIssue(issueId);

				if (!parentIssue) {
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

				// Get child issues using adapter
				const childrenData = await adapter.getChildIssues(issueId, {
					limit,
					includeCompleted,
					includeArchived,
				});

				console.log(`Found ${childrenData.length} child issues for ${issueId}`);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									success: true,
									parentIssue: {
										id: parentIssue.id,
										identifier: parentIssue.identifier,
										title: parentIssue.title,
										url: parentIssue.url,
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
				console.error(`Error getting child issues for ${issueId}:`, error);
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
		name: "cyrus-tools",
		version: "1.0.0",
		tools: [
			uploadTool,
			agentSessionTool,
			agentSessionOnCommentTool,
			giveFeedbackTool,
			getChildIssuesTool,
		],
	});
}
