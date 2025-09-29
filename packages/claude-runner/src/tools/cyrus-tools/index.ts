import { basename, extname } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { LinearClient } from "@linear/sdk";
import fs from "fs-extra";
import { z } from "zod";

/**
 * Detect MIME type based on file extension
 */
function getMimeType(filename: string): string {
	const ext = extname(filename).toLowerCase();
	const mimeTypes: Record<string, string> = {
		// Images
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".svg": "image/svg+xml",
		".webp": "image/webp",
		".bmp": "image/bmp",
		".ico": "image/x-icon",

		// Documents
		".pdf": "application/pdf",
		".doc": "application/msword",
		".docx":
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xls": "application/vnd.ms-excel",
		".xlsx":
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".ppt": "application/vnd.ms-powerpoint",
		".pptx":
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",

		// Text
		".txt": "text/plain",
		".md": "text/markdown",
		".csv": "text/csv",
		".json": "application/json",
		".xml": "application/xml",
		".html": "text/html",
		".css": "text/css",
		".js": "application/javascript",
		".ts": "application/typescript",

		// Archives
		".zip": "application/zip",
		".tar": "application/x-tar",
		".gz": "application/gzip",
		".rar": "application/vnd.rar",
		".7z": "application/x-7z-compressed",

		// Media
		".mp3": "audio/mpeg",
		".wav": "audio/wav",
		".mp4": "video/mp4",
		".mov": "video/quicktime",
		".avi": "video/x-msvideo",
		".webm": "video/webm",

		// Other
		".log": "text/plain",
		".yml": "text/yaml",
		".yaml": "text/yaml",
	};

	return mimeTypes[ext] || "application/octet-stream";
}

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
}

/**
 * Create an SDK MCP server with the inline Cyrus tools
 */
export function createCyrusToolsServer(
	linearApiToken: string,
	options: CyrusToolsOptions = {},
) {
	const linearClient = new LinearClient({ apiKey: linearApiToken });

	// Create tools with bound linear client
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
				// Read file and get stats
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

				const fileBuffer = await fs.readFile(filePath);
				const finalFilename = filename || basename(filePath);
				const finalContentType = contentType || getMimeType(finalFilename);
				const size = stats.size;

				// Step 1: Request upload URL from Linear
				console.log(
					`Requesting upload URL for ${finalFilename} (${size} bytes, ${finalContentType})`,
				);

				// Use LinearClient's fileUpload method directly
				const uploadPayload = await linearClient.fileUpload(
					finalContentType,
					finalFilename,
					size,
					{ makePublic },
				);

				if (!uploadPayload.success || !uploadPayload.uploadFile) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: "Failed to get upload URL from Linear",
								}),
							},
						],
					};
				}

				const { uploadUrl, headers, assetUrl } = uploadPayload.uploadFile;

				// Step 2: Upload the file to the provided URL
				console.log(`Uploading file to Linear cloud storage...`);

				// Create headers following Linear's documentation exactly
				const uploadHeaders: Record<string, string> = {
					"Content-Type": finalContentType,
					"Cache-Control": "public, max-age=31536000",
				};

				// Then add the headers from Linear's response
				// These override any defaults we set above
				for (const header of headers) {
					uploadHeaders[header.key] = header.value;
				}

				console.log(`Headers being sent:`, uploadHeaders);

				const uploadResponse = await fetch(uploadUrl, {
					method: "PUT",
					headers: uploadHeaders,
					body: fileBuffer,
				});

				if (!uploadResponse.ok) {
					const errorText = await uploadResponse.text();
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`,
								}),
							},
						],
					};
				}

				console.log(`File uploaded successfully: ${assetUrl}`);

				// Return the asset URL and metadata
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								assetUrl,
								filename: finalFilename,
								size,
								contentType: finalContentType,
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
				// Use raw GraphQL through the Linear client
				// Access the underlying GraphQL client
				const graphQLClient = (linearClient as any).client;

				const mutation = `
					mutation AgentSessionCreateOnIssue($input: AgentSessionCreateOnIssue!) {
						agentSessionCreateOnIssue(input: $input) {
							success
							lastSyncId
							agentSession {
								id
							}
						}
					}
				`;

				const variables = {
					input: {
						issueId,
						...(externalLink && { externalLink }),
					},
				};

				console.log(`Creating agent session for issue ${issueId}`);

				const response = await graphQLClient.rawRequest(mutation, variables);

				const result = response.data.agentSessionCreateOnIssue;

				if (!result.success) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: "Failed to create agent session",
								}),
							},
						],
					};
				}

				const agentSessionId = result.agentSession.id;
				console.log(`Agent session created successfully: ${agentSessionId}`);

				// Register the child-to-parent mapping if we have a parent session
				if (options.parentSessionId && options.onSessionCreated) {
					console.log(
						`[CyrusTools] Mapping child session ${agentSessionId} to parent ${options.parentSessionId}`,
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
				// Use raw GraphQL through the Linear client
				// Access the underlying GraphQL client
				const graphQLClient = (linearClient as any).client;

				const mutation = `
					mutation AgentSessionCreateOnComment($input: AgentSessionCreateOnComment!) {
						agentSessionCreateOnComment(input: $input) {
							success
							lastSyncId
							agentSession {
								id
							}
						}
					}
				`;

				const variables = {
					input: {
						commentId,
						...(externalLink && { externalLink }),
					},
				};

				console.log(`Creating agent session for comment ${commentId}`);

				const response = await graphQLClient.rawRequest(mutation, variables);

				const result = response.data.agentSessionCreateOnComment;

				if (!result.success) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: "Failed to create agent session on comment",
								}),
							},
						],
					};
				}

				const agentSessionId = result.agentSession.id;
				console.log(
					`Agent session created successfully on comment: ${agentSessionId}`,
				);

				// Register the child-to-parent mapping if we have a parent session
				if (options.parentSessionId && options.onSessionCreated) {
					console.log(
						`[CyrusTools] Mapping child session ${agentSessionId} to parent ${options.parentSessionId}`,
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
			let delivered = false;
			if (options.onFeedbackDelivery) {
				console.log(
					`[CyrusTools] Delivering feedback to child session ${agentSessionId}`,
				);
				try {
					delivered = await options.onFeedbackDelivery(agentSessionId, message);
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

			// Return success even if delivery wasn't possible
			// (the child session might not have a parent)
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: true,
							delivered,
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
				// Validate and clamp limit
				const finalLimit = Math.min(Math.max(1, limit), 250);

				console.log(
					`Getting child issues for ${issueId} (limit: ${finalLimit})`,
				);

				// Fetch the parent issue first
				const issue = await linearClient.issue(issueId);

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

				// Build the filter for child issues
				const filter: any = {};

				if (!includeCompleted) {
					filter.state = { type: { neq: "completed" } };
				}

				if (!includeArchived) {
					filter.archivedAt = { null: true };
				}

				// Get child issues using the children() method
				const childrenConnection = await issue.children({
					first: finalLimit,
					...(Object.keys(filter).length > 0 && { filter }),
				});

				// Extract the child issues from the connection
				const children = await childrenConnection.nodes;

				// Process each child to get detailed information
				const childrenData = await Promise.all(
					children.map(async (child) => {
						const [state, assignee] = await Promise.all([
							child.state,
							child.assignee,
						]);

						return {
							id: child.id,
							identifier: child.identifier,
							title: child.title,
							state: state?.name || "Unknown",
							stateType: state?.type || null,
							assignee: assignee?.name || null,
							assigneeId: assignee?.id || null,
							priority: child.priority,
							priorityLabel: child.priorityLabel,
							createdAt: child.createdAt.toISOString(),
							updatedAt: child.updatedAt.toISOString(),
							url: child.url,
							archivedAt: child.archivedAt?.toISOString() || null,
						};
					}),
				);

				console.log(`Found ${childrenData.length} child issues for ${issueId}`);

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
