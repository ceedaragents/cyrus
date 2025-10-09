import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

const {
	persistenceManagerInstances,
	agentSessionManagerInstances,
}: {
	persistenceManagerInstances: any[];
	agentSessionManagerInstances: any[];
} = vi.hoisted(() => ({
	persistenceManagerInstances: [] as any[],
	agentSessionManagerInstances: [] as any[],
}));

vi.mock("fs/promises");
vi.mock("cyrus-claude-runner");
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
		createAgentActivity: vi.fn().mockResolvedValue({ success: true }),
		client: {
			rawRequest: vi.fn().mockResolvedValue({ data: {} }),
		},
	})),
}));
vi.mock("cyrus-agent-runner", () => ({
	DefaultRunnerFactory: vi.fn().mockImplementation(() => ({
		create: vi.fn(),
	})),
}));
vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn().mockImplementation(() => ({
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		registerOAuthCallbackHandler: vi.fn(),
	})),
}));
vi.mock("../src/AgentSessionManager.js", () => ({
	AgentSessionManager: vi.fn().mockImplementation(() => {
		const instance = {
			serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
			restoreState: vi.fn(),
			getSession: vi.fn(),
			getSessionsByIssueId: vi.fn().mockReturnValue([]),
			createResponseActivity: vi.fn().mockResolvedValue(undefined),
		};
		agentSessionManagerInstances.push(instance);
		return instance;
	}),
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

const createDeferred = <T = void>() => {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe("EdgeWorker persistence", () => {
	let repository: RepositoryConfig;
	let config: EdgeWorkerConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		persistenceManagerInstances.length = 0;
		agentSessionManagerInstances.length = 0;

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
			proxyUrl: "http://localhost:3456",
			cyrusHome: "/tmp/cyrus-home",
			repositories: [repository],
		};
	});

	it("serializes and restores non-Claude state across restarts", () => {
		const edgeWorker = new EdgeWorker(config);
		const manager = agentSessionManagerInstances[0];
		const sessionId = "linear-session-123";

		const serializedSessions = {
			[sessionId]: {
				linearAgentActivitySessionId: sessionId,
				type: "commentThread",
				status: "active",
				context: "commentThread",
				createdAt: 1700000000000,
				updatedAt: 1700000005000,
				issueId: "issue-1",
				issue: {
					id: "issue-1",
					identifier: "TEST-1",
					title: "Persistence regression",
					branchName: "feature/persist",
				},
				workspace: {
					path: "/tmp/workspaces/repo-1/TEST-1",
					isGitWorktree: true,
				},
				metadata: { model: "o4-mini" },
			},
		};
		const serializedEntries = {
			[sessionId]: [
				{
					claudeSessionId: "codex-session",
					type: "assistant",
					content: "❌ Something went wrong",
					metadata: {
						timestamp: 1700000006000,
						isError: true,
						isTerminalError: false,
						resultSubtype: "error_during_execution",
					},
				},
			],
		};

		manager.serializeState.mockReturnValueOnce({
			sessions: serializedSessions,
			entries: serializedEntries,
		});

		(edgeWorker as any).childToParentAgentSession.set("child-1", sessionId);
		(edgeWorker as any).sessionRunnerSelections.set(sessionId, {
			type: "codex",
			model: "o4-mini",
			issueId: "issue-1",
			resumeSessionId: "resume-123",
			promptType: "builder",
			codexPermissions: {
				profile: "safe",
				sandbox: "danger-full-access",
				approvalPolicy: "never",
				fullAuto: false,
			},
		});
		(edgeWorker as any).codexSessionCache.set(sessionId, "codex-run-123");
		(edgeWorker as any).finalizedNonClaudeSessions.add(sessionId);
		(edgeWorker as any).stopRequestedSessions.add("session-stopped");

		const persistedState = edgeWorker.serializeMappings();

		expect(persistedState.agentSessions?.[repository.id]?.[sessionId]).toEqual(
			serializedSessions[sessionId],
		);
		expect(
			persistedState.agentSessionEntries?.[repository.id]?.[sessionId]?.[0]
				?.metadata,
		).toEqual(serializedEntries[sessionId][0].metadata);
		expect(persistedState.sessionRunnerSelections?.[sessionId]).toEqual(
			expect.objectContaining({
				type: "codex",
				resumeSessionId: "resume-123",
			}),
		);
		expect(persistedState.stopRequestedSessions).toContain("session-stopped");
		expect(persistedState.finalizedNonClaudeSessions).toContain(sessionId);
		expect(persistedState.codexSessionCache).toEqual(
			expect.objectContaining({ [sessionId]: "codex-run-123" }),
		);

		const restoredWorker = new EdgeWorker(config);
		const restoredManager = agentSessionManagerInstances[1];

		restoredWorker.restoreMappings(persistedState);

		expect(restoredManager.restoreState).toHaveBeenCalledWith(
			serializedSessions,
			serializedEntries,
		);
		expect(
			(restoredWorker as any).sessionRunnerSelections.get(sessionId),
		).toEqual(
			expect.objectContaining({
				type: "codex",
				issueId: "issue-1",
				resumeSessionId: "resume-123",
			}),
		);
		expect((restoredWorker as any).codexSessionCache.get(sessionId)).toBe(
			"codex-run-123",
		);
		expect(
			(restoredWorker as any).finalizedNonClaudeSessions.has(sessionId),
		).toBe(true);
		expect(
			(restoredWorker as any).stopRequestedSessions.has("session-stopped"),
		).toBe(true);
		expect(
			Array.from((restoredWorker as any).childToParentAgentSession.entries()),
		).toContainEqual(["child-1", sessionId]);
	});

	it("drains codex activity queue when runner stops cleanly", async () => {
		const edgeWorker = new EdgeWorker(config);
		const runner = {
			stop: vi.fn().mockResolvedValue(undefined),
		};
		const deferred = createDeferred<void>();

		(edgeWorker as any).codexActivityQueue.set(
			"session-queued",
			deferred.promise,
		);

		const stopPromise = (edgeWorker as any).safeStopRunner(
			"session-queued",
			runner,
		);

		expect((edgeWorker as any).codexActivityQueue.has("session-queued")).toBe(
			true,
		);

		deferred.resolve();
		await stopPromise;

		expect((edgeWorker as any).codexActivityQueue.has("session-queued")).toBe(
			false,
		);
		expect(runner.stop).toHaveBeenCalledTimes(1);
	});

	it("clears hanging codex queue promises after timeout", async () => {
		vi.useFakeTimers();
		try {
			const edgeWorker = new EdgeWorker(config);
			(edgeWorker as any).codexQueueDrainTimeoutMs = 5;

			const runner = {
				stop: vi.fn().mockResolvedValue(undefined),
			};

			const neverSettles = new Promise<void>(() => {
				// Intentionally left unresolved to simulate a hanging task
			});

			(edgeWorker as any).codexActivityQueue.set(
				"session-timeout",
				neverSettles,
			);

			const stopPromise = (edgeWorker as any).safeStopRunner(
				"session-timeout",
				runner,
			);

			await vi.advanceTimersByTimeAsync(10);
			await stopPromise;

			expect(
				(edgeWorker as any).codexActivityQueue.has("session-timeout"),
			).toBe(false);
			expect(runner.stop).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
