import crypto from "node:crypto";
import { basename, extname } from "node:path";
import { IssueRelationType, LinearClient } from "@linear/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import FastifyMcpServer from "fastify-mcp-server";
import fs from "fs-extra";
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
}

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
 * HTTP MCP server that wraps cyrus-tools using fastify-mcp-server
 */
export class CyrusToolsHttpServer {
	private readonly token: string;
	private readonly linearClient: LinearClient;
	private readonly options: CyrusToolsOptions;
	private readonly mcpServer: McpServer;

	constructor(
		fastify: FastifyInstance,
		linearApiToken: string,
		options: CyrusToolsOptions = {},
	) {
		// Generate cryptographically secure random token
		this.token = crypto.randomBytes(32).toString("hex");
		this.linearClient = new LinearClient({ apiKey: linearApiToken });
		this.options = options;

		// Create MCP server instance
		this.mcpServer = new McpServer(
			{
				name: "cyrus-tools",
				version: "1.0.0",
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		// Register all 8 cyrus-tools
		this.registerTools();

		// Register with Fastify using bearer token authentication
		this.registerWithFastify(fastify);
	}

	/**
	 * Get the bearer token for authenticating with this MCP server
	 */
	getToken(): string {
		return this.token;
	}

	/**
	 * Register all cyrus-tools with the MCP server
	 */
	private registerTools(): void {
		// 1. Upload file tool
		this.mcpServer.registerTool(
			"linear_upload_file",
			{
				description:
					"Upload a file to Linear. Returns an asset URL that can be used in issue descriptions or comments.",
				inputSchema: {
					filePath: z
						.string()
						.describe("The absolute path to the file to upload") as any,
					filename: z
						.string()
						.optional()
						.describe(
							"The filename to use in Linear (optional, defaults to basename of filePath)",
						) as any,
					contentType: z
						.string()
						.optional()
						.describe(
							"MIME type of the file (optional, auto-detected if not provided)",
						) as any,
					makePublic: z
						.boolean()
						.optional()
						.describe(
							"Whether to make the file publicly accessible (default: false)",
						) as any,
				},
			},
			async (_args: any, _extra: any) => {
				const { filePath, filename, contentType, makePublic } = _args;
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

					console.log(
						`Requesting upload URL for ${finalFilename} (${size} bytes, ${finalContentType})`,
					);

					const uploadPayload = await this.linearClient.fileUpload(
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

					console.log(`Uploading file to Linear cloud storage...`);

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

					console.log(`File uploaded successfully: ${assetUrl}`);

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

		// 2. Create agent session on issue
		this.mcpServer.registerTool(
			"linear_agent_session_create",
			{
				description:
					"Create an agent session on a Linear issue to track AI/bot activity.",
				inputSchema: {
					issueId: z
						.string()
						.describe(
							'The ID or identifier of the Linear issue (e.g., "ABC-123" or UUID)',
						) as any,
					externalLink: z
						.string()
						.optional()
						.describe(
							"Optional URL of an external agent-hosted page associated with this session",
						) as any,
				},
			},
			async (_args: any, _extra: any) => {
				const { issueId, externalLink } = _args;
				try {
					const graphQLClient = (this.linearClient as any).client;

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

					if (this.options.parentSessionId && this.options.onSessionCreated) {
						console.log(
							`[CyrusTools] Mapping child session ${agentSessionId} to parent ${this.options.parentSessionId}`,
						);
						this.options.onSessionCreated(
							agentSessionId,
							this.options.parentSessionId,
						);
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

		// 3. Create agent session on comment
		this.mcpServer.registerTool(
			"linear_agent_session_create_on_comment",
			{
				description:
					"Create an agent session on a Linear root comment (not a reply) to trigger a sub-agent for processing child issues or tasks.",
				inputSchema: {
					commentId: z
						.string()
						.describe(
							"The ID of the Linear root comment (not a reply) to create the session on",
						) as any,
					externalLink: z
						.string()
						.optional()
						.describe(
							"Optional URL of an external agent-hosted page associated with this session",
						) as any,
				},
			},
			async (_args: any, _extra: any) => {
				const { commentId, externalLink } = _args;
				try {
					const graphQLClient = (this.linearClient as any).client;

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

					if (this.options.parentSessionId && this.options.onSessionCreated) {
						console.log(
							`[CyrusTools] Mapping child session ${agentSessionId} to parent ${this.options.parentSessionId}`,
						);
						this.options.onSessionCreated(
							agentSessionId,
							this.options.parentSessionId,
						);
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

		// 4. Give feedback to agent session
		this.mcpServer.registerTool(
			"linear_agent_give_feedback",
			{
				description:
					"Provide feedback to a child agent session to continue its processing.",
				inputSchema: {
					agentSessionId: z
						.string()
						.describe(
							"The ID of the child agent session to provide feedback to",
						) as any,
					message: z
						.string()
						.describe(
							"The feedback message to send to the child agent session",
						) as any,
				},
			},
			async (_args: any, _extra: any) => {
				const { agentSessionId, message } = _args;
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

				if (this.options.onFeedbackDelivery) {
					console.log(
						`[CyrusTools] Delivering feedback to child session ${agentSessionId}`,
					);
					try {
						const delivered = await this.options.onFeedbackDelivery(
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

		// 5. Set issue relation
		this.mcpServer.registerTool(
			"linear_set_issue_relation",
			{
				description:
					"Create a relationship between two Linear issues. Use this to set 'blocks', 'related', or 'duplicate' relationships.",
				inputSchema: {
					issueId: z
						.string()
						.describe(
							"The BLOCKING issue (the one that must complete first). For 'blocks' type: this issue blocks relatedIssueId.",
						) as any,
					relatedIssueId: z
						.string()
						.describe(
							"The BLOCKED issue (the one that depends on issueId). For 'blocks' type: this issue is blocked by issueId.",
						) as any,
					type: z
						.enum(["blocks", "related", "duplicate"])
						.describe(
							"The type of relation: 'blocks', 'related', or 'duplicate'",
						) as any,
				},
			},
			async (_args: any, _extra: any) => {
				const { issueId, relatedIssueId, type } = _args;
				try {
					console.log(
						`Creating ${type} relation: ${issueId} -> ${relatedIssueId}`,
					);

					const issue = await this.linearClient.issue(issueId);
					const relatedIssue = await this.linearClient.issue(relatedIssueId);

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

					if (!relatedIssue) {
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										success: false,
										error: `Related issue ${relatedIssueId} not found`,
									}),
								},
							],
						};
					}

					const relationTypeMap: Record<
						"blocks" | "related" | "duplicate",
						IssueRelationType
					> = {
						blocks: IssueRelationType.Blocks,
						related: IssueRelationType.Related,
						duplicate: IssueRelationType.Duplicate,
					};
					const relationType =
						relationTypeMap[type as "blocks" | "related" | "duplicate"];

					const result = await this.linearClient.createIssueRelation({
						issueId: issue.id,
						relatedIssueId: relatedIssue.id,
						type: relationType,
					});

					const relation = await result.issueRelation;

					console.log(
						`Created ${type} relation: ${issue.identifier} ${type} ${relatedIssue.identifier}`,
					);

					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: true,
									relationId: relation?.id,
									message: `Successfully created '${type}' relation: ${issue.identifier} ${type} ${relatedIssue.identifier}`,
								}),
							},
						],
					};
				} catch (error) {
					console.error(`Error creating issue relation for ${issueId}:`, error);
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

		// 6. Get child issues
		this.mcpServer.registerTool(
			"linear_get_child_issues",
			{
				description:
					"Get all child issues (sub-issues) for a given Linear issue.",
				inputSchema: {
					issueId: z
						.string()
						.describe(
							"The ID or identifier of the parent issue (e.g., 'CYHOST-91' or UUID)",
						) as any,
					limit: z
						.number()
						.optional()
						.describe(
							"Maximum number of child issues to return (default: 50, max: 250)",
						) as any,
					includeCompleted: z
						.boolean()
						.optional()
						.describe(
							"Whether to include completed child issues (default: true)",
						) as any,
					includeArchived: z
						.boolean()
						.optional()
						.describe(
							"Whether to include archived child issues (default: false)",
						) as any,
				},
			},
			async (_args: any, _extra: any) => {
				const {
					issueId,
					limit = 50,
					includeCompleted = true,
					includeArchived = false,
				} = _args;
				try {
					const finalLimit = Math.min(Math.max(1, limit), 250);

					console.log(
						`Getting child issues for ${issueId} (limit: ${finalLimit})`,
					);

					const issue = await this.linearClient.issue(issueId);

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

					console.log(
						`Found ${childrenData.length} child issues for ${issueId}`,
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

		// 7. Get agent sessions
		this.mcpServer.registerTool(
			"linear_get_agent_sessions",
			{
				description:
					"Get all agent sessions. Returns a paginated list of agent sessions.",
				inputSchema: {
					first: z
						.number()
						.optional()
						.describe(
							"Number of items to fetch from the beginning (default: 50, max: 250)",
						) as any,
					after: z
						.string()
						.optional()
						.describe("Cursor to start fetching items after") as any,
					before: z
						.string()
						.optional()
						.describe("Cursor to start fetching items before") as any,
					last: z
						.number()
						.optional()
						.describe("Number of items to fetch from the end") as any,
					includeArchived: z
						.boolean()
						.optional()
						.describe(
							"Whether to include archived agent sessions (default: false)",
						) as any,
					orderBy: z
						.enum(["createdAt", "updatedAt"])
						.optional()
						.describe("Field to order results by (default: updatedAt)") as any,
				},
			},
			async (_args: any, _extra: any) => {
				const {
					first = 50,
					after,
					before,
					last,
					includeArchived = false,
					orderBy,
				} = _args;
				try {
					const finalFirst = first ? Math.min(Math.max(1, first), 250) : 50;
					const finalLast = last ? Math.min(Math.max(1, last), 250) : undefined;

					console.log("Fetching agent sessions with params:", {
						first: finalFirst,
						after,
						before,
						last: finalLast,
						includeArchived,
						orderBy,
					});

					const variables: any = { first: finalFirst };
					if (after) variables.after = after;
					if (before) variables.before = before;
					if (finalLast !== undefined) variables.last = finalLast;
					if (includeArchived !== undefined)
						variables.includeArchived = includeArchived;
					if (orderBy) variables.orderBy = orderBy;

					const sessionsConnection =
						await this.linearClient.agentSessions(variables);
					const sessions = await sessionsConnection.nodes;

					const sessionsData = sessions.map((session) => ({
						id: session.id,
						createdAt: session.createdAt.toISOString(),
						updatedAt: session.updatedAt.toISOString(),
						startedAt: session.startedAt?.toISOString() || null,
						endedAt: session.endedAt?.toISOString() || null,
						dismissedAt: session.dismissedAt?.toISOString() || null,
						archivedAt: session.archivedAt?.toISOString() || null,
						externalLink: session.externalLink || null,
						summary: session.summary || null,
						plan: session.plan || null,
						sourceMetadata: session.sourceMetadata || null,
					}));

					const pageInfo = await sessionsConnection.pageInfo;

					console.log(`Found ${sessionsData.length} agent sessions`);

					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify(
									{
										success: true,
										count: sessionsData.length,
										sessions: sessionsData,
										pageInfo: {
											hasNextPage: pageInfo.hasNextPage,
											hasPreviousPage: pageInfo.hasPreviousPage,
											startCursor: pageInfo.startCursor,
											endCursor: pageInfo.endCursor,
										},
									},
									null,
									2,
								),
							},
						],
					};
				} catch (error) {
					console.error("Error fetching agent sessions:", error);
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

		// 8. Get agent session
		this.mcpServer.registerTool(
			"linear_get_agent_session",
			{
				description:
					"Get a single agent session by ID. Returns detailed information about the agent session.",
				inputSchema: {
					sessionId: z
						.string()
						.describe("The ID of the agent session to retrieve (UUID)") as any,
				},
			},
			async (_args: any, _extra: any) => {
				const { sessionId } = _args;
				try {
					console.log(`Fetching agent session: ${sessionId}`);

					const session = await this.linearClient.agentSession(sessionId);

					if (!session) {
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										success: false,
										error: `Agent session ${sessionId} not found`,
									}),
								},
							],
						};
					}

					const [issue, creator, appUser, comment, sourceComment, dismissedBy] =
						await Promise.all([
							session.issue,
							session.creator,
							session.appUser,
							session.comment,
							session.sourceComment,
							session.dismissedBy,
						]);

					const sessionData = {
						id: session.id,
						createdAt: session.createdAt.toISOString(),
						updatedAt: session.updatedAt.toISOString(),
						startedAt: session.startedAt?.toISOString() || null,
						endedAt: session.endedAt?.toISOString() || null,
						dismissedAt: session.dismissedAt?.toISOString() || null,
						archivedAt: session.archivedAt?.toISOString() || null,
						externalLink: session.externalLink || null,
						summary: session.summary || null,
						plan: session.plan || null,
						sourceMetadata: session.sourceMetadata || null,
						issue: issue
							? {
									id: issue.id,
									identifier: issue.identifier,
									title: issue.title,
									url: issue.url,
									description: issue.description,
									priority: issue.priority,
									priorityLabel: issue.priorityLabel,
								}
							: null,
						creator: creator
							? {
									id: creator.id,
									name: creator.name,
									email: creator.email,
									displayName: creator.displayName,
								}
							: null,
						appUser: appUser
							? {
									id: appUser.id,
									name: appUser.name,
								}
							: null,
						comment: comment
							? {
									id: comment.id,
									body: comment.body,
									createdAt: comment.createdAt.toISOString(),
								}
							: null,
						sourceComment: sourceComment
							? {
									id: sourceComment.id,
									body: sourceComment.body,
									createdAt: sourceComment.createdAt.toISOString(),
								}
							: null,
						dismissedBy: dismissedBy
							? {
									id: dismissedBy.id,
									name: dismissedBy.name,
									email: dismissedBy.email,
								}
							: null,
					};

					console.log(`Successfully fetched agent session: ${sessionId}`);

					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify(
									{
										success: true,
										session: sessionData,
									},
									null,
									2,
								),
							},
						],
					};
				} catch (error) {
					console.error(`Error fetching agent session ${sessionId}:`, error);
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
	}

	/**
	 * Register the MCP server with Fastify using bearer token authentication
	 */
	private async registerWithFastify(fastify: FastifyInstance): Promise<void> {
		await fastify.register(FastifyMcpServer, {
			server: this.mcpServer.server,
			endpoint: "/mcp/cyrus-tools",
			bearerMiddleware: {
				verifier: {
					verifyAccessToken: async (token: string) => {
						// Verify the token matches our generated token
						if (token !== this.token) {
							throw new Error("Invalid bearer token");
						}
						return {
							active: true,
							token: this.token,
							clientId: "cyrus-tools",
							scopes: [],
						};
					},
				},
			},
		});
	}
}

/**
 * Helper function to create a CyrusToolsHttpServer instance
 */
export function createCyrusToolsHttpServer(
	fastify: FastifyInstance,
	linearApiToken: string,
	options: CyrusToolsOptions = {},
): CyrusToolsHttpServer {
	return new CyrusToolsHttpServer(fastify, linearApiToken, options);
}
