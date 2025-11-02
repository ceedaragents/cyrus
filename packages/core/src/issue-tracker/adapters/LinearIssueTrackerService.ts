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
} from "../IAgentEventTransport.js";
import type { IIssueTrackerService } from "../IIssueTrackerService.js";
import type {
	AgentActivity,
	AgentActivityContent,
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
} from "../types.js";
import {
	adaptLinearAgentSession,
	adaptLinearComment,
	adaptLinearIssue,
	adaptLinearIssueWithChildren,
	adaptLinearLabel,
	adaptLinearTeam,
	adaptLinearUser,
	adaptLinearWorkflowState,
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
 * Linear GraphQL comment data with user.
 */
interface LinearCommentData {
	id: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string | null;
	userId: string;
	issueId: string;
	user?: {
		id: string;
		name: string;
		displayName?: string | null;
		email: string;
		url: string;
		avatarUrl?: string | null;
	} | null;
	parent?: {
		id: string;
	} | null;
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
			const linearIssue = await this.linearClient.issue(idOrIdentifier);
			return await adaptLinearIssue(linearIssue);
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

			return await adaptLinearIssueWithChildren(parentIssue, children);
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

			return await adaptLinearIssue(updatedIssue);
		} catch (error) {
			throw new Error(
				`Failed to update issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
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

			const nodes = await Promise.all(
				(commentsConnection.nodes ?? []).map(adaptLinearComment),
			);

			return {
				nodes,
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
			const linearComment = await this.linearClient.comment({ id: commentId });
			return await adaptLinearComment(linearComment);
		} catch (error) {
			throw new Error(
				`Failed to fetch comment ${commentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fetch a comment with attachments using raw GraphQL.
	 */
	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		try {
			const result = await (
				this.linearClient as LinearClientWithRawRequest
			).client.rawRequest<{ comment: LinearCommentData }>(
				`
          query GetComment($id: String!) {
            comment(id: $id) {
              id
              body
              createdAt
              updatedAt
              archivedAt
              userId
              issueId
              user {
                id
                name
                displayName
                email
                url
                avatarUrl
              }
              parent {
                id
              }
            }
          }
        `,
				{ id: commentId },
			);

			const commentData = result.data.comment;
			if (!commentData) {
				throw new Error("Comment not found");
			}

			// Convert to platform-agnostic format
			const comment: CommentWithAttachments = {
				id: commentData.id,
				body: commentData.body,
				userId: commentData.userId,
				user: commentData.user
					? {
							id: commentData.user.id,
							name: commentData.user.displayName || commentData.user.name,
							email: commentData.user.email,
							url: commentData.user.url,
							avatarUrl: commentData.user.avatarUrl ?? undefined,
						}
					: undefined,
				issueId: commentData.issueId,
				parentId: commentData.parent?.id,
				createdAt: commentData.createdAt,
				updatedAt: commentData.updatedAt,
				archivedAt: commentData.archivedAt ?? null,
				attachments: [], // Linear doesn't expose attachments in GraphQL yet
				metadata: {
					linearId: commentData.id,
				},
			};

			return comment;
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
			const createPayload = await this.linearClient.createComment({
				issueId,
				body: input.body,
				parentId: input.parentId,
			});

			if (!createPayload.success) {
				throw new Error("Linear API returned success=false");
			}

			const createdComment = await createPayload.comment;
			if (!createdComment) {
				throw new Error("Created comment not returned from Linear API");
			}

			return await adaptLinearComment(createdComment);
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

			const nodes = (teamsConnection.nodes ?? []).map(adaptLinearTeam);

			return {
				nodes,
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
			const linearTeam = await this.linearClient.team(idOrKey);
			return adaptLinearTeam(linearTeam);
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

			const nodes = (labelsConnection.nodes ?? []).map(adaptLinearLabel);

			return {
				nodes,
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
			const linearLabel = await this.linearClient.issueLabel(idOrName);
			return adaptLinearLabel(linearLabel);
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

			const nodes = (statesConnection.nodes ?? []).map(
				adaptLinearWorkflowState,
			);

			return {
				nodes,
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
			const linearState = await this.linearClient.workflowState(stateId);
			return adaptLinearWorkflowState(linearState);
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
			const linearUser = await this.linearClient.user(userId);
			return adaptLinearUser(linearUser);
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
			const viewer = await this.linearClient.viewer;
			return adaptLinearUser(viewer);
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
	): Promise<AgentActivity> {
		try {
			const activityContent = toLinearActivityContent(content);
			const createPayload = await this.linearClient.createAgentActivity({
				agentSessionId: sessionId,
				content: activityContent,
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
	// RAW API ACCESS
	// ========================================================================

	/**
	 * Execute a raw GraphQL request.
	 */
	async rawGraphQLRequest<T = unknown>(
		query: string,
		variables?: Record<string, unknown>,
	): Promise<T> {
		try {
			const result = await (
				this.linearClient as LinearClientWithRawRequest
			).client.rawRequest<T>(query, variables);
			return result.data;
		} catch (error) {
			throw new Error(
				`Failed to execute raw GraphQL request: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Execute a raw REST API request.
	 *
	 * @remarks
	 * Linear primarily uses GraphQL, so this method is not implemented.
	 * Use rawGraphQLRequest instead.
	 */
	async rawRESTRequest<T = unknown>(
		_endpoint: string,
		_options?: {
			method?: string;
			headers?: Record<string, string>;
			body?: unknown;
		},
	): Promise<T> {
		throw new Error(
			"Linear API does not support REST requests. Use rawGraphQLRequest instead.",
		);
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
