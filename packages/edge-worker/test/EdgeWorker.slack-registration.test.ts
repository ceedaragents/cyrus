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
vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn().mockImplementation(() => ({
		initializeFastify: vi.fn(),
		getFastifyInstance: vi.fn().mockReturnValue({
			get: vi.fn(),
			post: vi.fn(),
		}),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		getWebhookUrl: vi.fn().mockReturnValue("http://localhost:3456/webhook"),
	})),
}));
vi.mock("../src/AgentSessionManager.js", () => ({
	AgentSessionManager: vi.fn().mockImplementation(() => ({
		getAllAgentRunners: vi.fn().mockReturnValue([]),
		getAllSessions: vi.fn().mockReturnValue([]),
		createCyrusAgentSession: vi.fn(),
		getSession: vi.fn(),
		getActiveSessionsByIssueId: vi.fn().mockReturnValue([]),
		setActivitySink: vi.fn(),
		on: vi.fn(),
		emit: vi.fn(),
	})),
}));
vi.mock("../src/ChatSessionHandler.js", () => ({
	ChatSessionHandler: vi.fn().mockImplementation(() => ({
		handleEvent: vi.fn(),
	})),
}));
vi.mock("cyrus-slack-event-transport", () => ({
	SlackEventTransport: vi.fn().mockImplementation(() => ({
		on: vi.fn().mockReturnThis(),
		register: vi.fn(),
	})),
}));
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

describe("EdgeWorker Slack transport registration", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/workspace/repos/test",
		workspaceBaseDir: "/workspace/worktrees",
		baseBranch: "main",
		linearWorkspaceId: "test-workspace",
	};

	beforeEach(() => {
		vi.clearAllMocks();

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

	it("continues without MCP config when Slack session MCP setup fails", () => {
		const warnSpy = vi.spyOn((edgeWorker as any).logger, "warn");
		const buildMcpConfigSpy = vi
			.spyOn(edgeWorker as any, "buildMcpConfig")
			.mockImplementation(() => {
				throw new Error("missing Linear SDK client");
			});

		expect(() =>
			(edgeWorker as any).registerSlackEventTransport(),
		).not.toThrow();
		expect(buildMcpConfigSpy).toHaveBeenCalledWith(
			"test-repo",
			"test-workspace",
		);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Failed to build Slack session MCP config for workspace test-workspace",
			),
			expect.any(Error),
		);
		expect((edgeWorker as any).chatSessionHandler).toBeDefined();
	});
});
