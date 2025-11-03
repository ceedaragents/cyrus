/**
 * CLI-based implementation of IAgentEventTransport for socket-based event delivery.
 *
 * This transport listens to events from CLIIssueTrackerService and delivers them
 * to the application via both HTTP endpoints (for compatibility) and direct event
 * emission (for testing).
 *
 * @module issue-tracker/adapters/CLIEventTransport
 */

import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../AgentEvent.js";
import type {
	AgentEventTransportConfig,
	AgentEventTransportEvents,
	IAgentEventTransport,
} from "../../IAgentEventTransport.js";
import type { CLIIssueTrackerService } from "./CLIIssueTrackerService.js";

/**
 * CLI event transport that connects CLIIssueTrackerService events to the application.
 *
 * This transport listens for events from the CLI issue tracker service and transforms
 * them into AgentEvent format for delivery to the EdgeWorker.
 *
 * @example
 * ```typescript
 * const transport = service.createEventTransport({
 *   fastifyServer: server,
 *   verificationMode: 'proxy',
 *   secret: 'test-secret'
 * });
 *
 * transport.register();
 *
 * transport.on('event', (event: AgentEvent) => {
 *   console.log('Received event:', event.action);
 * });
 * ```
 */
export class CLIEventTransport
	extends EventEmitter
	implements IAgentEventTransport
{
	private issueTrackerService: CLIIssueTrackerService;
	private fastifyServer: FastifyInstance;

	constructor(
		issueTrackerService: CLIIssueTrackerService,
		config: AgentEventTransportConfig,
	) {
		super();
		this.issueTrackerService = issueTrackerService;
		this.fastifyServer = config.fastifyServer;

		// Set up event listeners from the issue tracker service
		this.setupEventListeners();
	}

	/**
	 * Set up listeners for events from the CLI issue tracker service.
	 */
	private setupEventListeners(): void {
		// Listen for issue assignment events
		this.issueTrackerService.on("issueAssigned", (issue: any) => {
			const event: AgentEvent = {
				type: "AppUserNotification",
				action: "issueAssignedToYou",
				createdAt: new Date().toISOString(),
				organizationId: "cli-org",
				oauthClientId: "cli-oauth-client",
				appUserId: "cli-app-user",
				notification: {
					issue: {
						id: issue.id,
						identifier: issue.identifier,
						title: issue.title,
						description: issue.description,
					},
				},
				webhookTimestamp: Date.now(),
				webhookId: `cli-webhook-${Date.now()}`,
			} as unknown as AgentEvent;

			this.deliverEvent(event);
		});

		// Listen for comment mention events
		this.issueTrackerService.on("commentMention", ({ comment, issue }: any) => {
			const event: AgentEvent = {
				type: "AppUserNotification",
				action: "issueCommentMention",
				createdAt: new Date().toISOString(),
				organizationId: "cli-org",
				oauthClientId: "cli-oauth-client",
				appUserId: "cli-app-user",
				notification: {
					comment: {
						id: comment.id,
						body: comment.body,
						issueId: issue,
					},
				},
				webhookTimestamp: Date.now(),
				webhookId: `cli-webhook-${Date.now()}`,
			} as unknown as AgentEvent;

			this.deliverEvent(event);
		});

		// Listen for agent session created events
		this.issueTrackerService.on(
			"agentSessionCreated",
			({ session, issue }: any) => {
				const event: AgentEvent = {
					type: "AgentSessionEvent",
					action: "created",
					createdAt: new Date().toISOString(),
					organizationId: "cli-org",
					oauthClientId: "cli-oauth-client",
					appUserId: "cli-app-user",
					agentSession: {
						id: session.id,
						createdAt: session.createdAt,
						updatedAt: session.updatedAt,
						archivedAt: session.archivedAt,
						creatorId: session.creatorId,
						appUserId: session.appUserId,
						commentId: session.commentId,
						issueId: session.issueId,
						status: session.status,
						startedAt: session.startedAt,
						endedAt: null,
						type: session.type,
						summary: null,
						sourceMetadata: null,
						organizationId: "cli-org",
						creator: {
							id: session.creatorId,
							name: "CLI User",
						},
						comment: session.commentId
							? {
									id: session.commentId,
									body: "",
								}
							: ({} as any),
						issue: {
							id: issue.id,
							identifier: issue.identifier,
							title: issue.title,
							description: issue.description || "",
							url: issue.url,
							team: issue.team
								? {
										id: issue.team.id,
										key: issue.team.key,
										name: issue.team.name,
									}
								: undefined,
						},
					},
					webhookTimestamp: Date.now().toString(),
					webhookId: `cli-webhook-${Date.now()}`,
				} as unknown as AgentEvent;

				this.deliverEvent(event);
			},
		);

		// Listen for agent session prompted events
		this.issueTrackerService.on(
			"agentSessionPrompted",
			async ({ sessionId, activity }: any) => {
				// Fetch the complete session data
				const session = this.issueTrackerService
					.getState()
					.agentSessions.get(sessionId);
				if (!session) {
					console.error(
						`[CLIEventTransport] Agent session not found: ${sessionId}`,
					);
					return;
				}

				// Fetch the associated issue
				const issue = this.issueTrackerService
					.getState()
					.issues.get(session.issueId);
				if (!issue) {
					console.error(
						`[CLIEventTransport] Issue not found: ${session.issueId}`,
					);
					return;
				}

				// Fetch the team if available
				const team = issue.teamId
					? this.issueTrackerService.getState().teams.get(issue.teamId)
					: undefined;

				const event: AgentEvent = {
					type: "AgentSessionEvent",
					action: "prompted",
					createdAt: new Date().toISOString(),
					organizationId: "cli-org",
					oauthClientId: "cli-oauth-client",
					appUserId: "cli-app-user",
					agentSession: {
						id: session.id,
						createdAt: session.createdAt,
						updatedAt: session.updatedAt,
						archivedAt: session.archivedAt,
						creatorId: session.creatorId,
						appUserId: session.appUserId,
						commentId: session.commentId,
						issueId: session.issueId,
						status: session.status,
						startedAt: session.startedAt,
						endedAt: null,
						type: session.type,
						summary: null,
						sourceMetadata: null,
						organizationId: "cli-org",
						creator: {
							id: session.creatorId,
							name: "CLI User",
						},
						comment: session.commentId
							? {
									id: session.commentId,
									body: "",
								}
							: ({} as any),
						issue: {
							id: issue.id,
							identifier: issue.identifier,
							title: issue.title,
							description: issue.description || "",
							url: issue.url,
							team: team
								? {
										id: team.id,
										key: team.key,
										name: team.name,
									}
								: undefined,
						},
					},
					agentActivity: {
						id: activity.id,
						content: activity.content,
					},
					webhookTimestamp: Date.now().toString(),
					webhookId: `cli-webhook-${Date.now()}`,
				} as unknown as AgentEvent;

				this.deliverEvent(event);
			},
		);
	}

	/**
	 * Deliver an event to registered listeners.
	 */
	private deliverEvent(event: AgentEvent): void {
		this.emit("event", event);
	}

	/**
	 * Register HTTP endpoints with the Fastify server.
	 *
	 * For CLI mode, we register endpoints but they're primarily for RPC control
	 * rather than webhook delivery. The actual event delivery happens through
	 * the EventEmitter pattern.
	 */
	register(): void {
		// Register a health check endpoint
		this.fastifyServer.get("/cli/health", async () => {
			return {
				status: "ok",
				platform: "cli",
				timestamp: new Date().toISOString(),
			};
		});

		// Register endpoint to get current state
		this.fastifyServer.get("/cli/state", async () => {
			return this.issueTrackerService.getState();
		});

		console.log("[CLIEventTransport] HTTP endpoints registered");
	}

	/**
	 * Register an event listener.
	 */
	on<K extends keyof AgentEventTransportEvents>(
		event: K,
		listener: AgentEventTransportEvents[K],
	): this {
		super.on(event, listener);
		return this;
	}

	/**
	 * Remove all event listeners.
	 */
	removeAllListeners(): this {
		super.removeAllListeners();
		return this;
	}
}
