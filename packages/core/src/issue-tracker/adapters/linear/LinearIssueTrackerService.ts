/**
 * Linear-specific implementation of IIssueTrackerService.
 *
 * This adapter wraps the @linear/sdk LinearClient to provide a platform-agnostic
 * interface for issue tracking operations. It transforms Linear-specific types
 * to the platform-agnostic types defined in ../types.ts.
 *
 * @module issue-tracker/adapters/LinearIssueTrackerService
 */

import type { LinearClient } from "@linear/sdk";
import type {
	AgentEventTransportConfig,
	IAgentEventTransport,
} from "../../IAgentEventTransport.js";
import type { IIssueTrackerService } from "../../IIssueTrackerService.js";
import type {
	AgentActivity,
	AgentActivityContent,
	AgentActivitySignal,
	AgentSession,
	AgentSessionCreateOnCommentInput,
	AgentSessionCreateOnIssueInput,
	AgentSessionCreateResponse,
	Comment,
	CommentCreateInput,
	CommentWithAttachments,
	Connection,
	FetchChildrenOptions,
	FileUploadRequest,
	FileUploadResponse,
	Issue,
	IssueUpdateInput,
	IssueWithChildren,
	Label,
	PaginationOptions,
	Team,
	User,
	WorkflowState,
} from "../../types.js";
import {
	adaptLinearAgentSession,
	type LinearAgentSessionData,
	toLinearActivityContent,
} from "./LinearTypeAdapters.js";

/**
 * Linear GraphQL response structure for rawRequest.
 */
interface LinearGraphQLResponse<T> {
	data: T;
}

/**
 * Linear client with raw request capability.
 */
interface LinearClientWithRawRequest {
	client: {
		rawRequest<T>(
			query: string,
			variables?: Record<string, unknown>,
		): Promise<LinearGraphQLResponse<T>>;
	};
}

/**
 * Linear GraphQL agent session create response.
 */
interface LinearAgentSessionCreateData {
	success: boolean;
	lastSyncId: number;
	agentSession: {
		id: string;
	};
}

/**
 * Linear implementation of IIssueTrackerService.
 *
 * This class wraps the Linear SDK's LinearClient and provides a platform-agnostic
 * interface for all issue tracking operations. It handles type conversions between
 * Linear-specific types and platform-agnostic types.
 *
 * @example
 * ```typescript
 * const linearClient = new LinearClient({ accessToken: 'your-token' });
 * const service = new LinearIssueTrackerService(linearClient);
 *
 * // Fetch an issue
 * const issue = await service.fetchIssue('TEAM-123');
 *
 * // Create a comment
 * const comment = await service.createComment(issue.id, {
 *   body: 'This is a comment'
 * });
 * ```
 */
export class LinearIssueTrackerService implements IIssueTrackerService {
	private readonly linearClient: LinearClient;

	/**
	 * Create a new LinearIssueTrackerService.
	 *
	 * @param linearClient - Configured LinearClient instance
	 */
	constructor(linearClient: LinearClient) {
		this.linearClient = linearClient;
	}

	// ========================================================================
	// ISSUE OPERATIONS
	// ========================================================================

	/**
	 * Fetch a single issue by ID or identifier.
	 */
	async fetchIssue(idOrIdentifier: string): Promise<Issue> {
		try {
			return await this.linearClient.issue(idOrIdentifier);
		} catch (error) {
			throw new Error(
				`Failed to fetch issue ${idOrIdentifier}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch child issues (sub-issues) for a parent issue.
	 */
	async fetchIssueChildren(
		issueId: string,
		options?: FetchChildrenOptions,
	): Promise<IssueWithChildren> {
		try {
			const parentIssue = await this.linearClient.issue(issueId);

			// Build filter based on options
			const filter: Record<string, unknown> = {};

			if (options?.includeCompleted === false) {
				filter.state = { type: { neq: "completed" } };
			}

			if (options?.includeArchived === false) {
				filter.archivedAt = { null: true };
			}

			// Merge with additional filters
			if (options?.filter) {
				Object.assign(filter, options.filter);
			}

			// Fetch children with filter
			const childrenConnection = await parentIssue.children({
				first: options?.limit ?? 50,
				filter,
			});

			const children = childrenConnection.nodes ?? [];

			// Return Linear SDK issue with children array directly
			// Use type assertion since we're adding properties to Linear SDK Issue type
			return {
				...parentIssue,
				children,
				childCount: children.length,
			} as IssueWithChildren;
		} catch (error) {
			throw new Error(
				`Failed to fetch children for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Update an issue's properties.
	 */
	async updateIssue(
		issueId: string,
		updates: IssueUpdateInput,
	): Promise<Issue> {
		try {
			const updatePayload = await this.linearClient.updateIssue(
				issueId,
				updates,
			);

			if (!updatePayload.success) {
				throw new Error("Linear API returned success=false");
			}

			// Fetch the updated issue
			const updatedIssue = await updatePayload.issue;
			if (!updatedIssue) {
				throw new Error("Updated issue not returned from Linear API");
			}

			return updatedIssue;
		} catch (error) {
			throw new Error(
				`Failed to update issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch attachments for an issue.
	 *
	 * Uses the Linear SDK to fetch native attachments (typically external links
	 * to Sentry errors, Datadog reports, etc.)
	 */
	async fetchIssueAttachments(
		issueId: string,
	): Promise<Array<{ title: string; url: string }>> {
		try {
			const issue = await this.linearClient.issue(issueId);

			if (!issue) {
				throw new Error(`Issue ${issueId} not found`);
			}

			// Call the Linear SDK's attachments() method which returns a Connection
			const attachmentsConnection = await issue.attachments();

			// Extract title and url from each attachment node
			return attachmentsConnection.nodes.map((attachment) => ({
				title: attachment.title || "Untitled attachment",
				url: attachment.url,
			}));
		} catch (error) {
			throw new Error(
				`Failed to fetch attachments for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// COMMENT OPERATIONS
	// ========================================================================

	/**
	 * Fetch comments for an issue with optional pagination.
	 */
	async fetchComments(
		issueId: string,
		options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		try {
			const issue = await this.linearClient.issue(issueId);
			const commentsConnection = await issue.comments({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: commentsConnection.nodes ?? [],
				pageInfo: commentsConnection.pageInfo
					? {
							hasNextPage: commentsConnection.pageInfo.hasNextPage,
							hasPreviousPage: commentsConnection.pageInfo.hasPreviousPage,
							startCursor: commentsConnection.pageInfo.startCursor,
							endCursor: commentsConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			throw new Error(
				`Failed to fetch comments for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch a single comment by ID.
	 */
	async fetchComment(commentId: string): Promise<Comment> {
		try {
			return await this.linearClient.comment({ id: commentId });
		} catch (error) {
			throw new Error(
				`Failed to fetch comment ${commentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch a comment with attachments.
	 *
	 * Returns the Linear SDK Comment with an attachments array added.
	 * Linear doesn't currently expose attachments in their GraphQL API,
	 * so this always returns an empty attachments array for now.
	 */
	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		try {
			// Fetch the comment using the Linear SDK
			const comment = await this.fetchComment(commentId);

			// Add attachments property (currently empty as Linear doesn't expose this)
			// Cast through unknown since CommentWithAttachments extends Comment
			const commentWithAttachments =
				comment as unknown as CommentWithAttachments;
			commentWithAttachments.attachments = [];

			return commentWithAttachments;
		} catch (error) {
			throw new Error(
				`Failed to fetch comment with attachments ${commentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Create a comment on an issue.
	 */
	async createComment(
		issueId: string,
		input: CommentCreateInput,
	): Promise<Comment> {
		try {
			// Build the comment body, optionally appending attachment URLs
			let finalBody = input.body;

			// If attachment URLs are provided, append them to the comment body as markdown
			if (input.attachmentUrls && input.attachmentUrls.length > 0) {
				const attachmentMarkdown = input.attachmentUrls
					.map((url) => {
						// Detect if the URL is an image based on file extension
						const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(url);
						if (isImage) {
							// Embed as markdown image
							return `![attachment](${url})`;
						}
						// Otherwise, embed as markdown link
						return `[attachment](${url})`;
					})
					.join("\n");

				// Append attachments to the body with a separator if body is not empty
				finalBody = input.body
					? `${input.body}\n\n${attachmentMarkdown}`
					: attachmentMarkdown;
			}

			const createPayload = await this.linearClient.createComment({
				issueId,
				body: finalBody,
				parentId: input.parentId,
			});

			if (!createPayload.success) {
				throw new Error("Linear API returned success=false");
			}

			const createdComment = await createPayload.comment;
			if (!createdComment) {
				throw new Error("Created comment not returned from Linear API");
			}

			return createdComment;
		} catch (error) {
			throw new Error(
				`Failed to create comment on issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// TEAM OPERATIONS
	// ========================================================================

	/**
	 * Fetch all teams in the workspace/organization.
	 */
	async fetchTeams(options?: PaginationOptions): Promise<Connection<Team>> {
		try {
			const teamsConnection = await this.linearClient.teams({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: teamsConnection.nodes ?? [],
				pageInfo: teamsConnection.pageInfo
					? {
							hasNextPage: teamsConnection.pageInfo.hasNextPage,
							hasPreviousPage: teamsConnection.pageInfo.hasPreviousPage,
							startCursor: teamsConnection.pageInfo.startCursor,
							endCursor: teamsConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			throw new Error(
				`Failed to fetch teams: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch a single team by ID or key.
	 */
	async fetchTeam(idOrKey: string): Promise<Team> {
		try {
			return await this.linearClient.team(idOrKey);
		} catch (error) {
			throw new Error(
				`Failed to fetch team ${idOrKey}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// LABEL OPERATIONS
	// ========================================================================

	/**
	 * Fetch all issue labels in the workspace/organization.
	 */
	async fetchLabels(options?: PaginationOptions): Promise<Connection<Label>> {
		try {
			const labelsConnection = await this.linearClient.issueLabels({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: labelsConnection.nodes ?? [],
				pageInfo: labelsConnection.pageInfo
					? {
							hasNextPage: labelsConnection.pageInfo.hasNextPage,
							hasPreviousPage: labelsConnection.pageInfo.hasPreviousPage,
							startCursor: labelsConnection.pageInfo.startCursor,
							endCursor: labelsConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			throw new Error(
				`Failed to fetch labels: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch a single label by ID or name.
	 */
	async fetchLabel(idOrName: string): Promise<Label> {
		try {
			return await this.linearClient.issueLabel(idOrName);
		} catch (error) {
			throw new Error(
				`Failed to fetch label ${idOrName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// WORKFLOW STATE OPERATIONS
	// ========================================================================

	/**
	 * Fetch workflow states for a team.
	 */
	async fetchWorkflowStates(
		teamId: string,
		options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		try {
			const team = await this.linearClient.team(teamId);
			const statesConnection = await team.states({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: statesConnection.nodes ?? [],
				pageInfo: statesConnection.pageInfo
					? {
							hasNextPage: statesConnection.pageInfo.hasNextPage,
							hasPreviousPage: statesConnection.pageInfo.hasPreviousPage,
							startCursor: statesConnection.pageInfo.startCursor,
							endCursor: statesConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			throw new Error(
				`Failed to fetch workflow states for team ${teamId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch a single workflow state by ID.
	 */
	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		try {
			return await this.linearClient.workflowState(stateId);
		} catch (error) {
			throw new Error(
				`Failed to fetch workflow state ${stateId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// USER OPERATIONS
	// ========================================================================

	/**
	 * Fetch a user by ID.
	 */
	async fetchUser(userId: string): Promise<User> {
		try {
			return await this.linearClient.user(userId);
		} catch (error) {
			throw new Error(
				`Failed to fetch user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch the current authenticated user.
	 */
	async fetchCurrentUser(): Promise<User> {
		try {
			return await this.linearClient.viewer;
		} catch (error) {
			throw new Error(
				`Failed to fetch current user: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// AGENT SESSION OPERATIONS
	// ========================================================================

	/**
	 * Create an agent session on an issue.
	 */
	async createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): Promise<AgentSessionCreateResponse> {
		try {
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

			const result = await (
				this.linearClient as LinearClientWithRawRequest
			).client.rawRequest<{
				agentSessionCreateOnIssue: LinearAgentSessionCreateData;
			}>(mutation, {
				input: {
					issueId: input.issueId,
					externalLink: input.externalLink,
				},
			});

			const data = result.data.agentSessionCreateOnIssue;

			if (!data.success) {
				throw new Error("Linear API returned success=false");
			}

			return {
				success: data.success,
				agentSessionId: data.agentSession.id,
				lastSyncId: data.lastSyncId,
			};
		} catch (error) {
			throw new Error(
				`Failed to create agent session on issue ${input.issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Create an agent session on a comment thread.
	 */
	async createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): Promise<AgentSessionCreateResponse> {
		try {
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

			const result = await (
				this.linearClient as LinearClientWithRawRequest
			).client.rawRequest<{
				agentSessionCreateOnComment: LinearAgentSessionCreateData;
			}>(mutation, {
				input: {
					commentId: input.commentId,
					externalLink: input.externalLink,
				},
			});

			const data = result.data.agentSessionCreateOnComment;

			if (!data.success) {
				throw new Error("Linear API returned success=false");
			}

			return {
				success: data.success,
				agentSessionId: data.agentSession.id,
				lastSyncId: data.lastSyncId,
			};
		} catch (error) {
			throw new Error(
				`Failed to create agent session on comment ${input.commentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch an agent session by ID.
	 */
	async fetchAgentSession(sessionId: string): Promise<AgentSession> {
		try {
			const query = `
        query GetAgentSession($id: String!) {
          agentSession(id: $id) {
            id
            issueId
            commentId
            status
            type
            creatorId
            appUserId
            organizationId
            summary
            startedAt
            endedAt
            createdAt
            updatedAt
            archivedAt
            sourceMetadata
            creator {
              id
              name
              email
              url
              avatarUrl
            }
          }
        }
      `;

			const result = await (
				this.linearClient as LinearClientWithRawRequest
			).client.rawRequest<{ agentSession: LinearAgentSessionData }>(query, {
				id: sessionId,
			});

			const sessionData = result.data.agentSession;
			if (!sessionData) {
				throw new Error("Agent session not found");
			}

			return adaptLinearAgentSession(sessionData);
		} catch (error) {
			throw new Error(
				`Failed to fetch agent session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// AGENT ACTIVITY OPERATIONS
	// ========================================================================

	/**
	 * Post an agent activity to an agent session.
	 */
	async createAgentActivity(
		sessionId: string,
		content: AgentActivityContent,
		options?: {
			ephemeral?: boolean;
			signal?: AgentActivitySignal;
			signalMetadata?: Record<string, any>;
		},
	): Promise<AgentActivity> {
		try {
			const activityContent = toLinearActivityContent(content);
			const createPayload = await this.linearClient.createAgentActivity({
				agentSessionId: sessionId,
				content: activityContent,
				...(options?.ephemeral !== undefined && {
					ephemeral: options.ephemeral,
				}),
				...(options?.signal !== undefined && { signal: options.signal }),
				...(options?.signalMetadata !== undefined && {
					signalMetadata: options.signalMetadata,
				}),
			});

			if (!createPayload.success) {
				throw new Error("Linear API returned success=false");
			}

			const createdActivity = await createPayload.agentActivity;
			if (!createdActivity) {
				throw new Error("Created activity not returned from Linear API");
			}

			// Convert to platform-agnostic format
			return {
				id: createdActivity.id,
				agentSessionId: sessionId,
				agentContextId: null,
				sourceCommentId: undefined,
				content: {
					type: content.type,
					body: content.body,
				},
				signal: createdActivity.signal as AgentActivitySignal | undefined,
				signalMetadata: createdActivity.signalMetadata as
					| Record<string, any>
					| undefined,
				ephemeral: createdActivity.ephemeral,
				createdAt: createdActivity.createdAt.toISOString(),
				updatedAt: createdActivity.updatedAt.toISOString(),
				archivedAt: createdActivity.archivedAt?.toISOString() ?? null,
				metadata: {
					linearActivityId: createdActivity.id,
				},
			};
		} catch (error) {
			throw new Error(
				`Failed to create agent activity on session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// FILE OPERATIONS
	// ========================================================================

	/**
	 * Request a file upload URL from the platform.
	 */
	async requestFileUpload(
		request: FileUploadRequest,
	): Promise<FileUploadResponse> {
		try {
			const uploadPayload = await this.linearClient.fileUpload(
				request.contentType,
				request.filename,
				request.size,
				{
					makePublic: request.makePublic ?? false,
				},
			);

			if (!uploadPayload.success) {
				throw new Error("Linear API returned success=false");
			}

			// Access the upload file result
			const uploadFile = await uploadPayload.uploadFile;
			if (!uploadFile) {
				throw new Error("Upload file not returned from Linear API");
			}

			// Convert headers array to record
			const headersRecord: Record<string, string> = {};
			if (uploadFile.headers) {
				for (const header of uploadFile.headers) {
					if (header.key && header.value) {
						headersRecord[header.key] = header.value;
					}
				}
			}

			return {
				uploadUrl: uploadFile.uploadUrl ?? "",
				headers: headersRecord,
				assetUrl: uploadFile.assetUrl ?? "",
			};
		} catch (error) {
			throw new Error(
				`Failed to request file upload for ${request.filename}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ========================================================================
	// PLATFORM METADATA
	// ========================================================================

	/**
	 * Get the platform type identifier.
	 */
	getPlatformType(): string {
		return "linear";
	}

	/**
	 * Get the platform's API version or other metadata.
	 */
	getPlatformMetadata(): Record<string, unknown> {
		return {
			platform: "linear",
			sdkVersion: "unknown", // LinearClient doesn't expose version
			apiVersion: "graphql",
		};
	}

	// ========================================================================
	// EVENT TRANSPORT
	// ========================================================================

	/**
	 * Create an event transport for receiving Linear webhook events.
	 *
	 * @param config - Transport configuration
	 * @returns Linear event transport implementation
	 */
	createEventTransport(
		config: AgentEventTransportConfig,
	): IAgentEventTransport {
		const {
			LinearAgentEventTransport,
		} = require("./LinearAgentEventTransport.js");
		return new LinearAgentEventTransport(config);
	}
}
