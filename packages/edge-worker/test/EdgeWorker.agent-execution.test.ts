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
				mode: "persistent_issue_container",
				image: "ghcr.io/test/codex-debug:latest",
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

	it("wraps supported runners with the issue container wrapper", async () => {
		const mockContainerManager = {
			ensureRuntime: vi.fn().mockResolvedValue({
				containerName: "cyrus-issue-test-repo-def-123",
				wrapperPath: "/tmp/codex-in-container",
			}),
		};
		(edgeWorker as any).issueContainerManager = mockContainerManager;

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

		expect(mockContainerManager.ensureRuntime).toHaveBeenCalledWith({
			sessionId: "session-123",
			issueId: "issue-123",
			issueIdentifier: "DEF-123",
			repository: mockRepository,
			runnerType: "codex",
			workingDirectory: "/workspace/worktrees/DEF-123",
			allowedDirectories: ["/workspace/worktrees/DEF-123"],
		});
		expect((runnerConfig as any).codexPath).toBe("/tmp/codex-in-container");
	});

	it("wraps claude with a container bridge launcher", async () => {
		const mockContainerManager = {
			ensureRuntime: vi.fn().mockResolvedValue({
				containerName: "cyrus-issue-test-repo-def-123",
				wrapperPath: "/tmp/claude-in-container",
			}),
		};
		(edgeWorker as any).issueContainerManager = mockContainerManager;

		const runnerConfig = await (
			edgeWorker as any
		).prepareRunnerConfigForAgentExecution(
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
		);

		expect(mockContainerManager.ensureRuntime).toHaveBeenCalled();
		expect((runnerConfig as any).containerBridge).toEqual({
			command: "/tmp/claude-in-container",
		});
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
