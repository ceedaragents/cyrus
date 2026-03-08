import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	PersistenceManager,
	type SerializableEdgeWorkerState,
	type SerializedCyrusAgentSession,
} from "../src/PersistenceManager.js";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
}));

describe("repository-association persistence", () => {
	let persistenceManager: PersistenceManager;

	beforeEach(() => {
		vi.clearAllMocks();
		persistenceManager = new PersistenceManager("/tmp/test-cyrus");
		vi.mocked(mkdir).mockResolvedValue(undefined);
		vi.mocked(writeFile).mockResolvedValue(undefined);
	});

	async function saveAndReload(
		state: SerializableEdgeWorkerState,
	): Promise<SerializableEdgeWorkerState | null> {
		await persistenceManager.saveEdgeWorkerState(state);

		const serializedPayload = JSON.parse(
			vi.mocked(writeFile).mock.calls[0]?.[1] as string,
		);

		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(serializedPayload));

		return persistenceManager.loadEdgeWorkerState();
	}

	it("serializes and restores a zero-repository session explicitly", async () => {
		const zeroAssociationSession: SerializedCyrusAgentSession = {
			id: "session-zero",
			externalSessionId: "linear-session-zero",
			type: "comment-thread",
			status: "active",
			context: "comment-thread",
			createdAt: 1705320000000,
			updatedAt: 1705320000000,
			issueContext: {
				trackerId: "linear",
				issueId: "issue-zero",
				issueIdentifier: "TEST-0",
			},
			issueId: "issue-zero",
			workspace: {
				path: "/tmp/zero-association-workspace",
				isGitWorktree: true,
			},
			repositoryAssociations: [],
		};

		const restoredState = await saveAndReload({
			agentSessionsById: {
				[zeroAssociationSession.id]: zeroAssociationSession,
			},
			agentSessionEntriesById: {
				[zeroAssociationSession.id]: [],
			},
		});

		expect(
			restoredState?.agentSessionsById?.[zeroAssociationSession.id]
				.repositoryAssociations,
		).toStrictEqual([]);
		expect(
			restoredState?.agentSessionsById?.[zeroAssociationSession.id].workspace
				.path,
		).toBe("/tmp/zero-association-workspace");
	});

	it("round-trips a single repository association without workspace-path inference", async () => {
		const singleAssociationSession: SerializedCyrusAgentSession = {
			id: "session-one",
			externalSessionId: "linear-session-one",
			type: "comment-thread",
			status: "active",
			context: "comment-thread",
			createdAt: 1705320001000,
			updatedAt: 1705320001000,
			issueContext: {
				trackerId: "linear",
				issueId: "issue-one",
				issueIdentifier: "TEST-1",
			},
			issueId: "issue-one",
			workspace: {
				path: "/tmp/last-execution-location",
				isGitWorktree: false,
			},
			repositoryAssociations: [
				{
					repositoryId: "repo-1",
					linearWorkspaceId: "workspace-1",
					associationOrigin: "routed",
					status: "active",
					executionWorkspace: {
						path: "/tmp/worktrees/repo-1",
						isGitWorktree: true,
					},
				},
			],
		};

		const restoredState = await saveAndReload({
			agentSessionsById: {
				[singleAssociationSession.id]: singleAssociationSession,
			},
			agentSessionEntriesById: {
				[singleAssociationSession.id]: [
					{
						type: "user",
						content: "Resume work in the explicitly associated repository",
						metadata: { timestamp: 1705320001000 },
					},
				],
			},
		});

		expect(
			restoredState?.agentSessionsById?.[singleAssociationSession.id]
				.repositoryAssociations,
		).toStrictEqual(singleAssociationSession.repositoryAssociations);
		expect(
			restoredState?.agentSessionsById?.[singleAssociationSession.id].workspace
				.path,
		).toBe("/tmp/last-execution-location");
	});
});
