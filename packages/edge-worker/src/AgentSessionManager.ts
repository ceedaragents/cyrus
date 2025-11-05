import { type LinearClient, LinearDocument } from "@linear/sdk";
import type {
	APIAssistantMessage,
	APIUserMessage,
	ClaudeRunner,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from "cyrus-claude-runner";
import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
	IssueMinimal,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
	Workspace,
} from "cyrus-core";
import type { ProcedureRouter } from "./procedures/ProcedureRouter.js";
import type { SharedApplicationServer } from "./SharedApplicationServer.js";
import { formatToolInput } from "./tool-formatters.js";

/**
 * Manages Linear Agent Sessions integration with Claude Code SDK
 * Transforms Claude streaming messages into Agent Session format
 * Handles session lifecycle: create → active → complete/error
 *
 * CURRENTLY BEING HANDLED 'per repository'
 */
export class AgentSessionManager {
	private linearClient: LinearClient;
	private sessions: Map<string, CyrusAgentSession> = new Map();
	private entries: Map<string, CyrusAgentSessionEntry[]> = new Map(); // Stores a list of session entries per each session by its linearAgentActivitySessionId
	private activeTasksBySession: Map<string, string> = new Map(); // Maps session ID to active Task tool use ID
	private toolCallsByToolUseId: Map<string, { name: string; input: any }> =
		new Map(); // Track tool calls by their tool_use_id
	private procedureRouter?: ProcedureRouter;
	private sharedApplicationServer?: SharedApplicationServer;
	private getParentSessionId?: (childSessionId: string) => string | undefined;
	private resumeParentSession?: (
		parentSessionId: string,
		prompt: string,
		childSessionId: string,
	) => Promise<void>;
	private resumeNextSubroutine?: (
		linearAgentActivitySessionId: string,
	) => Promise<void>;

	constructor(
		linearClient: LinearClient,
		getParentSessionId?: (childSessionId: string) => string | undefined,
		resumeParentSession?: (
			parentSessionId: string,
			prompt: string,
			childSessionId: string,
		) => Promise<void>,
		resumeNextSubroutine?: (
			linearAgentActivitySessionId: string,
		) => Promise<void>,
		procedureRouter?: ProcedureRouter,
		sharedApplicationServer?: SharedApplicationServer,
	) {
		this.linearClient = linearClient;
		this.getParentSessionId = getParentSessionId;
		this.resumeParentSession = resumeParentSession;
		this.resumeNextSubroutine = resumeNextSubroutine;
		this.procedureRouter = procedureRouter;
		this.sharedApplicationServer = sharedApplicationServer;
	}

	/**
	 * Initialize a Linear agent session from webhook
	 * The session is already created by Linear, we just need to track it
	 */
	createLinearAgentSession(
		linearAgentActivitySessionId: string,
		issueId: string,
		issueMinimal: IssueMinimal,
		workspace: Workspace,
	): CyrusAgentSession {
		console.log(
			`[AgentSessionManager] Tracking Linear session ${linearAgentActivitySessionId} for issue ${issueId}`,
		);

		const agentSession: CyrusAgentSession = {
			linearAgentActivitySessionId,
			type: LinearDocument.AgentSessionType.CommentThread,
			status: LinearDocument.AgentSessionStatus.Active,
			context: LinearDocument.AgentSessionType.CommentThread,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			issueId,
			issue: issueMinimal,
			workspace: workspace,
		};

		// Store locally
		this.sessions.set(linearAgentActivitySessionId, agentSession);
		this.entries.set(linearAgentActivitySessionId, []);

		return agentSession;
	}

	/**
	 * Create a new Agent Session from Claude system initialization
	 */
	updateAgentSessionWithClaudeSessionId(
		linearAgentActivitySessionId: string,
		claudeSystemMessage: SDKSystemMessage,
	): void {
		const linearSession = this.sessions.get(linearAgentActivitySessionId);
		if (!linearSession) {
			console.warn(
				`[AgentSessionManager] No Linear session found for linearAgentActivitySessionId ${linearAgentActivitySessionId}`,
			);
			return;
		}
		linearSession.claudeSessionId = claudeSystemMessage.session_id;
		linearSession.updatedAt = Date.now();
		linearSession.metadata = {
			...linearSession.metadata, // Preserve existing metadata
			model: claudeSystemMessage.model,
			tools: claudeSystemMessage.tools,
			permissionMode: claudeSystemMessage.permissionMode,
			apiKeySource: claudeSystemMessage.apiKeySource,
		};
	}

	/**
	 * Create a session entry from Claude user/assistant message (without syncing to Linear)
	 */
	private async createSessionEntry(
		_linearAgentActivitySessionId: string,
		sdkMessage: SDKUserMessage | SDKAssistantMessage,
	): Promise<CyrusAgentSessionEntry> {
		// Extract tool info if this is an assistant message
		const toolInfo =
			sdkMessage.type === "assistant" ? this.extractToolInfo(sdkMessage) : null;
		// Extract tool_use_id and error status if this is a user message with tool_result
		const toolResultInfo =
			sdkMessage.type === "user"
				? this.extractToolResultInfo(sdkMessage)
				: null;

		const sessionEntry: CyrusAgentSessionEntry = {
			claudeSessionId: sdkMessage.session_id,
			type: sdkMessage.type,
			content: this.extractContent(sdkMessage),
			metadata: {
				timestamp: Date.now(),
				parentToolUseId: sdkMessage.parent_tool_use_id || undefined,
				...(toolInfo && {
					toolUseId: toolInfo.id,
					toolName: toolInfo.name,
					toolInput: toolInfo.input,
				}),
				...(toolResultInfo && {
					toolUseId: toolResultInfo.toolUseId,
					toolResultError: toolResultInfo.isError,
				}),
			},
		};

		// DON'T store locally yet - wait until we actually post to Linear
		return sessionEntry;
	}

	/**
	 * Format TodoWrite tool parameter as a nice checklist
	 */
	private formatTodoWriteParameter(jsonContent: string): string {
		try {
			const data = JSON.parse(jsonContent);
			if (!data.todos || !Array.isArray(data.todos)) {
				return jsonContent;
			}

			const todos = data.todos as Array<{
				id: string;
				content: string;
				status: string;
				priority: string;
			}>;

			// Keep original order but add status indicators
			let formatted = "\n";

			todos.forEach((todo, index) => {
				let statusEmoji = "";
				if (todo.status === "completed") {
					statusEmoji = "✅ ";
				} else if (todo.status === "in_progress") {
					statusEmoji = "🔄 ";
				} else if (todo.status === "pending") {
					statusEmoji = "⏳ ";
				}

				formatted += `${statusEmoji}${todo.content}`;
				if (index < todos.length - 1) {
					formatted += "\n";
				}
			});

			return formatted;
		} catch (error) {
			console.error(
				"[AgentSessionManager] Failed to format TodoWrite parameter:",
				error,
			);
			return jsonContent;
		}
	}

	/**
	 * Complete a session from Claude result message
	 */
	async completeSession(
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (!session) {
			console.error(
				`[AgentSessionManager] No session found for linearAgentActivitySessionId: ${linearAgentActivitySessionId}`,
			);
			return;
		}

		// Clear any active Task when session completes
		this.activeTasksBySession.delete(linearAgentActivitySessionId);

		// Clear tool calls tracking for this session
		// Note: We should ideally track by session, but for now clearing all is safer
		// to prevent memory leaks

		const status =
			resultMessage.subtype === "success"
				? LinearDocument.AgentSessionStatus.Complete
				: LinearDocument.AgentSessionStatus.Error;

		// Update session status and metadata
		await this.updateSessionStatus(linearAgentActivitySessionId, status, {
			totalCostUsd: resultMessage.total_cost_usd,
			usage: resultMessage.usage,
		});

		// Handle result using procedure routing system
		if ("result" in resultMessage && resultMessage.result) {
			await this.handleProcedureCompletion(
				session,
				linearAgentActivitySessionId,
				resultMessage,
			);
		}
	}

	/**
	 * Handle completion using procedure routing system
	 */
	private async handleProcedureCompletion(
		session: CyrusAgentSession,
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		if (!this.procedureRouter) {
			throw new Error("ProcedureRouter not available");
		}

		// Check if error occurred
		if (resultMessage.subtype !== "success") {
			console.log(
				`[AgentSessionManager] Subroutine completed with error, not triggering next subroutine`,
			);
			return;
		}

		const claudeSessionId = session.claudeSessionId;
		if (!claudeSessionId) {
			console.error(
				`[AgentSessionManager] No Claude session ID found for procedure session`,
			);
			return;
		}

		// Check if there's a next subroutine
		const nextSubroutine = this.procedureRouter.getNextSubroutine(session);

		if (nextSubroutine) {
			// More subroutines to run - check if current subroutine requires approval
			const currentSubroutine =
				this.procedureRouter.getCurrentSubroutine(session);

			if (currentSubroutine?.requiresApproval) {
				console.log(
					`[AgentSessionManager] Current subroutine "${currentSubroutine.name}" requires approval before proceeding`,
				);

				// Check if SharedApplicationServer is available
				if (!this.sharedApplicationServer) {
					console.error(
						`[AgentSessionManager] SharedApplicationServer not available for approval workflow`,
					);
					await this.createErrorActivity(
						linearAgentActivitySessionId,
						"Approval workflow failed: Server not available",
					);
					return;
				}

				// Extract the final result from the completed subroutine
				const subroutineResult =
					"result" in resultMessage && resultMessage.result
						? resultMessage.result
						: "No result available";

				try {
					// Register approval request with server
					const approvalRequest =
						this.sharedApplicationServer.registerApprovalRequest(
							linearAgentActivitySessionId,
						);

					// Post approval elicitation to Linear with auth signal URL
					const approvalMessage = `The previous step has completed. Please review the result below and approve to continue:\n\n${subroutineResult}`;

					await this.createApprovalElicitation(
						linearAgentActivitySessionId,
						approvalMessage,
						approvalRequest.url,
					);

					console.log(
						`[AgentSessionManager] Waiting for approval at URL: ${approvalRequest.url}`,
					);

					// Wait for approval with timeout (30 minutes)
					const approvalTimeout = 30 * 60 * 1000;
					const timeoutPromise = new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("Approval timeout")),
							approvalTimeout,
						),
					);

					const { approved, feedback } = await Promise.race([
						approvalRequest.promise,
						timeoutPromise,
					]);

					if (!approved) {
						console.log(
							`[AgentSessionManager] Approval rejected for session ${linearAgentActivitySessionId}`,
						);
						await this.createErrorActivity(
							linearAgentActivitySessionId,
							`Workflow stopped: User rejected approval.${feedback ? `\n\nFeedback: ${feedback}` : ""}`,
						);
						return; // Stop workflow
					}

					console.log(
						`[AgentSessionManager] Approval granted, continuing to next subroutine`,
					);

					// Optionally post feedback as a thought
					if (feedback) {
						await this.createThoughtActivity(
							linearAgentActivitySessionId,
							`User feedback: ${feedback}`,
						);
					}

					// Continue with advancement (fall through to existing code)
				} catch (error) {
					const errorMessage = (error as Error).message;
					if (errorMessage === "Approval timeout") {
						console.log(
							`[AgentSessionManager] Approval timed out for session ${linearAgentActivitySessionId}`,
						);
						await this.createErrorActivity(
							linearAgentActivitySessionId,
							"Workflow stopped: Approval request timed out after 30 minutes.",
						);
					} else {
						console.error(
							`[AgentSessionManager] Approval request failed:`,
							error,
						);
						await this.createErrorActivity(
							linearAgentActivitySessionId,
							`Workflow stopped: Approval request failed - ${errorMessage}`,
						);
					}
					return; // Stop workflow
				}
			}

			// Advance procedure state
			console.log(
				`[AgentSessionManager] Subroutine completed, advancing to next: ${nextSubroutine.name}`,
			);
			this.procedureRouter.advanceToNextSubroutine(session, claudeSessionId);

			// Trigger next subroutine
			if (this.resumeNextSubroutine) {
				try {
					await this.resumeNextSubroutine(linearAgentActivitySessionId);
				} catch (error) {
					console.error(
						`[AgentSessionManager] Failed to trigger next subroutine:`,
						error,
					);
				}
			}
		} else {
			// Procedure complete - post final result
			console.log(
				`[AgentSessionManager] All subroutines completed, posting final result to Linear`,
			);
			await this.addResultEntry(linearAgentActivitySessionId, resultMessage);

			// Handle child session completion
			const isChildSession = this.getParentSessionId?.(
				linearAgentActivitySessionId,
			);
			if (isChildSession && this.resumeParentSession) {
				await this.handleChildSessionCompletion(
					linearAgentActivitySessionId,
					resultMessage,
				);
			}
		}
	}

	/**
	 * Handle child session completion and resume parent
	 */
	private async handleChildSessionCompletion(
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		if (!this.getParentSessionId || !this.resumeParentSession) {
			return;
		}

		const parentAgentSessionId = this.getParentSessionId(
			linearAgentActivitySessionId,
		);

		if (!parentAgentSessionId) {
			console.error(
				`[AgentSessionManager] No parent session ID found for child ${linearAgentActivitySessionId}`,
			);
			return;
		}

		console.log(
			`[AgentSessionManager] Child session ${linearAgentActivitySessionId} completed, resuming parent ${parentAgentSessionId}`,
		);

		try {
			const childResult =
				"result" in resultMessage
					? resultMessage.result
					: "No result available";
			const promptToParent = `Child agent session ${linearAgentActivitySessionId} completed with result:\n\n${childResult}`;

			await this.resumeParentSession(
				parentAgentSessionId,
				promptToParent,
				linearAgentActivitySessionId,
			);

			console.log(
				`[AgentSessionManager] Successfully resumed parent session ${parentAgentSessionId}`,
			);
		} catch (error) {
			console.error(
				`[AgentSessionManager] Failed to resume parent session:`,
				error,
			);
		}
	}

	/**
	 * Handle streaming Claude messages and route to appropriate methods
	 */
	async handleClaudeMessage(
		linearAgentActivitySessionId: string,
		message: SDKMessage,
	): Promise<void> {
		try {
			switch (message.type) {
				case "system":
					if (message.subtype === "init") {
						this.updateAgentSessionWithClaudeSessionId(
							linearAgentActivitySessionId,
							message,
						);

						// Post model notification
						const systemMessage = message as SDKSystemMessage;
						if (systemMessage.model) {
							await this.postModelNotificationThought(
								linearAgentActivitySessionId,
								systemMessage.model,
							);
						}
					}
					break;

				case "user": {
					const userEntry = await this.createSessionEntry(
						linearAgentActivitySessionId,
						message as SDKUserMessage,
					);
					await this.syncEntryToLinear(userEntry, linearAgentActivitySessionId);
					break;
				}

				case "assistant": {
					const assistantEntry = await this.createSessionEntry(
						linearAgentActivitySessionId,
						message as SDKAssistantMessage,
					);
					await this.syncEntryToLinear(
						assistantEntry,
						linearAgentActivitySessionId,
					);
					break;
				}

				case "result":
					await this.completeSession(
						linearAgentActivitySessionId,
						message as SDKResultMessage,
					);
					break;

				default:
					console.warn(
						`[AgentSessionManager] Unknown message type: ${(message as any).type}`,
					);
			}
		} catch (error) {
			console.error(`[AgentSessionManager] Error handling message:`, error);
			// Mark session as error state
			await this.updateSessionStatus(
				linearAgentActivitySessionId,
				LinearDocument.AgentSessionStatus.Error,
			);
		}
	}

	/**
	 * Update session status and metadata
	 */
	private async updateSessionStatus(
		linearAgentActivitySessionId: string,
		status: LinearDocument.AgentSessionStatus,
		additionalMetadata?: Partial<CyrusAgentSession["metadata"]>,
	): Promise<void> {
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (!session) return;

		session.status = status;
		session.updatedAt = Date.now();

		if (additionalMetadata) {
			session.metadata = { ...session.metadata, ...additionalMetadata };
		}

		this.sessions.set(linearAgentActivitySessionId, session);
	}

	/**
	 * Add result entry from Claude result message
	 */
	private async addResultEntry(
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		const resultEntry: CyrusAgentSessionEntry = {
			claudeSessionId: resultMessage.session_id,
			type: "result",
			content: "result" in resultMessage ? resultMessage.result : "",
			metadata: {
				timestamp: Date.now(),
				durationMs: resultMessage.duration_ms,
				isError: resultMessage.is_error,
			},
		};

		// DON'T store locally - syncEntryToLinear will do it
		// Sync to Linear
		await this.syncEntryToLinear(resultEntry, linearAgentActivitySessionId);
	}

	/**
	 * Extract content from Claude message
	 */
	private extractContent(
		sdkMessage: SDKUserMessage | SDKAssistantMessage,
	): string {
		const message =
			sdkMessage.type === "user"
				? (sdkMessage.message as APIUserMessage)
				: (sdkMessage.message as APIAssistantMessage);

		if (typeof message.content === "string") {
			return message.content;
		}

		if (Array.isArray(message.content)) {
			return message.content
				.map((block) => {
					if (block.type === "text") {
						return block.text;
					} else if (block.type === "tool_use") {
						// For tool use blocks, return the input as JSON string
						return JSON.stringify(block.input, null, 2);
					} else if (block.type === "tool_result") {
						// For tool_result blocks, extract just the text content
						// Also store the error status in metadata if needed
						if ("is_error" in block && block.is_error) {
							// Mark this as an error result - we'll handle this elsewhere
						}
						if (typeof block.content === "string") {
							return block.content;
						}
						if (Array.isArray(block.content)) {
							return block.content
								.filter((contentBlock: any) => contentBlock.type === "text")
								.map((contentBlock: any) => contentBlock.text)
								.join("\n");
						}
						return "";
					}
					return "";
				})
				.filter(Boolean)
				.join("\n");
		}

		return "";
	}

	/**
	 * Extract tool information from Claude assistant message
	 */
	private extractToolInfo(
		sdkMessage: SDKAssistantMessage,
	): { id: string; name: string; input: any } | null {
		const message = sdkMessage.message as APIAssistantMessage;

		if (Array.isArray(message.content)) {
			const toolUse = message.content.find(
				(block) => block.type === "tool_use",
			);
			if (
				toolUse &&
				"id" in toolUse &&
				"name" in toolUse &&
				"input" in toolUse
			) {
				return {
					id: toolUse.id,
					name: toolUse.name,
					input: toolUse.input,
				};
			}
		}
		return null;
	}

	/**
	 * Extract tool_use_id and error status from Claude user message containing tool_result
	 */
	private extractToolResultInfo(
		sdkMessage: SDKUserMessage,
	): { toolUseId: string; isError: boolean } | null {
		const message = sdkMessage.message as APIUserMessage;

		if (Array.isArray(message.content)) {
			const toolResult = message.content.find(
				(block) => block.type === "tool_result",
			);
			if (toolResult && "tool_use_id" in toolResult) {
				return {
					toolUseId: toolResult.tool_use_id,
					isError: "is_error" in toolResult && toolResult.is_error === true,
				};
			}
		}
		return null;
	}

	/**
	 * Extract tool result content and error status from session entry
	 */
	private extractToolResult(
		entry: CyrusAgentSessionEntry,
	): { content: string; isError: boolean } | null {
		// Check if we have the error status in metadata
		const isError = entry.metadata?.toolResultError || false;

		return {
			content: entry.content,
			isError: isError,
		};
	}

	/**
	 * Sync Agent Session Entry to Linear (create AgentActivity)
	 */
	private async syncEntryToLinear(
		entry: CyrusAgentSessionEntry,
		linearAgentActivitySessionId: string,
	): Promise<void> {
		try {
			const session = this.sessions.get(linearAgentActivitySessionId);
			if (!session) {
				console.warn(
					`[AgentSessionManager] No Linear session for linearAgentActivitySessionId ${linearAgentActivitySessionId}`,
				);
				return;
			}

			// Store entry locally first
			const entries = this.entries.get(linearAgentActivitySessionId) || [];
			entries.push(entry);
			this.entries.set(linearAgentActivitySessionId, entries);

			// Build activity content based on entry type
			let content: any;
			let ephemeral = false;
			switch (entry.type) {
				case "user": {
					const activeTaskId = this.activeTasksBySession.get(
						linearAgentActivitySessionId,
					);
					if (activeTaskId && activeTaskId === entry.metadata?.toolUseId) {
						content = {
							type: "thought",
							body: `✅ Task Completed\n\n\n\n${entry.content}\n\n---\n\n`,
						};
						this.activeTasksBySession.delete(linearAgentActivitySessionId);
					} else if (entry.metadata?.toolUseId) {
						// This is a tool result - create an action activity with the result
						const toolResult = this.extractToolResult(entry);
						if (toolResult) {
							// Get the original tool information
							const originalTool = this.toolCallsByToolUseId.get(
								entry.metadata.toolUseId,
							);
							const toolName = originalTool?.name || "Tool";
							const toolInput = originalTool?.input || "";

							// Clean up the tool call from our tracking map
							if (entry.metadata.toolUseId) {
								this.toolCallsByToolUseId.delete(entry.metadata.toolUseId);
							}

							// Skip creating activity for TodoWrite results since TodoWrite already created a non-ephemeral thought
							if (toolName === "TodoWrite" || toolName === "↪ TodoWrite") {
								return;
							}

							// Format input for display using custom formatters
							const formattedInput =
								typeof toolInput === "string"
									? toolInput
									: formatToolInput(toolName, toolInput);

							// Use tool output directly without collapsible wrapping
							const wrappedResult = toolResult.content?.trim() || "";

							content = {
								type: "action",
								action: toolResult.isError ? `${toolName} (Error)` : toolName,
								parameter: formattedInput,
								result: wrappedResult,
							};
						} else {
							return;
						}
					} else {
						return;
					}
					break;
				}
				case "assistant": {
					// Assistant messages can be thoughts or responses
					if (entry.metadata?.toolUseId) {
						const toolName = entry.metadata.toolName || "Tool";

						// Store tool information for later use in tool results
						if (entry.metadata.toolUseId) {
							// Check if this is a subtask with arrow prefix
							let storedName = toolName;
							if (entry.metadata?.parentToolUseId) {
								const activeTaskId = this.activeTasksBySession.get(
									linearAgentActivitySessionId,
								);
								if (activeTaskId === entry.metadata?.parentToolUseId) {
									storedName = `↪ ${toolName}`;
								}
							}

							this.toolCallsByToolUseId.set(entry.metadata.toolUseId, {
								name: storedName,
								input: entry.metadata.toolInput || entry.content,
							});
						}

						// Special handling for TodoWrite tool - treat as thought instead of action
						if (toolName === "TodoWrite") {
							const formattedTodos = this.formatTodoWriteParameter(
								entry.content,
							);
							content = {
								type: "thought",
								body: formattedTodos,
							};
							// TodoWrite is not ephemeral
							ephemeral = false;
						} else if (toolName === "Task") {
							// Special handling for Task tool - add start marker and track active task
							const toolInput = entry.metadata.toolInput || entry.content;
							const parameter =
								typeof toolInput === "string"
									? toolInput
									: formatToolInput(toolName, toolInput);
							const displayName = toolName;

							// Track this as the active Task for this session
							if (entry.metadata?.toolUseId) {
								this.activeTasksBySession.set(
									linearAgentActivitySessionId,
									entry.metadata.toolUseId,
								);
							}

							content = {
								type: "action",
								action: displayName,
								parameter: parameter,
								// result will be added later when we get tool result
							};
							// Task is not ephemeral
							ephemeral = false;
						} else {
							// Other tools - check if they're within an active Task
							const toolInput = entry.metadata.toolInput || entry.content;
							const parameter =
								typeof toolInput === "string"
									? toolInput
									: formatToolInput(toolName, toolInput);
							let displayName = toolName;

							if (entry.metadata?.parentToolUseId) {
								const activeTaskId = this.activeTasksBySession.get(
									linearAgentActivitySessionId,
								);
								if (activeTaskId === entry.metadata?.parentToolUseId) {
									displayName = `↪ ${toolName}`;
								}
							}

							content = {
								type: "action",
								action: displayName,
								parameter: parameter,
								// result will be added later when we get tool result
							};
							// Standard tool calls are ephemeral
							ephemeral = true;
						}
					} else {
						// Regular assistant message - create a thought
						content = {
							type: "thought",
							body: entry.content,
						};
					}
					break;
				}

				case "system":
					// System messages are thoughts
					content = {
						type: "thought",
						body: entry.content,
					};
					break;

				case "result":
					// Result messages can be responses or errors
					if (entry.metadata?.isError) {
						content = {
							type: "error",
							body: entry.content,
						};
					} else {
						content = {
							type: "response",
							body: entry.content,
						};
					}
					break;

				default:
					// Default to thought
					content = {
						type: "thought",
						body: entry.content,
					};
			}

			// Check if current subroutine has suppressThoughtPosting enabled
			// If so, suppress thoughts and actions (but still post responses and results)
			const currentSubroutine =
				this.procedureRouter?.getCurrentSubroutine(session);
			if (currentSubroutine?.suppressThoughtPosting) {
				// Only suppress thoughts and actions, not responses or results
				if (content.type === "thought" || content.type === "action") {
					console.log(
						`[AgentSessionManager] Suppressing ${content.type} posting for subroutine "${currentSubroutine.name}"`,
					);
					return; // Don't post to Linear
				}
			}

			const activityInput: LinearDocument.AgentActivityCreateInput = {
				agentSessionId: session.linearAgentActivitySessionId, // Use the Linear session ID
				content,
				...(ephemeral && { ephemeral: true }),
			};

			const result = await this.linearClient.createAgentActivity(activityInput);

			if (result.success && result.agentActivity) {
				const agentActivity = await result.agentActivity;
				entry.linearAgentActivityId = agentActivity.id;
				console.log(
					`[AgentSessionManager] Created ${content.type} activity ${entry.linearAgentActivityId}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to create Linear activity:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Failed to sync entry to Linear:`,
				error,
			);
		}
	}

	/**
	 * Get session by ID
	 */
	getSession(
		linearAgentActivitySessionId: string,
	): CyrusAgentSession | undefined {
		return this.sessions.get(linearAgentActivitySessionId);
	}

	/**
	 * Get session entries by session ID
	 */
	getSessionEntries(
		linearAgentActivitySessionId: string,
	): CyrusAgentSessionEntry[] {
		return this.entries.get(linearAgentActivitySessionId) || [];
	}

	/**
	 * Get all active sessions
	 */
	getActiveSessions(): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) => session.status === LinearDocument.AgentSessionStatus.Active,
		);
	}

	/**
	 * Add or update ClaudeRunner for a session
	 */
	addClaudeRunner(
		linearAgentActivitySessionId: string,
		claudeRunner: ClaudeRunner,
	): void {
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (!session) {
			console.warn(
				`[AgentSessionManager] No session found for linearAgentActivitySessionId ${linearAgentActivitySessionId}`,
			);
			return;
		}

		session.claudeRunner = claudeRunner;
		session.updatedAt = Date.now();
		console.log(
			`[AgentSessionManager] Added ClaudeRunner to session ${linearAgentActivitySessionId}`,
		);
	}

	/**
	 *  Get all ClaudeRunners
	 */
	getAllClaudeRunners(): ClaudeRunner[] {
		return Array.from(this.sessions.values())
			.map((session) => session.claudeRunner)
			.filter((runner): runner is ClaudeRunner => runner !== undefined);
	}

	/**
	 * Get all ClaudeRunners for a specific issue
	 */
	getClaudeRunnersForIssue(issueId: string): ClaudeRunner[] {
		return Array.from(this.sessions.values())
			.filter((session) => session.issueId === issueId)
			.map((session) => session.claudeRunner)
			.filter((runner): runner is ClaudeRunner => runner !== undefined);
	}

	/**
	 * Get sessions by issue ID
	 */
	getSessionsByIssueId(issueId: string): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) => session.issueId === issueId,
		);
	}

	/**
	 * Get active sessions by issue ID
	 */
	getActiveSessionsByIssueId(issueId: string): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) =>
				session.issueId === issueId &&
				session.status === LinearDocument.AgentSessionStatus.Active,
		);
	}

	/**
	 * Get all sessions
	 */
	getAllSessions(): CyrusAgentSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get ClaudeRunner for a specific session
	 */
	getClaudeRunner(
		linearAgentActivitySessionId: string,
	): ClaudeRunner | undefined {
		const session = this.sessions.get(linearAgentActivitySessionId);
		return session?.claudeRunner;
	}

	/**
	 * Check if a ClaudeRunner exists for a session
	 */
	hasClaudeRunner(linearAgentActivitySessionId: string): boolean {
		const session = this.sessions.get(linearAgentActivitySessionId);
		return session?.claudeRunner !== undefined;
	}

	/**
	 * Create a thought activity
	 */
	async createThoughtActivity(sessionId: string, body: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			console.warn(
				`[AgentSessionManager] No Linear session ID for session ${sessionId}`,
			);
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "thought",
					body,
				},
			});

			if (result.success) {
				console.log(
					`[AgentSessionManager] Created thought activity for session ${sessionId}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to create thought activity:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error creating thought activity:`,
				error,
			);
		}
	}

	/**
	 * Create an action activity
	 */
	async createActionActivity(
		sessionId: string,
		action: string,
		parameter: string,
		result?: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			console.warn(
				`[AgentSessionManager] No Linear session ID for session ${sessionId}`,
			);
			return;
		}

		try {
			const content: any = {
				type: "action",
				action,
				parameter,
			};

			if (result !== undefined) {
				content.result = result;
			}

			const response = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content,
			});

			if (response.success) {
				console.log(
					`[AgentSessionManager] Created action activity for session ${sessionId}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to create action activity:`,
					response,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error creating action activity:`,
				error,
			);
		}
	}

	/**
	 * Create a response activity
	 */
	async createResponseActivity(sessionId: string, body: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			console.warn(
				`[AgentSessionManager] No Linear session ID for session ${sessionId}`,
			);
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "response",
					body,
				},
			});

			if (result.success) {
				console.log(
					`[AgentSessionManager] Created response activity for session ${sessionId}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to create response activity:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error creating response activity:`,
				error,
			);
		}
	}

	/**
	 * Create an error activity
	 */
	async createErrorActivity(sessionId: string, body: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			console.warn(
				`[AgentSessionManager] No Linear session ID for session ${sessionId}`,
			);
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "error",
					body,
				},
			});

			if (result.success) {
				console.log(
					`[AgentSessionManager] Created error activity for session ${sessionId}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to create error activity:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error creating error activity:`,
				error,
			);
		}
	}

	/**
	 * Create an elicitation activity
	 */
	async createElicitationActivity(
		sessionId: string,
		body: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			console.warn(
				`[AgentSessionManager] No Linear session ID for session ${sessionId}`,
			);
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "elicitation",
					body,
				},
			});

			if (result.success) {
				console.log(
					`[AgentSessionManager] Created elicitation activity for session ${sessionId}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to create elicitation activity:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error creating elicitation activity:`,
				error,
			);
		}
	}

	/**
	 * Create an approval elicitation activity with auth signal
	 */
	async createApprovalElicitation(
		sessionId: string,
		body: string,
		approvalUrl: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			console.warn(
				`[AgentSessionManager] No Linear session ID for session ${sessionId}`,
			);
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "elicitation",
					body,
				},
				signal: LinearDocument.AgentActivitySignal.Auth,
				signalMetadata: {
					url: approvalUrl,
				},
			});

			if (result.success) {
				console.log(
					`[AgentSessionManager] Created approval elicitation for session ${sessionId} with URL: ${approvalUrl}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to create approval elicitation:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error creating approval elicitation:`,
				error,
			);
		}
	}

	/**
	 * Clear completed sessions older than specified time
	 */
	cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): void {
		const cutoff = Date.now() - olderThanMs;

		for (const [sessionId, session] of this.sessions.entries()) {
			if (
				(session.status === "complete" || session.status === "error") &&
				session.updatedAt < cutoff
			) {
				this.sessions.delete(sessionId);
				this.entries.delete(sessionId);
				console.log(`[AgentSessionManager] Cleaned up session ${sessionId}`);
			}
		}
	}

	/**
	 * Serialize Agent Session state for persistence
	 */
	serializeState(): {
		sessions: Record<string, SerializedCyrusAgentSession>;
		entries: Record<string, SerializedCyrusAgentSessionEntry[]>;
	} {
		const sessions: Record<string, SerializedCyrusAgentSession> = {};
		const entries: Record<string, SerializedCyrusAgentSessionEntry[]> = {};

		// Serialize sessions
		for (const [sessionId, session] of this.sessions.entries()) {
			// Exclude claudeRunner from serialization as it's not serializable
			const { claudeRunner: _claudeRunner, ...serializableSession } = session;
			sessions[sessionId] = serializableSession;
		}

		// Serialize entries
		for (const [sessionId, sessionEntries] of this.entries.entries()) {
			entries[sessionId] = sessionEntries.map((entry) => ({
				...entry,
			}));
		}

		return { sessions, entries };
	}

	/**
	 * Restore Agent Session state from serialized data
	 */
	restoreState(
		serializedSessions: Record<string, SerializedCyrusAgentSession>,
		serializedEntries: Record<string, SerializedCyrusAgentSessionEntry[]>,
	): void {
		// Clear existing state
		this.sessions.clear();
		this.entries.clear();

		// Restore sessions
		for (const [sessionId, sessionData] of Object.entries(serializedSessions)) {
			const session: CyrusAgentSession = {
				...sessionData,
			};
			this.sessions.set(sessionId, session);
		}

		// Restore entries
		for (const [sessionId, entriesData] of Object.entries(serializedEntries)) {
			const sessionEntries: CyrusAgentSessionEntry[] = entriesData.map(
				(entryData) => ({
					...entryData,
				}),
			);
			this.entries.set(sessionId, sessionEntries);
		}

		console.log(
			`[AgentSessionManager] Restored ${this.sessions.size} sessions, ${Object.keys(serializedEntries).length} entry collections`,
		);
	}

	/**
	 * Post a thought about the model being used
	 */
	private async postModelNotificationThought(
		linearAgentActivitySessionId: string,
		model: string,
	): Promise<void> {
		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Using model: ${model}`,
				},
			});

			if (result.success) {
				console.log(
					`[AgentSessionManager] Posted model notification for session ${linearAgentActivitySessionId} (model: ${model})`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to post model notification:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error posting model notification:`,
				error,
			);
		}
	}

	/**
	 * Post an ephemeral "Routing your request..." thought and return the activity ID
	 */
	async postRoutingThought(
		linearAgentActivitySessionId: string,
	): Promise<string | null> {
		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: "Routing your request…",
				},
				ephemeral: true,
			});

			if (result.success && result.agentActivity) {
				const activity = await result.agentActivity;
				console.log(
					`[AgentSessionManager] Posted routing thought for session ${linearAgentActivitySessionId}`,
				);
				return activity.id;
			} else {
				console.error(
					`[AgentSessionManager] Failed to post routing thought:`,
					result,
				);
				return null;
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error posting routing thought:`,
				error,
			);
			return null;
		}
	}

	/**
	 * Post the procedure selection result as a non-ephemeral thought
	 */
	async postProcedureSelectionThought(
		linearAgentActivitySessionId: string,
		procedureName: string,
		classification: string,
	): Promise<void> {
		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Selected procedure: **${procedureName}** (classified as: ${classification})`,
				},
				ephemeral: false,
			});

			if (result.success) {
				console.log(
					`[AgentSessionManager] Posted procedure selection for session ${linearAgentActivitySessionId}: ${procedureName}`,
				);
			} else {
				console.error(
					`[AgentSessionManager] Failed to post procedure selection:`,
					result,
				);
			}
		} catch (error) {
			console.error(
				`[AgentSessionManager] Error posting procedure selection:`,
				error,
			);
		}
	}
}
