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
		process.env.LINEAR_DIRECT_WEBHOOKS = "true";

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
		delete process.env.LINEAR_DIRECT_WEBHOOKS;
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

	it("terminates codex runner and clears state on stop signal", async () => {
		const agentSessionManager = {
			getSession: vi.fn().mockReturnValue({
				claudeRunner: {
					isStreaming: vi.fn().mockReturnValue(false),
					stop: vi.fn(),
				},
				workspace: { path: workspacePath },
				issueId: "issue-123",
			}),
			createResponseActivity: vi.fn().mockResolvedValue(undefined),
			serializeState: vi.fn(),
		};
		(edgeWorker as any).agentSessionManagers.set(
			repository.id,
			agentSessionManager,
		);

		const codexRunner = {
			stop: vi.fn().mockResolvedValue(undefined),
		} as unknown as ReturnType<typeof runnerFactoryMock.create>;
		(edgeWorker as any).nonClaudeRunners.set(sessionId, codexRunner);
		(edgeWorker as any).sessionRunnerSelections.set(sessionId, {
			type: "codex",
			issueId: "issue-123",
		});
		(edgeWorker as any).codexSessionCache.set(sessionId, "codex-run-123");

		const webhook = {
			type: "AgentSessionEvent",
			action: "prompted",
			createdAt: new Date().toISOString(),
			organizationId: "org-1",
			oauthClientId: "oauth-1",
			appUserId: "user-1",
			agentSession: {
				id: sessionId,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				archivedAt: null,
				creatorId: "creator-1",
				appUserId: "user-1",
				commentId: "comment-1",
				issueId: "issue-123",
				status: "active",
				startedAt: new Date().toISOString(),
				endedAt: null,
				type: "commentThread",
				summary: null,
				sourceMetadata: null,
				organizationId: "org-1",
				creator: { id: "creator-1", name: "User", email: "user@example.com" },
				comment: { id: "comment-1", body: "body", url: "http://example.com" },
				issue: {
					id: "issue-123",
					identifier: issueIdentifier,
					title: "Fix navigation",
					branchName: null,
				},
			},
			agentActivity: {
				id: "activity-1",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				archivedAt: null,
				agentContextId: null,
				agentSessionId: sessionId,
				sourceCommentId: "comment-1",
				content: { type: "prompt", body: "Stop please" },
				signal: "stop",
			},
			webhookTimestamp: new Date().toISOString(),
			webhookId: "webhook-1",
		} as any;

		await (edgeWorker as any).handleUserPostedAgentActivity(
			webhook,
			repository,
		);

		expect(codexRunner.stop).toHaveBeenCalledTimes(1);
		expect(agentSessionManager.createResponseActivity).toHaveBeenCalledWith(
			sessionId,
			expect.stringContaining("I've stopped working"),
		);
		expect((edgeWorker as any).sessionRunnerSelections.has(sessionId)).toBe(
			false,
		);
		expect((edgeWorker as any).codexSessionCache.has(sessionId)).toBe(false);
		expect((edgeWorker as any).finalizedNonClaudeSessions.has(sessionId)).toBe(
			true,
		);
	});
});
