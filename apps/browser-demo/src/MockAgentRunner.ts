import type {
	AgentEvent,
	AgentRunner,
	AgentSession,
	AgentSessionConfig,
	SessionSummary,
} from "cyrus-interfaces";

/**
 * Session tracking for mock runner
 */
interface MockSessionState {
	id: string;
	startedAt: Date;
	isRunning: boolean;
	events: AgentEvent[];
	eventResolvers: Array<(value: IteratorResult<AgentEvent>) => void>;
	isComplete: boolean;
}

/**
 * Mock AgentRunner for demo/testing purposes
 *
 * Simulates agent activity without actually running Claude.
 * Generates realistic-looking events for demonstration.
 */
export class MockAgentRunner implements AgentRunner {
	private sessions: Map<string, MockSessionState> = new Map();
	private sessionIdCounter = 0;

	async start(config: AgentSessionConfig): Promise<AgentSession> {
		const sessionId = `mock-session-${++this.sessionIdCounter}`;
		const startedAt = new Date();

		const sessionState: MockSessionState = {
			id: sessionId,
			startedAt,
			isRunning: true,
			events: [],
			eventResolvers: [],
			isComplete: false,
		};

		this.sessions.set(sessionId, sessionState);

		// Start generating mock events after a short delay
		setTimeout(() => {
			this.generateMockEvents(sessionId, config).catch(console.error);
		}, 1000);

		return {
			id: sessionId,
			startedAt,
			events: this.createEventStream(sessionId),
		};
	}

	async sendMessage(sessionId: string, message: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		if (!session.isRunning) {
			throw new Error(`Session ${sessionId} is not running`);
		}

		// Emit a text event acknowledging the message
		this.emitEvent(sessionId, {
			type: "text",
			content: `Received your message: "${message}"\n\nI'll incorporate this feedback into my work.`,
		});

		// Continue generating events
		setTimeout(() => {
			this.generateAdditionalEvents(sessionId).catch(console.error);
		}, 2000);
	}

	async stop(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		session.isRunning = false;
		session.isComplete = true;

		// Emit completion event
		this.emitEvent(sessionId, {
			type: "complete",
			summary: {
				turns: 5,
				toolsUsed: 8,
				filesModified: ["src/example.ts", "src/test.ts"],
				exitCode: 0,
				summary: "Session stopped by user",
			},
		});

		this.resolvePendingEvents(session);
	}

	async resume(
		_sessionId: string,
		config: AgentSessionConfig,
	): Promise<AgentSession> {
		// For mock, just start a new session
		return this.start(config);
	}

	isRunning(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		return session?.isRunning ?? false;
	}

	getEventStream(sessionId: string): AsyncIterable<AgentEvent> {
		return this.createEventStream(sessionId);
	}

	/**
	 * Generate realistic mock events for demo
	 */
	private async generateMockEvents(
		sessionId: string,
		config: AgentSessionConfig,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.isRunning) {
			return;
		}

		const events: Array<{ event: AgentEvent; delayMs: number }> = [
			{
				event: {
					type: "text",
					content: `Analyzing the issue: "${typeof config.prompt === "string" ? config.prompt : "Work on issue"}"`,
				},
				delayMs: 500,
			},
			{
				event: {
					type: "tool-use",
					tool: "Glob",
					input: { pattern: "src/**/*.ts" },
				},
				delayMs: 1000,
			},
			{
				event: {
					type: "text",
					content:
						"I found the relevant files. Let me examine the codebase structure.",
				},
				delayMs: 1500,
			},
			{
				event: {
					type: "tool-use",
					tool: "Read",
					input: { file_path: "src/example.ts" },
				},
				delayMs: 800,
			},
			{
				event: {
					type: "text",
					content:
						"I've reviewed the existing code. Now I'll implement the requested changes.",
				},
				delayMs: 1200,
			},
			{
				event: {
					type: "tool-use",
					tool: "Edit",
					input: {
						file_path: "src/example.ts",
						old_string: "// TODO: implement",
						new_string: "// Implementation complete",
					},
				},
				delayMs: 2000,
			},
			{
				event: {
					type: "text",
					content:
						"Changes implemented. Let me run the tests to verify everything works.",
				},
				delayMs: 1000,
			},
			{
				event: {
					type: "tool-use",
					tool: "Bash",
					input: { command: "npm test" },
				},
				delayMs: 3000,
			},
			{
				event: {
					type: "text",
					content:
						"All tests passed! The implementation is complete and verified.",
				},
				delayMs: 1000,
			},
		];

		for (const { event, delayMs } of events) {
			await this.delay(delayMs);

			if (!session.isRunning) {
				return;
			}

			this.emitEvent(sessionId, event);
		}

		// Complete the session after all events
		await this.delay(1000);
		if (session.isRunning) {
			const summary: SessionSummary = {
				turns: 5,
				toolsUsed: 8,
				filesModified: ["src/example.ts", "src/test.ts", "README.md"],
				exitCode: 0,
				summary:
					"Successfully implemented the requested feature with tests and documentation.",
			};

			this.emitEvent(sessionId, {
				type: "complete",
				summary,
			});

			session.isComplete = true;
			session.isRunning = false;
			this.resolvePendingEvents(session);
		}
	}

	/**
	 * Generate additional events after user feedback
	 */
	private async generateAdditionalEvents(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.isRunning) {
			return;
		}

		await this.delay(1000);
		this.emitEvent(sessionId, {
			type: "text",
			content: "Making adjustments based on your feedback...",
		});

		await this.delay(2000);
		this.emitEvent(sessionId, {
			type: "tool-use",
			tool: "Edit",
			input: {
				file_path: "src/example.ts",
				old_string: "old code",
				new_string: "improved code",
			},
		});

		await this.delay(1500);
		this.emitEvent(sessionId, {
			type: "text",
			content: "Adjustments complete!",
		});
	}

	/**
	 * Emit an event to the session
	 */
	private emitEvent(sessionId: string, event: AgentEvent): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			console.error(
				`[DEBUG MockAgent] Session ${sessionId} not found, cannot emit event`,
			);
			return;
		}

		console.error(
			`[DEBUG MockAgent] Emitting event type: ${event.type} for session ${sessionId}`,
		);
		session.events.push(event);

		// Resolve any waiting iterators
		if (session.eventResolvers.length > 0) {
			const resolver = session.eventResolvers.shift()!;
			resolver({ value: event, done: false });
			console.error(
				`[DEBUG MockAgent] Resolved waiting iterator for ${event.type}`,
			);
		} else {
			console.error(`[DEBUG MockAgent] No waiting iterators, event buffered`);
		}
	}

	/**
	 * Resolve pending event promises with done=true
	 */
	private resolvePendingEvents(session: MockSessionState): void {
		while (session.eventResolvers.length > 0) {
			const resolver = session.eventResolvers.shift()!;
			resolver({ value: undefined, done: true });
		}
	}

	/**
	 * Create an async iterable event stream
	 */
	private createEventStream(sessionId: string): AsyncIterable<AgentEvent> {
		const self = this;
		let currentIndex = 0;

		return {
			[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
				return {
					next(): Promise<IteratorResult<AgentEvent>> {
						return new Promise((resolve) => {
							const session = self.sessions.get(sessionId);

							if (!session) {
								resolve({ value: undefined, done: true });
								return;
							}

							// Check if we have buffered events
							if (currentIndex < session.events.length) {
								const event = session.events[currentIndex];
								currentIndex++;
								resolve({
									value: event,
									done: false,
								} as IteratorResult<AgentEvent>);
								return;
							}

							// Check if session is complete
							if (session.isComplete) {
								resolve({ value: undefined, done: true });
								return;
							}

							// Wait for next event
							session.eventResolvers.push(resolve);
						});
					},
				};
			},
		};
	}

	/**
	 * Helper to add delay
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
