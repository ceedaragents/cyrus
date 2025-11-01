import { EventEmitter } from "node:events";
import type {
	AgentEvent,
	AgentRunner,
	AgentSession,
	AgentSessionConfig,
	AgentSignal,
	Issue,
	IssueEvent,
	IssueTracker,
	Message,
	RenderableSession,
	Renderer,
	SessionState,
	SessionStatus,
	SessionStorage,
	SessionSummary,
	UserInput,
} from "cyrus-interfaces";

/**
 * Configuration options for MasterSessionManager
 */
export interface OrchestratorConfig {
	/** The member/user ID to watch for issue assignments */
	memberId: string;
	/** Maximum number of retry attempts for failed operations */
	maxRetries?: number;
	/** Delay in milliseconds between retry attempts */
	retryDelayMs?: number;
	/** Maximum number of concurrent sessions */
	maxConcurrentSessions?: number;
}

/**
 * Orchestrator-level events
 */
export interface OrchestratorEvents {
	/** Emitted when the orchestrator starts */
	started: () => void;
	/** Emitted when the orchestrator stops */
	stopped: () => void;
	/** Emitted when a session starts */
	"session:started": (sessionId: string, issueId: string) => void;
	/** Emitted when a session completes */
	"session:completed": (sessionId: string, issueId: string) => void;
	/** Emitted when a session fails */
	"session:failed": (sessionId: string, issueId: string, error: Error) => void;
	/** Emitted when a session is paused */
	"session:paused": (sessionId: string, issueId: string) => void;
	/** Emitted when a session is stopped */
	"session:stopped": (sessionId: string, issueId: string) => void;
	/** Emitted when an error occurs */
	error: (error: Error, context?: any) => void;
}

/**
 * Internal session state tracking
 */
interface ActiveSession {
	sessionId: string;
	issueId: string;
	issue: Issue;
	agentSession: AgentSession;
	status: SessionStatus;
	abortController: AbortController;
}

/**
 * Core orchestrator that coordinates AgentRunner, IssueTracker, Renderer, and Storage
 * using only abstract interfaces - no concrete implementations.
 */
export class MasterSessionManager extends EventEmitter {
	private readonly agentRunner: AgentRunner;
	private readonly issueTracker: IssueTracker;
	private readonly renderer: Renderer;
	private readonly storage: SessionStorage;
	private readonly config: Required<OrchestratorConfig>;

	/** Map of active sessions by session ID */
	private readonly activeSessions = new Map<string, ActiveSession>();

	/** Map of session IDs by issue ID for quick lookup */
	private readonly sessionsByIssue = new Map<string, string>();

	/** Flag indicating if the orchestrator is running */
	private isRunning = false;

	/** Abort controller for the issue watcher */
	private watcherAbortController: AbortController | null = null;

	constructor(
		agentRunner: AgentRunner,
		issueTracker: IssueTracker,
		renderer: Renderer,
		storage: SessionStorage,
		config: OrchestratorConfig,
	) {
		super();
		this.agentRunner = agentRunner;
		this.issueTracker = issueTracker;
		this.renderer = renderer;
		this.storage = storage;
		this.config = {
			memberId: config.memberId,
			maxRetries: config.maxRetries ?? 3,
			retryDelayMs: config.retryDelayMs ?? 1000,
			maxConcurrentSessions: config.maxConcurrentSessions ?? 10,
		};
	}

	/**
	 * Start the orchestrator and begin watching for issue assignments
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			throw new Error("Orchestrator is already running");
		}

		this.isRunning = true;
		this.watcherAbortController = new AbortController();
		this.emit("started");

		// Start watching for issue events
		this.watchIssueEvents().catch((error) => {
			this.emit("error", error, { context: "issue watcher" });
		});
	}

	/**
	 * Stop the orchestrator and gracefully shutdown all active sessions
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		// Stop watching for new events
		if (this.watcherAbortController) {
			this.watcherAbortController.abort();
			this.watcherAbortController = null;
		}

		// Gracefully stop all active sessions
		const stopPromises = Array.from(this.activeSessions.keys()).map(
			(sessionId) =>
				this.stopSession(sessionId).catch((error) => {
					this.emit("error", error, { context: "stopping session", sessionId });
				}),
		);

		await Promise.all(stopPromises);
		this.emit("stopped");
	}

	/**
	 * Start a new session for an issue
	 */
	async startSession(
		issue: Issue,
		config?: Partial<AgentSessionConfig>,
	): Promise<string> {
		// Check if we're at max concurrent sessions
		if (this.activeSessions.size >= this.config.maxConcurrentSessions) {
			throw new Error(
				`Maximum concurrent sessions (${this.config.maxConcurrentSessions}) reached`,
			);
		}

		// Check if there's already an active session for this issue
		const existingSessionId = this.sessionsByIssue.get(issue.id);
		if (existingSessionId && this.activeSessions.has(existingSessionId)) {
			throw new Error(`Session already active for issue ${issue.identifier}`);
		}

		const sessionId = this.generateSessionId(issue.id);
		const abortController = new AbortController();

		try {
			// Create initial session state
			const sessionState: SessionState = {
				id: sessionId,
				issueId: issue.id,
				agentSessionId: "",
				startedAt: new Date(),
				endedAt: undefined,
				status: "running",
				messages: [],
				metadata: {
					issueIdentifier: issue.identifier,
					issueTitle: issue.title,
					issueUrl: issue.url,
				},
				workingDirectory: config?.workingDirectory ?? process.cwd(),
				filesModified: [],
				turns: 0,
			};

			await this.storage.saveSession(sessionState);

			// Render session start
			const renderableSession: RenderableSession = {
				id: sessionId,
				issueId: issue.id,
				issueTitle: issue.title,
				startedAt: sessionState.startedAt,
				metadata: sessionState.metadata,
			};

			await this.renderer.renderSessionStart(renderableSession);

			// Build agent session config
			const agentConfig: AgentSessionConfig = {
				workingDirectory: sessionState.workingDirectory ?? process.cwd(),
				prompt: issue.description || `Work on issue: ${issue.title}`,
				systemPrompt: config?.systemPrompt,
				allowedTools: config?.allowedTools,
				disallowedTools: config?.disallowedTools,
				environment: config?.environment,
				maxTurns: config?.maxTurns,
				model: config?.model,
			};

			// Start agent session
			const agentSession = await this.agentRunner.start(agentConfig);

			// Update session state with agent session ID
			sessionState.agentSessionId = agentSession.id;
			await this.storage.saveSession(sessionState);

			// Track active session
			const activeSession: ActiveSession = {
				sessionId,
				issueId: issue.id,
				issue,
				agentSession,
				status: "running",
				abortController,
			};

			this.activeSessions.set(sessionId, activeSession);
			this.sessionsByIssue.set(issue.id, sessionId);

			this.emit("session:started", sessionId, issue.id);

			// Start processing agent events and user input in parallel
			this.processAgentEvents(activeSession).catch((error) => {
				this.handleSessionError(sessionId, error);
			});

			this.processUserInput(activeSession).catch((error) => {
				this.handleSessionError(sessionId, error);
			});

			return sessionId;
		} catch (error) {
			// Clean up on failure
			this.activeSessions.delete(sessionId);
			this.sessionsByIssue.delete(issue.id);

			await this.storage.updateStatus(sessionId, "failed").catch(() => {
				// Ignore storage errors during cleanup
			});

			throw error;
		}
	}

	/**
	 * Stop a running session
	 */
	async stopSession(sessionId: string): Promise<void> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) {
			throw new Error(`No active session found with ID: ${sessionId}`);
		}

		try {
			// Abort ongoing operations
			activeSession.abortController.abort();

			// Stop agent session
			if (this.agentRunner.isRunning(activeSession.agentSession.id)) {
				await this.agentRunner.stop(activeSession.agentSession.id);
			}

			// Update status
			await this.storage.updateStatus(sessionId, "stopped");

			// Clean up
			this.activeSessions.delete(sessionId);
			this.sessionsByIssue.delete(activeSession.issueId);

			this.emit("session:stopped", sessionId, activeSession.issueId);
		} catch (error) {
			this.emit("error", error as Error, {
				context: "stop session",
				sessionId,
			});
			throw error;
		}
	}

	/**
	 * Pause a running session (stops agent but preserves state for resumption)
	 */
	async pauseSession(sessionId: string): Promise<void> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) {
			throw new Error(`No active session found with ID: ${sessionId}`);
		}

		try {
			// Stop agent session
			if (this.agentRunner.isRunning(activeSession.agentSession.id)) {
				await this.agentRunner.stop(activeSession.agentSession.id);
			}

			// Update status
			await this.storage.updateStatus(sessionId, "paused");
			activeSession.status = "paused";

			this.emit("session:paused", sessionId, activeSession.issueId);
		} catch (error) {
			this.emit("error", error as Error, {
				context: "pause session",
				sessionId,
			});
			throw error;
		}
	}

	/**
	 * Resume a paused session
	 */
	async resumeSession(
		sessionId: string,
		config?: Partial<AgentSessionConfig>,
	): Promise<void> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) {
			throw new Error(`No active session found with ID: ${sessionId}`);
		}

		if (activeSession.status !== "paused") {
			throw new Error(
				`Session ${sessionId} is not paused (status: ${activeSession.status})`,
			);
		}

		try {
			// Load session state
			const sessionState = await this.storage.loadSession(sessionId);
			if (!sessionState) {
				throw new Error(`Session state not found for ID: ${sessionId}`);
			}

			// Build resume config
			const resumeConfig: AgentSessionConfig = {
				workingDirectory: sessionState.workingDirectory ?? process.cwd(),
				prompt: "Continue from where you left off",
				systemPrompt: config?.systemPrompt,
				allowedTools: config?.allowedTools,
				disallowedTools: config?.disallowedTools,
				environment: config?.environment,
				maxTurns: config?.maxTurns,
				model: config?.model,
			};

			// Resume agent session
			const agentSession = await this.agentRunner.resume(
				activeSession.agentSession.id,
				resumeConfig,
			);

			// Update active session
			activeSession.agentSession = agentSession;
			activeSession.status = "running";

			// Update storage
			await this.storage.updateStatus(sessionId, "running");

			// Restart event processing
			this.processAgentEvents(activeSession).catch((error) => {
				this.handleSessionError(sessionId, error);
			});

			this.processUserInput(activeSession).catch((error) => {
				this.handleSessionError(sessionId, error);
			});
		} catch (error) {
			this.emit("error", error as Error, {
				context: "resume session",
				sessionId,
			});
			throw error;
		}
	}

	/**
	 * Handle user input for a session
	 */
	async handleUserInput(sessionId: string, message: string): Promise<void> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) {
			throw new Error(`No active session found with ID: ${sessionId}`);
		}

		if (!this.agentRunner.isRunning(activeSession.agentSession.id)) {
			throw new Error(
				`Agent session ${activeSession.agentSession.id} is not running`,
			);
		}

		try {
			// Send message to agent
			await this.agentRunner.sendMessage(
				activeSession.agentSession.id,
				message,
			);

			// Store message in session
			const userMessage: Message = {
				id: this.generateMessageId(),
				role: "user",
				content: message,
				timestamp: new Date(),
				attachments: [],
				metadata: {},
			};

			await this.storage.addMessage(sessionId, userMessage);
		} catch (error) {
			this.emit("error", error as Error, {
				context: "handle user input",
				sessionId,
			});
			throw error;
		}
	}

	/**
	 * Get the current status of a session
	 */
	async getSessionStatus(sessionId: string): Promise<SessionState | null> {
		return this.storage.loadSession(sessionId);
	}

	/**
	 * List all sessions for an issue
	 */
	async listSessionsForIssue(issueId: string): Promise<SessionState[]> {
		return this.storage.listSessions(issueId);
	}

	/**
	 * Check if a session is active
	 */
	isSessionActive(sessionId: string): boolean {
		return this.activeSessions.has(sessionId);
	}

	/**
	 * Watch for issue events and handle them
	 */
	private async watchIssueEvents(): Promise<void> {
		try {
			const eventStream = this.issueTracker.watchIssues(this.config.memberId);

			for await (const event of eventStream) {
				if (!this.isRunning || this.watcherAbortController?.signal.aborted) {
					break;
				}

				await this.handleIssueEvent(event).catch((error) => {
					this.emit("error", error, { context: "handle issue event", event });
				});
			}
		} catch (error) {
			if (this.isRunning) {
				this.emit("error", error as Error, { context: "watch issue events" });
			}
		}
	}

	/**
	 * Handle an issue event
	 */
	private async handleIssueEvent(event: IssueEvent): Promise<void> {
		switch (event.type) {
			case "assigned": {
				// Start a new session when an issue is assigned
				await this.withRetry(
					() => this.startSession(event.issue),
					"start session",
				);
				break;
			}

			case "unassigned": {
				// Stop the session when an issue is unassigned
				const sessionId = this.sessionsByIssue.get(event.issue.id);
				if (sessionId) {
					await this.withRetry(
						() => this.stopSession(sessionId),
						"stop session",
					);
				}
				break;
			}

			case "comment-added": {
				// Handle new comments as user input
				const sessionId = this.sessionsByIssue.get(event.issue.id);
				if (sessionId && event.comment.content) {
					// Send to existing active session
					await this.withRetry(
						() => this.handleUserInput(sessionId, event.comment.content),
						"handle comment",
					);
				} else if (!sessionId && event.comment.content) {
					// No active session - start a new continuation session (like prompted event)
					await this.withRetry(
						() => this.startSession(event.issue),
						"start continuation session",
					);
				}
				break;
			}

			case "state-changed": {
				// Handle state changes (e.g., marking as completed)
				if (
					event.newState.type === "completed" ||
					event.newState.type === "canceled"
				) {
					const sessionId = this.sessionsByIssue.get(event.issue.id);
					if (sessionId) {
						await this.withRetry(
							() => this.stopSession(sessionId),
							"stop session",
						);
					}
				}
				break;
			}

			case "signal": {
				// Handle agent signals
				await this.handleAgentSignal(event.issue.id, event.signal);
				break;
			}
		}
	}

	/**
	 * Handle agent signals (start, stop, feedback)
	 */
	private async handleAgentSignal(
		issueId: string,
		signal: AgentSignal,
	): Promise<void> {
		const sessionId = this.sessionsByIssue.get(issueId);

		switch (signal.type) {
			case "start": {
				if (!sessionId) {
					const issue = await this.issueTracker.getIssue(issueId);
					await this.withRetry(
						() => this.startSession(issue),
						"start session from signal",
					);
				}
				break;
			}

			case "stop": {
				if (sessionId) {
					await this.withRetry(
						() => this.stopSession(sessionId),
						"stop session from signal",
					);
				}
				break;
			}

			case "feedback": {
				if (sessionId && signal.message) {
					await this.withRetry(
						() => this.handleUserInput(sessionId, signal.message),
						"handle feedback signal",
					);
				}
				break;
			}
		}
	}

	/**
	 * Process agent events and route to renderer
	 */
	private async processAgentEvents(
		activeSession: ActiveSession,
	): Promise<void> {
		try {
			const eventStream = activeSession.agentSession.events;

			for await (const event of eventStream) {
				if (activeSession.abortController.signal.aborted) {
					break;
				}

				await this.handleAgentEvent(activeSession, event).catch((error) => {
					this.emit("error", error, {
						context: "handle agent event",
						sessionId: activeSession.sessionId,
					});
				});
			}
		} catch (error) {
			if (!activeSession.abortController.signal.aborted) {
				this.handleSessionError(activeSession.sessionId, error as Error);
			}
		}
	}

	/**
	 * Handle an agent event
	 */
	private async handleAgentEvent(
		activeSession: ActiveSession,
		event: AgentEvent,
	): Promise<void> {
		const { sessionId } = activeSession;

		console.error(
			`[DEBUG Orchestrator] handleAgentEvent - sessionId: ${sessionId}, eventType: ${event.type}`,
		);

		switch (event.type) {
			case "text": {
				console.error(
					`[DEBUG Orchestrator] Calling renderer.renderText with sessionId: ${sessionId}`,
				);
				await this.renderer.renderText(sessionId, event.content);

				// Store as assistant message
				const message: Message = {
					id: this.generateMessageId(),
					role: "assistant",
					content: event.content,
					timestamp: new Date(),
					attachments: [],
					metadata: {},
				};
				await this.storage.addMessage(sessionId, message);
				break;
			}

			case "tool-use": {
				console.error(
					`[DEBUG Orchestrator] Calling renderer.renderToolUse with sessionId: ${sessionId}`,
				);
				await this.renderer.renderToolUse(sessionId, event.tool, event.input);

				// Store as tool message
				const message: Message = {
					id: this.generateMessageId(),
					role: "tool",
					content: JSON.stringify({ tool: event.tool, input: event.input }),
					timestamp: new Date(),
					attachments: [],
					metadata: { tool: event.tool },
				};
				await this.storage.addMessage(sessionId, message);
				break;
			}

			case "tool-result": {
				// Store tool result
				const message: Message = {
					id: this.generateMessageId(),
					role: "tool",
					content:
						typeof event.output === "string"
							? event.output
							: JSON.stringify(event.output),
					timestamp: new Date(),
					attachments: [],
					metadata: { tool: event.tool, success: event.success },
				};
				await this.storage.addMessage(sessionId, message);
				break;
			}

			case "error": {
				await this.renderer.renderError(sessionId, event.error);
				// Errors are handled by the complete event or session error handler
				break;
			}

			case "complete": {
				await this.handleSessionComplete(activeSession, event.summary);
				break;
			}
		}
	}

	/**
	 * Process user input from renderer and send to agent
	 */
	private async processUserInput(activeSession: ActiveSession): Promise<void> {
		try {
			const inputStream = this.renderer.getUserInput(activeSession.sessionId);

			for await (const input of inputStream) {
				if (activeSession.abortController.signal.aborted) {
					break;
				}

				await this.handleUserInputFromRenderer(activeSession, input).catch(
					(error) => {
						this.emit("error", error, {
							context: "handle user input from renderer",
							sessionId: activeSession.sessionId,
						});
					},
				);
			}
		} catch (error) {
			if (!activeSession.abortController.signal.aborted) {
				this.emit("error", error as Error, {
					context: "process user input",
					sessionId: activeSession.sessionId,
				});
			}
		}
	}

	/**
	 * Handle user input from renderer
	 */
	private async handleUserInputFromRenderer(
		activeSession: ActiveSession,
		input: UserInput,
	): Promise<void> {
		switch (input.type) {
			case "message": {
				await this.handleUserInput(activeSession.sessionId, input.content);
				break;
			}

			case "signal": {
				await this.handleAgentSignal(activeSession.issueId, input.signal);
				break;
			}
		}
	}

	/**
	 * Handle session completion
	 */
	private async handleSessionComplete(
		activeSession: ActiveSession,
		summary: SessionSummary,
	): Promise<void> {
		const { sessionId, issueId } = activeSession;

		try {
			// Render completion
			await this.renderer.renderComplete(sessionId, summary);

			// Update session state
			const sessionState = await this.storage.loadSession(sessionId);
			if (sessionState) {
				sessionState.status = "completed";
				sessionState.endedAt = new Date();
				sessionState.turns = summary.turns;
				sessionState.filesModified = summary.filesModified || [];
				await this.storage.saveSession(sessionState);
			}

			// Abort ongoing operations (stops processUserInput loop)
			activeSession.abortController.abort();

			// Clean up
			this.activeSessions.delete(sessionId);
			this.sessionsByIssue.delete(issueId);

			this.emit("session:completed", sessionId, issueId);
		} catch (error) {
			this.emit("error", error as Error, {
				context: "handle session complete",
				sessionId,
			});
		}
	}

	/**
	 * Handle session errors
	 */
	private async handleSessionError(
		sessionId: string,
		error: Error,
	): Promise<void> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) {
			return;
		}

		const { issueId } = activeSession;

		try {
			// Render error
			await this.renderer.renderError(sessionId, error);

			// Update session state
			await this.storage.updateStatus(sessionId, "failed");

			// Abort ongoing operations (stops processUserInput loop)
			activeSession.abortController.abort();

			// Clean up
			this.activeSessions.delete(sessionId);
			this.sessionsByIssue.delete(issueId);

			this.emit("session:failed", sessionId, issueId, error);
		} catch (err) {
			this.emit("error", err as Error, {
				context: "handle session error",
				sessionId,
			});
		}
	}

	/**
	 * Execute an operation with retry logic
	 */
	private async withRetry<T>(
		operation: () => Promise<T>,
		operationName: string,
	): Promise<T | undefined> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;

				if (attempt < this.config.maxRetries - 1) {
					// Wait before retrying
					await new Promise((resolve) =>
						setTimeout(resolve, this.config.retryDelayMs),
					);
				}
			}
		}

		// All retries failed
		this.emit("error", lastError!, {
			context: `${operationName} (after retries)`,
		});
		return undefined;
	}

	/**
	 * Generate a unique session ID
	 */
	private generateSessionId(issueId: string): string {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 9);
		return `session_${issueId}_${timestamp}_${random}`;
	}

	/**
	 * Generate a unique message ID
	 */
	private generateMessageId(): string {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 9);
		return `msg_${timestamp}_${random}`;
	}
}

// Type-safe event emitter declaration
export declare interface AgentSessionOrchestrator {
	on<K extends keyof OrchestratorEvents>(
		event: K,
		listener: OrchestratorEvents[K],
	): this;
	emit<K extends keyof OrchestratorEvents>(
		event: K,
		...args: Parameters<OrchestratorEvents[K]>
	): boolean;
}
