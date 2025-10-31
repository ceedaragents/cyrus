import type {
	ClaudeRunnerConfig,
	ClaudeSessionInfo,
	SDKMessage,
} from "cyrus-claude-runner";
import { ClaudeRunner } from "cyrus-claude-runner";
import type {
	AgentEvent,
	AgentRunner,
	AgentSession,
	AgentSessionConfig,
	SessionSummary,
	UserMessage,
} from "cyrus-interfaces";

/**
 * Session tracking information
 */
interface SessionState {
	runner: ClaudeRunner;
	sessionInfo: ClaudeSessionInfo;
	events: AgentEvent[];
	eventResolvers: Array<(value: IteratorResult<AgentEvent>) => void>;
	isComplete: boolean;
	summary: SessionSummary | null;
}

/**
 * Adapter that wraps ClaudeRunner to implement the AgentRunner interface
 *
 * This adapter bridges the gap between the existing ClaudeRunner implementation
 * and the new standardized AgentRunner interface, allowing ClaudeRunner to be
 * used in the new I/O architecture without modification.
 */
export class ClaudeAgentRunner implements AgentRunner {
	private defaultConfig: Partial<ClaudeRunnerConfig>;
	private sessions: Map<string, SessionState> = new Map();

	/**
	 * Create a new ClaudeAgentRunner
	 *
	 * @param defaultConfig - Default configuration to use for all sessions
	 */
	constructor(defaultConfig: Partial<ClaudeRunnerConfig> = {}) {
		this.defaultConfig = defaultConfig;
	}

	/**
	 * Start a new agent session
	 *
	 * @param config - Session configuration
	 * @returns Promise that resolves to the active session
	 */
	async start(config: AgentSessionConfig): Promise<AgentSession> {
		// Build ClaudeRunner config from AgentSessionConfig
		const claudeConfig: ClaudeRunnerConfig = {
			...this.defaultConfig,
			workingDirectory: config.workingDirectory,
			allowedTools: config.allowedTools,
			disallowedTools: config.disallowedTools,
			systemPrompt: config.systemPrompt,
			model: config.model,
			maxTurns: config.maxTurns,
			cyrusHome: this.defaultConfig.cyrusHome || process.env.CYRUS_HOME || "",
		};

		// Create new ClaudeRunner instance
		const runner = new ClaudeRunner(claudeConfig);

		// Set up event listeners before starting
		const sessionState: SessionState = {
			runner,
			sessionInfo: {
				sessionId: null,
				startedAt: new Date(),
				isRunning: true,
			},
			events: [],
			eventResolvers: [],
			isComplete: false,
			summary: null,
		};

		this.setupEventListeners(runner, sessionState);

		// Start the session with the appropriate prompt type
		let sessionInfo: ClaudeSessionInfo;

		if (typeof config.prompt === "string") {
			// String prompt mode
			sessionInfo = await runner.start(config.prompt);
		} else {
			// Streaming prompt mode
			sessionInfo = await runner.startStreaming();

			// Convert AsyncIterable<UserMessage> to ClaudeRunner stream messages
			this.streamUserMessages(config.prompt, runner);
		}

		// Update session state with actual session info
		sessionState.sessionInfo = sessionInfo;

		// Store session by ID (or temporary ID if not yet assigned)
		const sessionId = sessionInfo.sessionId || `temp-${Date.now()}`;
		this.sessions.set(sessionId, sessionState);

		// If we have a real session ID, also store by that
		if (sessionInfo.sessionId && sessionInfo.sessionId !== sessionId) {
			this.sessions.set(sessionInfo.sessionId, sessionState);
		}

		// Create the AgentSession return value
		const session: AgentSession = {
			id: sessionInfo.sessionId || sessionId,
			startedAt: sessionInfo.startedAt,
			events: this.createEventStream(sessionId),
		};

		return session;
	}

	/**
	 * Send a message to a running session
	 *
	 * @param sessionId - ID of the session to send to
	 * @param message - Message content to send
	 */
	async sendMessage(sessionId: string, message: string): Promise<void> {
		const sessionState = this.sessions.get(sessionId);

		if (!sessionState) {
			throw new Error(`Session ${sessionId} not found`);
		}

		if (!sessionState.runner.isStreaming()) {
			throw new Error(
				`Session ${sessionId} is not in streaming mode. Cannot send additional messages.`,
			);
		}

		if (!sessionState.sessionInfo.isRunning) {
			throw new Error(`Session ${sessionId} is not running`);
		}

		// Add message to the stream
		sessionState.runner.addStreamMessage(message);
	}

	/**
	 * Stop a running session
	 *
	 * @param sessionId - ID of the session to stop
	 */
	async stop(sessionId: string): Promise<void> {
		const sessionState = this.sessions.get(sessionId);

		if (!sessionState) {
			throw new Error(`Session ${sessionId} not found`);
		}

		if (!sessionState.sessionInfo.isRunning) {
			throw new Error(`Session ${sessionId} is not running`);
		}

		// Stop the runner
		sessionState.runner.stop();

		// Mark as complete
		sessionState.sessionInfo.isRunning = false;
		sessionState.isComplete = true;

		// Resolve any pending event promises
		this.resolvePendingEvents(sessionState);
	}

	/**
	 * Resume an existing session with new configuration or prompt
	 *
	 * @param sessionId - ID of the session to resume
	 * @param config - Configuration for resuming
	 * @returns Promise that resolves to the resumed session
	 */
	async resume(
		sessionId: string,
		config: AgentSessionConfig,
	): Promise<AgentSession> {
		// Build ClaudeRunner config with resumeSessionId
		const claudeConfig: ClaudeRunnerConfig = {
			...this.defaultConfig,
			workingDirectory: config.workingDirectory,
			allowedTools: config.allowedTools,
			disallowedTools: config.disallowedTools,
			systemPrompt: config.systemPrompt,
			model: config.model,
			maxTurns: config.maxTurns,
			resumeSessionId: sessionId,
			cyrusHome: this.defaultConfig.cyrusHome || process.env.CYRUS_HOME || "",
		};

		// Create new ClaudeRunner instance for resume
		const runner = new ClaudeRunner(claudeConfig);

		// Set up session state
		const sessionState: SessionState = {
			runner,
			sessionInfo: {
				sessionId: sessionId,
				startedAt: new Date(),
				isRunning: true,
			},
			events: [],
			eventResolvers: [],
			isComplete: false,
			summary: null,
		};

		this.setupEventListeners(runner, sessionState);

		// Start the resumed session
		let sessionInfo: ClaudeSessionInfo;

		if (typeof config.prompt === "string") {
			sessionInfo = await runner.start(config.prompt);
		} else {
			sessionInfo = await runner.startStreaming();
			this.streamUserMessages(config.prompt, runner);
		}

		sessionState.sessionInfo = sessionInfo;

		// Update session mapping
		this.sessions.set(sessionId, sessionState);
		if (sessionInfo.sessionId && sessionInfo.sessionId !== sessionId) {
			this.sessions.set(sessionInfo.sessionId, sessionState);
		}

		// Create the AgentSession return value
		const session: AgentSession = {
			id: sessionInfo.sessionId || sessionId,
			startedAt: sessionInfo.startedAt,
			events: this.createEventStream(sessionId),
		};

		return session;
	}

	/**
	 * Check if a session is currently running
	 *
	 * @param sessionId - ID of the session to check
	 * @returns true if session is running, false otherwise
	 */
	isRunning(sessionId: string): boolean {
		const sessionState = this.sessions.get(sessionId);

		if (!sessionState) {
			return false;
		}

		return sessionState.runner.isRunning();
	}

	/**
	 * Get the event stream for a running session
	 *
	 * @param sessionId - ID of the session
	 * @returns Async iterable of events
	 */
	getEventStream(sessionId: string): AsyncIterable<AgentEvent> {
		const sessionState = this.sessions.get(sessionId);

		if (!sessionState) {
			throw new Error(`Session ${sessionId} not found`);
		}

		return this.createEventStream(sessionId);
	}

	/**
	 * Set up event listeners on ClaudeRunner to convert to AgentEvents
	 */
	private setupEventListeners(
		runner: ClaudeRunner,
		sessionState: SessionState,
	): void {
		// Text events
		runner.on("text", (text: string) => {
			const event: AgentEvent = {
				type: "text",
				content: text,
			};
			this.emitEvent(sessionState, event);
		});

		// Tool use events
		runner.on("tool-use", (toolName: string, input: unknown) => {
			const event: AgentEvent = {
				type: "tool-use",
				tool: toolName,
				input: input,
			};
			this.emitEvent(sessionState, event);
		});

		// Error events
		runner.on("error", (error: Error) => {
			const event: AgentEvent = {
				type: "error",
				error: error,
			};
			this.emitEvent(sessionState, event);
		});

		// Complete events
		runner.on("complete", (messages: SDKMessage[]) => {
			// Calculate summary from messages
			const summary = this.calculateSummary(messages);
			sessionState.summary = summary;

			const event: AgentEvent = {
				type: "complete",
				summary: summary,
			};

			this.emitEvent(sessionState, event);

			// Mark session as complete
			sessionState.isComplete = true;
			sessionState.sessionInfo.isRunning = false;

			// Resolve any pending event promises
			this.resolvePendingEvents(sessionState);
		});
	}

	/**
	 * Emit an event to the session's event stream
	 */
	private emitEvent(sessionState: SessionState, event: AgentEvent): void {
		// Add to event array
		sessionState.events.push(event);

		// Resolve any waiting iterators
		if (sessionState.eventResolvers.length > 0) {
			const resolver = sessionState.eventResolvers.shift()!;
			resolver({ value: event, done: false });
		}
	}

	/**
	 * Resolve any pending event promises with done=true
	 */
	private resolvePendingEvents(sessionState: SessionState): void {
		while (sessionState.eventResolvers.length > 0) {
			const resolver = sessionState.eventResolvers.shift()!;
			resolver({ value: undefined, done: true });
		}
	}

	/**
	 * Create an async iterable event stream for a session
	 */
	private createEventStream(sessionId: string): AsyncIterable<AgentEvent> {
		const self = this;
		let currentIndex = 0;

		return {
			[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
				return {
					next(): Promise<IteratorResult<AgentEvent>> {
						return new Promise((resolve) => {
							const sessionState = self.sessions.get(sessionId);

							if (!sessionState) {
								resolve({ value: undefined, done: true });
								return;
							}

							// Check if we have buffered events
							if (currentIndex < sessionState.events.length) {
								const event = sessionState.events[currentIndex];
								currentIndex++;
								resolve({
									value: event,
									done: false,
								} as IteratorResult<AgentEvent>);
								return;
							}

							// Check if session is complete
							if (sessionState.isComplete) {
								resolve({ value: undefined, done: true });
								return;
							}

							// Wait for next event
							sessionState.eventResolvers.push(resolve);
						});
					},
				};
			},
		};
	}

	/**
	 * Stream user messages from AsyncIterable to ClaudeRunner
	 */
	private async streamUserMessages(
		messages: AsyncIterable<UserMessage>,
		runner: ClaudeRunner,
	): Promise<void> {
		try {
			for await (const message of messages) {
				if (!runner.isRunning()) {
					break;
				}

				runner.addStreamMessage(message.content);
			}

			// Complete the stream when done
			if (runner.isRunning() && runner.isStreaming()) {
				runner.completeStream();
			}
		} catch (error) {
			console.error(
				"[ClaudeAgentRunner] Error streaming user messages:",
				error,
			);
			// Don't throw - let the runner handle errors
		}
	}

	/**
	 * Calculate session summary from SDK messages
	 */
	private calculateSummary(messages: SDKMessage[]): SessionSummary {
		let turns = 0;
		let toolsUsed = 0;
		const filesModified: Set<string> = new Set();

		for (const message of messages) {
			if (message.type === "assistant") {
				turns++;
			}

			// Count tool uses
			if (message.type === "assistant" && "content" in message.message) {
				const content = message.message.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === "tool_use") {
							toolsUsed++;

							// Track file modifications from Edit and Write tools
							if (block.name === "Edit" || block.name === "Write") {
								const input = block.input as { file_path?: string };
								if (input.file_path) {
									filesModified.add(input.file_path);
								}
							}
						}
					}
				}
			}
		}

		return {
			turns,
			toolsUsed,
			filesModified: Array.from(filesModified),
			exitCode: 0, // Successful completion
		};
	}
}
