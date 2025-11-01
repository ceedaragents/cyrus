/**
 * Linear adapter implementation of IssueTracker interface
 */

import { EventEmitter } from "node:events";
import { LinearClient } from "@linear/sdk";
import type {
	AgentSignal,
	IssueAttachment as Attachment,
	Comment,
	Issue,
	IssueEvent,
	IssueFilters,
	IssueState,
	IssueTracker,
	Label,
	Member,
} from "cyrus-interfaces";
import {
	mapIssueStateType,
	mapLinearAttachment,
	mapLinearComment,
	mapLinearIssue,
} from "./mappers.js";

/**
 * Configuration options for LinearIssueTracker
 */
export interface LinearIssueTrackerConfig {
	/**
	 * Linear API access token
	 */
	accessToken: string;

	/**
	 * Optional webhook secret for signature verification
	 */
	webhookSecret?: string;
}

/**
 * Linear implementation of IssueTracker
 *
 * This adapter wraps the Linear SDK and implements the abstract IssueTracker interface.
 * It handles all Linear-specific details including type mapping, pagination, and webhooks.
 *
 * @example
 * ```typescript
 * const tracker = new LinearIssueTracker({
 *   accessToken: process.env.LINEAR_API_TOKEN,
 *   webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
 * });
 *
 * // Get an issue
 * const issue = await tracker.getIssue("CYPACK-268");
 *
 * // Watch for updates
 * for await (const event of tracker.watchIssues(memberId)) {
 *   console.log(event.type, event.issue);
 * }
 * ```
 */
export class LinearIssueTracker implements IssueTracker {
	private client: LinearClient;
	private eventEmitter: EventEmitter;

	constructor(config: LinearIssueTrackerConfig) {
		this.client = new LinearClient({
			accessToken: config.accessToken,
		});
		this.eventEmitter = new EventEmitter();
	}

	/**
	 * Get an issue by its ID or identifier
	 *
	 * @param issueId - Issue UUID or identifier (e.g., "CYPACK-268")
	 * @returns Promise that resolves to the issue
	 * @throws Error if issue is not found
	 */
	async getIssue(issueId: string): Promise<Issue> {
		try {
			const linearIssue = await this.client.issue(issueId);
			return await mapLinearIssue(linearIssue);
		} catch (error) {
			throw new Error(
				`Failed to get issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * List issues assigned to a specific member
	 *
	 * @param memberId - ID of the member
	 * @param filters - Optional filters to narrow results
	 * @returns Promise that resolves to array of issues
	 */
	async listAssignedIssues(
		memberId: string,
		filters?: IssueFilters,
	): Promise<Issue[]> {
		try {
			// Build Linear API filter
			const filter: any = {
				assignee: { id: { eq: memberId } },
			};

			// Apply state filters
			if (filters?.state) {
				const states = Array.isArray(filters.state)
					? filters.state
					: [filters.state];
				if (states.length === 1) {
					const stateType = states[0];
					if (stateType) {
						filter.state = { type: { eq: mapIssueStateType(stateType) } };
					}
				} else {
					const validStates = states.filter(
						(s): s is IssueState["type"] => s !== undefined,
					);
					if (validStates.length > 0) {
						filter.state = { type: { in: validStates.map(mapIssueStateType) } };
					}
				}
			}

			// Apply priority filters
			if (filters?.priority !== undefined) {
				const priorities = Array.isArray(filters.priority)
					? filters.priority
					: [filters.priority];
				if (priorities.length === 1) {
					filter.priority = { eq: priorities[0] };
				} else {
					filter.priority = { in: priorities };
				}
			}

			// Apply label filters
			if (filters?.labels && filters.labels.length > 0) {
				filter.labels = { some: { name: { in: filters.labels } } };
			}

			// Apply project filter
			if (filters?.projectId) {
				filter.project = { id: { eq: filters.projectId } };
			}

			// Apply team filter
			if (filters?.teamId) {
				filter.team = { id: { eq: filters.teamId } };
			}

			// Apply date filters
			if (filters?.createdAfter) {
				filter.createdAt = { gte: filters.createdAfter };
			}
			if (filters?.createdBefore) {
				filter.createdAt = { ...filter.createdAt, lte: filters.createdBefore };
			}
			if (filters?.updatedAfter) {
				filter.updatedAt = { gte: filters.updatedAfter };
			}
			if (filters?.updatedBefore) {
				filter.updatedAt = { ...filter.updatedAt, lte: filters.updatedBefore };
			}

			// Query Linear API
			const issuesConnection = await this.client.issues({
				filter,
				first: filters?.limit || 50,
			});

			// Map to abstract Issue type
			const issues = await Promise.all(
				issuesConnection.nodes.map((issue) => mapLinearIssue(issue)),
			);

			return issues;
		} catch (error) {
			throw new Error(
				`Failed to list assigned issues for member ${memberId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Update the state of an issue
	 *
	 * @param issueId - ID of the issue to update
	 * @param state - New state to set
	 * @throws Error if update fails
	 */
	async updateIssueState(issueId: string, state: IssueState): Promise<void> {
		try {
			// If state.id is provided, use it directly
			if (state.id) {
				await this.client.updateIssue(issueId, {
					stateId: state.id,
				});
				return;
			}

			// Otherwise, find the state by type
			// First get the issue to find its team
			const issue = await this.client.issue(issueId);
			const team = await issue.team;

			if (!team) {
				throw new Error(`Issue ${issueId} has no team`);
			}

			// Get workflow states for the team
			const statesConnection = await this.client.workflowStates({
				filter: {
					team: { id: { eq: team.id } },
					type: { eq: mapIssueStateType(state.type) },
				},
			});

			const states = statesConnection.nodes;
			if (states.length === 0) {
				throw new Error(
					`No workflow state found for type "${state.type}" in team ${team.id}`,
				);
			}

			// Use the first state (lowest position)
			const targetState = states.sort((a, b) => a.position - b.position)[0];

			if (!targetState) {
				throw new Error(
					`No workflow state found for type "${state.type}" in team ${team.id}`,
				);
			}

			await this.client.updateIssue(issueId, {
				stateId: targetState.id,
			});
		} catch (error) {
			throw new Error(
				`Failed to update issue state for ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Add a comment to an issue
	 *
	 * @param issueId - ID of the issue
	 * @param comment - Comment to add (without id, which will be generated)
	 * @returns Promise that resolves to the complete Comment object (including generated id)
	 * @throws Error if comment cannot be added
	 */
	async addComment(
		issueId: string,
		comment: Omit<Comment, "id">,
	): Promise<Comment> {
		try {
			const commentData: {
				issueId: string;
				body: string;
				parentId?: string;
			} = {
				issueId,
				body: comment.content,
			};

			// If this is a reply, set parent ID
			if (!comment.isRoot && comment.parentId) {
				commentData.parentId = comment.parentId;
			}

			const result = await this.client.createComment(commentData);
			const newComment = await result.comment;

			if (!newComment) {
				throw new Error("Failed to retrieve created comment");
			}

			// Return the full Comment object
			return {
				id: newComment.id,
				author: comment.author,
				content: comment.content,
				createdAt: comment.createdAt || new Date(),
				isRoot: comment.isRoot,
				parentId: comment.parentId,
				updatedAt: newComment.updatedAt
					? new Date(newComment.updatedAt)
					: undefined,
			};
		} catch (error) {
			throw new Error(
				`Failed to add comment to issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Get all comments for an issue
	 *
	 * @param issueId - ID of the issue
	 * @returns Promise that resolves to array of comments
	 */
	async getComments(issueId: string): Promise<Comment[]> {
		try {
			const commentsConnection = await this.client.comments({
				filter: {
					issue: { id: { eq: issueId } },
				},
			});

			const comments = await Promise.all(
				commentsConnection.nodes.map((comment) => mapLinearComment(comment)),
			);

			return comments;
		} catch (error) {
			throw new Error(
				`Failed to get comments for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Watch for issue updates for a specific member
	 *
	 * This returns an async iterable that emits events when issues assigned to
	 * the member are updated. The implementation relies on webhook events being
	 * fed to this tracker via `emitWebhookEvent()`.
	 *
	 * @param memberId - ID of the member whose assigned issues to watch
	 * @returns Async iterable of issue events
	 *
	 * @example
	 * ```typescript
	 * // Start watching
	 * for await (const event of tracker.watchIssues(memberId)) {
	 *   if (event.type === 'assigned') {
	 *     console.log('New issue assigned:', event.issue.identifier);
	 *   }
	 * }
	 * ```
	 */
	async *watchIssues(memberId: string): AsyncIterable<IssueEvent> {
		// Create a queue to buffer events
		const eventQueue: IssueEvent[] = [];
		let resolveNext: ((event: IssueEvent | null) => void) | null = null;
		let finished = false;

		// Set up event listener
		const eventHandler = (event: IssueEvent) => {
			// Only emit events for this member's assigned issues
			if (event.issue.assignee?.id === memberId) {
				if (resolveNext) {
					resolveNext(event);
					resolveNext = null;
				} else {
					eventQueue.push(event);
				}
			}
		};

		this.eventEmitter.on("issue-event", eventHandler);

		try {
			while (!finished) {
				// If we have queued events, yield them
				if (eventQueue.length > 0) {
					const event = eventQueue.shift()!;
					yield event;
				} else {
					// Wait for the next event
					const event = await new Promise<IssueEvent | null>((resolve) => {
						resolveNext = resolve;
					});

					if (event === null) {
						// Signal to stop
						finished = true;
					} else {
						yield event;
					}
				}
			}
		} finally {
			// Clean up listener
			this.eventEmitter.off("issue-event", eventHandler);
		}
	}

	/**
	 * Get attachments for an issue
	 *
	 * @param issueId - ID of the issue
	 * @returns Promise that resolves to array of attachments
	 */
	async getAttachments(issueId: string): Promise<Attachment[]> {
		try {
			const issue = await this.client.issue(issueId);
			const attachmentsConnection = await issue.attachments();

			const attachments = attachmentsConnection.nodes.map((attachment) =>
				mapLinearAttachment(attachment),
			);

			return attachments;
		} catch (error) {
			throw new Error(
				`Failed to get attachments for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Send a signal to control agent behavior on an issue
	 *
	 * Linear supports agent signals through its agent activity API.
	 * This method creates an agent activity with the appropriate signal.
	 *
	 * @param issueId - ID of the issue
	 * @param signal - Signal to send
	 * @throws Error if signal cannot be sent
	 */
	async sendSignal(issueId: string, signal: AgentSignal): Promise<void> {
		try {
			// For now, signals are sent via comments with special formatting
			// In the future, this could use Linear's agent activity API directly
			switch (signal.type) {
				case "start":
					await this.addComment(issueId, {
						author: { id: "system", name: "System" },
						content: "🤖 Starting agent processing...",
						createdAt: new Date(),
						isRoot: true,
					});
					break;

				case "stop":
					await this.addComment(issueId, {
						author: { id: "system", name: "System" },
						content: `⛔ Stopping agent processing${signal.reason ? `: ${signal.reason}` : ""}`,
						createdAt: new Date(),
						isRoot: true,
					});
					break;

				case "feedback":
					await this.addComment(issueId, {
						author: { id: "system", name: "System" },
						content: `💬 User feedback:\n\n${signal.message}`,
						createdAt: new Date(),
						isRoot: true,
					});
					break;

				default:
					throw new Error(`Unknown signal type: ${(signal as any).type}`);
			}
		} catch (error) {
			throw new Error(
				`Failed to send signal to issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Emit a webhook event to be processed by watchers
	 *
	 * This method should be called when a webhook is received from Linear.
	 * It will convert the webhook payload to an IssueEvent and emit it to
	 * all active watchers.
	 *
	 * @param webhookPayload - Linear webhook payload
	 */
	emitWebhookEvent(event: IssueEvent): void {
		this.eventEmitter.emit("issue-event", event);
	}

	/**
	 * Stop all active watchers
	 *
	 * This should be called when shutting down the tracker.
	 */
	stopWatchers(): void {
		this.eventEmitter.emit("stop-watchers");
	}

	/**
	 * Get a member by their ID
	 *
	 * @param memberId - ID of the member
	 * @returns Promise that resolves to the member
	 * @throws Error if member is not found
	 */
	async getMember(memberId: string): Promise<Member> {
		try {
			const user = await this.client.user(memberId);
			if (!user) {
				throw new Error(`Member not found: ${memberId}`);
			}
			return {
				id: user.id,
				name: user.name,
				email: user.email,
				avatarUrl: user.avatarUrl,
			};
		} catch (error) {
			throw new Error(
				`Failed to get member ${memberId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * List all available labels in the workspace/team
	 *
	 * @param teamId - Optional team ID to filter labels by team
	 * @returns Promise that resolves to array of labels
	 */
	async listLabels(teamId?: string): Promise<Label[]> {
		try {
			const labels = teamId
				? await this.client.issueLabels({
						filter: { team: { id: { eq: teamId } } },
					})
				: await this.client.issueLabels();

			const labelNodes = await labels.nodes;
			return labelNodes.map((label) => ({
				id: label.id,
				name: label.name,
				color: label.color,
				description: label.description,
			}));
		} catch (error) {
			throw new Error(
				`Failed to list labels: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
