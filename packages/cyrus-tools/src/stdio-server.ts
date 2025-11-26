/**
 * Standard MCP Server implementation using @modelcontextprotocol/sdk
 *
 * This provides a stdio-based MCP server that is compatible with:
 * - Gemini CLI
 * - Claude Desktop
 * - Any other MCP-compliant client
 */

import { basename, extname } from "node:path";
import { LinearClient } from "@linear/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
 * Start the MCP server with stdio transport
 *
 * @param linearApiToken - The Linear API token for authentication
 */
export async function startStdioServer(linearApiToken: string): Promise<void> {
	const linearClient = new LinearClient({ apiKey: linearApiToken });

	const server = new McpServer({
		name: "cyrus-tools",
		version: "1.0.0",
	});

	// Register: linear_upload_file
	server.tool(
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

				const uploadHeaders: Record<string, string> = {
					"Content-Type": finalContentType,
					"Cache-Control": "public, max-age=31536000",
				};

				for (const header of headers) {
					uploadHeaders[header.key] = header.value;
				}

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

	// Register: linear_agent_session_create
	server.tool(
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

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: result.success,
								agentSessionId: result.agentSession.id,
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

	// Register: linear_agent_session_create_on_comment
	server.tool(
		"linear_agent_session_create_on_comment",
		"Create an agent session on a Linear root comment (not a reply) to trigger a sub-agent for processing child issues or tasks.",
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

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: result.success,
								agentSessionId: result.agentSession.id,
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

	// Register: linear_get_child_issues
	server.tool(
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
				const finalLimit = Math.min(Math.max(1, limit), 250);

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

				const filter: any = {};

				if (!includeCompleted) {
					filter.state = { type: { neq: "completed" } };
				}

				if (!includeArchived) {
					filter.archivedAt = { null: true };
				}

				const childrenConnection = await issue.children({
					first: finalLimit,
					...(Object.keys(filter).length > 0 && { filter }),
				});

				const children = await childrenConnection.nodes;

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

	// Connect to stdio transport
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
