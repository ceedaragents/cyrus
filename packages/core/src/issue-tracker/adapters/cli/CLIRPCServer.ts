/**
 * Socket RPC server for controlling CLIIssueTrackerService via remote commands.
 *
 * This server provides a JSON-RPC-like interface over HTTP for controlling the
 * CLI issue tracker. It's designed for testing and development workflows where
 * you want to programmatically control Cyrus agent sessions.
 *
 * @module issue-tracker/adapters/CLIRPCServer
 */

import type { FastifyInstance } from "fastify";
import type { CLIIssueTrackerService } from "./CLIIssueTrackerService.js";

/**
 * RPC command types for the CLI issue tracker.
 */
export type RPCCommand =
	| { method: "ping"; params?: Record<string, never> }
	| { method: "status"; params?: Record<string, never> }
	| { method: "viewAgentSession"; params: { sessionId: string } }
	| { method: "getActivity"; params: { sessionId: string; activityId: string } }
	| {
			method: "promptAgentSession";
			params: { sessionId: string; message: string };
	  }
	| { method: "stopAgentSession"; params: { sessionId: string } }
	| {
			method: "createIssue";
			params: {
				title: string;
				description?: string;
				options?: Record<string, unknown>;
			};
	  }
	| {
			method: "assignIssue";
			params: { issueId: string; assigneeId?: string | null };
	  }
	| {
			method: "createComment";
			params: { issueId: string; body: string; mentionAgent?: boolean };
	  }
	| { method: "startAgentSessionOnIssue"; params: { issueId: string } }
	| { method: "startAgentSessionOnComment"; params: { commentId: string } }
	| {
			method: "createLabel";
			params: { name: string; options?: Record<string, unknown> };
	  }
	| {
			method: "createMember";
			params: { name: string; options?: Record<string, unknown> };
	  }
	| { method: "fetchLabels"; params?: Record<string, never> }
	| { method: "fetchMembers"; params?: Record<string, never> }
	| { method: "getState"; params?: Record<string, never> };

/**
 * RPC response type.
 */
export interface RPCResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * Request body types for convenience endpoints.
 */
interface CreateIssueRequestBody {
	title: string;
	description?: string;
	teamId?: string;
	assigneeId?: string;
	[key: string]: unknown;
}

interface CreateCommentRequestBody {
	issueId: string;
	body: string;
	mentionAgent?: boolean;
}

interface PromptSessionRequestBody {
	sessionId: string;
	message: string;
}

interface StopSessionRequestBody {
	sessionId: string;
}

interface ViewSessionParams {
	sessionId: string;
}

/**
 * Socket RPC server for CLI issue tracker control.
 *
 * Registers HTTP endpoints on the Fastify server that accept JSON-RPC commands
 * and execute them against the CLIIssueTrackerService.
 *
 * @example
 * ```typescript
 * const rpcServer = new CLIRPCServer(fastifyServer, issueTrackerService);
 * rpcServer.register();
 *
 * // From a client:
 * // POST /cli/rpc
 * // {
 * //   "method": "createIssue",
 * //   "params": {
 * //     "title": "Test issue",
 * //     "description": "This is a test"
 * //   }
 * // }
 * ```
 */
export class CLIRPCServer {
	private fastifyServer: FastifyInstance;
	private issueTrackerService: CLIIssueTrackerService;
	private startTime: Date;

	constructor(
		fastifyServer: FastifyInstance,
		issueTrackerService: CLIIssueTrackerService,
	) {
		this.fastifyServer = fastifyServer;
		this.issueTrackerService = issueTrackerService;
		this.startTime = new Date();
	}

	/**
	 * Register RPC endpoints with the Fastify server.
	 */
	register(): void {
		// Main RPC endpoint
		this.fastifyServer.post("/cli/rpc", async (request) => {
			try {
				const command = request.body as RPCCommand;
				const result = await this.handleCommand(command);
				return result;
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Convenience endpoints for common operations
		this.fastifyServer.post("/cli/issue", async (request) => {
			try {
				const params = request.body as CreateIssueRequestBody;
				const issue = await this.issueTrackerService.createIssue(params);
				return { success: true, data: issue };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		this.fastifyServer.post("/cli/comment", async (request) => {
			try {
				const { issueId, body, mentionAgent } =
					request.body as CreateCommentRequestBody;
				const finalBody = mentionAgent
					? `${this.issueTrackerService.getAgentHandle()} ${body}`
					: body;
				const comment = await this.issueTrackerService.createComment(issueId, {
					body: finalBody,
				});
				return { success: true, data: comment };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		this.fastifyServer.post("/cli/session/start", async (request) => {
			try {
				const { issueId } = request.body as { issueId: string };
				const response =
					await this.issueTrackerService.createAgentSessionOnIssue({ issueId });
				return { success: true, data: response };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		this.fastifyServer.post("/cli/session/prompt", async (request) => {
			try {
				const { sessionId, message } = request.body as PromptSessionRequestBody;
				const activity = await this.issueTrackerService.promptAgentSession(
					sessionId,
					message,
				);
				return { success: true, data: activity };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		this.fastifyServer.post("/cli/session/stop", async (request) => {
			try {
				const { sessionId } = request.body as StopSessionRequestBody;
				const activity =
					await this.issueTrackerService.stopAgentSession(sessionId);
				return { success: true, data: activity };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		this.fastifyServer.get("/cli/session/:sessionId", async (request) => {
			try {
				const { sessionId } = request.params as ViewSessionParams;
				const session =
					await this.issueTrackerService.fetchAgentSession(sessionId);
				const activities =
					await this.issueTrackerService.fetchAgentActivities(sessionId);
				return {
					success: true,
					data: {
						session,
						activities,
					},
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		console.log("[CLIRPCServer] RPC endpoints registered at /cli/rpc");
	}

	/**
	 * Get server uptime in human-readable format
	 */
	private getUptime(): string {
		const now = new Date();
		const diff = now.getTime() - this.startTime.getTime();
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) {
			return `${days}d ${hours % 24}h ${minutes % 60}m`;
		}
		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		}
		if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		}
		return `${seconds}s`;
	}

	/**
	 * Handle an RPC command.
	 */
	private async handleCommand(command: RPCCommand): Promise<RPCResponse> {
		switch (command.method) {
			case "ping": {
				return {
					success: true,
					data: {
						pong: true,
						timestamp: new Date().toISOString(),
					},
				};
			}

			case "status": {
				const metadata = this.issueTrackerService.getPlatformMetadata();
				return {
					success: true,
					data: {
						...metadata,
						uptime: this.getUptime(),
						startTime: this.startTime.toISOString(),
					},
				};
			}

			case "viewAgentSession": {
				const session = await this.issueTrackerService.fetchAgentSession(
					command.params.sessionId,
				);
				const activities = await this.issueTrackerService.fetchAgentActivities(
					command.params.sessionId,
				);
				return {
					success: true,
					data: { session, activities },
				};
			}

			case "getActivity": {
				const activities = await this.issueTrackerService.fetchAgentActivities(
					command.params.sessionId,
				);
				const activity = activities.find(
					(a) => a.id === command.params.activityId,
				);
				if (!activity) {
					return {
						success: false,
						error: `Activity not found: ${command.params.activityId}`,
					};
				}
				return {
					success: true,
					data: activity,
				};
			}

			case "promptAgentSession": {
				const activity = await this.issueTrackerService.promptAgentSession(
					command.params.sessionId,
					command.params.message,
				);
				return {
					success: true,
					data: activity,
				};
			}

			case "stopAgentSession": {
				const activity = await this.issueTrackerService.stopAgentSession(
					command.params.sessionId,
				);
				return {
					success: true,
					data: activity,
				};
			}

			case "createIssue": {
				const issue = await this.issueTrackerService.createIssue({
					title: command.params.title,
					description: command.params.description,
					...command.params.options,
				});
				return {
					success: true,
					data: issue,
				};
			}

			case "assignIssue": {
				const issue = await this.issueTrackerService.updateIssue(
					command.params.issueId,
					{
						assigneeId: command.params.assigneeId ?? undefined,
					},
				);
				return {
					success: true,
					data: issue,
				};
			}

			case "createComment": {
				const { issueId, body, mentionAgent } = command.params;
				const finalBody = mentionAgent
					? `${this.issueTrackerService.getAgentHandle()} ${body}`
					: body;
				const comment = await this.issueTrackerService.createComment(issueId, {
					body: finalBody,
				});
				return {
					success: true,
					data: comment,
				};
			}

			case "startAgentSessionOnIssue": {
				const response =
					await this.issueTrackerService.createAgentSessionOnIssue({
						issueId: command.params.issueId,
					});
				return {
					success: true,
					data: response,
				};
			}

			case "startAgentSessionOnComment": {
				const response =
					await this.issueTrackerService.createAgentSessionOnComment({
						commentId: command.params.commentId,
					});
				return {
					success: true,
					data: response,
				};
			}

			case "createLabel": {
				const label = await this.issueTrackerService.createLabel({
					name: command.params.name,
					...command.params.options,
				});
				return {
					success: true,
					data: label,
				};
			}

			case "createMember": {
				const user = await this.issueTrackerService.createMember({
					name: command.params.name,
					...command.params.options,
				});
				return {
					success: true,
					data: user,
				};
			}

			case "fetchLabels": {
				const labels = await this.issueTrackerService.fetchLabels();
				return {
					success: true,
					data: labels.nodes,
				};
			}

			case "fetchMembers": {
				const usersMap = this.issueTrackerService.getState().users;
				const users = Array.from(usersMap.values());
				return {
					success: true,
					data: users,
				};
			}

			case "getState": {
				const state = this.issueTrackerService.getState();
				return {
					success: true,
					data: {
						issues: Array.from(state.issues.values()),
						comments: Array.from(state.comments.values()),
						sessions: Array.from(state.agentSessions.values()),
						labels: Array.from(state.labels.values()),
						users: Array.from(state.users.values()),
						teams: Array.from(state.teams.values()),
						workflowStates: Array.from(state.workflowStates.values()),
					},
				};
			}

			default:
				return {
					success: false,
					error: `Unknown method: ${(command as { method: string }).method}`,
				};
		}
	}
}
