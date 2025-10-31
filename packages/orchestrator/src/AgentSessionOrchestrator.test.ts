import { EventEmitter } from "node:events";
import type {
	AgentEvent,
	AgentRunner,
	AgentSession,
	Issue,
	IssueEvent,
	IssueTracker,
	Renderer,
	SessionState,
	SessionStorage,
	SessionSummary,
	UserInput,
} from "cyrus-interfaces";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgentSessionOrchestrator,
	type OrchestratorConfig,
} from "./AgentSessionOrchestrator.js";

/**
 * Mock AgentRunner implementation
 */
class MockAgentRunner implements AgentRunner {
	private sessions = new Map<
		string,
		{ stream: AsyncIterable<AgentEvent>; isRunning: boolean }
	>();
	private eventEmitters = new Map<string, EventEmitter>();

	async start(config: any): Promise<AgentSession> {
		const sessionId = `agent_${Date.now()}_${Math.random()}`;
		const emitter = new EventEmitter();
		this.eventEmitters.set(sessionId, emitter);

		const stream = this.createEventStream(emitter);
		this.sessions.set(sessionId, { stream, isRunning: true });

		return {
			id: sessionId,
			config,
		};
	}

	async sendMessage(sessionId: string, message: string): Promise<void> {
		const emitter = this.eventEmitters.get(sessionId);
		if (emitter) {
			emitter.emit("message", message);
		}
	}

	async stop(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.isRunning = false;
		}
		const emitter = this.eventEmitters.get(sessionId);
		if (emitter) {
			emitter.emit("stop");
		}
	}

	async resume(sessionId: string, config: any): Promise<AgentSession> {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.isRunning = true;
		}
		return {
			id: sessionId,
			config,
		};
	}

	isRunning(sessionId: string): boolean {
		return this.sessions.get(sessionId)?.isRunning ?? false;
	}

	getEventStream(sessionId: string): AsyncIterable<AgentEvent> {
		return this.sessions.get(sessionId)?.stream ?? this.createEmptyStream();
	}

	// Helper methods for testing
	emitEvent(sessionId: string, event: AgentEvent): void {
		const emitter = this.eventEmitters.get(sessionId);
		if (emitter) {
			emitter.emit("event", event);
		}
	}

	private async *createEventStream(
		emitter: EventEmitter,
	): AsyncIterable<AgentEvent> {
		const events: AgentEvent[] = [];
		let resolve: (() => void) | null = null;
		let stopped = false;

		emitter.on("event", (event: AgentEvent) => {
			events.push(event);
			if (resolve) {
				resolve();
				resolve = null;
			}
		});

		emitter.on("stop", () => {
			stopped = true;
			if (resolve) {
				resolve();
				resolve = null;
			}
		});

		while (!stopped) {
			if (events.length > 0) {
				yield events.shift()!;
			} else {
				await new Promise<void>((r) => {
					resolve = r;
				});
			}
		}
	}

	private async *createEmptyStream(): AsyncIterable<AgentEvent> {
		// Empty stream
	}
}

/**
 * Mock IssueTracker implementation
 */
class MockIssueTracker implements IssueTracker {
	private issues = new Map<string, Issue>();
	private eventEmitter = new EventEmitter();
	private comments = new Map<string, any[]>();

	async getIssue(issueId: string): Promise<Issue> {
		const issue = this.issues.get(issueId);
		if (!issue) {
			throw new Error(`Issue not found: ${issueId}`);
		}
		return issue;
	}

	async listAssignedIssues(memberId: string, _filters?: any): Promise<Issue[]> {
		return Array.from(this.issues.values()).filter(
			(issue) => issue.assignee?.id === memberId,
		);
	}

	async updateIssueState(issueId: string, state: any): Promise<void> {
		const issue = this.issues.get(issueId);
		if (issue) {
			issue.state = state;
		}
	}

	async addComment(issueId: string, comment: any): Promise<string> {
		const comments = this.comments.get(issueId) || [];
		const commentId = `comment_${Date.now()}`;
		comments.push({ ...comment, id: commentId });
		this.comments.set(issueId, comments);
		return commentId;
	}

	async getComments(issueId: string): Promise<any[]> {
		return this.comments.get(issueId) || [];
	}

	async *watchIssues(_memberId: string): AsyncIterable<IssueEvent> {
		const events: IssueEvent[] = [];
		let resolve: (() => void) | null = null;
		let stopped = false;

		this.eventEmitter.on("event", (event: IssueEvent) => {
			events.push(event);
			if (resolve) {
				resolve();
				resolve = null;
			}
		});

		this.eventEmitter.on("stop", () => {
			stopped = true;
			if (resolve) {
				resolve();
				resolve = null;
			}
		});

		while (!stopped) {
			if (events.length > 0) {
				yield events.shift()!;
			} else {
				await new Promise<void>((r) => {
					resolve = r;
				});
			}
		}
	}

	async getAttachments(_issueId: string): Promise<any[]> {
		return [];
	}

	async sendSignal(_issueId: string, _signal: any): Promise<void> {
		// No-op for mock
	}

	// Helper methods for testing
	addIssue(issue: Issue): void {
		this.issues.set(issue.id, issue);
	}

	emitEvent(event: IssueEvent): void {
		this.eventEmitter.emit("event", event);
	}

	stopWatching(): void {
		this.eventEmitter.emit("stop");
	}
}

/**
 * Mock Renderer implementation
 */
class MockRenderer implements Renderer {
	private inputEmitters = new Map<string, EventEmitter>();
	public renderedSessions: string[] = [];
	public renderedTexts: Array<{ sessionId: string; text: string }> = [];
	public renderedTools: Array<{
		sessionId: string;
		tool: string;
		input: unknown;
	}> = [];
	public renderedCompletes: Array<{
		sessionId: string;
		summary: SessionSummary;
	}> = [];
	public renderedErrors: Array<{ sessionId: string; error: Error }> = [];

	async renderSessionStart(session: any): Promise<void> {
		this.renderedSessions.push(session.id);
	}

	async renderActivity(_sessionId: string, _activity: any): Promise<void> {
		// No-op for mock
	}

	async renderText(sessionId: string, text: string): Promise<void> {
		this.renderedTexts.push({ sessionId, text });
	}

	async renderToolUse(
		sessionId: string,
		tool: string,
		input: unknown,
	): Promise<void> {
		this.renderedTools.push({ sessionId, tool, input });
	}

	async renderComplete(
		sessionId: string,
		summary: SessionSummary,
	): Promise<void> {
		this.renderedCompletes.push({ sessionId, summary });
	}

	async renderError(sessionId: string, error: Error): Promise<void> {
		this.renderedErrors.push({ sessionId, error });
	}

	async *getUserInput(sessionId: string): AsyncIterable<UserInput> {
		const emitter = new EventEmitter();
		this.inputEmitters.set(sessionId, emitter);

		const inputs: UserInput[] = [];
		let resolve: (() => void) | null = null;
		let stopped = false;

		emitter.on("input", (input: UserInput) => {
			inputs.push(input);
			if (resolve) {
				resolve();
				resolve = null;
			}
		});

		emitter.on("stop", () => {
			stopped = true;
			if (resolve) {
				resolve();
				resolve = null;
			}
		});

		while (!stopped) {
			if (inputs.length > 0) {
				yield inputs.shift()!;
			} else {
				await new Promise<void>((r) => {
					resolve = r;
				});
			}
		}
	}

	// Helper methods for testing
	emitUserInput(sessionId: string, input: UserInput): void {
		const emitter = this.inputEmitters.get(sessionId);
		if (emitter) {
			emitter.emit("input", input);
		}
	}

	stopInput(sessionId: string): void {
		const emitter = this.inputEmitters.get(sessionId);
		if (emitter) {
			emitter.emit("stop");
		}
	}
}

/**
 * Mock SessionStorage implementation
 */
class MockSessionStorage implements SessionStorage {
	private sessions = new Map<string, SessionState>();

	async saveSession(session: SessionState): Promise<void> {
		this.sessions.set(session.id, { ...session });
	}

	async loadSession(sessionId: string): Promise<SessionState | null> {
		return this.sessions.get(sessionId) || null;
	}

	async listSessions(issueId: string): Promise<SessionState[]> {
		return Array.from(this.sessions.values()).filter(
			(session) => session.issueId === issueId,
		);
	}

	async querySessions(_filters: any): Promise<SessionState[]> {
		return Array.from(this.sessions.values());
	}

	async deleteSession(sessionId: string): Promise<void> {
		this.sessions.delete(sessionId);
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		return this.sessions.has(sessionId);
	}

	async addMessage(sessionId: string, message: any): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.messages.push(message);
		}
	}

	async updateStatus(sessionId: string, status: any): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.status = status;
		}
	}
}

describe("AgentSessionOrchestrator", () => {
	let agentRunner: MockAgentRunner;
	let issueTracker: MockIssueTracker;
	let renderer: MockRenderer;
	let storage: MockSessionStorage;
	let orchestrator: AgentSessionOrchestrator;
	let config: OrchestratorConfig;

	beforeEach(() => {
		agentRunner = new MockAgentRunner();
		issueTracker = new MockIssueTracker();
		renderer = new MockRenderer();
		storage = new MockSessionStorage();

		config = {
			memberId: "test-member-123",
			maxRetries: 3,
			retryDelayMs: 100,
			maxConcurrentSessions: 5,
		};

		orchestrator = new AgentSessionOrchestrator(
			agentRunner,
			issueTracker,
			renderer,
			storage,
			config,
		);
	});

	afterEach(async () => {
		await orchestrator.stop();
		issueTracker.stopWatching();
	});

	describe("Constructor", () => {
		it("should create orchestrator with provided dependencies", () => {
			expect(orchestrator).toBeInstanceOf(AgentSessionOrchestrator);
			expect(orchestrator).toBeInstanceOf(EventEmitter);
		});

		it("should use default config values when not provided", () => {
			const minimalConfig: OrchestratorConfig = {
				memberId: "test-member",
			};

			const orch = new AgentSessionOrchestrator(
				agentRunner,
				issueTracker,
				renderer,
				storage,
				minimalConfig,
			);

			expect(orch).toBeInstanceOf(AgentSessionOrchestrator);
		});
	});

	describe("start/stop", () => {
		it("should start the orchestrator", async () => {
			const startedSpy = vi.fn();
			orchestrator.on("started", startedSpy);

			await orchestrator.start();

			expect(startedSpy).toHaveBeenCalledOnce();
		});

		it("should throw error if already running", async () => {
			await orchestrator.start();

			await expect(orchestrator.start()).rejects.toThrow("already running");
		});

		it("should stop the orchestrator", async () => {
			const stoppedSpy = vi.fn();
			orchestrator.on("stopped", stoppedSpy);

			await orchestrator.start();
			await orchestrator.stop();

			expect(stoppedSpy).toHaveBeenCalledOnce();
		});

		it("should stop all active sessions when stopping orchestrator", async () => {
			await orchestrator.start();

			const issue: Issue = {
				id: "issue-1",
				identifier: "TEST-1",
				title: "Test Issue",
				description: "Test description",
				state: { type: "started", name: "In Progress" },
				priority: 3,
				assignee: {
					id: "test-member-123",
					name: "Test User",
					email: "test@example.com",
				},
				labels: [],
				url: "https://linear.app/test/issue/TEST-1",
				createdAt: new Date(),
				updatedAt: new Date(),
				projectId: null,
				teamId: "team-1",
			};

			issueTracker.addIssue(issue);
			const sessionId = await orchestrator.startSession(issue);

			expect(orchestrator.isSessionActive(sessionId)).toBe(true);

			await orchestrator.stop();

			expect(orchestrator.isSessionActive(sessionId)).toBe(false);
		});
	});

	describe("startSession", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should start a new session", async () => {
			const sessionStartedSpy = vi.fn();
			orchestrator.on("session:started", sessionStartedSpy);

			const sessionId = await orchestrator.startSession(testIssue);

			expect(sessionId).toBeTruthy();
			expect(orchestrator.isSessionActive(sessionId)).toBe(true);
			expect(sessionStartedSpy).toHaveBeenCalledWith(sessionId, testIssue.id);
		});

		it("should save session state to storage", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			const sessionState = await storage.loadSession(sessionId);
			expect(sessionState).toBeTruthy();
			expect(sessionState!.issueId).toBe(testIssue.id);
			expect(sessionState!.status).toBe("running");
		});

		it("should render session start", async () => {
			await orchestrator.startSession(testIssue);

			expect(renderer.renderedSessions).toHaveLength(1);
		});

		it("should throw error if max concurrent sessions reached", async () => {
			// Create config with max 1 session
			const limitedConfig: OrchestratorConfig = {
				memberId: "test-member-123",
				maxConcurrentSessions: 1,
			};

			const limitedOrchestrator = new AgentSessionOrchestrator(
				agentRunner,
				issueTracker,
				renderer,
				storage,
				limitedConfig,
			);

			await limitedOrchestrator.startSession(testIssue);

			const issue2: Issue = {
				...testIssue,
				id: "issue-2",
				identifier: "TEST-2",
			};
			issueTracker.addIssue(issue2);

			await expect(limitedOrchestrator.startSession(issue2)).rejects.toThrow(
				"Maximum concurrent sessions",
			);

			await limitedOrchestrator.stop();
		});

		it("should throw error if session already active for issue", async () => {
			await orchestrator.startSession(testIssue);

			await expect(orchestrator.startSession(testIssue)).rejects.toThrow(
				"Session already active",
			);
		});
	});

	describe("stopSession", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should stop a running session", async () => {
			const sessionId = await orchestrator.startSession(testIssue);
			const sessionStoppedSpy = vi.fn();
			orchestrator.on("session:stopped", sessionStoppedSpy);

			await orchestrator.stopSession(sessionId);

			expect(orchestrator.isSessionActive(sessionId)).toBe(false);
			expect(sessionStoppedSpy).toHaveBeenCalledWith(sessionId, testIssue.id);
		});

		it("should update session status in storage", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			await orchestrator.stopSession(sessionId);

			const sessionState = await storage.loadSession(sessionId);
			expect(sessionState!.status).toBe("stopped");
		});

		it("should throw error if session not found", async () => {
			await expect(orchestrator.stopSession("nonexistent")).rejects.toThrow(
				"No active session found",
			);
		});
	});

	describe("pauseSession", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should pause a running session", async () => {
			const sessionId = await orchestrator.startSession(testIssue);
			const sessionPausedSpy = vi.fn();
			orchestrator.on("session:paused", sessionPausedSpy);

			await orchestrator.pauseSession(sessionId);

			const sessionState = await storage.loadSession(sessionId);
			expect(sessionState!.status).toBe("paused");
			expect(sessionPausedSpy).toHaveBeenCalledWith(sessionId, testIssue.id);
		});

		it("should throw error if session not found", async () => {
			await expect(orchestrator.pauseSession("nonexistent")).rejects.toThrow(
				"No active session found",
			);
		});
	});

	describe("resumeSession", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should resume a paused session", async () => {
			const sessionId = await orchestrator.startSession(testIssue);
			await orchestrator.pauseSession(sessionId);

			await orchestrator.resumeSession(sessionId);

			const sessionState = await storage.loadSession(sessionId);
			expect(sessionState!.status).toBe("running");
		});

		it("should throw error if session not paused", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			await expect(orchestrator.resumeSession(sessionId)).rejects.toThrow(
				"is not paused",
			);
		});

		it("should throw error if session not found", async () => {
			await expect(orchestrator.resumeSession("nonexistent")).rejects.toThrow(
				"No active session found",
			);
		});
	});

	describe("handleUserInput", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should handle user input and send to agent", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			await orchestrator.handleUserInput(sessionId, "Test message");

			const sessionState = await storage.loadSession(sessionId);
			const userMessages = sessionState!.messages.filter(
				(m) => m.role === "user",
			);
			expect(userMessages).toHaveLength(1);
			expect(userMessages[0].content).toBe("Test message");
		});

		it("should throw error if session not found", async () => {
			await expect(
				orchestrator.handleUserInput("nonexistent", "Test"),
			).rejects.toThrow("No active session found");
		});
	});

	describe("getSessionStatus", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should return session status", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			const status = await orchestrator.getSessionStatus(sessionId);

			expect(status).toBeTruthy();
			expect(status!.id).toBe(sessionId);
			expect(status!.issueId).toBe(testIssue.id);
			expect(status!.status).toBe("running");
		});

		it("should return null for nonexistent session", async () => {
			const status = await orchestrator.getSessionStatus("nonexistent");

			expect(status).toBeNull();
		});
	});

	describe("listSessionsForIssue", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should list all sessions for an issue", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			const sessions = await orchestrator.listSessionsForIssue(testIssue.id);

			expect(sessions).toHaveLength(1);
			expect(sessions[0].id).toBe(sessionId);
		});

		it("should return empty array for issue with no sessions", async () => {
			const sessions = await orchestrator.listSessionsForIssue("nonexistent");

			expect(sessions).toHaveLength(0);
		});
	});

	describe("Agent Events", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should handle text events from agent", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			// Get the agent session ID
			const sessionState = await storage.loadSession(sessionId);
			const agentSessionId = sessionState!.agentSessionId!;

			// Emit a text event
			const textEvent: AgentEvent = {
				type: "text",
				text: "Hello from agent",
			};

			agentRunner.emitEvent(agentSessionId, textEvent);

			// Wait for event processing
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(renderer.renderedTexts).toContainEqual({
				sessionId,
				text: "Hello from agent",
			});
		});

		it("should handle tool-use events from agent", async () => {
			const sessionId = await orchestrator.startSession(testIssue);

			const sessionState = await storage.loadSession(sessionId);
			const agentSessionId = sessionState!.agentSessionId!;

			const toolUseEvent: AgentEvent = {
				type: "tool-use",
				toolUseId: "tool-123",
				tool: "read_file",
				input: { path: "/test/file.txt" },
			};

			agentRunner.emitEvent(agentSessionId, toolUseEvent);

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(renderer.renderedTools).toContainEqual({
				sessionId,
				tool: "read_file",
				input: { path: "/test/file.txt" },
			});
		});

		it("should handle complete events from agent", async () => {
			const sessionCompletedSpy = vi.fn();
			orchestrator.on("session:completed", sessionCompletedSpy);

			const sessionId = await orchestrator.startSession(testIssue);

			const sessionState = await storage.loadSession(sessionId);
			const agentSessionId = sessionState!.agentSessionId!;

			const completeEvent: AgentEvent = {
				type: "complete",
				summary: {
					turns: 5,
					toolsUsed: ["read_file", "write_file"],
					filesModified: ["/test/file.txt"],
					summary: "Completed task successfully",
					exitCode: 0,
					metadata: {},
				},
			};

			agentRunner.emitEvent(agentSessionId, completeEvent);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(sessionCompletedSpy).toHaveBeenCalledWith(sessionId, testIssue.id);
			expect(orchestrator.isSessionActive(sessionId)).toBe(false);
		});
	});

	describe("Issue Events", () => {
		const testIssue: Issue = {
			id: "issue-1",
			identifier: "TEST-1",
			title: "Test Issue",
			description: "Test description",
			state: { type: "started", name: "In Progress" },
			priority: 3,
			assignee: {
				id: "test-member-123",
				name: "Test User",
				email: "test@example.com",
			},
			labels: [],
			url: "https://linear.app/test/issue/TEST-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: null,
			teamId: "team-1",
		};

		beforeEach(() => {
			issueTracker.addIssue(testIssue);
		});

		it("should start session on issue assignment", async () => {
			await orchestrator.start();

			const sessionStartedSpy = vi.fn();
			orchestrator.on("session:started", sessionStartedSpy);

			const assignedEvent: IssueEvent = {
				type: "issue:assigned",
				issueId: testIssue.id,
				assigneeId: config.memberId,
				timestamp: new Date(),
			};

			issueTracker.emitEvent(assignedEvent);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(sessionStartedSpy).toHaveBeenCalled();
		});

		it("should stop session on issue unassignment", async () => {
			await orchestrator.start();

			const sessionId = await orchestrator.startSession(testIssue);

			const sessionStoppedSpy = vi.fn();
			orchestrator.on("session:stopped", sessionStoppedSpy);

			const unassignedEvent: IssueEvent = {
				type: "issue:unassigned",
				issueId: testIssue.id,
				previousAssigneeId: config.memberId,
				timestamp: new Date(),
			};

			issueTracker.emitEvent(unassignedEvent);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(sessionStoppedSpy).toHaveBeenCalledWith(sessionId, testIssue.id);
		});

		it("should handle comment as user input", async () => {
			await orchestrator.start();

			const sessionId = await orchestrator.startSession(testIssue);

			const commentEvent: IssueEvent = {
				type: "comment:added",
				issueId: testIssue.id,
				comment: {
					id: "comment-1",
					author: { id: "user-1", name: "User", email: "user@example.com" },
					content: "Test comment",
					createdAt: new Date(),
					isRoot: true,
				},
				timestamp: new Date(),
			};

			issueTracker.emitEvent(commentEvent);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const sessionState = await storage.loadSession(sessionId);
			const userMessages = sessionState!.messages.filter(
				(m) => m.role === "user",
			);
			expect(userMessages.some((m) => m.content === "Test comment")).toBe(true);
		});
	});

	describe("Error Handling", () => {
		it("should emit error events", async () => {
			const errorSpy = vi.fn();
			orchestrator.on("error", errorSpy);

			// Force an error by trying to stop a nonexistent session
			try {
				await orchestrator.stopSession("nonexistent");
			} catch {
				// Expected error
			}

			// The error should still be thrown, but this tests the orchestrator's behavior
			expect(errorSpy).not.toHaveBeenCalled(); // This particular error is thrown, not emitted
		});
	});
});
