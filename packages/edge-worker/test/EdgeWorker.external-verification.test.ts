import { LinearClient } from "@linear/sdk";
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

describe("EdgeWorker external verification integration", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockLinearClient: any;
	let mockRepository: RepositoryConfig;

	beforeEach(() => {
		vi.clearAllMocks();

		mockLinearClient = {
			issue: vi.fn(),
			workflowStates: vi.fn().mockResolvedValue({ nodes: [] }),
			updateIssue: vi.fn().mockResolvedValue({ success: true }),
			createAgentActivity: vi.fn().mockResolvedValue({ success: true }),
			comments: vi.fn().mockResolvedValue({ nodes: [] }),
			rawRequest: vi.fn(),
		};
		vi.mocked(LinearClient).mockImplementation(() => mockLinearClient);

		mockRepository = {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: "/workspace/repos/test",
			workspaceBaseDir: "/workspace/worktrees",
			baseBranch: "main",
			linearWorkspaceId: "test-workspace",
			verification: {
				mode: "ephemeral_container",
				image: "ghcr.io/test/debug:latest",
				command: "pnpm test",
				workdir: "/workspace",
				artifactGlobs: ["test-results/**"],
			},
		};

		mockConfig = {
			cyrusHome: TEST_CYRUS_HOME,
			repositories: [mockRepository],
			linearWorkspaces: {
				"test-workspace": {
					linearToken: "token",
					linearWorkspaceSlug: "test-slug",
				},
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("augments the verifications prompt with external container results", async () => {
		const mockExecutor = {
			execute: vi.fn().mockResolvedValue({
				mode: "ephemeral_container",
				image: "ghcr.io/test/debug:latest",
				command: "pnpm test",
				shell: "sh",
				workdir: "/workspace",
				workspaceHostPath: "/host/worktrees/TEST-123/test-repo",
				exitCode: 0,
				stdout: "47 tests passing",
				stderr: "",
				durationMs: 1234,
				timedOut: false,
				artifacts: ["test-results/junit.xml"],
			}),
		};
		(edgeWorker as any).verificationExecutor = mockExecutor;
		vi.spyOn(edgeWorker as any, "loadSubroutinePrompt").mockResolvedValue(
			"# Verifications - Testing and Quality Checks",
		);

		const session: any = {
			id: "session-123",
			issueId: "issue-123",
			issueContext: {
				issueId: "issue-123",
				issueIdentifier: "TEST-123",
			},
			workspace: {
				path: "/workspace/worktrees/TEST-123",
				hostPath: "/host/worktrees/TEST-123",
				isGitWorktree: true,
				repoPaths: {
					"test-repo": "/workspace/worktrees/TEST-123/test-repo",
				},
				repoHostPaths: {
					"test-repo": "/host/worktrees/TEST-123/test-repo",
				},
			},
		};
		const mockAgentSessionManager = {
			createThoughtActivity: vi.fn().mockResolvedValue(undefined),
		};

		const prompt = await (edgeWorker as any).prepareSubroutinePrompt(
			"session-123",
			session,
			mockRepository,
			{
				name: "verifications",
				description: "Running tests, linting, and type checking",
			},
			mockAgentSessionManager,
		);

		expect(mockExecutor.execute).toHaveBeenCalledWith({
			issueId: "issue-123",
			issueIdentifier: "TEST-123",
			repository: mockRepository,
			workspacePath: "/workspace/worktrees/TEST-123/test-repo",
			workspaceHostPath: "/host/worktrees/TEST-123/test-repo",
		});
		expect(prompt).toContain(
			"Cyrus has already executed the verification commands externally",
		);
		expect(prompt).toContain("<image>ghcr.io/test/debug:latest</image>");
		expect(prompt).toContain("<exit_code>0</exit_code>");
		expect(prompt).toContain("Do NOT re-run test, lint, or typecheck commands");
		expect(mockAgentSessionManager.createThoughtActivity).toHaveBeenCalledTimes(
			2,
		);
	});

	it("returns the base prompt unchanged for non-containerized verification", async () => {
		vi.spyOn(edgeWorker as any, "loadSubroutinePrompt").mockResolvedValue(
			"base prompt",
		);
		const mockExecutor = {
			execute: vi.fn(),
		};
		(edgeWorker as any).verificationExecutor = mockExecutor;
		const repoWithoutExternalVerification: RepositoryConfig = {
			...mockRepository,
			verification: {
				mode: "local",
			},
		};

		const prompt = await (edgeWorker as any).prepareSubroutinePrompt(
			"session-123",
			{
				workspace: { path: "/workspace", isGitWorktree: true },
			},
			repoWithoutExternalVerification,
			{
				name: "verifications",
				description: "Running tests, linting, and type checking",
			},
			{
				createThoughtActivity: vi.fn(),
			},
		);

		expect(prompt).toBe("base prompt");
		expect(mockExecutor.execute).not.toHaveBeenCalled();
	});
});
