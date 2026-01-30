import { EventEmitter } from "node:events";
import type {
	APIAssistantMessage,
	APIUserMessage,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKStatusMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from "cyrus-claude-runner";
import {
	type AgentActivityCreateInput,
	AgentActivitySignal,
	AgentSessionStatus,
	AgentSessionType,
	type CyrusAgentSession,
	type CyrusAgentSessionEntry,
	createLogger,
	type IAgentRunner,
	type IIssueTrackerService,
	type ILogger,
	type IssueMinimal,
	type SerializedCyrusAgentSession,
	type SerializedCyrusAgentSessionEntry,
	type Workspace,
} from "cyrus-core";
import type { GlobalSessionRegistry } from "./GlobalSessionRegistry.js";
import type { ProcedureAnalyzer } from "./procedures/ProcedureAnalyzer.js";
import type { ValidationLoopMetadata } from "./procedures/types.js";
import type { SharedApplicationServer } from "./SharedApplicationServer.js";
import {
	DEFAULT_VALIDATION_LOOP_CONFIG,
	parseValidationResult,
	renderValidationFixerPrompt,
} from "./validation/index.js";

/**
 * Events emitted by AgentSessionManager
 */
export interface AgentSessionManagerEvents {
	subroutineComplete: (data: {
		sessionId: string;
		session: CyrusAgentSession;
	}) => void;
	/**
	 * Emitted when validation fails and we need to run the validation-fixer
	 * The EdgeWorker should respond by running the fixer prompt and then re-running verifications
	 */
	validationLoopIteration: (data: {
		sessionId: string;
		session: CyrusAgentSession;
		/** The fixer prompt to run (already rendered with failure context) */
		fixerPrompt: string;
		/** Current iteration (1-based) */
		iteration: number;
		/** Maximum iterations allowed */
		maxIterations: number;
	}) => void;
	/**
	 * Emitted when we need to re-run the verifications subroutine
	 */
	validationLoopRerun: (data: {
		sessionId: string;
		session: CyrusAgentSession;
		/** Current iteration (1-based) */
		iteration: number;
	}) => void;
}

/**
 * Type-safe event emitter interface for AgentSessionManager
 */
export declare interface AgentSessionManager {
	on<K extends keyof AgentSessionManagerEvents>(
		event: K,
		listener: AgentSessionManagerEvents[K],
	): this;
	emit<K extends keyof AgentSessionManagerEvents>(
		event: K,
		...args: Parameters<AgentSessionManagerEvents[K]>
	): boolean;
}

/**
 * Manages Agent Sessions integration with Claude Code SDK
 * Transforms Claude streaming messages into Agent Session format
 * Handles session lifecycle: create → active → complete/error
 *
 * CURRENTLY BEING HANDLED 'per repository'
 */
export class AgentSessionManager extends EventEmitter {
	private logger: ILogger;
	private issueTracker: IIssueTrackerService;
	private sessions: Map<string, CyrusAgentSession> = new Map();
	private entries: Map<string, CyrusAgentSessionEntry[]> = new Map(); // Stores a list of session entries per each session by its id
	private activeTasksBySession: Map<string, string> = new Map(); // Maps session ID to active Task tool use ID
	private toolCallsByToolUseId: Map<string, { name: string; input: any }> =
		new Map(); // Track tool calls by their tool_use_id
	private activeStatusActivitiesBySession: Map<string, string> = new Map(); // Maps session ID to active compacting status activity ID
	private procedureAnalyzer?: ProcedureAnalyzer;
	private sharedApplicationServer?: SharedApplicationServer;
	private getParentSessionId?: (childSessionId: string) => string | undefined;
	private resumeParentSession?: (
		parentSessionId: string,
		prompt: string,
		childSessionId: string,
	) => Promise<void>;

	constructor(
		issueTracker: IIssueTrackerService,
		getParentSessionId?: (childSessionId: string) => string | undefined,
		resumeParentSession?: (
			parentSessionId: string,
			prompt: string,
			childSessionId: string,
		) => Promise<void>,
		procedureAnalyzer?: ProcedureAnalyzer,
		sharedApplicationServer?: SharedApplicationServer,
		_globalSessionRegistry?: GlobalSessionRegistry,
		logger?: ILogger,
	) {
		super();
		this.logger = logger ?? createLogger({ component: "AgentSessionManager" });
		this.issueTracker = issueTracker;
		this.getParentSessionId = getParentSessionId;
		this.resumeParentSession = resumeParentSession;
		this.procedureAnalyzer = procedureAnalyzer;
		this.sharedApplicationServer = sharedApplicationServer;
		// GlobalSessionRegistry parameter added for future migration (Phase 4)
		// Currently unused but prepared for when AgentSessionManager is refactored
		// to use centralized session storage instead of local Maps
		// Prefixed with _ to indicate intentionally unused for now
	}

	/**
	 * Get a session-scoped logger with context (sessionId, platform, issueIdentifier).
	 */
	private sessionLog(sessionId: string): ILogger {
		const session = this.sessions.get(sessionId);
		return this.logger.withContext({
			sessionId,
			platform: session?.issueContext?.trackerId,
			issueIdentifier: session?.issueContext?.issueIdentifier,
		});
	}

	/**
	 * Initialize a Linear agent session from webhook
	 * The session is already created by Linear, we just need to track it
	 */
	createLinearAgentSession(
		sessionId: string,
		issueId: string,
		issueMinimal: IssueMinimal,
		workspace: Workspace,
	): CyrusAgentSession {
		const log = this.logger.withContext({
			sessionId,
			platform: "linear",
			issueIdentifier: issueMinimal.identifier,
		});
		log.info(`Tracking session for issue ${issueId}`);

		const agentSession: CyrusAgentSession = {
			id: sessionId,
			externalSessionId: sessionId, // For Linear sessions, the external ID is the same as our internal ID
			platform: "linear",
			type: AgentSessionType.CommentThread,
			status: AgentSessionStatus.Active,
			context: AgentSessionType.CommentThread,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			issueContext: {
				trackerId: "linear",
				issueId: issueId,
				issueIdentifier: issueMinimal.identifier,
			},
			issueId, // Kept for backwards compatibility
			issue: issueMinimal,
			workspace: workspace,
		};

		// Store locally
		this.sessions.set(sessionId, agentSession);
		this.entries.set(sessionId, []);

		return agentSession;
	}

	/**
	 * Initialize a GitHub agent session from a PR comment webhook.
	 * GitHub sessions do NOT sync activities to Linear — only the final result
	 * is posted back to the PR as a GitHub comment (handled by EdgeWorker.postGitHubReply).
	 */
	createGitHubSession(
		sessionId: string,
		issueId: string,
		issueMinimal: IssueMinimal,
		workspace: Workspace,
	): CyrusAgentSession {
		const log = this.logger.withContext({
			sessionId,
			platform: "github",
			issueIdentifier: issueMinimal.identifier,
		});
		log.info(`Tracking GitHub session for ${issueId}`);

		const agentSession: CyrusAgentSession = {
			id: sessionId,
			externalSessionId: sessionId,
			platform: "github",
			type: AgentSessionType.CommentThread,
			status: AgentSessionStatus.Active,
			context: AgentSessionType.CommentThread,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			issueContext: {
				trackerId: "github",
				issueId: issueId,
				issueIdentifier: issueMinimal.identifier,
			},
			issueId,
			issue: issueMinimal,
			workspace: workspace,
		};

		// Store locally
		this.sessions.set(sessionId, agentSession);
		this.entries.set(sessionId, []);

		return agentSession;
	}

	/**
	 * Update Agent Session with session ID from system initialization
	 * Automatically detects whether it's Claude or Gemini based on the runner
	 */
	updateAgentSessionWithClaudeSessionId(
		sessionId: string,
		claudeSystemMessage: SDKSystemMessage,
	): void {
		const linearSession = this.sessions.get(sessionId);
		if (!linearSession) {
			const log = this.sessionLog(sessionId);
			log.warn(`No Linear session found`);
			return;
		}

		// Determine which runner is being used
		const runner = linearSession.agentRunner;
		const isGeminiRunner = runner?.constructor.name === "GeminiRunner";

		// Update the appropriate session ID based on runner type
		if (isGeminiRunner) {
			linearSession.geminiSessionId = claudeSystemMessage.session_id;
		} else {
			linearSession.claudeSessionId = claudeSystemMessage.session_id;
		}

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
	 * Create a session entry from user/assistant message (without syncing to Linear)
	 */
	private async createSessionEntry(
		sessionId: string,
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
		// Extract SDK error from assistant messages (e.g., rate_limit, billing_error)
		// SDKAssistantMessage has optional `error?: SDKAssistantMessageError` field
		// See: @anthropic-ai/claude-agent-sdk sdk.d.ts lines 1013-1022
		// Evidence from ~/.cyrus/logs/CYGROW-348 session jsonl shows assistant messages with
		// "error":"rate_limit" field when usage limits are hit
		const sdkError =
			sdkMessage.type === "assistant" ? sdkMessage.error : undefined;

		// Determine which runner is being used
		const session = this.sessions.get(sessionId);
		const runner = session?.agentRunner;
		const isGeminiRunner = runner?.constructor.name === "GeminiRunner";

		const sessionEntry: CyrusAgentSessionEntry = {
			// Set the appropriate session ID based on runner type
			...(isGeminiRunner
				? { geminiSessionId: sdkMessage.session_id }
				: { claudeSessionId: sdkMessage.session_id }),
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
				...(sdkError && { sdkError }),
			},
		};

		// DON'T store locally yet - wait until we actually post to Linear
		return sessionEntry;
	}

	/**
	 * Complete a session from Claude result message
	 */
	async completeSession(
		sessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			const log = this.sessionLog(sessionId);
			log.error(`No session found`);
			return;
		}

		const log = this.sessionLog(sessionId);

		// Clear any active Task when session completes
		this.activeTasksBySession.delete(sessionId);

		// Clear tool calls tracking for this session
		// Note: We should ideally track by session, but for now clearing all is safer
		// to prevent memory leaks

		const status =
			resultMessage.subtype === "success"
				? AgentSessionStatus.Complete
				: AgentSessionStatus.Error;

		// Update session status and metadata
		await this.updateSessionStatus(sessionId, status, {
			totalCostUsd: resultMessage.total_cost_usd,
			usage: resultMessage.usage,
		});

		// Handle result using procedure routing system
		if ("result" in resultMessage && resultMessage.result) {
			await this.handleProcedureCompletion(session, sessionId, resultMessage);
		} else if (resultMessage.subtype !== "success") {
			// Error result (e.g. error_max_turns from singleTurn subroutines) — try to
			// recover from the last completed subroutine's result so the procedure can still complete.
			const recoveredText =
				this.procedureAnalyzer?.getLastSubroutineResult(session);
			if (recoveredText) {
				log.info(
					`Recovered result from previous subroutine (subtype: ${resultMessage.subtype}), treating as success for procedure completion`,
				);
				// Create a synthetic success result for procedure routing
				const syntheticResult: SDKResultMessage = {
					...resultMessage,
					subtype: "success",
					result: recoveredText,
					is_error: false,
				};
				await this.handleProcedureCompletion(
					session,
					sessionId,
					syntheticResult,
				);
			} else {
				log.warn(
					`Error result with no recoverable text (subtype: ${resultMessage.subtype}), posting error to Linear`,
				);
				await this.addResultEntry(sessionId, resultMessage);
			}
		}
	}

	/**
	 * Handle completion using procedure routing system
	 */
	private async handleProcedureCompletion(
		session: CyrusAgentSession,
		sessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		if (!this.procedureAnalyzer) {
			throw new Error("ProcedureAnalyzer not available");
		}

		// Check if error occurred
		if (resultMessage.subtype !== "success") {
			log.info(
				`Subroutine completed with error, not triggering next subroutine`,
			);
			return;
		}

		// Get the runner session ID (either Claude or Gemini)
		const runnerSessionId = session.claudeSessionId || session.geminiSessionId;
		if (!runnerSessionId) {
			log.error(`No runner session ID found for procedure session`);
			return;
		}

		// Check if there's a next subroutine
		const nextSubroutine = this.procedureAnalyzer.getNextSubroutine(session);

		if (nextSubroutine) {
			// More subroutines to run - check if current subroutine requires approval
			const currentSubroutine =
				this.procedureAnalyzer.getCurrentSubroutine(session);

			if (currentSubroutine?.requiresApproval) {
				log.info(
					`Current subroutine "${currentSubroutine.name}" requires approval before proceeding`,
				);

				// Check if SharedApplicationServer is available
				if (!this.sharedApplicationServer) {
					log.error(
						`SharedApplicationServer not available for approval workflow`,
					);
					await this.createErrorActivity(
						sessionId,
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
						this.sharedApplicationServer.registerApprovalRequest(sessionId);

					// Post approval elicitation to Linear with auth signal URL
					const approvalMessage = `The previous step has completed. Please review the result below and approve to continue:\n\n${subroutineResult}`;

					await this.createApprovalElicitation(
						sessionId,
						approvalMessage,
						approvalRequest.url,
					);

					log.info(`Waiting for approval at URL: ${approvalRequest.url}`);

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
						log.info(`Approval rejected`);
						await this.createErrorActivity(
							sessionId,
							`Workflow stopped: User rejected approval.${feedback ? `\n\nFeedback: ${feedback}` : ""}`,
						);
						return; // Stop workflow
					}

					log.info(`Approval granted, continuing to next subroutine`);

					// Optionally post feedback as a thought
					if (feedback) {
						await this.createThoughtActivity(
							sessionId,
							`User feedback: ${feedback}`,
						);
					}

					// Continue with advancement (fall through to existing code)
				} catch (error) {
					const errorMessage = (error as Error).message;
					if (errorMessage === "Approval timeout") {
						log.info(`Approval timed out`);
						await this.createErrorActivity(
							sessionId,
							"Workflow stopped: Approval request timed out after 30 minutes.",
						);
					} else {
						log.error(`Approval request failed:`, error);
						await this.createErrorActivity(
							sessionId,
							`Workflow stopped: Approval request failed - ${errorMessage}`,
						);
					}
					return; // Stop workflow
				}
			}

			// Check if current subroutine uses validation loop
			if (currentSubroutine?.usesValidationLoop) {
				const handled = await this.handleValidationLoopCompletion(
					session,
					sessionId,
					resultMessage,
					runnerSessionId,
					nextSubroutine,
				);
				if (handled) {
					return; // Validation loop took over control flow
				}
				// If not handled (validation passed or max retries), continue with normal advancement
			}

			// Advance procedure state
			log.info(
				`Subroutine completed, advancing to next: ${nextSubroutine.name}`,
			);
			const subroutineResult =
				"result" in resultMessage ? resultMessage.result : undefined;
			this.procedureAnalyzer.advanceToNextSubroutine(
				session,
				runnerSessionId,
				subroutineResult,
			);

			// Emit event for EdgeWorker to handle subroutine transition
			// This replaces the callback pattern and allows EdgeWorker to subscribe
			this.emit("subroutineComplete", {
				sessionId,
				session,
			});
		} else {
			// Procedure complete - post final result
			log.info(`All subroutines completed, posting final result to Linear`);
			await this.addResultEntry(sessionId, resultMessage);

			// Handle child session completion
			const isChildSession = this.getParentSessionId?.(sessionId);
			if (isChildSession && this.resumeParentSession) {
				await this.handleChildSessionCompletion(sessionId, resultMessage);
			}
		}
	}

	/**
	 * Handle validation loop completion for subroutines that use usesValidationLoop
	 * Returns true if the validation loop took over control flow (needs fixer or retry)
	 * Returns false if validation passed or max retries reached (continue with normal advancement)
	 */
	private async handleValidationLoopCompletion(
		session: CyrusAgentSession,
		sessionId: string,
		resultMessage: SDKResultMessage,
		_sessionId: string,
		_nextSubroutine: { name: string } | null,
	): Promise<boolean> {
		const log = this.sessionLog(sessionId);
		const maxIterations = DEFAULT_VALIDATION_LOOP_CONFIG.maxIterations;

		// Get or initialize validation loop state
		let validationLoop = session.metadata?.procedure?.validationLoop;
		if (!validationLoop) {
			validationLoop = {
				iteration: 0,
				inFixerMode: false,
				attempts: [],
			};
		}

		// Check if we're coming back from the fixer
		if (validationLoop.inFixerMode) {
			// Fixer completed, now we need to re-run verifications
			log.info(
				`Validation fixer completed for iteration ${validationLoop.iteration}, re-running verifications`,
			);

			// Clear fixer mode flag
			validationLoop.inFixerMode = false;
			this.updateValidationLoopState(session, validationLoop);

			// Emit event to re-run verifications
			this.emit("validationLoopRerun", {
				sessionId,
				session,
				iteration: validationLoop.iteration,
			});

			return true;
		}

		// Parse the validation result from the response
		const resultText =
			"result" in resultMessage ? resultMessage.result : undefined;
		const structuredOutput =
			"structured_output" in resultMessage
				? (resultMessage as { structured_output?: unknown }).structured_output
				: undefined;

		const validationResult = parseValidationResult(
			resultText,
			structuredOutput,
		);

		// Record this attempt
		const newIteration = validationLoop.iteration + 1;
		validationLoop.iteration = newIteration;
		validationLoop.attempts.push({
			iteration: newIteration,
			pass: validationResult.pass,
			reason: validationResult.reason,
			timestamp: Date.now(),
		});

		log.info(
			`Validation result for iteration ${newIteration}/${maxIterations}: pass=${validationResult.pass}, reason="${validationResult.reason.substring(0, 100)}..."`,
		);

		// Update state in session
		this.updateValidationLoopState(session, validationLoop);

		// Check if validation passed
		if (validationResult.pass) {
			log.info(`Validation passed after ${newIteration} iteration(s)`);
			// Clear validation loop state for next subroutine
			this.clearValidationLoopState(session);
			return false; // Continue with normal advancement
		}

		// Check if we've exceeded max retries
		if (newIteration >= maxIterations) {
			log.info(
				`Validation failed after ${newIteration} iterations, continuing anyway`,
			);
			// Post a thought about the failures
			await this.createThoughtActivity(
				sessionId,
				`Validation loop exhausted after ${newIteration} attempts. Last failure: ${validationResult.reason}`,
			);
			// Clear validation loop state for next subroutine
			this.clearValidationLoopState(session);
			return false; // Continue with normal advancement
		}

		// Validation failed and we have retries left - run the fixer
		log.info(
			`Validation failed, running fixer (iteration ${newIteration}/${maxIterations})`,
		);

		// Set fixer mode flag
		validationLoop.inFixerMode = true;
		this.updateValidationLoopState(session, validationLoop);

		// Render the fixer prompt with context
		const previousAttempts = validationLoop.attempts.slice(0, -1).map((a) => ({
			iteration: a.iteration,
			reason: a.reason,
		}));

		const fixerPrompt = renderValidationFixerPrompt({
			failureReason: validationResult.reason,
			iteration: newIteration,
			maxIterations,
			previousAttempts,
		});

		// Emit event for EdgeWorker to run the fixer
		this.emit("validationLoopIteration", {
			sessionId,
			session,
			fixerPrompt,
			iteration: newIteration,
			maxIterations,
		});

		return true; // Validation loop took over control flow
	}

	/**
	 * Update validation loop state in session metadata
	 */
	private updateValidationLoopState(
		session: CyrusAgentSession,
		validationLoop: ValidationLoopMetadata,
	): void {
		if (!session.metadata) {
			session.metadata = {};
		}
		if (!session.metadata.procedure) {
			return; // No procedure metadata, can't update
		}
		session.metadata.procedure.validationLoop = validationLoop;
	}

	/**
	 * Clear validation loop state from session metadata
	 */
	private clearValidationLoopState(session: CyrusAgentSession): void {
		if (session.metadata?.procedure) {
			delete session.metadata.procedure.validationLoop;
		}
	}

	/**
	 * Handle child session completion and resume parent
	 */
	private async handleChildSessionCompletion(
		sessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		if (!this.getParentSessionId || !this.resumeParentSession) {
			return;
		}

		const parentAgentSessionId = this.getParentSessionId(sessionId);

		if (!parentAgentSessionId) {
			log.error(`No parent session ID found for child session`);
			return;
		}

		log.info(
			`Child session completed, resuming parent ${parentAgentSessionId}`,
		);

		try {
			const childResult =
				"result" in resultMessage
					? resultMessage.result
					: "No result available";
			const promptToParent = `Child agent session ${sessionId} completed with result:\n\n${childResult}`;

			await this.resumeParentSession(
				parentAgentSessionId,
				promptToParent,
				sessionId,
			);

			log.info(`Successfully resumed parent session ${parentAgentSessionId}`);
		} catch (error) {
			log.error(`Failed to resume parent session:`, error);
		}
	}

	/**
	 * Handle streaming Claude messages and route to appropriate methods
	 */
	async handleClaudeMessage(
		sessionId: string,
		message: SDKMessage,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		try {
			switch (message.type) {
				case "system":
					if (message.subtype === "init") {
						this.updateAgentSessionWithClaudeSessionId(sessionId, message);

						// Post model notification
						const systemMessage = message as SDKSystemMessage;
						if (systemMessage.model) {
							await this.postModelNotificationThought(
								sessionId,
								systemMessage.model,
							);
						}
					} else if (message.subtype === "status") {
						// Handle status updates (compacting, etc.)
						await this.handleStatusMessage(
							sessionId,
							message as SDKStatusMessage,
						);
					}
					break;

				case "user": {
					const userEntry = await this.createSessionEntry(
						sessionId,
						message as SDKUserMessage,
					);
					await this.syncEntryToLinear(userEntry, sessionId);
					break;
				}

				case "assistant": {
					const assistantEntry = await this.createSessionEntry(
						sessionId,
						message as SDKAssistantMessage,
					);
					await this.syncEntryToLinear(assistantEntry, sessionId);
					break;
				}

				case "result":
					await this.completeSession(sessionId, message as SDKResultMessage);
					break;

				default:
					log.warn(`Unknown message type: ${(message as any).type}`);
			}
		} catch (error) {
			log.error(`Error handling message:`, error);
			// Mark session as error state
			await this.updateSessionStatus(sessionId, AgentSessionStatus.Error);
		}
	}

	/**
	 * Update session status and metadata
	 */
	private async updateSessionStatus(
		sessionId: string,
		status: AgentSessionStatus,
		additionalMetadata?: Partial<CyrusAgentSession["metadata"]>,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		session.status = status;
		session.updatedAt = Date.now();

		if (additionalMetadata) {
			session.metadata = { ...session.metadata, ...additionalMetadata };
		}

		this.sessions.set(sessionId, session);
	}

	/**
	 * Add result entry from result message
	 */
	private async addResultEntry(
		sessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		// Determine which runner is being used
		const session = this.sessions.get(sessionId);
		const runner = session?.agentRunner;
		const isGeminiRunner = runner?.constructor.name === "GeminiRunner";

		const resultEntry: CyrusAgentSessionEntry = {
			// Set the appropriate session ID based on runner type
			...(isGeminiRunner
				? { geminiSessionId: resultMessage.session_id }
				: { claudeSessionId: resultMessage.session_id }),
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
		await this.syncEntryToLinear(resultEntry, sessionId);
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
		sessionId: string,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		try {
			const session = this.sessions.get(sessionId);
			if (!session) {
				log.warn(`No Linear session found`);
				return;
			}

			// Store entry locally first
			const entries = this.entries.get(sessionId) || [];
			entries.push(entry);
			this.entries.set(sessionId, entries);

			// GitHub sessions don't sync activities to Linear
			if (session.platform !== "linear") {
				return;
			}

			// Build activity content based on entry type
			let content: any;
			let ephemeral = false;
			switch (entry.type) {
				case "user": {
					const activeTaskId = this.activeTasksBySession.get(sessionId);
					if (activeTaskId && activeTaskId === entry.metadata?.toolUseId) {
						content = {
							type: "thought",
							body: `✅ Task Completed\n\n\n\n${entry.content}\n\n---\n\n`,
						};
						this.activeTasksBySession.delete(sessionId);
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

							// Skip creating activity for TodoWrite/write_todos results since they already created a non-ephemeral thought
							// Skip AskUserQuestion results since it's custom handled via Linear's select signal elicitation
							if (
								toolName === "TodoWrite" ||
								toolName === "↪ TodoWrite" ||
								toolName === "write_todos" ||
								toolName === "AskUserQuestion" ||
								toolName === "↪ AskUserQuestion"
							) {
								return;
							}

							// Get formatter from runner
							const formatter = session.agentRunner?.getFormatter();
							if (!formatter) {
								log.warn(`No formatter available`);
								return;
							}

							// Format parameter and result using runner's formatter
							const formattedParameter = formatter.formatToolParameter(
								toolName,
								toolInput,
							);
							const formattedResult = formatter.formatToolResult(
								toolName,
								toolInput,
								toolResult.content?.trim() || "",
								toolResult.isError,
							);

							// Format the action name (with description for Bash tool)
							const formattedAction = formatter.formatToolActionName(
								toolName,
								toolInput,
								toolResult.isError,
							);

							content = {
								type: "action",
								action: formattedAction,
								parameter: formattedParameter,
								result: formattedResult,
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
								const activeTaskId = this.activeTasksBySession.get(sessionId);
								if (activeTaskId === entry.metadata?.parentToolUseId) {
									storedName = `↪ ${toolName}`;
								}
							}

							this.toolCallsByToolUseId.set(entry.metadata.toolUseId, {
								name: storedName,
								input: entry.metadata.toolInput || entry.content,
							});
						}

						// Skip AskUserQuestion tool - it's custom handled via Linear's select signal elicitation
						if (toolName === "AskUserQuestion") {
							return;
						}

						// Special handling for TodoWrite tool (Claude) and write_todos (Gemini) - treat as thought instead of action
						if (toolName === "TodoWrite" || toolName === "write_todos") {
							// Get formatter from runner
							const formatter = session.agentRunner?.getFormatter();
							if (!formatter) {
								log.warn(`No formatter available`);
								return;
							}

							const formattedTodos = formatter.formatTodoWriteParameter(
								entry.content,
							);
							content = {
								type: "thought",
								body: formattedTodos,
							};
							// TodoWrite/write_todos is not ephemeral
							ephemeral = false;
						} else if (toolName === "Task") {
							// Get formatter from runner
							const formatter = session.agentRunner?.getFormatter();
							if (!formatter) {
								log.warn(`No formatter available`);
								return;
							}

							// Special handling for Task tool - add start marker and track active task
							const toolInput = entry.metadata.toolInput || entry.content;
							const formattedParameter = formatter.formatToolParameter(
								toolName,
								toolInput,
							);
							const displayName = toolName;

							// Track this as the active Task for this session
							if (entry.metadata?.toolUseId) {
								this.activeTasksBySession.set(
									sessionId,
									entry.metadata.toolUseId,
								);
							}

							content = {
								type: "action",
								action: displayName,
								parameter: formattedParameter,
								// result will be added later when we get tool result
							};
							// Task is not ephemeral
							ephemeral = false;
						} else {
							// Get formatter from runner
							const formatter = session.agentRunner?.getFormatter();
							if (!formatter) {
								log.warn(`No formatter available`);
								return;
							}

							// Other tools - check if they're within an active Task
							const toolInput = entry.metadata.toolInput || entry.content;
							let displayName = toolName;

							if (entry.metadata?.parentToolUseId) {
								const activeTaskId = this.activeTasksBySession.get(sessionId);
								if (activeTaskId === entry.metadata?.parentToolUseId) {
									displayName = `↪ ${toolName}`;
								}
							}

							const formattedParameter = formatter.formatToolParameter(
								displayName,
								toolInput,
							);

							content = {
								type: "action",
								action: displayName,
								parameter: formattedParameter,
								// result will be added later when we get tool result
							};
							// Standard tool calls are ephemeral
							ephemeral = true;
						}
					} else if (entry.metadata?.sdkError) {
						// Assistant message with SDK error (e.g., rate_limit, billing_error)
						// Create an error type so it's visible to users (not just a thought)
						// Per CYPACK-719: usage limits should trigger "error" type activity
						content = {
							type: "error",
							body: entry.content,
						};
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
				this.procedureAnalyzer?.getCurrentSubroutine(session);
			if (currentSubroutine?.suppressThoughtPosting) {
				// Only suppress thoughts and actions, not responses or results
				if (content.type === "thought" || content.type === "action") {
					log.debug(
						`Suppressing ${content.type} posting for subroutine "${currentSubroutine.name}"`,
					);
					return; // Don't post to Linear
				}
			}

			// Ensure we have an external session ID for Linear API
			if (!session.externalSessionId) {
				log.warn(`No external session ID, skipping Linear activity`);
				return;
			}

			const activityInput: AgentActivityCreateInput = {
				agentSessionId: session.externalSessionId, // Use the Linear session ID
				content,
				...(ephemeral && { ephemeral: true }),
			};

			const result = await this.issueTracker.createAgentActivity(activityInput);

			if (result.success && result.agentActivity) {
				const agentActivity = await result.agentActivity;
				entry.linearAgentActivityId = agentActivity.id;
				if (entry.type === "result") {
					log.info(
						`Result message emitted to Linear (activity ${entry.linearAgentActivityId})`,
					);
				} else {
					log.debug(
						`Created ${content.type} activity ${entry.linearAgentActivityId}`,
					);
				}
			} else {
				log.error(`Failed to create Linear activity:`, result);
			}
		} catch (error) {
			log.error(`Failed to sync entry to Linear:`, error);
		}
	}

	/**
	 * Get session by ID
	 */
	getSession(sessionId: string): CyrusAgentSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get session entries by session ID
	 */
	getSessionEntries(sessionId: string): CyrusAgentSessionEntry[] {
		return this.entries.get(sessionId) || [];
	}

	/**
	 * Get all active sessions
	 */
	getActiveSessions(): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) => session.status === AgentSessionStatus.Active,
		);
	}

	/**
	 * Add or update agent runner for a session
	 */
	addAgentRunner(sessionId: string, agentRunner: IAgentRunner): void {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session) {
			log.warn(`No session found`);
			return;
		}

		session.agentRunner = agentRunner;
		session.updatedAt = Date.now();
		log.debug(`Added agent runner`);
	}

	/**
	 *  Get all agent runners
	 */
	getAllAgentRunners(): IAgentRunner[] {
		return Array.from(this.sessions.values())
			.map((session) => session.agentRunner)
			.filter((runner): runner is IAgentRunner => runner !== undefined);
	}

	/**
	 * Resolve the issue ID from a session, checking issueContext first then deprecated issueId.
	 */
	private getSessionIssueId(session: CyrusAgentSession): string | undefined {
		return session.issueContext?.issueId ?? session.issueId;
	}

	/**
	 * Get all agent runners for a specific issue
	 */
	getAgentRunnersForIssue(issueId: string): IAgentRunner[] {
		return Array.from(this.sessions.values())
			.filter((session) => this.getSessionIssueId(session) === issueId)
			.map((session) => session.agentRunner)
			.filter((runner): runner is IAgentRunner => runner !== undefined);
	}

	/**
	 * Get sessions by issue ID
	 */
	getSessionsByIssueId(issueId: string): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) => this.getSessionIssueId(session) === issueId,
		);
	}

	/**
	 * Get active sessions by issue ID
	 */
	getActiveSessionsByIssueId(issueId: string): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) =>
				this.getSessionIssueId(session) === issueId &&
				session.status === AgentSessionStatus.Active,
		);
	}

	/**
	 * Get all sessions
	 */
	getAllSessions(): CyrusAgentSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get agent runner for a specific session
	 */
	getAgentRunner(sessionId: string): IAgentRunner | undefined {
		const session = this.sessions.get(sessionId);
		return session?.agentRunner;
	}

	/**
	 * Check if an agent runner exists for a session
	 */
	hasAgentRunner(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		return session?.agentRunner !== undefined;
	}

	/**
	 * Create a thought activity
	 */
	async createThoughtActivity(sessionId: string, body: string): Promise<void> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session || !session.externalSessionId) {
			log.warn(`No Linear session ID`);
			return;
		}

		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: session.externalSessionId,
				content: {
					type: "thought",
					body,
				},
			});

			if (result.success) {
				log.debug(`Created thought activity`);
			} else {
				log.error(`Failed to create thought activity:`, result);
			}
		} catch (error) {
			log.error(`Error creating thought activity:`, error);
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
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session || !session.externalSessionId) {
			log.warn(`No Linear session ID`);
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

			const response = await this.issueTracker.createAgentActivity({
				agentSessionId: session.externalSessionId,
				content,
			});

			if (response.success) {
				log.debug(`Created action activity`);
			} else {
				log.error(`Failed to create action activity:`, response);
			}
		} catch (error) {
			log.error(`Error creating action activity:`, error);
		}
	}

	/**
	 * Create a response activity
	 */
	async createResponseActivity(sessionId: string, body: string): Promise<void> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session || !session.externalSessionId) {
			log.warn(`No Linear session ID`);
			return;
		}

		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: session.externalSessionId,
				content: {
					type: "response",
					body,
				},
			});

			if (result.success) {
				log.debug(`Created response activity`);
			} else {
				log.error(`Failed to create response activity:`, result);
			}
		} catch (error) {
			log.error(`Error creating response activity:`, error);
		}
	}

	/**
	 * Create an error activity
	 */
	async createErrorActivity(sessionId: string, body: string): Promise<void> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session || !session.externalSessionId) {
			log.warn(`No Linear session ID`);
			return;
		}

		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: session.externalSessionId,
				content: {
					type: "error",
					body,
				},
			});

			if (result.success) {
				log.debug(`Created error activity`);
			} else {
				log.error(`Failed to create error activity:`, result);
			}
		} catch (error) {
			log.error(`Error creating error activity:`, error);
		}
	}

	/**
	 * Create an elicitation activity
	 */
	async createElicitationActivity(
		sessionId: string,
		body: string,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session || !session.externalSessionId) {
			log.warn(`No Linear session ID`);
			return;
		}

		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: session.externalSessionId,
				content: {
					type: "elicitation",
					body,
				},
			});

			if (result.success) {
				log.debug(`Created elicitation activity`);
			} else {
				log.error(`Failed to create elicitation activity:`, result);
			}
		} catch (error) {
			log.error(`Error creating elicitation activity:`, error);
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
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session || !session.externalSessionId) {
			log.warn(`No Linear session ID`);
			return;
		}

		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: session.externalSessionId,
				content: {
					type: "elicitation",
					body,
				},
				signal: AgentActivitySignal.Auth,
				signalMetadata: {
					url: approvalUrl,
				},
			});

			if (result.success) {
				log.debug(`Created approval elicitation with URL: ${approvalUrl}`);
			} else {
				log.error(`Failed to create approval elicitation:`, result);
			}
		} catch (error) {
			log.error(`Error creating approval elicitation:`, error);
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
				const log = this.sessionLog(sessionId);
				this.sessions.delete(sessionId);
				this.entries.delete(sessionId);
				log.debug(`Cleaned up session`);
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
			// Exclude agentRunner from serialization as it's not serializable
			const { agentRunner: _agentRunner, ...serializableSession } = session;
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

		this.logger.debug(
			`Restored ${this.sessions.size} sessions, ${Object.keys(serializedEntries).length} entry collections`,
		);
	}

	/**
	 * Post a thought about the model being used
	 */
	private async postModelNotificationThought(
		sessionId: string,
		model: string,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (session?.platform !== "linear") {
			return;
		}
		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: `Using model: ${model}`,
				},
			});

			if (result.success) {
				log.debug(`Posted model notification (model: ${model})`);
			} else {
				log.error(`Failed to post model notification:`, result);
			}
		} catch (error) {
			log.error(`Error posting model notification:`, error);
		}
	}

	/**
	 * Post an ephemeral "Analyzing your request..." thought and return the activity ID
	 */
	async postAnalyzingThought(sessionId: string): Promise<string | null> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (session?.platform !== "linear") {
			return null;
		}
		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: "Analyzing your request…",
				},
				ephemeral: true,
			});

			if (result.success && result.agentActivity) {
				const activity = await result.agentActivity;
				log.debug(`Posted analyzing thought`);
				return activity.id;
			} else {
				log.error(`Failed to post analyzing thought:`, result);
				return null;
			}
		} catch (error) {
			log.error(`Error posting analyzing thought:`, error);
			return null;
		}
	}

	/**
	 * Post the procedure selection result as a non-ephemeral thought
	 */
	async postProcedureSelectionThought(
		sessionId: string,
		procedureName: string,
		classification: string,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (session?.platform !== "linear") {
			return;
		}
		try {
			const result = await this.issueTracker.createAgentActivity({
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: `Selected procedure: **${procedureName}** (classified as: ${classification})`,
				},
				ephemeral: false,
			});

			if (result.success) {
				log.debug(`Posted procedure selection: ${procedureName}`);
			} else {
				log.error(`Failed to post procedure selection:`, result);
			}
		} catch (error) {
			log.error(`Error posting procedure selection:`, error);
		}
	}

	/**
	 * Handle status messages (compacting, etc.)
	 */
	private async handleStatusMessage(
		sessionId: string,
		message: SDKStatusMessage,
	): Promise<void> {
		const log = this.sessionLog(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session || !session.externalSessionId) {
			log.warn(`No Linear session ID`);
			return;
		}

		// GitHub sessions don't sync status activities to Linear
		if (session.platform !== "linear") {
			return;
		}

		try {
			if (message.status === "compacting") {
				// Create an ephemeral thought for the compacting status
				const result = await this.issueTracker.createAgentActivity({
					agentSessionId: session.externalSessionId,
					content: {
						type: "thought",
						body: "Compacting conversation history…",
					},
					ephemeral: true,
				});

				if (result.success && result.agentActivity) {
					const activity = await result.agentActivity;
					// Store the activity ID so we can replace it later
					this.activeStatusActivitiesBySession.set(sessionId, activity.id);
					log.debug(`Posted ephemeral compacting status`);
				} else {
					log.error(`Failed to post compacting status:`, result);
				}
			} else if (message.status === null) {
				// Clear the status - post a non-ephemeral thought to replace the ephemeral one
				const result = await this.issueTracker.createAgentActivity({
					agentSessionId: session.externalSessionId,
					content: {
						type: "thought",
						body: "Conversation history compacted",
					},
					ephemeral: false,
				});

				if (result.success) {
					// Clean up the stored activity ID
					this.activeStatusActivitiesBySession.delete(sessionId);
					log.debug(`Posted non-ephemeral status clear`);
				} else {
					log.error(`Failed to post status clear:`, result);
				}
			}
		} catch (error) {
			log.error(`Error handling status message:`, error);
		}
	}
}
