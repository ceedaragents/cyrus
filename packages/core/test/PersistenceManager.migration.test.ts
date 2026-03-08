/**
 * Tests for PersistenceManager legacy-to-latest migration
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

	describe("legacy state migration", () => {
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

		const v3State = {
			version: "3.0",
			savedAt: "2025-01-16T12:00:00.000Z",
			state: {
				agentSessionsById: {
					"session-123": {
						id: "session-123",
						externalSessionId: "linear-session-123",
						type: "comment-thread",
						status: "active",
						context: "comment-thread",
						createdAt: 1705320000000,
						updatedAt: 1705320000500,
						issueContext: {
							trackerId: "linear",
							issueId: "issue-456",
							issueIdentifier: "TEST-123",
						},
						issueId: "issue-456",
						issue: {
							id: "issue-456",
							identifier: "TEST-123",
							title: "Test Issue",
							branchName: "test-branch",
						},
						workspace: {
							path: "/tmp/worktree-repo-1",
							isGitWorktree: true,
						},
						repositoryAssociations: [
							{
								repositoryId: "repo-1",
								associationOrigin: "routed",
								status: "active",
								executionWorkspace: {
									path: "/tmp/worktree-repo-1",
									isGitWorktree: true,
								},
							},
						],
					},
				},
				agentSessionEntriesById: {
					"session-123": [
						{
							type: "user",
							content: "Initial message",
							metadata: { timestamp: 1705320000000 },
						},
					],
				},
				agentSessions: {
					"repo-2": {
						"session-123": {
							id: "session-123",
							externalSessionId: "linear-session-123",
							type: "comment-thread",
							status: "active",
							context: "comment-thread",
							createdAt: 1705320000100,
							updatedAt: 1705320000600,
							issueContext: {
								trackerId: "linear",
								issueId: "issue-456",
								issueIdentifier: "TEST-123",
							},
							issueId: "issue-456",
							workspace: {
								path: "/tmp/worktree-repo-2",
								isGitWorktree: true,
							},
							repositoryAssociations: [
								{
									repositoryId: "repo-2",
									associationOrigin: "user-selected",
									status: "selected",
									executionWorkspace: {
										path: "/tmp/worktree-repo-2",
										isGitWorktree: true,
									},
								},
							],
						},
					},
				},
				agentSessionEntries: {
					"repo-2": {
						"session-123": [
							{
								type: "user",
								content: "Initial message",
								metadata: { timestamp: 1705320000000 },
							},
							{
								type: "assistant",
								content: "Working in another associated repository",
								metadata: { timestamp: 1705320000600 },
							},
						],
					},
				},
				childToParentAgentSession: {
					"child-session": "parent-session",
				},
				issueRepositoryCache: {
					"issue-456": "repo-3",
				},
			},
		};

		it("should migrate v2.0 state to the latest normalized format", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v2State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			const result = await persistenceManager.loadEdgeWorkerState();

			expect(result).toBeDefined();
			expect(result!.agentSessionsById).toBeDefined();
			expect(result).not.toHaveProperty("agentSessions");
			expect(result).not.toHaveProperty("agentSessionEntries");
			expect(result).not.toHaveProperty("issueRepositoryCache");

			// Check migrated session
			const migratedSession = result!.agentSessionsById!["linear-session-123"];
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

			// Should preserve issueId for backwards compatibility
			expect(migratedSession.issueId).toBe("issue-456");

			// Should preserve issue object
			expect(migratedSession.issue).toEqual({
				id: "issue-456",
				identifier: "TEST-123",
				title: "Test Issue",
				branchName: "test-branch",
			});

			expect(migratedSession.repositoryAssociations).toEqual([
				{
					repositoryId: "repo-1",
					associationOrigin: "legacy-migration",
					status: "active",
					executionWorkspace: {
						path: "/tmp/worktree",
						isGitWorktree: true,
					},
				},
			]);

			// Should preserve other fields
			expect(migratedSession.claudeSessionId).toBe("claude-789");
			expect(migratedSession.workspace.path).toBe("/tmp/worktree");
			expect(result!.agentSessionsById).toEqual({
				"linear-session-123": migratedSession,
			});
			expect(result!.issueRepositoryAssociationsByIssueId).toEqual({
				"issue-456": [
					{
						repositoryId: "repo-1",
						associationOrigin: "legacy-migration",
						status: "selected",
					},
				],
			});
		});

		it("should save migrated legacy state as the latest format without legacy containers", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v2State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			await persistenceManager.loadEdgeWorkerState();

			// Verify writeFile was called with the latest version
			expect(writeFile).toHaveBeenCalled();
			const savedData = JSON.parse(
				vi.mocked(writeFile).mock.calls[0][1] as string,
			);
			expect(savedData.version).toBe(PERSISTENCE_VERSION);
			expect(savedData.state.agentSessions).toBeUndefined();
			expect(savedData.state.agentSessionEntries).toBeUndefined();
			expect(savedData.state.issueRepositoryCache).toBeUndefined();
		});

		it("should preserve child mappings and normalize entries during migration", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v2State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			const result = await persistenceManager.loadEdgeWorkerState();

			// Check child-to-parent mappings are preserved
			expect(result!.childToParentAgentSession).toEqual(
				v2State.state.childToParentAgentSession,
			);

			expect(result!.agentSessionEntriesById).toEqual({
				"linear-session-123": [
					{
						type: "user",
						content: "Hello",
						metadata: { timestamp: 1705320000000 },
					},
				],
			});
		});

		it("should merge repo-keyed v3 buckets and issue cache into explicit associations", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify(v3State));
			vi.mocked(writeFile).mockResolvedValue(undefined);
			vi.mocked(mkdir).mockResolvedValue(undefined);

			const result = await persistenceManager.loadEdgeWorkerState();

			expect(result).toBeDefined();
			expect(result).not.toHaveProperty("agentSessions");
			expect(result).not.toHaveProperty("agentSessionEntries");
			expect(result).not.toHaveProperty("issueRepositoryCache");

			expect(
				result!.agentSessionsById?.["session-123"].repositoryAssociations,
			).toEqual([
				{
					repositoryId: "repo-1",
					associationOrigin: "routed",
					status: "active",
					executionWorkspace: {
						path: "/tmp/worktree-repo-1",
						isGitWorktree: true,
					},
				},
				{
					repositoryId: "repo-2",
					associationOrigin: "user-selected",
					status: "selected",
					executionWorkspace: {
						path: "/tmp/worktree-repo-2",
						isGitWorktree: true,
					},
				},
				{
					repositoryId: "repo-3",
					associationOrigin: "legacy-migration",
					status: "selected",
				},
			]);

			expect(result!.agentSessionEntriesById?.["session-123"]).toEqual([
				{
					type: "user",
					content: "Initial message",
					metadata: { timestamp: 1705320000000 },
				},
				{
					type: "assistant",
					content: "Working in another associated repository",
					metadata: { timestamp: 1705320000600 },
				},
			]);

			expect(result!.issueRepositoryAssociationsByIssueId).toEqual({
				"issue-456": [
					{
						repositoryId: "repo-3",
						associationOrigin: "legacy-migration",
						status: "selected",
					},
				],
			});
		});

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

		it("should load the latest persisted format without migration", async () => {
			const v4State = {
				version: "4.0",
				savedAt: "2025-01-15T12:00:00.000Z",
				state: {
					agentSessionsById: {
						"session-123": {
							id: "session-123",
							externalSessionId: "session-123",
							issueContext: {
								trackerId: "linear",
								issueId: "issue-456",
								issueIdentifier: "TEST-123",
							},
							repositoryAssociations: [],
						},
					},
					issueRepositoryAssociationsByIssueId: {
						"issue-456": [
							{
								repositoryId: "repo-1",
								associationOrigin: "restored",
								status: "selected",
							},
						],
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

	describe("PERSISTENCE_VERSION constant", () => {
		it("should be 4.0", () => {
			expect(PERSISTENCE_VERSION).toBe("4.0");
		});
	});
});
