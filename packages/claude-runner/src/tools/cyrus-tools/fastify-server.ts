import * as crypto from "node:crypto";
import { basename, extname } from "node:path";
import { IssueRelationType, LinearClient } from "@linear/sdk";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Fastify, { type FastifyInstance } from "fastify";
import FastifyMcpServer from "fastify-mcp-server";
import * as fs from "fs-extra";

/**
 * Maximum page size for paginated API requests
 */
const MAX_PAGE_SIZE = 250;

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
 * Result of starting the Cyrus tools Fastify HTTP MCP server
 */
export interface CyrusToolsServerResult {
	/**
	 * The port the server is listening on
	 */
	port: number;

	/**
	 * The Bearer authentication token
	 */
	token: string;

	/**
	 * Function to stop the server
	 */
	stop: () => Promise<void>;

	/**
	 * The Fastify instance (for advanced usage)
	 */
	fastify: FastifyInstance;
}

/**
 * Create and start a Fastify HTTP MCP server with the Cyrus tools
 *
 * @param linearApiToken - Linear API token for authentication
 * @param options - Configuration options for session management
 * @param port - Port to listen on (default: 0 for dynamic assignment)
 * @returns Server result with port, token, and stop function
 */
export async function createCyrusToolsFastifyServer(
	linearApiToken: string,
	options: CyrusToolsOptions = {},
	port: number = 0,
): Promise<CyrusToolsServerResult> {
	// Generate a cryptographically secure random token
	const token = crypto.randomBytes(32).toString("hex");

	// Calculate token expiration time (1 hour from server start)
	const tokenExpiresAt = Date.now() + 3600000;

	// Create Linear client
	const linearClient = new LinearClient({ apiKey: linearApiToken });

	// Create Fastify instance
	const fastify = Fastify({
		logger: {
			level: process.env.LOG_LEVEL || "info",
		},
	});

	// Create MCP server
	const mcpServer = new Server(
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

	// Define the tools list
	mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [
				{
					name: "linear_upload_file",
					description:
						"Upload a file to Linear. Returns an asset URL that can be used in issue descriptions or comments.",
					inputSchema: {
						type: "object",
						properties: {
							filePath: {
								type: "string",
								description: "The absolute path to the file to upload",
							},
							filename: {
								type: "string",
								description:
									"The filename to use in Linear (optional, defaults to basename of filePath)",
							},
							contentType: {
								type: "string",
								description:
									"MIME type of the file (optional, auto-detected if not provided)",
							},
							makePublic: {
								type: "boolean",
								description:
									"Whether to make the file publicly accessible (default: false)",
							},
						},
						required: ["filePath"],
					},
				},
				{
					name: "linear_agent_session_create",
					description:
						"Create an agent session on a Linear issue to track AI/bot activity.",
					inputSchema: {
						type: "object",
						properties: {
							issueId: {
								type: "string",
								description:
									'The ID or identifier of the Linear issue (e.g., "ABC-123" or UUID)',
							},
							externalLink: {
								type: "string",
								description:
									"Optional URL of an external agent-hosted page associated with this session",
							},
						},
						required: ["issueId"],
					},
				},
				{
					name: "linear_agent_session_create_on_comment",
					description:
						"Create an agent session on a Linear root comment (not a reply) to trigger a sub-agent for processing child issues or tasks. See Linear API docs: https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/inputs/AgentSessionCreateOnComment",
					inputSchema: {
						type: "object",
						properties: {
							commentId: {
								type: "string",
								description:
									"The ID of the Linear root comment (not a reply) to create the session on",
							},
							externalLink: {
								type: "string",
								description:
									"Optional URL of an external agent-hosted page associated with this session",
							},
						},
						required: ["commentId"],
					},
				},
				{
					name: "linear_agent_give_feedback",
					description:
						"Provide feedback to a child agent session to continue its processing.",
					inputSchema: {
						type: "object",
						properties: {
							agentSessionId: {
								type: "string",
								description:
									"The ID of the child agent session to provide feedback to",
							},
							message: {
								type: "string",
								description:
									"The feedback message to send to the child agent session",
							},
						},
						required: ["agentSessionId", "message"],
					},
				},
				{
					name: "linear_set_issue_relation",
					description:
						"Create a relationship between two Linear issues. Use this to set 'blocks', 'related', or 'duplicate' relationships. For Graphite stacking workflows, use 'blocks' type where the blocking issue is the one that must be completed first.",
					inputSchema: {
						type: "object",
						properties: {
							issueId: {
								type: "string",
								description:
									"The BLOCKING issue (the one that must complete first). For 'blocks' type: this issue blocks relatedIssueId. Example: 'PROJ-123' or UUID",
							},
							relatedIssueId: {
								type: "string",
								description:
									"The BLOCKED issue (the one that depends on issueId). For 'blocks' type: this issue is blocked by issueId. Example: 'PROJ-124' or UUID",
							},
							type: {
								type: "string",
								enum: ["blocks", "related", "duplicate"],
								description:
									"The type of relation: 'blocks' (issueId blocks relatedIssueId - use for Graphite stacking), 'related' (issues are related), 'duplicate' (issueId is a duplicate of relatedIssue)",
							},
						},
						required: ["issueId", "relatedIssueId", "type"],
					},
				},
				{
					name: "linear_get_child_issues",
					description:
						"Get all child issues (sub-issues) for a given Linear issue. Takes an issue identifier like 'CYHOST-91' and returns a list of child issue ids and their titles.",
					inputSchema: {
						type: "object",
						properties: {
							issueId: {
								type: "string",
								description:
									"The ID or identifier of the parent issue (e.g., 'CYHOST-91' or UUID)",
							},
							limit: {
								type: "number",
								description:
									"Maximum number of child issues to return (default: 50, max: 250)",
							},
							includeCompleted: {
								type: "boolean",
								description:
									"Whether to include completed child issues (default: true)",
							},
							includeArchived: {
								type: "boolean",
								description:
									"Whether to include archived child issues (default: false)",
							},
						},
						required: ["issueId"],
					},
				},
				{
					name: "linear_get_agent_sessions",
					description:
						"Get all agent sessions. Returns a paginated list of agent sessions with their details including status, timestamps, and associated issues.",
					inputSchema: {
						type: "object",
						properties: {
							first: {
								type: "number",
								description:
									"Number of items to fetch from the beginning (default: 50, max: 250)",
							},
							after: {
								type: "string",
								description: "Cursor to start fetching items after",
							},
							before: {
								type: "string",
								description: "Cursor to start fetching items before",
							},
							last: {
								type: "number",
								description: "Number of items to fetch from the end",
							},
							includeArchived: {
								type: "boolean",
								description:
									"Whether to include archived agent sessions (default: false)",
							},
							orderBy: {
								type: "string",
								enum: ["createdAt", "updatedAt"],
								description:
									"Field to order results by (default: updatedAt). Can be 'createdAt' or 'updatedAt'",
							},
						},
					},
				},
				{
					name: "linear_get_agent_session",
					description:
						"Get a single agent session by ID. Returns detailed information about the agent session including its status, timestamps, associated issue, and metadata.",
					inputSchema: {
						type: "object",
						properties: {
							sessionId: {
								type: "string",
								description: "The ID of the agent session to retrieve (UUID)",
							},
						},
						required: ["sessionId"],
					},
				},
			],
		};
	});

	// Handle tool execution
	mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		switch (name) {
			case "linear_upload_file":
				return await handleUploadFile(
					linearClient,
					args as {
						filePath: string;
						filename?: string;
						contentType?: string;
						makePublic?: boolean;
					},
				);

			case "linear_agent_session_create":
				return await handleAgentSessionCreate(
					linearClient,
					options,
					args as { issueId: string; externalLink?: string },
				);

			case "linear_agent_session_create_on_comment":
				return await handleAgentSessionCreateOnComment(
					linearClient,
					options,
					args as { commentId: string; externalLink?: string },
				);

			case "linear_agent_give_feedback":
				return await handleGiveFeedback(
					options,
					args as { agentSessionId: string; message: string },
				);

			case "linear_set_issue_relation":
				return await handleSetIssueRelation(
					linearClient,
					args as {
						issueId: string;
						relatedIssueId: string;
						type: "blocks" | "related" | "duplicate";
					},
				);

			case "linear_get_child_issues":
				return await handleGetChildIssues(
					linearClient,
					args as {
						issueId: string;
						limit?: number;
						includeCompleted?: boolean;
						includeArchived?: boolean;
					},
				);

			case "linear_get_agent_sessions":
				return await handleGetAgentSessions(
					linearClient,
					args as {
						first?: number;
						after?: string;
						before?: string;
						last?: number;
						includeArchived?: boolean;
						orderBy?: "createdAt" | "updatedAt";
					},
				);

			case "linear_get_agent_session":
				return await handleGetAgentSession(
					linearClient,
					args as { sessionId: string },
				);

			default:
				// Unknown tool - return error response
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: `Unknown tool: ${name}`,
							}),
						},
					],
				};
		}
	});

	// Token verifier for Bearer authentication
	const tokenVerifier = {
		async verifyAccessToken(receivedToken: string) {
			if (receivedToken !== token) {
				throw new Error("Invalid token");
			}

			return {
				token: receivedToken,
				clientId: "cyrus-tools-server",
				scopes: ["mcp:read", "mcp:write"],
				expiresAt: tokenExpiresAt,
			};
		},
	};

	// Register the MCP server plugin with authentication
	await fastify.register(FastifyMcpServer, {
		server: mcpServer,
		endpoint: "/mcp",
		authorization: {
			bearerMiddlewareOptions: {
				verifier: tokenVerifier,
				requiredScopes: ["mcp:read", "mcp:write"],
			},
		},
	});

	// Start the server
	await fastify.listen({ port, host: "127.0.0.1" });

	const actualPort = (fastify.server.address() as any)?.port || port;

	console.log(
		`[CyrusTools] Fastify HTTP MCP server started on http://127.0.0.1:${actualPort}/mcp`,
	);

	return {
		port: actualPort,
		token,
		stop: async () => {
			await fastify.close();
			console.log("[CyrusTools] Fastify HTTP MCP server stopped");
		},
		fastify,
	};
}

// Tool handler implementations

async function handleUploadFile(
	linearClient: LinearClient,
	args: {
		filePath: string;
		filename?: string;
		contentType?: string;
		makePublic?: boolean;
	},
) {
	const { filePath, filename, contentType, makePublic } = args;

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
}

async function handleAgentSessionCreate(
	linearClient: LinearClient,
	options: CyrusToolsOptions,
	args: { issueId: string; externalLink?: string },
) {
	const { issueId, externalLink } = args;

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
}

async function handleAgentSessionCreateOnComment(
	linearClient: LinearClient,
	options: CyrusToolsOptions,
	args: { commentId: string; externalLink?: string },
) {
	const { commentId, externalLink } = args;

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
}

async function handleGiveFeedback(
	options: CyrusToolsOptions,
	args: { agentSessionId: string; message: string },
) {
	const { agentSessionId, message } = args;

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
}

async function handleSetIssueRelation(
	linearClient: LinearClient,
	args: {
		issueId: string;
		relatedIssueId: string;
		type: "blocks" | "related" | "duplicate";
	},
) {
	const { issueId, relatedIssueId, type } = args;

	try {
		console.log(
			`Creating ${type} relation: ${issueId} -> ${relatedIssueId} (${issueId} blocks ${relatedIssueId})`,
		);

		// Resolve issue identifiers to UUIDs if needed
		const issue = await linearClient.issue(issueId);
		const relatedIssue = await linearClient.issue(relatedIssueId);

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

		// Map string type to IssueRelationType enum
		const relationTypeMap: Record<
			"blocks" | "related" | "duplicate",
			IssueRelationType
		> = {
			blocks: IssueRelationType.Blocks,
			related: IssueRelationType.Related,
			duplicate: IssueRelationType.Duplicate,
		};
		const relationType = relationTypeMap[type];

		// Create the issue relation
		const result = await linearClient.createIssueRelation({
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
}

async function handleGetChildIssues(
	linearClient: LinearClient,
	args: {
		issueId: string;
		limit?: number;
		includeCompleted?: boolean;
		includeArchived?: boolean;
	},
) {
	const {
		issueId,
		limit = 50,
		includeCompleted = true,
		includeArchived = false,
	} = args;

	try {
		// Validate and clamp limit
		const finalLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);

		console.log(`Getting child issues for ${issueId} (limit: ${finalLimit})`);

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
}

async function handleGetAgentSessions(
	linearClient: LinearClient,
	args: {
		first?: number;
		after?: string;
		before?: string;
		last?: number;
		includeArchived?: boolean;
		orderBy?: "createdAt" | "updatedAt";
	},
) {
	const {
		first = 50,
		after,
		before,
		last,
		includeArchived = false,
		orderBy,
	} = args;

	try {
		// Validate and clamp first/last
		const finalFirst = first
			? Math.min(Math.max(1, first), MAX_PAGE_SIZE)
			: undefined;
		const finalLast = last
			? Math.min(Math.max(1, last), MAX_PAGE_SIZE)
			: undefined;

		console.log("Fetching agent sessions with params:", {
			first: finalFirst,
			after,
			before,
			last: finalLast,
			includeArchived,
			orderBy,
		});

		// Build variables for the query
		const variables: any = {};
		if (finalFirst !== undefined) variables.first = finalFirst;
		if (after) variables.after = after;
		if (before) variables.before = before;
		if (finalLast !== undefined) variables.last = finalLast;
		if (includeArchived !== undefined)
			variables.includeArchived = includeArchived;
		if (orderBy) variables.orderBy = orderBy;

		// Fetch agent sessions using the Linear SDK
		const sessionsConnection = await linearClient.agentSessions(variables);
		const sessions = await sessionsConnection.nodes;

		// Process each session to get detailed information
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
}

async function handleGetAgentSession(
	linearClient: LinearClient,
	args: { sessionId: string },
) {
	const { sessionId } = args;

	try {
		console.log(`Fetching agent session: ${sessionId}`);

		// Fetch the agent session using the Linear SDK
		const session = await linearClient.agentSession(sessionId);

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

		// Get related entities
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
}
