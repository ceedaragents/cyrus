import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { TEST_CYRUS_HOME } from "./test-dirs.js";

vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn().mockResolvedValue([]),
}));
vi.mock("cyrus-claude-runner");
vi.mock("cyrus-codex-runner");
vi.mock("cyrus-cursor-runner");
vi.mock("cyrus-gemini-runner");
vi.mock("cyrus-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});
vi.mock("file-type");

describe("EdgeWorker agent execution runtime integration", () => {
	let edgeWorker: EdgeWorker;
	let mockRepository: RepositoryConfig;

	beforeEach(() => {
		vi.clearAllMocks();

		mockRepository = {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: "/workspace/repos/test",
			workspaceBaseDir: "/workspace/worktrees",
			baseBranch: "main",
			linearWorkspaceId: "test-workspace",
			agentExecution: {
				mode: "external_launcher",
				runner: "codex",
				command: "/Users/top/bin/codex-api-kk",
			},
		};

		const config: EdgeWorkerConfig = {
			cyrusHome: TEST_CYRUS_HOME,
			repositories: [mockRepository],
			linearWorkspaces: {
				"test-workspace": {
					linearToken: "token",
					linearWorkspaceSlug: "test-slug",
				},
			},
		};

		edgeWorker = new EdgeWorker(config);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("wraps codex with the external launcher wrapper", async () => {
		const mockLauncherManager = {
			ensureRuntime: vi.fn().mockResolvedValue({
				command: "/Users/top/bin/codex-api-kk",
				wrapperPath: "/tmp/codex-external-launcher",
			}),
		};
		(edgeWorker as any).externalLauncherManager = mockLauncherManager;

		const session: any = {
			issueId: "issue-123",
			issueContext: {
				issueId: "issue-123",
				issueIdentifier: "DEF-123",
			},
			workspace: {
				path: "/workspace/worktrees/DEF-123",
				isGitWorktree: true,
			},
		};

		const runnerConfig = await (
			edgeWorker as any
		).prepareRunnerConfigForAgentExecution(
			"session-123",
			session,
			mockRepository,
			"codex",
			{
				workingDirectory: "/workspace/worktrees/DEF-123",
				allowedDirectories: ["/workspace/worktrees/DEF-123"],
				cyrusHome: TEST_CYRUS_HOME,
			},
		);

		expect(mockLauncherManager.ensureRuntime).toHaveBeenCalledWith({
			sessionId: "session-123",
			repository: mockRepository,
			runnerType: "codex",
			workingDirectory: "/workspace/worktrees/DEF-123",
		});
		expect((runnerConfig as any).codexPath).toBe(
			"/tmp/codex-external-launcher",
		);
		expect(session.metadata.agentExecution).toEqual({
			mode: "external_launcher",
			runner: "codex",
			command: "/Users/top/bin/codex-api-kk",
			visibility: "orchestrator_only",
		});
	});

	it("rejects unsupported runners in external launcher mode", async () => {
		const mockLauncherManager = {
			ensureRuntime: vi
				.fn()
				.mockRejectedValue(
					new Error(
						'Repository test-repo requires runner "codex" for external launcher execution, but resolved runner was "claude"',
					),
				),
		};
		(edgeWorker as any).externalLauncherManager = mockLauncherManager;

		await expect(
			(edgeWorker as any).prepareRunnerConfigForAgentExecution(
				"session-123",
				{
					workspace: {
						path: "/workspace/worktrees/DEF-123",
						isGitWorktree: true,
					},
				},
				mockRepository,
				"claude",
				{
					workingDirectory: "/workspace/worktrees/DEF-123",
					allowedDirectories: ["/workspace/worktrees/DEF-123"],
					cyrusHome: TEST_CYRUS_HOME,
				},
			),
		).rejects.toThrow(/requires runner "codex"/);
	});

	it("syncs completed CLI sessions back to the issue tracker", async () => {
		const updateAgentSessionStatus = vi.fn().mockResolvedValue(undefined);
		(edgeWorker as any).issueTrackers.set("test-workspace", {
			getPlatformType: () => "cli",
			updateAgentSessionStatus,
		});
		(edgeWorker as any).sessionRepositories.set("session-123", "test-repo");

		await (edgeWorker as any).syncCliAgentSessionStatus("session-123", {
			externalSessionId: "session-123",
			status: "complete",
			repositories: [{ repositoryId: "test-repo" }],
		});

		expect(updateAgentSessionStatus).toHaveBeenCalledWith(
			"session-123",
			"complete",
		);
	});

	it("does not sync non-CLI issue tracker sessions", async () => {
		const updateAgentSessionStatus = vi.fn().mockResolvedValue(undefined);
		(edgeWorker as any).issueTrackers.set("test-workspace", {
			getPlatformType: () => "linear",
			updateAgentSessionStatus,
		});
		(edgeWorker as any).sessionRepositories.set("session-123", "test-repo");

		await (edgeWorker as any).syncCliAgentSessionStatus("session-123", {
			externalSessionId: "session-123",
			status: "complete",
			repositories: [{ repositoryId: "test-repo" }],
		});

		expect(updateAgentSessionStatus).not.toHaveBeenCalled();
	});
});
