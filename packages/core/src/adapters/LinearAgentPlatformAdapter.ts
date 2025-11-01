/**
 * Linear SDK implementation of the agent platform adapter
 * This handles all actual Linear API calls for the abstraction layer
 */

import { basename, extname } from "node:path";
import { LinearClient } from "@linear/sdk";
import fs from "fs-extra";
import type {
	AdapterConfig,
	AgentSessionCreateResult,
	ChildIssueData,
	CommentData,
	FileUploadResult,
	GetChildIssuesOptions,
	IAgentPlatformAdapter,
	IssueData,
} from "./types.js";

/**
 * MIME type detection helper
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
 * Linear SDK implementation of the agent platform adapter
 */
export class LinearAgentPlatformAdapter implements IAgentPlatformAdapter {
	private linearClient: LinearClient;

	constructor(config: AdapterConfig) {
		this.linearClient = new LinearClient({
			accessToken: config.apiToken,
		});
	}

	/**
	 * Fetch an issue by ID or identifier
	 */
	async getIssue(issueId: string): Promise<IssueData | null> {
		try {
			const issue = await this.linearClient.issue(issueId);
			if (!issue) {
				return null;
			}

			const team = await issue.team;
			const teamId = String(team?.id || issue.teamId || "");
			const teamKey = String(team?.key || "");
			const teamName = String(team?.name || "");

			return {
				id: issue.id,
				identifier: issue.identifier,
				title: issue.title,
				teamId: teamId,
				team: {
					id: teamId,
					key: teamKey,
					name: teamName,
				},
				url: issue.url,
			};
		} catch (error) {
			console.error(`[LinearAdapter] Error fetching issue ${issueId}:`, error);
			return null;
		}
	}

	/**
	 * Get child issues (sub-issues) of a parent issue
	 */
	async getChildIssues(
		issueId: string,
		options?: GetChildIssuesOptions,
	): Promise<ChildIssueData[]> {
		try {
			const limit = Math.min(Math.max(1, options?.limit || 50), 250);
			const includeCompleted = options?.includeCompleted !== false;
			const includeArchived = options?.includeArchived === true;

			// Fetch the parent issue first
			const issue = await this.linearClient.issue(issueId);
			if (!issue) {
				return [];
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
				first: limit,
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

			return childrenData;
		} catch (error) {
			console.error(
				`[LinearAdapter] Error fetching child issues for ${issueId}:`,
				error,
			);
			return [];
		}
	}

	/**
	 * Fetch a comment by ID
	 */
	async getComment(commentId: string): Promise<CommentData | null> {
		try {
			const comment = await this.linearClient.comment({ id: commentId });
			if (!comment) {
				return null;
			}

			return {
				id: comment.id,
				body: String(comment.body || ""),
				userId: String(comment.userId || ""),
				issueId: String(comment.issueId || ""),
			};
		} catch (error) {
			console.error(
				`[LinearAdapter] Error fetching comment ${commentId}:`,
				error,
			);
			return null;
		}
	}

	/**
	 * Create an agent session on an issue
	 */
	async createSessionOnIssue(
		issueId: string,
		externalLink?: string,
	): Promise<AgentSessionCreateResult> {
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

			const response = await graphQLClient.rawRequest(mutation, variables);
			const result = response.data.agentSessionCreateOnIssue;

			if (!result.success) {
				return {
					success: false,
					error: "Failed to create agent session on issue",
				};
			}

			return {
				success: true,
				agentSessionId: result.agentSession.id,
				lastSyncId: result.lastSyncId,
			};
		} catch (error) {
			console.error(
				`[LinearAdapter] Error creating agent session on issue ${issueId}:`,
				error,
			);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Create an agent session on a comment
	 */
	async createSessionOnComment(
		commentId: string,
		externalLink?: string,
	): Promise<AgentSessionCreateResult> {
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

			const response = await graphQLClient.rawRequest(mutation, variables);
			const result = response.data.agentSessionCreateOnComment;

			if (!result.success) {
				return {
					success: false,
					error: "Failed to create agent session on comment",
				};
			}

			return {
				success: true,
				agentSessionId: result.agentSession.id,
				lastSyncId: result.lastSyncId,
			};
		} catch (error) {
			console.error(
				`[LinearAdapter] Error creating agent session on comment ${commentId}:`,
				error,
			);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Update agent session status
	 * Note: This is a local operation in the current implementation
	 * Actual Linear updates would go here in a future version
	 */
	async updateSessionStatus(
		sessionId: string,
		status: string,
		_metadata?: Record<string, any>,
	): Promise<void> {
		// TODO: Implement actual Linear API call when Linear provides mutation for this
		console.log(
			`[LinearAdapter] Session ${sessionId} status updated to ${status}`,
		);
	}

	/**
	 * Post agent activity to a session
	 * Note: This is a placeholder for future Linear API
	 */
	async postAgentActivity(
		sessionId: string,
		_content: string,
		contentType:
			| "prompt"
			| "observation"
			| "action"
			| "error"
			| "elicitation"
			| "response",
	): Promise<void> {
		// TODO: Implement actual Linear API call when Linear provides mutation for this
		console.log(
			`[LinearAdapter] Agent activity posted to session ${sessionId}: ${contentType}`,
		);
	}

	/**
	 * Upload a file for use in Linear
	 */
	async uploadFile(
		filePath: string,
		filename?: string,
		contentType?: string,
		makePublic?: boolean,
	): Promise<FileUploadResult> {
		try {
			// Read file and get stats
			const stats = await fs.stat(filePath);
			if (!stats.isFile()) {
				return {
					success: false,
					error: `Path ${filePath} is not a file`,
				};
			}

			const fileBuffer = await fs.readFile(filePath);
			const finalFilename = filename || basename(filePath);
			const finalContentType = contentType || getMimeType(finalFilename);
			const size = stats.size;

			console.log(
				`[LinearAdapter] Requesting upload URL for ${finalFilename} (${size} bytes, ${finalContentType})`,
			);

			// Request upload URL from Linear
			const uploadPayload = await this.linearClient.fileUpload(
				finalContentType,
				finalFilename,
				size,
				{ makePublic },
			);

			if (!uploadPayload.success || !uploadPayload.uploadFile) {
				return {
					success: false,
					error: "Failed to get upload URL from Linear",
				};
			}

			const { uploadUrl, headers, assetUrl } = uploadPayload.uploadFile;

			console.log(`[LinearAdapter] Uploading file to Linear cloud storage...`);

			// Create headers for upload
			const uploadHeaders: Record<string, string> = {
				"Content-Type": finalContentType,
				"Cache-Control": "public, max-age=31536000",
			};

			// Add headers from Linear's response
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
					success: false,
					error: `Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`,
				};
			}

			console.log(`[LinearAdapter] File uploaded successfully: ${assetUrl}`);

			return {
				success: true,
				assetUrl,
				filename: finalFilename,
				size,
				contentType: finalContentType,
			};
		} catch (error) {
			console.error(`[LinearAdapter] Error uploading file:`, error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Give feedback to a child agent session
	 * Note: This is a placeholder - actual implementation depends on Linear's feedback API
	 */
	async giveFeedback(sessionId: string, message: string): Promise<void> {
		// TODO: Implement actual Linear API call when Linear provides mutation for this
		console.log(
			`[LinearAdapter] Feedback given to session ${sessionId}: ${message.substring(0, 50)}...`,
		);
	}
}
