import type { RunnerEvent } from "cyrus-agent-runner";
import type { SpyInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

const hoisted = vi.hoisted(() => ({
	linearActivities: [] as Array<{
		agentSessionId: string;
		content: Record<string, any>;
	}>,
	persistenceManagerInstances: [] as Array<{
		loadEdgeWorkerState: SpyInstance;
		saveEdgeWorkerState: SpyInstance;
	}>,
	linearClients: [] as Array<{
		createAgentActivity: SpyInstance;
	}>,
}));

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn(),
}));

vi.mock("cyrus-ndjson-client", () => ({
	NdjsonClient: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn(),
		on: vi.fn(),
		isConnected: vi.fn().mockReturnValue(true),
	})),
}));

vi.mock("@linear/sdk", () => {
	const LinearClient = vi.fn().mockImplementation(() => {
		const instance = {
			createAgentActivity: vi.fn(async (input: any) => {
				hoisted.linearActivities.push(input);
				return { success: true };
			}),
		};
		hoisted.linearClients.push(instance);
		return instance;
	});

	return { LinearClient };
});

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
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(() => {
			const instance = {
				loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
				saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
			};
			hoisted.persistenceManagerInstances.push(instance);
			return instance;
		}),
	};
});

describe("EdgeWorker Codex integration", () => {
	let edgeWorker: EdgeWorker;
	let repository: RepositoryConfig;
	let config: EdgeWorkerConfig;
	let runnerFactoryMock: { create: ReturnType<typeof vi.fn> };
	let fakeRunner: {
		start: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
	};

	const sessionId = "linear-session-9001";
	const issueIdentifier = "TEST-9001";
	const workspacePath = "/tmp/workspaces/repo-1/TEST-9001";
	const promptBody = "Summarize repository status";

	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.linearActivities.length = 0;
		hoisted.persistenceManagerInstances.length = 0;
		hoisted.linearClients.length = 0;

		repository = {
			id: "repo-1",
			name: "Repository One",
			repositoryPath: "/tmp/repos/repo-1",
			workspaceBaseDir: "/tmp/workspaces/repo-1",
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			linearToken: "linear-token",
			isActive: true,
			allowedTools: ["Read(**)", "Edit(**)"],
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
		vi.spyOn(edgeWorker as any, "debugLog").mockImplementation(() => {});

		const runnerEvents: RunnerEvent[] = [
			{ kind: "thought", text: "collecting repository context" },
			{
				kind: "action",
				name: "bash -lc ls",
				detail: JSON.stringify(
					{
						command: "ls",
						stdout: "apps\nREADME.md\n",
					},
					undefined,
					2,
				),
			},
			{ kind: "final", text: "Codex run completed successfully" },
		];

		fakeRunner = {
			start: vi.fn(async (onEvent: (event: RunnerEvent) => void) => {
				for (const event of runnerEvents) {
					onEvent(event);
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
		(edgeWorker as any).sessionRunnerSelections.set(sessionId, {
			type: "codex",
			model: "o4-mini",
			issueId: "issue-123",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("streams Codex events through EdgeWorker and persists state", async () => {
		await (edgeWorker as any).startNonClaudeRunner({
			selection: { type: "codex", model: "o4-mini" },
			repository,
			prompt: promptBody,
			workspacePath,
			linearAgentActivitySessionId: sessionId,
			issueIdentifier,
			isFollowUp: false,
		});

		await vi.waitFor(() => {
			expect(fakeRunner.start).toHaveBeenCalledTimes(1);
			expect(hoisted.linearActivities.length).toBeGreaterThanOrEqual(3);
		});

		expect(runnerFactoryMock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "codex",
				cwd: workspacePath,
				prompt: promptBody,
				approvalPolicy: "never",
				sandbox: "workspace-write",
				fullAuto: false,
			}),
		);

		expect(
			hoisted.linearActivities.map((activity) => activity.content.type),
		).toEqual(["thought", "action", "response"]);

		const thoughtActivity = hoisted.linearActivities[0];
		expect(thoughtActivity.content.body).toBe("collecting repository context");

		const actionActivity = hoisted.linearActivities[1];
		expect(actionActivity.content.action).toBe("🛠️ bash -lc ls");
		expect(actionActivity.content.parameter).toContain('"command": "ls"');

		const responseActivity = hoisted.linearActivities[2];
		expect(responseActivity.content.body).toBe(
			"Codex run completed successfully",
		);

		expect((edgeWorker as any).finalizedNonClaudeSessions.has(sessionId)).toBe(
			true,
		);
		expect((edgeWorker as any).nonClaudeRunners.has(sessionId)).toBe(false);

		const persistence = hoisted.persistenceManagerInstances[0];
		expect(persistence).toBeDefined();
		expect(persistence.saveEdgeWorkerState).toHaveBeenCalled();

		const lastSavedState =
			persistence.saveEdgeWorkerState.mock.calls.at(-1)?.[0];
		expect(lastSavedState?.finalizedNonClaudeSessions).toContain(sessionId);
		expect(lastSavedState?.sessionRunnerSelections?.[sessionId]?.type).toBe(
			"codex",
		);
	});
});
