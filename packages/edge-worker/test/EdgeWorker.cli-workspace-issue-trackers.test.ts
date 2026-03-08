import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { createTestCyrusHome } from "./testCyrusHome.js";

vi.mock("@linear/sdk");
vi.mock("cyrus-linear-event-transport", () => ({
	LinearEventTransport: vi.fn().mockImplementation(() => ({
		register: vi.fn(),
		on: vi.fn(),
		removeAllListeners: vi.fn(),
	})),
}));
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");

describe("EdgeWorker - CLI workspace issue tracker reuse", () => {
	const makeRepository = (
		id: string,
		linearWorkspaceId: string,
	): RepositoryConfig => ({
		id,
		name: id,
		repositoryPath: `/tmp/${id}`,
		workspaceBaseDir: `/tmp/${id}/worktrees`,
		baseBranch: "main",
		linearToken: `${id}-token`,
		linearWorkspaceId,
		linearWorkspaceName: linearWorkspaceId,
		isActive: true,
		labelPrompts: {},
	});

	beforeEach(() => {
		vi.clearAllMocks();

		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					start: vi.fn().mockResolvedValue(undefined),
					stop: vi.fn().mockResolvedValue(undefined),
					getFastifyInstance: vi.fn().mockReturnValue({ post: vi.fn() }),
					getWebhookUrl: vi
						.fn()
						.mockReturnValue("http://localhost:3456/webhook"),
					registerOAuthCallbackHandler: vi.fn(),
				}) as any,
		);

		vi.mocked(AgentSessionManager).mockImplementation(
			() =>
				({
					restoreState: vi.fn(),
					on: vi.fn(),
				}) as any,
		);
	});

	it("reuses one CLI issue tracker per workspace so repository selection keeps issue and session state", async () => {
		const repo1 = makeRepository("frontend-repo", "cli-workspace");
		const repo2 = makeRepository("backend-repo", "cli-workspace");

		const config: EdgeWorkerConfig = {
			platform: "cli",
			cyrusHome: createTestCyrusHome(),
			repositories: [repo1, repo2],
		};

		const edgeWorker = new EdgeWorker(config);
		const tracker1 = (edgeWorker as any).issueTrackers.get(repo1.id);
		const tracker2 = (edgeWorker as any).issueTrackers.get(repo2.id);

		expect(tracker1).toBe(tracker2);

		const issue = await tracker1.createIssue({
			teamId: "team-default",
			title: "Shared workspace issue",
		});
		const sessionPayload = await tracker1.createAgentSessionOnIssue({
			issueId: issue.id,
		});
		const session = await sessionPayload.agentSession;

		await expect(tracker2.fetchIssue(issue.id)).resolves.toMatchObject({
			id: issue.id,
			identifier: issue.identifier,
		});
		await expect(
			tracker2.createAgentActivity({
				agentSessionId: session.id,
				content: {
					type: "thought",
					body: "Repository selection confirmed",
				},
			}),
		).resolves.toMatchObject({ success: true });
	});

	it("keeps CLI issue trackers separate when repositories belong to different workspaces", () => {
		const repo1 = makeRepository("frontend-repo", "cli-workspace");
		const repo2 = makeRepository("backend-repo", "other-workspace");

		const config: EdgeWorkerConfig = {
			platform: "cli",
			cyrusHome: createTestCyrusHome(),
			repositories: [repo1, repo2],
		};

		const edgeWorker = new EdgeWorker(config);
		const tracker1 = (edgeWorker as any).issueTrackers.get(repo1.id);
		const tracker2 = (edgeWorker as any).issueTrackers.get(repo2.id);

		expect(tracker1).not.toBe(tracker2);
	});
});
