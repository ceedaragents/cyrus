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
			text: ["___LAST_MESSAGE_MARKER___final response", "item_2"],
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
			allowedTools: ["Read"],
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
					sandbox: "workspace-write",
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

		(edgeWorker as any).sessionRunnerSelections.set(sessionId, {
			issueId: "issue-123",
			type: "codex",
			model: "o4-mini",
		});

		fakeRunner = {
			start: vi.fn(async (onEvent: (event: any) => void) => {
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
		vi.restoreAllMocks();
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

		// Allow any queued promise callbacks to settle
		await Promise.resolve();
		await Promise.resolve();

		expect(runnerFactoryMock.create).toHaveBeenCalledTimes(1);
		expect(runnerFactoryMock.create.mock.calls[0]?.[0]).toMatchObject({
			type: "codex",
			prompt: promptBody,
			cwd: workspacePath,
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

		expect(savePersistedStateSpy).toHaveBeenCalledTimes(2);

		const persistence = persistenceManagerInstances[0];
		expect(persistence).toBeDefined();
		const savedStates = persistence.saveEdgeWorkerState.mock.calls;
		expect(savedStates.length).toBeGreaterThanOrEqual(2);
		const latestState = savedStates.at(-1)?.[0];
		expect(latestState?.finalizedNonClaudeSessions).toContain(sessionId);
		expect(latestState?.sessionRunnerSelections?.[sessionId]?.type).toBe(
			"codex",
		);
		const missingClientLog = debugLogSpy.mock.calls.find(
			([message]) =>
				typeof message === "string" &&
				message.includes("[postThought] No Linear client"),
		);
		expect(missingClientLog).toBeUndefined();
	});
});
