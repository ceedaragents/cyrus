import type { SpyInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

const { persistenceManagerInstances } = vi.hoisted(() => ({
	persistenceManagerInstances: [] as Array<{
		loadEdgeWorkerState: ReturnType<typeof vi.fn>;
		saveEdgeWorkerState: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("fs/promises");
vi.mock("cyrus-ndjson-client", () => ({
	NdjsonClient: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn(),
		on: vi.fn(),
		isConnected: vi.fn().mockReturnValue(true),
	})),
}));
vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		users: {
			me: vi.fn().mockResolvedValue({ id: "user-1", name: "Test User" }),
		},
	})),
}));
vi.mock("cyrus-claude-runner");
vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn().mockImplementation(() => ({
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		registerOAuthCallbackHandler: vi.fn(),
	})),
}));
vi.mock("../src/AgentSessionManager.js", () => ({
	AgentSessionManager: vi.fn().mockImplementation(() => ({
		serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
	})),
}));
vi.mock("cyrus-linear-webhook-client", () => ({
	LinearWebhookClient: vi.fn().mockImplementation(() => ({
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
	})),
}));
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(() => {
			const instance = {
				loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
				saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
			};
			persistenceManagerInstances.push(instance);
			return instance;
		}),
	};
});

const flushAsync = async (): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
};

const codexJsonFixture = [
	{
		type: "item.completed",
		item: {
			id: "item_0",
			item_type: "reasoning",
			text: "  initial analysis  ",
		},
	},
	{
		type: "item.completed",
		item: {
			id: "item_1",
			item_type: "command_execution",
			command: "bash -lc ls",
			aggregated_output: "apps\\nREADME.md\\n",
		},
	},
	{
		type: "item.completed",
		item: {
			id: "item_2",
			item_type: "assistant_message",
			text: ["final response", "item_2"],
		},
	},
];

describe("EdgeWorker Codex regression", () => {
	let edgeWorker: EdgeWorker;
	let repository: RepositoryConfig;
	let config: EdgeWorkerConfig;
	let savePersistedStateSpy: SpyInstance;
	let debugLogSpy: SpyInstance;
	let runnerFactoryMock: { create: ReturnType<typeof vi.fn> };
	let fakeRunner: {
		start: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
	};
	let postThoughtMock: ReturnType<typeof vi.fn>;
	let postActionMock: ReturnType<typeof vi.fn>;
	let postResponseMock: ReturnType<typeof vi.fn>;
	let markSessionCompleteMock: ReturnType<typeof vi.fn>;
	let postErrorMock: ReturnType<typeof vi.fn>;

	const sessionId = "linear-session-001";
	const issueIdentifier = "TEST-42";
	const workspacePath = "/tmp/workspaces/repo-1/TEST-42";
	const promptBody = "Summarize the repository status";
	const normalizedEvents = [
		{ kind: "thought", text: codexJsonFixture[0].item.text.trim() },
		{
			kind: "action",
			name: codexJsonFixture[1].item.command,
			detail: JSON.stringify(
				{
					command: codexJsonFixture[1].item.command,
					stdout: codexJsonFixture[1].item.aggregated_output,
				},
				undefined,
				2,
			),
		},
		{ kind: "final", text: "final response" },
	] as const;

	beforeEach(() => {
		vi.clearAllMocks();
		persistenceManagerInstances.length = 0;

		repository = {
			id: "repo-1",
			name: "Repository One",
			repositoryPath: "/tmp/repos/repo-1",
			workspaceBaseDir: "/tmp/workspaces/repo-1",
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			linearToken: "linear-token",
			isActive: true,
			allowedTools: ["Read(**)", "Edit(**)", "Bash(git:*)"],
			labelPrompts: {},
		};

		config = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: "/tmp/cyrus-home",
			repositories: [repository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: workspacePath,
					isGitWorktree: false,
				}),
			},
			cliDefaults: {
				codex: {
					approvalPolicy: "on-request",
					sandbox: "danger-full-access",
				},
			},
		};

		edgeWorker = new EdgeWorker(config);
		expect(typeof (edgeWorker as any).postThought).toBe("function");

		// Reduce noise from debug logs while capturing messages
		debugLogSpy = vi
			.spyOn(edgeWorker as any, "debugLog")
			.mockImplementation(() => {});
		savePersistedStateSpy = vi.spyOn(edgeWorker as any, "savePersistedState");
		postThoughtMock = vi.fn().mockResolvedValue(undefined);
		postActionMock = vi.fn().mockResolvedValue(undefined);
		postResponseMock = vi.fn().mockResolvedValue(undefined);
		markSessionCompleteMock = vi.fn().mockResolvedValue(undefined);
		(edgeWorker as any).postThought = postThoughtMock;
		(edgeWorker as any).postAction = postActionMock;
		(edgeWorker as any).postResponse = postResponseMock;
		(edgeWorker as any).markSessionComplete = markSessionCompleteMock;
		postErrorMock = vi.fn().mockResolvedValue(undefined);
		(edgeWorker as any).postError = postErrorMock;

		(edgeWorker as any).sessionRunnerSelections.set(sessionId, {
			issueId: "issue-123",
			type: "codex",
			model: "o4-mini",
		});

		fakeRunner = {
			start: vi.fn(async (onEvent: (event: any) => void) => {
				onEvent({ kind: "session", id: "codex-run-123" });
				for (const event of normalizedEvents) {
					process.stdout.write(`emitting:${JSON.stringify(event)}\n`);
					onEvent(event as any);
				}
				return {
					sessionId: "codex-run-123",
					capabilities: { jsonStream: true },
				};
			}),
			stop: vi.fn().mockResolvedValue(undefined),
		};

		runnerFactoryMock = {
			create: vi.fn(() => fakeRunner),
		};

		(edgeWorker as any).runnerFactory = runnerFactoryMock;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("streams codex events, posts Linear entries, and persists session state", async () => {
		await (edgeWorker as any).startNonClaudeRunner({
			selection: { type: "codex", model: "o4-mini" },
			repository,
			prompt: promptBody,
			workspacePath,
			linearAgentActivitySessionId: sessionId,
			issueIdentifier,
			isFollowUp: false,
		});

		await flushAsync();

		// Allow any queued promise callbacks to settle
		await Promise.resolve();
		await Promise.resolve();

		expect(runnerFactoryMock.create).toHaveBeenCalledTimes(1);
		const firstRunnerConfig = runnerFactoryMock.create.mock.calls[0]?.[0];
		expect(firstRunnerConfig).toMatchObject({
			type: "codex",
			prompt: promptBody,
			cwd: workspacePath,
			approvalPolicy: "never",
			sandbox: "danger-full-access",
			fullAuto: false,
		});
		expect(fakeRunner.start).toHaveBeenCalledTimes(1);
		const debugMessages = debugLogSpy.mock.calls.map((call) => call[0]);
		process.stdout.write(`debugMessages: ${JSON.stringify(debugMessages)}\n`);
		process.stdout.write(
			`saveCalls: ${savePersistedStateSpy.mock.calls.length}\n`,
		);
		expect(
			debugMessages.some(
				(message) =>
					typeof message === "string" &&
					message.includes("[startNonClaudeRunner] Starting codex runner"),
			),
		).toBe(true);

		expect(postThoughtMock).toHaveBeenCalledWith(
			sessionId,
			repository.id,
			normalizedEvents[0].text,
		);
		expect(postActionMock).toHaveBeenCalledWith(
			sessionId,
			repository.id,
			`🛠️ ${normalizedEvents[1].name}`,
			normalizedEvents[1].detail,
		);
		expect(postResponseMock).toHaveBeenCalledWith(
			sessionId,
			repository.id,
			normalizedEvents[2].text,
		);
		expect(markSessionCompleteMock).toHaveBeenCalledWith(
			sessionId,
			repository.id,
		);

		expect((edgeWorker as any).finalizedNonClaudeSessions.has(sessionId)).toBe(
			true,
		);
		expect((edgeWorker as any).nonClaudeRunners.has(sessionId)).toBe(false);

		expect(savePersistedStateSpy).toHaveBeenCalledTimes(3);

		const persistence = persistenceManagerInstances[0];
		expect(persistence).toBeDefined();
		const savedStates = persistence.saveEdgeWorkerState.mock.calls;
		expect(savedStates.length).toBeGreaterThanOrEqual(2);
		const latestState = savedStates.at(-1)?.[0];
		expect(latestState?.finalizedNonClaudeSessions).toContain(sessionId);
		expect(latestState?.sessionRunnerSelections?.[sessionId]?.type).toBe(
			"codex",
		);
		expect(
			latestState?.sessionRunnerSelections?.[sessionId]?.codexPermissions,
		).toEqual(
			expect.objectContaining({
				profile: "safe",
				sandbox: "danger-full-access",
				approvalPolicy: "never",
				fullAuto: false,
			}),
		);
		const missingClientLog = debugLogSpy.mock.calls.find(
			([message]) =>
				typeof message === "string" &&
				message.includes("[postThought] No Linear client"),
		);
		expect(missingClientLog).toBeUndefined();
	});

	it("persists codex session cache across restart for follow-up", async () => {
		runnerFactoryMock.create.mockReset();
		runnerFactoryMock.create.mockReturnValue(fakeRunner);

		await (edgeWorker as any).startNonClaudeRunner({
			selection: { type: "codex", model: "o4-mini" },
			repository,
			prompt: promptBody,
			workspacePath,
			linearAgentActivitySessionId: sessionId,
			issueIdentifier,
			isFollowUp: false,
		});

		expect((edgeWorker as any).codexSessionCache.get(sessionId)).toBe(
			"codex-run-123",
		);
		process.stdout.write(
			`selectionMeta after first run: ${JSON.stringify(
				(edgeWorker as any).sessionRunnerSelections.get(sessionId),
			)}\n`,
		);
		expect(
			(edgeWorker as any).sessionRunnerSelections.get(sessionId)
				?.resumeSessionId,
		).toBe("codex-run-123");

		const persistedState = (edgeWorker as any).serializeMappings();
		expect(persistedState.codexSessionCache).toEqual(
			expect.objectContaining({ [sessionId]: "codex-run-123" }),
		);
		expect(
			persistedState.sessionRunnerSelections?.[sessionId]?.resumeSessionId,
		).toBe("codex-run-123");
		expect(
			persistedState.sessionRunnerSelections?.[sessionId]?.codexPermissions,
		).toEqual(
			expect.objectContaining({
				profile: "safe",
				sandbox: "danger-full-access",
				approvalPolicy: "never",
				fullAuto: false,
			}),
		);

		const restoredWorker = new EdgeWorker(config);
		const followUpRunner = {
			start: vi.fn(async () => ({
				sessionId: "codex-run-456",
				capabilities: { jsonStream: true },
			})),
			stop: vi.fn().mockResolvedValue(undefined),
		};
		const followUpRunnerFactory = {
			create: vi.fn(() => followUpRunner),
		};
		(restoredWorker as any).runnerFactory = followUpRunnerFactory;
		(restoredWorker as any).postThought = vi.fn().mockResolvedValue(undefined);
		(restoredWorker as any).postAction = vi.fn().mockResolvedValue(undefined);
		(restoredWorker as any).postResponse = vi.fn().mockResolvedValue(undefined);
		(restoredWorker as any).postError = vi.fn().mockResolvedValue(undefined);
		(restoredWorker as any).savePersistedState = vi
			.fn()
			.mockResolvedValue(undefined);

		restoredWorker.restoreMappings(persistedState);

		expect((restoredWorker as any).codexSessionCache.get(sessionId)).toBe(
			"codex-run-123",
		);
		expect(
			(restoredWorker as any).sessionRunnerSelections.get(sessionId)
				?.resumeSessionId,
		).toBe("codex-run-123");

		await (restoredWorker as any).startNonClaudeRunner({
			selection: { type: "codex", model: "o4-mini" },
			repository,
			prompt: `${promptBody} follow-up`,
			workspacePath,
			linearAgentActivitySessionId: sessionId,
			issueIdentifier,
			isFollowUp: true,
		});

		await flushAsync();

		expect(followUpRunnerFactory.create).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "codex",
				resumeSessionId: "codex-run-123",
				prompt: `${promptBody} follow-up`,
				approvalPolicy: "never",
				sandbox: "danger-full-access",
				fullAuto: false,
			}),
		);
	});

	it("suppresses error when codex runner stops intentionally and preserves resume id", async () => {
		// Prepare runner that captures onEvent handler
		let capturedOnEvent: ((e: any) => void) | undefined;
		fakeRunner = {
			start: vi.fn(async (onEvent: (event: any) => void) => {
				capturedOnEvent = onEvent;
				// Simulate session id being reported by Codex
				onEvent({ kind: "session", id: "codex-run-abc" });
				return {
					sessionId: "codex-run-abc",
					capabilities: { jsonStream: true },
				};
			}),
			stop: vi.fn().mockResolvedValue(undefined),
		};
		runnerFactoryMock.create.mockReset();
		runnerFactoryMock.create.mockReturnValue(fakeRunner);

		// Start initial non-Claude runner
		await (edgeWorker as any).startNonClaudeRunner({
			selection: { type: "codex", model: "o4-mini" },
			repository,
			prompt: promptBody,
			workspacePath,
			linearAgentActivitySessionId: sessionId,
			issueIdentifier,
			isFollowUp: false,
		});
		expect((edgeWorker as any).codexSessionCache.get(sessionId)).toBe(
			"codex-run-abc",
		);

		// Issue a stop signal via webhook path
		const agentSessionManager = {
			getSession: vi.fn().mockReturnValue({
				workspace: { path: workspacePath },
				issueId: "issue-123",
			}),
			createResponseActivity: vi.fn().mockResolvedValue(undefined),
			serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
		};
		(edgeWorker as any).agentSessionManagers.set(
			repository.id,
			agentSessionManager,
		);
		const stopWebhook = {
			type: "AgentSessionEvent",
			action: "prompted",
			agentSession: {
				id: sessionId,
				issue: { id: "issue-123", identifier: issueIdentifier, title: "X" },
				creator: { name: "User" },
			},
			agentActivity: {
				id: "activity-1",
				signal: "stop",
				content: { type: "prompt", body: "Stop" },
				sourceCommentId: "comment-1",
			},
		} as any;

		await (edgeWorker as any).handleUserPostedAgentActivity(
			stopWebhook,
			repository,
		);

		// Simulate adapter reporting an error after stop
		capturedOnEvent?.({
			kind: "error",
			error: new Error("Codex exited without delivering a final response"),
		});

		await flushAsync();
		expect(postErrorMock).not.toHaveBeenCalled();
		// Resume id must be preserved
		expect((edgeWorker as any).codexSessionCache.get(sessionId)).toBe(
			"codex-run-abc",
		);

		// Start follow-up and ensure resume id is wired through
		const followUpRunner = {
			start: vi.fn(async () => ({
				sessionId: "codex-run-def",
				capabilities: { jsonStream: true },
			})),
			stop: vi.fn().mockResolvedValue(undefined),
		};
		runnerFactoryMock.create.mockReset();
		runnerFactoryMock.create.mockReturnValue(followUpRunner as any);
		await (edgeWorker as any).startNonClaudeRunner({
			selection: { type: "codex", model: "o4-mini" },
			repository,
			prompt: `${promptBody} follow-up`,
			workspacePath,
			linearAgentActivitySessionId: sessionId,
			issueIdentifier,
			isFollowUp: true,
		});
		const createdConfig = runnerFactoryMock.create.mock.calls[0]?.[0];
		expect(createdConfig?.resumeSessionId).toBe("codex-run-abc");
	});
});
