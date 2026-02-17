import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CyrusAgentSession,
	EdgeWorkerConfig,
	IssueMinimal,
	Workspace,
} from "cyrus-core";
import type { SlackWebhookEvent } from "cyrus-slack-event-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

const mockClaudeRunnerFactory = vi.fn();

vi.mock(
	"cyrus-claude-runner",
	() => {
		return {
			ClaudeRunner: vi
				.fn()
				.mockImplementation((config: unknown) =>
					mockClaudeRunnerFactory(config),
				),
			createCyrusToolsServer: vi.fn(),
			createImageToolsServer: vi.fn(),
			createSoraToolsServer: vi.fn(),
			getAllTools: vi.fn(() => []),
			getCoordinatorTools: vi.fn(() => []),
			getReadOnlyTools: vi.fn(() => []),
			getSafeTools: vi.fn(() => []),
		};
	},
	{ virtual: true },
);

vi.mock(
	"cyrus-gemini-runner",
	() => ({
		GeminiRunner: vi.fn(),
		SimpleGeminiRunner: vi.fn(),
	}),
	{ virtual: true },
);

vi.mock(
	"cyrus-simple-agent-runner",
	() => ({
		SimpleClaudeRunner: vi.fn(),
	}),
	{ virtual: true },
);

vi.mock(
	"cyrus-slack-event-transport",
	() => ({
		SlackEventTransport: vi.fn().mockImplementation(() => ({
			on: vi.fn(),
			register: vi.fn(),
		})),
		SlackMessageService: vi.fn(),
		SlackReactionService: vi.fn(),
		stripMention: (text: string) =>
			text.replace(/^\s*<@[A-Z0-9]+>\s*/, "").trim(),
	}),
	{ virtual: true },
);

interface MockSlackSessionManager {
	createLinearAgentSession: ReturnType<typeof vi.fn>;
	getSession: ReturnType<typeof vi.fn>;
	addAgentRunner: ReturnType<typeof vi.fn>;
}

function createSlackEvent(
	overrides?: Partial<SlackWebhookEvent>,
): SlackWebhookEvent {
	return {
		eventType: "app_mention",
		eventId: "Ev-1",
		teamId: "T1",
		slackBotToken: "xoxb-test",
		payload: {
			type: "app_mention",
			user: "U123",
			text: "<@U0BOT1234> Please draft a release plan",
			ts: "1704110400.000100",
			channel: "C123",
			event_ts: "1704110400.000100",
		},
		...overrides,
	};
}

describe("EdgeWorker Slack thread sessions", () => {
	let edgeWorker: EdgeWorker;
	let workspaceBaseDir: string;
	let cyrusHome: string;
	let repositoryPath: string;
	let sessions: Map<string, Partial<CyrusAgentSession>>;
	let manager: MockSlackSessionManager;
	let buildRunnerConfigSpy: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		workspaceBaseDir = await mkdtemp(join(tmpdir(), "cyrus-slack-workspace-"));
		cyrusHome = await mkdtemp(join(tmpdir(), "cyrus-slack-home-"));
		repositoryPath = "/tmp/not-used-repo";

		const config: EdgeWorkerConfig = {
			cyrusHome,
			repositories: [
				{
					id: "repo-1",
					name: "Repo 1",
					repositoryPath,
					workspaceBaseDir,
					baseBranch: "main",
					linearToken: "linear-token",
					linearWorkspaceId: "workspace-1",
					isActive: true,
				},
			],
			platform: "cli",
			agentHandle: "cyrus",
			agentUserId: "agent-1",
		};

		edgeWorker = new EdgeWorker(config);
		sessions = new Map<string, Partial<CyrusAgentSession>>();

		manager = {
			createLinearAgentSession: vi.fn(
				(
					sessionId: string,
					issueId: string,
					issue: IssueMinimal,
					workspace: Workspace,
				) => {
					sessions.set(sessionId, {
						id: sessionId,
						issueId,
						issue,
						workspace,
						metadata: {},
					});
				},
			),
			getSession: vi.fn((sessionId: string) => sessions.get(sessionId)),
			addAgentRunner: vi.fn((sessionId: string, runner: unknown) => {
				const session = sessions.get(sessionId);
				if (session) {
					session.agentRunner = runner as CyrusAgentSession["agentRunner"];
				}
			}),
		};

		(edgeWorker as any).agentSessionManagers = new Map([
			["__slack__", manager],
		]);
		(edgeWorker as any).savePersistedState = vi
			.fn()
			.mockResolvedValue(undefined);
		(edgeWorker as any).postSlackReply = vi.fn().mockResolvedValue(undefined);

		buildRunnerConfigSpy = vi
			.fn()
			.mockReturnValue({ allowedDirectories: [], cyrusHome });
		(edgeWorker as any).buildSlackRunnerConfig = buildRunnerConfigSpy;
	});

	afterEach(async () => {
		await rm(workspaceBaseDir, { recursive: true, force: true });
		await rm(cyrusHome, { recursive: true, force: true });
	});

	it("creates a new Slack session in an empty non-git thread workspace", async () => {
		const runner = {
			start: vi.fn().mockResolvedValue({ sessionId: "runner-1" }),
		};
		mockClaudeRunnerFactory.mockReturnValue(runner);

		const event = createSlackEvent();
		await (edgeWorker as any).handleSlackWebhook(event);

		expect(manager.createLinearAgentSession).toHaveBeenCalledTimes(1);
		expect(buildRunnerConfigSpy).toHaveBeenCalledTimes(1);

		const createdSession = Array.from(sessions.values())[0];
		expect(createdSession).toBeDefined();
		expect(createdSession!.workspace?.isGitWorktree).toBe(false);

		const workspacePath = createdSession!.workspace!.path;
		expect(workspacePath).toContain("/slack-workspaces/thread-");

		const workspaceExists = await access(workspacePath)
			.then(() => true)
			.catch(() => false);
		expect(workspaceExists).toBe(true);

		const allowedDirectories = buildRunnerConfigSpy.mock
			.calls[0]?.[3] as string[];
		expect(allowedDirectories).toEqual([workspacePath]);
		expect(allowedDirectories).not.toContain(repositoryPath);
		expect(runner.start).toHaveBeenCalledWith("Please draft a release plan");
	});

	it("adds follow-up mentions to the active streaming runner for the same thread", async () => {
		const event = createSlackEvent();
		const threadKey = (edgeWorker as any).buildSlackThreadKey(event);
		const sessionId = (edgeWorker as any).buildSlackSessionId(threadKey);
		const existingWorkspace = join(
			workspaceBaseDir,
			"slack",
			"thread-existing",
		);
		await mkdir(existingWorkspace, { recursive: true });

		const activeRunner = {
			isRunning: vi.fn().mockReturnValue(true),
			supportsStreamingInput: true,
			addStreamMessage: vi.fn(),
		};

		sessions.set(sessionId, {
			id: sessionId,
			workspace: {
				path: existingWorkspace,
				isGitWorktree: false,
			},
			agentRunner: activeRunner as CyrusAgentSession["agentRunner"],
			metadata: {},
		});

		buildRunnerConfigSpy.mockClear();
		manager.createLinearAgentSession.mockClear();

		const followUpEvent = createSlackEvent({
			eventId: "Ev-2",
			payload: {
				...event.payload,
				text: "<@U0BOT1234> Also include rollback steps",
				event_ts: "1704110405.000200",
			},
		});

		await (edgeWorker as any).handleSlackWebhook(followUpEvent);

		expect(activeRunner.addStreamMessage).toHaveBeenCalledWith(
			"Also include rollback steps",
		);
		expect(manager.createLinearAgentSession).not.toHaveBeenCalled();
		expect(buildRunnerConfigSpy).not.toHaveBeenCalled();
	});

	it("resumes the same thread session in the same workspace when not actively running", async () => {
		const event = createSlackEvent();
		const threadKey = (edgeWorker as any).buildSlackThreadKey(event);
		const sessionId = (edgeWorker as any).buildSlackSessionId(threadKey);
		const existingWorkspace = join(workspaceBaseDir, "slack", "thread-resume");
		await mkdir(existingWorkspace, { recursive: true });

		sessions.set(sessionId, {
			id: sessionId,
			workspace: {
				path: existingWorkspace,
				isGitWorktree: false,
			},
			claudeSessionId: "claude-session-42",
			metadata: {},
		});

		const resumedRunner = {
			start: vi.fn().mockResolvedValue({ sessionId: "runner-2" }),
		};
		mockClaudeRunnerFactory.mockReturnValue(resumedRunner);

		buildRunnerConfigSpy.mockClear();
		manager.createLinearAgentSession.mockClear();

		const followUpEvent = createSlackEvent({
			eventId: "Ev-3",
			payload: {
				...event.payload,
				text: "<@U0BOT1234> Add a status section too",
				event_ts: "1704110410.000300",
			},
		});

		await (edgeWorker as any).handleSlackWebhook(followUpEvent);

		expect(manager.createLinearAgentSession).not.toHaveBeenCalled();
		expect(buildRunnerConfigSpy).toHaveBeenCalledTimes(1);
		expect(buildRunnerConfigSpy.mock.calls[0]?.[3]).toEqual([
			existingWorkspace,
		]);
		expect(buildRunnerConfigSpy.mock.calls[0]?.[4]).toBe("claude-session-42");
		expect(resumedRunner.start).toHaveBeenCalledWith(
			"Add a status section too",
		);
	});
});
