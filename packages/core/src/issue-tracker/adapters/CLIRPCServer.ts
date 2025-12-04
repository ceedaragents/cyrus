/**
 * CLI RPC Server - Fastify-based JSON-RPC handler for F1 testing framework
 *
 * This server exposes HTTP endpoints that bridge the F1 CLI binary with the
 * CLIIssueTrackerService and EdgeWorker, enabling command routing, pagination,
 * and session management.
 *
 * @module issue-tracker/adapters/CLIRPCServer
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
	AgentSessionCreateOnIssueInput,
	Comment,
	CommentCreateInput,
	Issue,
	IssueUpdateInput,
} from "../types.js";
import type { CLIIssueTrackerService } from "./CLIIssueTrackerService.js";

/**
 * RPC command type union for all supported commands
 */
export type RPCCommand =
	| "ping"
	| "status"
	| "version"
	| "createIssue"
	| "assignIssue"
	| "createComment"
	| "startSession"
	| "viewSession"
	| "promptSession"
	| "stopSession"
	| "listAgentSessions";

/**
 * Generic RPC request structure
 */
export interface RPCRequest<TParams = unknown> {
	method: RPCCommand;
	params: TParams;
}

/**
 * Generic RPC response structure
 */
export interface RPCResponse<TData = unknown> {
	success: boolean;
	data?: TData;
	error?: string;
}

/**
 * Ping command parameters (no params needed)
 */
export type PingParams = Record<string, never>;

/**
 * Ping command response data
 */
export interface PingData {
	message: string;
	timestamp: number;
}

/**
 * Status command parameters (no params needed)
 */
export type StatusParams = Record<string, never>;

/**
 * Status command response data
 */
export interface StatusData {
	uptime: number;
	status: "ready";
	server: string;
}

/**
 * Version command parameters (no params needed)
 */
export type VersionParams = Record<string, never>;

/**
 * Version command response data
 */
export interface VersionData {
	version: string;
	platform: string;
}

/**
 * Create issue command parameters
 */
export interface CreateIssueParams {
	teamId: string;
	title: string;
	description?: string;
	priority?: number;
	stateId?: string;
}

/**
 * Create issue command response data
 */
export interface CreateIssueData {
	issue: Issue;
}

/**
 * Assign issue command parameters
 */
export interface AssignIssueParams {
	issueId: string;
	userId: string;
}

/**
 * Assign issue command response data
 */
export interface AssignIssueData {
	issue: Issue;
}

/**
 * Create comment command parameters
 */
export interface CreateCommentParams {
	issueId: string;
	body: string;
}

/**
 * Create comment command response data
 */
export interface CreateCommentData {
	comment: Comment;
}

/**
 * Start session command parameters
 */
export interface StartSessionParams {
	issueId: string;
	externalLink?: string;
}

/**
 * Agent session data returned from start/view commands
 */
export interface AgentSessionData {
	sessionId: string;
	issueId: string;
	status: string;
	createdAt: number;
	updatedAt: number;
}

/**
 * Start session command response data
 */
export interface StartSessionData {
	session: AgentSessionData;
}

/**
 * View session command parameters
 */
export interface ViewSessionParams {
	sessionId: string;
	limit?: number;
	offset?: number;
	search?: string;
}

/**
 * Agent activity data for view session response
 */
export interface AgentActivityData {
	id: string;
	type: string;
	content: string;
	createdAt: number;
}

/**
 * View session command response data
 */
export interface ViewSessionData {
	session: AgentSessionData;
	activities: AgentActivityData[];
	totalCount: number;
	hasMore: boolean;
}

/**
 * Prompt session command parameters
 */
export interface PromptSessionParams {
	sessionId: string;
	message: string;
}

/**
 * Prompt session command response data
 */
export interface PromptSessionData {
	success: boolean;
	message: string;
}

/**
 * Stop session command parameters
 */
export interface StopSessionParams {
	sessionId: string;
}

/**
 * Stop session command response data
 */
export interface StopSessionData {
	success: boolean;
	message: string;
}

/**
 * List agent sessions command parameters
 */
export interface ListAgentSessionsParams {
	issueId?: string;
	limit?: number;
	offset?: number;
}

/**
 * List agent sessions command response data
 */
export interface ListAgentSessionsData {
	sessions: AgentSessionData[];
	totalCount: number;
	hasMore: boolean;
}

/**
 * CLI RPC Server configuration
 */
export interface CLIRPCServerConfig {
	/**
	 * Fastify instance to register routes on
	 */
	fastifyServer: FastifyInstance;

	/**
	 * CLIIssueTrackerService instance to delegate to
	 */
	issueTracker: CLIIssueTrackerService;

	/**
	 * Version string to return for version command
	 */
	version?: string;
}

/**
 * CLI RPC Server
 *
 * Exposes HTTP JSON-RPC endpoints for CLI commands, delegating to
 * CLIIssueTrackerService for all operations.
 *
 * @example
 * ```typescript
 * const server = new CLIRPCServer({
 *   fastifyServer: app,
 *   issueTracker: cliIssueTracker,
 *   version: "1.0.0"
 * });
 *
 * server.register();
 * ```
 */
export class CLIRPCServer {
	private config: CLIRPCServerConfig;
	private startTime: number;

	constructor(config: CLIRPCServerConfig) {
		this.config = config;
		this.startTime = Date.now();
	}

	/**
	 * Register the /cli/rpc endpoint with Fastify
	 */
	register(): void {
		this.config.fastifyServer.post(
			"/cli/rpc",
			async (
				request: FastifyRequest<{ Body: RPCRequest }>,
				reply: FastifyReply,
			) => {
				try {
					const { method, params } = request.body;

					// Route to appropriate handler
					const response = await this.handleCommand(method, params);

					reply.send(response);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : "Unknown error";

					reply.send({
						success: false,
						error: errorMessage,
					});
				}
			},
		);
	}

	/**
	 * Route commands to appropriate handlers
	 */
	private async handleCommand(
		method: RPCCommand,
		params: unknown,
	): Promise<RPCResponse> {
		switch (method) {
			case "ping":
				return this.handlePing(params as PingParams);

			case "status":
				return this.handleStatus(params as StatusParams);

			case "version":
				return this.handleVersion(params as VersionParams);

			case "createIssue":
				return this.handleCreateIssue(params as CreateIssueParams);

			case "assignIssue":
				return this.handleAssignIssue(params as AssignIssueParams);

			case "createComment":
				return this.handleCreateComment(params as CreateCommentParams);

			case "startSession":
				return this.handleStartSession(params as StartSessionParams);

			case "viewSession":
				return this.handleViewSession(params as ViewSessionParams);

			case "promptSession":
				return this.handlePromptSession(params as PromptSessionParams);

			case "stopSession":
				return this.handleStopSession(params as StopSessionParams);

			case "listAgentSessions":
				return this.handleListAgentSessions(params as ListAgentSessionsParams);

			default:
				return {
					success: false,
					error: `Unknown command: ${method}`,
				};
		}
	}

	/**
	 * Handle ping command - health check
	 */
	private async handlePing(
		_params: PingParams,
	): Promise<RPCResponse<PingData>> {
		return {
			success: true,
			data: {
				message: "pong",
				timestamp: Date.now(),
			},
		};
	}

	/**
	 * Handle status command - server status with uptime
	 */
	private async handleStatus(
		_params: StatusParams,
	): Promise<RPCResponse<StatusData>> {
		return {
			success: true,
			data: {
				uptime: Date.now() - this.startTime,
				status: "ready",
				server: "CLIRPCServer",
			},
		};
	}

	/**
	 * Handle version command - version info
	 */
	private async handleVersion(
		_params: VersionParams,
	): Promise<RPCResponse<VersionData>> {
		return {
			success: true,
			data: {
				version: this.config.version ?? "unknown",
				platform: "cli",
			},
		};
	}

	/**
	 * Handle createIssue command - create new issue
	 */
	private async handleCreateIssue(
		params: CreateIssueParams,
	): Promise<RPCResponse<CreateIssueData>> {
		const { teamId, title, description, priority, stateId } = params;

		if (!teamId || !title) {
			return {
				success: false,
				error: "Missing required parameters: teamId and title are required",
			};
		}

		try {
			const issue = await this.config.issueTracker.createIssue({
				teamId,
				title,
				description,
				priority,
				stateId,
			});

			return {
				success: true,
				data: {
					issue,
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to create issue",
			};
		}
	}

	/**
	 * Handle assignIssue command - assign issue to user
	 */
	private async handleAssignIssue(
		params: AssignIssueParams,
	): Promise<RPCResponse<AssignIssueData>> {
		const { issueId, userId } = params;

		if (!issueId || !userId) {
			return {
				success: false,
				error: "Missing required parameters: issueId and userId are required",
			};
		}

		try {
			const updates: IssueUpdateInput = {
				assigneeId: userId,
			};

			const issue = await this.config.issueTracker.updateIssue(
				issueId,
				updates,
			);

			return {
				success: true,
				data: {
					issue,
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to assign issue",
			};
		}
	}

	/**
	 * Handle createComment command - add comment to issue
	 */
	private async handleCreateComment(
		params: CreateCommentParams,
	): Promise<RPCResponse<CreateCommentData>> {
		const { issueId, body } = params;

		if (!issueId || !body) {
			return {
				success: false,
				error: "Missing required parameters: issueId and body are required",
			};
		}

		try {
			const input: CommentCreateInput = {
				body,
			};

			const comment = await this.config.issueTracker.createComment(
				issueId,
				input,
			);

			return {
				success: true,
				data: {
					comment,
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to create comment",
			};
		}
	}

	/**
	 * Handle startSession command - start agent session on issue
	 */
	private async handleStartSession(
		params: StartSessionParams,
	): Promise<RPCResponse<StartSessionData>> {
		const { issueId, externalLink } = params;

		if (!issueId) {
			return {
				success: false,
				error: "Missing required parameter: issueId is required",
			};
		}

		try {
			const input: AgentSessionCreateOnIssueInput = {
				issueId,
				...(externalLink && { externalLink }),
			};

			const result =
				await this.config.issueTracker.createAgentSessionOnIssue(input);

			// Extract session from LinearFetch result
			const agentSessionPayload = await result;

			// Access agentSession property safely
			const agentSession = await agentSessionPayload.agentSession;

			if (!agentSession) {
				throw new Error("Failed to create agent session - no session returned");
			}

			return {
				success: true,
				data: {
					session: {
						sessionId: agentSession.id,
						issueId,
						status: agentSession.status ?? "unknown",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					},
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to start session",
			};
		}
	}

	/**
	 * Handle viewSession command - view session with activity pagination
	 */
	private async handleViewSession(
		params: ViewSessionParams,
	): Promise<RPCResponse<ViewSessionData>> {
		const { sessionId, limit = 50, offset = 0, search } = params;

		if (!sessionId) {
			return {
				success: false,
				error: "Missing required parameter: sessionId is required",
			};
		}

		try {
			// Fetch session
			const agentSession =
				await this.config.issueTracker.fetchAgentSession(sessionId);

			// Fetch activities from the issue tracker
			const activityDataList = this.config.issueTracker.listAgentActivities(
				sessionId,
				{ limit: limit + 1, offset }, // Fetch one extra to check hasMore
			);

			// Filter by search if provided
			let filteredActivities = activityDataList;
			if (search) {
				const searchLower = search.toLowerCase();
				filteredActivities = activityDataList.filter((a) =>
					a.content.toLowerCase().includes(searchLower),
				);
			}

			// Check if there are more activities
			const hasMore = filteredActivities.length > limit;
			const paginatedActivityData = hasMore
				? filteredActivities.slice(0, limit)
				: filteredActivities;

			// Transform to AgentActivityData format
			const activities: AgentActivityData[] = paginatedActivityData.map(
				(activityData) => ({
					id: activityData.id,
					type: activityData.type,
					content: activityData.content,
					createdAt: activityData.createdAt.getTime(),
				}),
			);

			// Get total count
			const allActivities =
				this.config.issueTracker.listAgentActivities(sessionId);
			const totalCount = search
				? allActivities.filter((a) =>
						a.content.toLowerCase().includes(search.toLowerCase()),
					).length
				: allActivities.length;

			return {
				success: true,
				data: {
					session: {
						sessionId: agentSession.id,
						issueId: agentSession.issueId ?? "unknown",
						status: agentSession.status ?? "unknown",
						createdAt: agentSession.createdAt.getTime(),
						updatedAt: agentSession.updatedAt.getTime(),
					},
					activities,
					totalCount,
					hasMore,
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to view session",
			};
		}
	}

	/**
	 * Handle promptSession command - send message to session
	 */
	private async handlePromptSession(
		params: PromptSessionParams,
	): Promise<RPCResponse<PromptSessionData>> {
		const { sessionId, message } = params;

		if (!sessionId || !message) {
			return {
				success: false,
				error:
					"Missing required parameters: sessionId and message are required",
			};
		}

		try {
			// Prompt the session - this creates a comment and emits a prompted event
			await this.config.issueTracker.promptAgentSession(sessionId, message);

			return {
				success: true,
				data: {
					success: true,
					message: "Session prompted successfully",
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to prompt session",
			};
		}
	}

	/**
	 * Handle stopSession command - stop agent session
	 */
	private async handleStopSession(
		params: StopSessionParams,
	): Promise<RPCResponse<StopSessionData>> {
		const { sessionId } = params;

		if (!sessionId) {
			return {
				success: false,
				error: "Missing required parameter: sessionId is required",
			};
		}

		try {
			// Import AgentSessionStatus for the update
			const { AgentSessionStatus } = await import("../types.js");

			// Update the session status to complete
			await this.config.issueTracker.updateAgentSessionStatus(
				sessionId,
				AgentSessionStatus.Complete,
			);

			return {
				success: true,
				data: {
					success: true,
					message: "Session stopped successfully",
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to stop session",
			};
		}
	}

	/**
	 * Handle listAgentSessions command - list all sessions (optional)
	 */
	private async handleListAgentSessions(
		params: ListAgentSessionsParams,
	): Promise<RPCResponse<ListAgentSessionsData>> {
		const { issueId, limit = 50, offset = 0 } = params;

		try {
			// Get sessions from the issue tracker
			const sessionDataList = this.config.issueTracker.listAgentSessions({
				issueId,
				limit: limit + 1, // Fetch one extra to check hasMore
				offset,
			});

			// Check if there are more sessions
			const hasMore = sessionDataList.length > limit;
			const paginatedSessionData = hasMore
				? sessionDataList.slice(0, limit)
				: sessionDataList;

			// Transform to AgentSessionData format
			const sessions: AgentSessionData[] = paginatedSessionData.map(
				(sessionData) => ({
					sessionId: sessionData.id,
					issueId: sessionData.issueId ?? "unknown",
					status: sessionData.status ?? "unknown",
					createdAt: sessionData.createdAt.getTime(),
					updatedAt: sessionData.updatedAt.getTime(),
				}),
			);

			// Get total count (approximate - would need separate count query for accuracy)
			const allSessions = this.config.issueTracker.listAgentSessions({
				issueId,
			});
			const totalCount = allSessions.length;

			return {
				success: true,
				data: {
					sessions,
					totalCount,
					hasMore,
				},
			};
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to list agent sessions",
			};
		}
	}
}
