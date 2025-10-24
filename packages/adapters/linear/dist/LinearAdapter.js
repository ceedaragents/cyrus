import {
	translateActivityToLinear,
	translateWebhookToWorkItem,
	translateWorkItemUpdate,
} from "./translators.js";
import { defaultLogger } from "./types.js";
/**
 * Linear-specific implementation of IUserInterface
 *
 * This adapter translates between Linear's API/webhooks and Cyrus's abstract
 * WorkItem/Activity model, hiding all Linear-specific details behind the interface.
 */
export class LinearAdapter {
	linearClient;
	webhookClient;
	logger;
	workItemHandler;
	initialized = false;
	/**
	 * Maps WorkItem IDs to Linear agent session IDs
	 * This is needed to post activities to the correct Linear session
	 */
	workItemToSessionMap = new Map();
	constructor(config) {
		this.linearClient = config.linearClient;
		this.webhookClient = config.webhookClient;
		this.logger = config.logger || defaultLogger;
	}
	/**
	 * Initialize the adapter - sets up webhook listeners
	 */
	async initialize() {
		if (this.initialized) {
			this.logger.warn("LinearAdapter already initialized");
			return;
		}
		this.logger.info("Initializing LinearAdapter...");
		// Set up webhook event handlers
		this.webhookClient.on("webhook", this.handleWebhook.bind(this));
		this.webhookClient.on("connect", () => {
			this.logger.info("Linear webhook client connected");
		});
		this.webhookClient.on("disconnect", () => {
			this.logger.warn("Linear webhook client disconnected");
		});
		this.webhookClient.on("error", (error) => {
			this.logger.error("Linear webhook client error:", error);
		});
		// Connect the webhook client
		await this.webhookClient.connect();
		this.initialized = true;
		this.logger.info("LinearAdapter initialized successfully");
	}
	/**
	 * Shutdown the adapter - cleanup connections
	 */
	async shutdown() {
		if (!this.initialized) {
			this.logger.warn("LinearAdapter not initialized, nothing to shutdown");
			return;
		}
		this.logger.info("Shutting down LinearAdapter...");
		// Disconnect webhook client
		await this.webhookClient.disconnect();
		// Clear internal state
		this.workItemHandler = undefined;
		this.workItemToSessionMap.clear();
		this.initialized = false;
		this.logger.info("LinearAdapter shutdown complete");
	}
	/**
	 * Register a handler for incoming work items
	 * This is called when Linear webhooks are received and translated to WorkItems
	 */
	onWorkItem(handler) {
		this.workItemHandler = handler;
		this.logger.debug("WorkItem handler registered");
	}
	/**
	 * Post an activity to Linear as an agent activity
	 */
	async postActivity(activity) {
		this.ensureInitialized();
		// Get the agent session ID for this work item
		const agentSessionId = this.workItemToSessionMap.get(activity.workItemId);
		if (!agentSessionId) {
			throw new Error(
				`No agent session found for work item ${activity.workItemId}. ` +
					`Cannot post activity without an active Linear agent session.`,
			);
		}
		this.logger.debug(
			`Posting activity ${activity.id} to Linear session ${agentSessionId}`,
		);
		// Translate the activity to Linear format
		const linearActivity = translateActivityToLinear(activity, agentSessionId);
		// Post to Linear
		try {
			const result =
				await this.linearClient.createAgentActivity(linearActivity);
			if (!result.success) {
				throw new Error(`Failed to create Linear agent activity: ${result}`);
			}
			const createdActivity = await result.agentActivity;
			if (createdActivity) {
				this.logger.debug(
					`Successfully created Linear activity ${createdActivity.id}`,
				);
			}
		} catch (error) {
			this.logger.error("Error posting activity to Linear:", error);
			throw error;
		}
	}
	/**
	 * Update a work item's status, progress, or add a message
	 */
	async updateWorkItem(id, update) {
		this.ensureInitialized();
		this.logger.debug(`Updating work item ${id}:`, update);
		const { stateUpdate, progressUpdate, commentUpdate } =
			translateWorkItemUpdate(update);
		try {
			// Get the issue to update
			const issue = await this.linearClient.issue(id);
			// Update issue state if specified
			if (stateUpdate) {
				// Find the state by name in the team's workflow states
				const issueData = await issue;
				if (!issueData) {
					throw new Error(`Issue ${id} not found`);
				}
				const team = await issueData.team;
				if (!team) {
					throw new Error(`Team not found for issue ${id}`);
				}
				const states = await team.states();
				const targetState = states.nodes.find(
					(s) => s.name === stateUpdate.name,
				);
				if (targetState) {
					await issue.update({ stateId: targetState.id });
					this.logger.debug(`Updated issue ${id} state to ${stateUpdate.name}`);
				} else {
					this.logger.warn(
						`State "${stateUpdate.name}" not found for team ${team.id}`,
					);
				}
			}
			// Add comment if message specified
			if (commentUpdate) {
				const issueData = await issue;
				if (issueData) {
					await this.linearClient.createComment({
						issueId: id,
						body: commentUpdate,
					});
					this.logger.debug(`Added comment to issue ${id}`);
				}
			}
			// Note: Linear doesn't have a direct progress field, so we ignore progressUpdate
			// In a real implementation, you might store this in a custom field or metadata
			if (progressUpdate !== undefined) {
				this.logger.debug(
					`Progress update ${progressUpdate}% noted (not synced to Linear)`,
				);
			}
		} catch (error) {
			this.logger.error(`Error updating work item ${id}:`, error);
			throw error;
		}
	}
	/**
	 * Get a work item by ID (fetches Linear issue)
	 */
	async getWorkItem(id) {
		this.ensureInitialized();
		this.logger.debug(`Fetching work item ${id} from Linear`);
		try {
			const issue = await this.linearClient.issue(id);
			const issueData = await issue;
			if (!issueData) {
				throw new Error(`Issue ${id} not found in Linear`);
			}
			const team = await issueData.team;
			const assignee = await issueData.assignee;
			// Convert Linear issue to WorkItem
			return {
				id: issueData.id,
				type: "task", // Issues are generally tasks
				title: issueData.title,
				description: issueData.description || "",
				context: {
					issueIdentifier: issueData.identifier,
					issueUrl: issueData.url,
					teamKey: team?.key,
					teamName: team?.name,
				},
				metadata: {
					source: "linear",
					issueId: issueData.id,
					issueIdentifier: issueData.identifier,
					issueUrl: issueData.url,
					teamId: issueData.teamId,
					teamKey: team?.key,
					assignee: assignee?.id,
					assigneeName: assignee?.name,
					assigneeEmail: assignee?.email,
					state: (await issueData.state)?.name,
					priority: issueData.priority,
					createdAt: issueData.createdAt?.toISOString(),
					updatedAt: issueData.updatedAt?.toISOString(),
				},
			};
		} catch (error) {
			this.logger.error(`Error fetching work item ${id}:`, error);
			throw error;
		}
	}
	/**
	 * Get activity history for a work item
	 * Fetches Linear agent activities for the associated agent session
	 */
	async getWorkItemHistory(id) {
		this.ensureInitialized();
		this.logger.debug(`Fetching work item history for ${id}`);
		// Get the agent session ID for this work item
		const agentSessionId = this.workItemToSessionMap.get(id);
		if (!agentSessionId) {
			this.logger.debug(
				`No agent session found for work item ${id}, returning empty history`,
			);
			return [];
		}
		try {
			// Fetch agent session and its activities
			const agentSession = await this.linearClient.agentSession(agentSessionId);
			const sessionData = await agentSession;
			if (!sessionData) {
				this.logger.warn(`Agent session ${agentSessionId} not found`);
				return [];
			}
			const activities = await sessionData.activities();
			// Convert Linear activities to Cyrus Activity format
			return activities.nodes.map((linearActivity) => {
				const content = linearActivity.content;
				// Map Linear activity content to Cyrus ActivityContent
				let activityContent;
				const activityType = content.type || "thought";
				if (activityType === "action" && content.action) {
					activityContent = {
						type: "tool_use",
						tool: content.action,
						input: content.parameter ? JSON.parse(content.parameter) : {},
					};
				} else if (activityType === "response" && content.result) {
					activityContent = {
						type: "tool_result",
						tool: "linear",
						output: content.result,
					};
				} else if (activityType === "error") {
					activityContent = {
						type: "error",
						message: content.body || "Unknown error",
					};
				} else {
					activityContent = {
						type: "text",
						text: content.body || "",
					};
				}
				return {
					id: linearActivity.id,
					workItemId: id,
					timestamp: linearActivity.createdAt,
					type: mapLinearActivityType(activityType),
					content: activityContent,
					metadata: {
						agentSessionId: agentSessionId,
						linearActivityId: linearActivity.id,
						source: "linear",
					},
				};
			});
		} catch (error) {
			this.logger.error(`Error fetching work item history for ${id}:`, error);
			throw error;
		}
	}
	/**
	 * Internal handler for incoming Linear webhooks
	 */
	handleWebhook(webhook) {
		this.logger.debug("Received Linear webhook:", {
			type: webhook.type,
			action: webhook.action,
			webhookId: webhook.webhookId,
		});
		// Translate webhook to WorkItem
		const workItem = translateWebhookToWorkItem(webhook);
		if (!workItem) {
			this.logger.debug(
				`Webhook ${webhook.action} not translated to work item (ignored)`,
			);
			return;
		}
		// Store agent session mapping if present
		if ("agentSession" in webhook && webhook.agentSession) {
			this.workItemToSessionMap.set(workItem.id, webhook.agentSession.id);
			this.logger.debug(
				`Mapped work item ${workItem.id} to agent session ${webhook.agentSession.id}`,
			);
		}
		// Call the registered work item handler
		if (this.workItemHandler) {
			this.logger.debug(`Dispatching work item ${workItem.id} to handler`);
			try {
				const result = this.workItemHandler(workItem);
				// Handle async handlers
				if (result && typeof result === "object" && "then" in result) {
					result.catch((error) => {
						this.logger.error("Error in work item handler:", error);
					});
				}
			} catch (error) {
				this.logger.error("Error calling work item handler:", error);
			}
		} else {
			this.logger.warn(
				`Work item ${workItem.id} received but no handler registered`,
			);
		}
	}
	/**
	 * Ensures the adapter is initialized before operations
	 */
	ensureInitialized() {
		if (!this.initialized) {
			throw new Error(
				"LinearAdapter not initialized. Call initialize() before using.",
			);
		}
	}
}
/**
 * Maps Linear activity types to Cyrus activity types
 */
function mapLinearActivityType(linearType) {
	switch (linearType) {
		case "thought":
			return "thought";
		case "action":
			return "action";
		case "response":
		case "observation":
			return "result";
		case "error":
			return "error";
		default:
			return "thought";
	}
}
//# sourceMappingURL=LinearAdapter.js.map
