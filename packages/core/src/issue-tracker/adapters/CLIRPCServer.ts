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
		const { teamId, title } = params;

		// Unused params will be used when CLIIssueTrackerService.createIssue is implemented
		// const { description, priority, stateId } = params;

		if (!teamId || !title) {
			return {
				success: false,
				error: "Missing required parameters: teamId and title are required",
			};
		}

		try {
			// CLIIssueTrackerService should have a createIssue method
			// For now, we'll call updateIssue after creating a minimal issue
			// This is a placeholder - the actual implementation depends on
			// CLIIssueTrackerService having a createIssue method

			throw new Error(
				"createIssue not yet implemented in CLIIssueTrackerService",
			);
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
		const { sessionId, limit = 50, offset = 0 } = params;

		// Search param will be used when activity fetching is implemented
		// const { search } = params;

		if (!sessionId) {
			return {
				success: false,
				error: "Missing required parameter: sessionId is required",
			};
		}

		try {
			// Fetch session
			const session =
				await this.config.issueTracker.fetchAgentSession(sessionId);
			const agentSession = await session;

			// Fetch activities (this method doesn't exist yet in IIssueTrackerService)
			// This is a placeholder showing the expected interface
			const activities: AgentActivityData[] = [];
			const totalCount = 0;

			// Apply pagination
			const paginatedActivities = activities.slice(offset, offset + limit);
			const hasMore = offset + limit < totalCount;

			return {
				success: true,
				data: {
					session: {
						sessionId: agentSession.id,
						issueId: "unknown", // Would need to be tracked in session
						status: agentSession.status ?? "unknown",
						createdAt: Date.now(), // Would need to be tracked in session
						updatedAt: Date.now(), // Would need to be tracked in session
					},
					activities: paginatedActivities,
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
			// This would need to trigger EdgeWorker's agentSessionPrompted handler
			// For now, this is a placeholder
			throw new Error(
				"promptSession not yet implemented - requires EdgeWorker integration",
			);
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
			// This would need to trigger EdgeWorker's stop signal handler
			// For now, this is a placeholder
			throw new Error(
				"stopSession not yet implemented - requires EdgeWorker integration",
			);
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
		const { limit = 50, offset = 0 } = params;

		// IssueId param will be used when session listing is implemented
		// const { issueId } = params;

		try {
			// This would need access to all sessions
			// For now, this is a placeholder
			const sessions: AgentSessionData[] = [];
			const totalCount = 0;

			// Apply pagination
			const paginatedSessions = sessions.slice(offset, offset + limit);
			const hasMore = offset + limit < totalCount;

			return {
				success: true,
				data: {
					sessions: paginatedSessions,
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
