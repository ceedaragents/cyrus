/**
 * Tests for PersistenceManager v2.0 → v4.0 and v3.0 → v4.0 migration
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	PERSISTENCE_VERSION,
	PersistenceManager,
} from "../src/PersistenceManager.js";

// Mock fs modules
vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
}));

describe("PersistenceManager", () => {
	let persistenceManager: PersistenceManager;

	beforeEach(() => {
		vi.clearAllMocks();
		persistenceManager = new PersistenceManager("/tmp/test-cyrus");
	});

	describe("v2.0 to v4.0 Migration", () => {
		const v2State = {
			version: "2.0",
			savedAt: "2025-01-15T12:00:00.000Z",
			state: {
				agentSessions: {
					"repo-1": {
						"linear-session-123": {
							linearAgentActivitySessionId: "linear-session-123",
							type: "comment-thread",
							status: "active",
							context: "comment-thread",
							createdAt: 1705320000000,
							updatedAt: 1705320000000,
							issueId: "issue-456",
							issue: {
								id: "issue-456",
								identifier: "TEST-123",
								title: "Test Issue",
								branchName: "test-branch",
							},
							workspace: {
								path: "/tmp/worktree",
								isGitWorktree: true,
							},
							claudeSessionId: "claude-789",
						},
					},
				},
				agentSessionEntries: {
					"repo-1": {
						"linear-session-123": [
							{
								type: "user",
								content: "Hello",
								metadata: { timestamp: 1705320000000 },
							},
						],
					},
				},
				childToParentAgentSession: {
					"child-session": "parent-session",
				},
				issueRepositoryCache: {
					"issue-456": "repo-1",
				},
			},
		};

		it("should migrate v2.0 state to v4.0 format (flat sessions with repositoryIds)", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v2State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			const result = await persistenceManager.loadEdgeWorkerState();

			expect(result).toBeDefined();
			expect(result!.agentSessions).toBeDefined();

			// Sessions are now flat (not nested by repo ID)
			const migratedSession = result!.agentSessions!["linear-session-123"];
			expect(migratedSession).toBeDefined();

			// Should have new id field
			expect(migratedSession.id).toBe("linear-session-123");

			// Should have externalSessionId
			expect(migratedSession.externalSessionId).toBe("linear-session-123");

			// Should have issueContext
			expect(migratedSession.issueContext).toEqual({
				trackerId: "linear",
				issueId: "issue-456",
				issueIdentifier: "TEST-123",
			});

			// Should have repositoryIds from the repo key
			expect(migratedSession.repositoryIds).toEqual(["repo-1"]);

			// Should preserve issue object
			expect(migratedSession.issue).toEqual({
				id: "issue-456",
				identifier: "TEST-123",
				title: "Test Issue",
				branchName: "test-branch",
			});

			// Should preserve other fields
			expect(migratedSession.claudeSessionId).toBe("claude-789");
			expect(migratedSession.workspace.path).toBe("/tmp/worktree");
		});

		it("should save migrated state as v4.0", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v2State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			await persistenceManager.loadEdgeWorkerState();

			// Verify writeFile was called with v4.0 version
			expect(writeFile).toHaveBeenCalled();
			const savedData = JSON.parse(
				vi.mocked(writeFile).mock.calls[0][1] as string,
			);
			expect(savedData.version).toBe(PERSISTENCE_VERSION);
		});

		it("should flatten entries and preserve child-to-parent mappings during migration", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v2State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			const result = await persistenceManager.loadEdgeWorkerState();

			// Entries should be flattened (no repo nesting)
			expect(result!.agentSessionEntries!["linear-session-123"]).toEqual([
				{
					type: "user",
					content: "Hello",
					metadata: { timestamp: 1705320000000 },
				},
			]);

			// Check child-to-parent mappings are preserved
			expect(result!.childToParentAgentSession).toEqual(
				v2State.state.childToParentAgentSession,
			);

			// issueRepositoryCache should NOT be in v4.0 output
			expect((result as any).issueRepositoryCache).toBeUndefined();
		});
	});

	describe("v3.0 to v4.0 Migration", () => {
		const v3State = {
			version: "3.0",
			savedAt: "2025-01-15T12:00:00.000Z",
			state: {
				agentSessions: {
					"repo-1": {
						"session-123": {
							id: "session-123",
							externalSessionId: "session-123",
							issueContext: {
								trackerId: "linear",
								issueId: "issue-456",
								issueIdentifier: "TEST-123",
							},
							type: "comment-thread",
							status: "active",
							context: "comment-thread",
							createdAt: 1705320000000,
							updatedAt: 1705320000000,
							workspace: { path: "/tmp/wt", isGitWorktree: true },
						},
					},
					"repo-2": {
						"session-456": {
							id: "session-456",
							externalSessionId: "session-456",
							type: "comment-thread",
							status: "complete",
							context: "comment-thread",
							createdAt: 1705320000000,
							updatedAt: 1705320000000,
							workspace: { path: "/tmp/wt2", isGitWorktree: true },
						},
					},
				},
				agentSessionEntries: {
					"repo-1": {
						"session-123": [{ type: "user", content: "test" }],
					},
					"repo-2": {
						"session-456": [{ type: "assistant", content: "reply" }],
					},
				},
				childToParentAgentSession: {
					"session-456": "session-123",
				},
				issueRepositoryCache: {
					"issue-456": "repo-1",
				},
			},
		};

		it("should migrate v3.0 state to v4.0 format", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v3State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			const result = await persistenceManager.loadEdgeWorkerState();

			expect(result).toBeDefined();

			// Sessions should be flat with repositoryIds
			const session123 = result!.agentSessions!["session-123"];
			expect(session123).toBeDefined();
			expect(session123.repositoryIds).toEqual(["repo-1"]);
			expect(session123.issueContext?.issueId).toBe("issue-456");

			const session456 = result!.agentSessions!["session-456"];
			expect(session456).toBeDefined();
			expect(session456.repositoryIds).toEqual(["repo-2"]);

			// Entries should be flat
			expect(result!.agentSessionEntries!["session-123"]).toEqual([
				{ type: "user", content: "test" },
			]);
			expect(result!.agentSessionEntries!["session-456"]).toEqual([
				{ type: "assistant", content: "reply" },
			]);

			// Child-to-parent preserved
			expect(result!.childToParentAgentSession).toEqual({
				"session-456": "session-123",
			});

			// issueRepositoryCache should NOT be present
			expect((result as any).issueRepositoryCache).toBeUndefined();
		});

		it("should save migrated state as v4.0", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v3State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			await persistenceManager.loadEdgeWorkerState();

			expect(writeFile).toHaveBeenCalled();
			const savedData = JSON.parse(
				vi.mocked(writeFile).mock.calls[0][1] as string,
			);
			expect(savedData.version).toBe("4.0");
		});
	});

	describe("v4.0 state loading", () => {
		it("should load v4.0 state without migration", async () => {
			const v4State = {
				version: "4.0",
				savedAt: "2025-01-15T12:00:00.000Z",
				state: {
					agentSessions: {
						"session-123": {
							id: "session-123",
							externalSessionId: "session-123",
							repositoryIds: ["repo-1"],
							issueContext: {
								trackerId: "linear",
								issueId: "issue-456",
								issueIdentifier: "TEST-123",
							},
						},
					},
				},
			};

			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v4State));

			const result = await persistenceManager.loadEdgeWorkerState();

			expect(result).toEqual(v4State.state);
			// Should not call writeFile since no migration needed
			expect(writeFile).not.toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should return null for unknown version", async () => {
			const unknownVersionState = {
				version: "99.0",
				savedAt: "2025-01-15T12:00:00.000Z",
				state: {},
			};

			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify(unknownVersionState),
			);

			const result = await persistenceManager.loadEdgeWorkerState();

			expect(result).toBeNull();
		});

		it("should return null for invalid state structure", async () => {
			const invalidState = {
				version: "2.0",
				savedAt: "2025-01-15T12:00:00.000Z",
				// Missing state property
			};

			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(invalidState));

			const result = await persistenceManager.loadEdgeWorkerState();

			expect(result).toBeNull();
		});
	});

	describe("PERSISTENCE_VERSION constant", () => {
		it("should be 4.0", () => {
			expect(PERSISTENCE_VERSION).toBe("4.0");
		});
	});
});
