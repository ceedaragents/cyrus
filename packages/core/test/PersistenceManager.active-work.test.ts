import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	ActiveWorkSession,
	ActiveWorkStatus,
} from "../src/PersistenceManager.js";
import { PersistenceManager } from "../src/PersistenceManager.js";

describe("PersistenceManager - Active Work Status", () => {
	let persistenceManager: PersistenceManager;
	let testDir: string;

	beforeEach(async () => {
		// Create a temporary directory for testing
		testDir = join(tmpdir(), `cyrus-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
		persistenceManager = new PersistenceManager(testDir);
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("addActiveSession", () => {
		it("should create active-work.json file with session", async () => {
			const session: ActiveWorkSession = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			};

			await persistenceManager.addActiveSession(session);

			const filePath = join(testDir, "active-work.json");
			expect(existsSync(filePath)).toBe(true);

			const fileContent = await readFile(filePath, "utf8");
			const savedStatus: ActiveWorkStatus = JSON.parse(fileContent);

			expect(savedStatus.isWorking).toBe(true);
			expect(savedStatus.activeSessions[session.sessionId]).toEqual(session);
			expect(savedStatus.lastUpdated).toBeDefined();
			expect(typeof savedStatus.lastUpdated).toBe("number");
		});

		it("should handle multiple parallel sessions", async () => {
			const session1: ActiveWorkSession = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-1",
				startedAt: Date.now(),
			};

			const session2: ActiveWorkSession = {
				issueId: "issue-456",
				issueIdentifier: "TEAM-456",
				repositoryId: "repo-789",
				sessionId: "session-2",
				startedAt: Date.now(),
			};

			await persistenceManager.addActiveSession(session1);
			await persistenceManager.addActiveSession(session2);

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(true);
			expect(Object.keys(status!.activeSessions)).toHaveLength(2);
			expect(status!.activeSessions["session-1"]).toEqual(session1);
			expect(status!.activeSessions["session-2"]).toEqual(session2);
		});

		it("should update lastUpdated timestamp when adding sessions", async () => {
			const session: ActiveWorkSession = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			};

			await persistenceManager.addActiveSession(session);
			const status1 = await persistenceManager.getActiveWorkStatus();

			// Wait a bit to ensure timestamp changes
			await new Promise((resolve) => setTimeout(resolve, 10));

			const session2: ActiveWorkSession = {
				...session,
				sessionId: "session-890",
			};
			await persistenceManager.addActiveSession(session2);
			const status2 = await persistenceManager.getActiveWorkStatus();

			expect(status2?.lastUpdated).toBeGreaterThan(status1!.lastUpdated);
		});
	});

	describe("removeActiveSession", () => {
		it("should remove a session and set isWorking to false when no sessions remain", async () => {
			const session: ActiveWorkSession = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			};

			// Add then remove
			await persistenceManager.addActiveSession(session);
			let status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(true);

			await persistenceManager.removeActiveSession("session-789");
			status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(false);
			expect(Object.keys(status!.activeSessions)).toHaveLength(0);
		});

		it("should keep isWorking true when other sessions remain", async () => {
			const session1: ActiveWorkSession = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-1",
				startedAt: Date.now(),
			};

			const session2: ActiveWorkSession = {
				issueId: "issue-456",
				issueIdentifier: "TEAM-456",
				repositoryId: "repo-789",
				sessionId: "session-2",
				startedAt: Date.now(),
			};

			await persistenceManager.addActiveSession(session1);
			await persistenceManager.addActiveSession(session2);

			// Remove one session
			await persistenceManager.removeActiveSession("session-1");

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(true);
			expect(Object.keys(status!.activeSessions)).toHaveLength(1);
			expect(status!.activeSessions["session-2"]).toEqual(session2);
		});

		it("should handle removing non-existent session gracefully", async () => {
			await persistenceManager.removeActiveSession("non-existent");
			// Should not throw
		});
	});

	describe("clearActiveWork", () => {
		it("should clear all sessions and set isWorking to false", async () => {
			// Add multiple sessions
			await persistenceManager.addActiveSession({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-1",
				startedAt: Date.now(),
			});
			await persistenceManager.addActiveSession({
				issueId: "issue-456",
				issueIdentifier: "TEAM-456",
				repositoryId: "repo-789",
				sessionId: "session-2",
				startedAt: Date.now(),
			});

			// Clear all
			await persistenceManager.clearActiveWork();

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(false);
			expect(Object.keys(status!.activeSessions)).toHaveLength(0);
			expect(status?.lastUpdated).toBeDefined();
		});

		it("should work even if no active work was set", async () => {
			await persistenceManager.clearActiveWork();

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(false);
			expect(status?.activeSessions).toEqual({});
		});
	});

	describe("getActiveWorkStatus", () => {
		it("should return null if file does not exist", async () => {
			const status = await persistenceManager.getActiveWorkStatus();
			expect(status).toBeNull();
		});

		it("should return active work status with sessions when file exists", async () => {
			const session: ActiveWorkSession = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			};

			await persistenceManager.addActiveSession(session);
			const status = await persistenceManager.getActiveWorkStatus();

			expect(status).not.toBeNull();
			expect(status?.isWorking).toBe(true);
			expect(status?.activeSessions["session-789"]).toEqual(session);
		});

		it("should return cleared status after clearing", async () => {
			await persistenceManager.addActiveSession({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			});
			await persistenceManager.clearActiveWork();

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status).not.toBeNull();
			expect(status?.isWorking).toBe(false);
			expect(Object.keys(status!.activeSessions)).toHaveLength(0);
		});
	});

	describe("isCurrentlyWorking", () => {
		it("should return false when no status file exists", async () => {
			const isWorking = await persistenceManager.isCurrentlyWorking();
			expect(isWorking).toBe(false);
		});

		it("should return true when active sessions exist", async () => {
			await persistenceManager.addActiveSession({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			});

			const isWorking = await persistenceManager.isCurrentlyWorking();
			expect(isWorking).toBe(true);
		});

		it("should return false when all sessions are removed", async () => {
			await persistenceManager.addActiveSession({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			});
			await persistenceManager.removeActiveSession("session-789");

			const isWorking = await persistenceManager.isCurrentlyWorking();
			expect(isWorking).toBe(false);
		});

		it("should return false when active work is cleared", async () => {
			await persistenceManager.addActiveSession({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			});
			await persistenceManager.clearActiveWork();

			const isWorking = await persistenceManager.isCurrentlyWorking();
			expect(isWorking).toBe(false);
		});
	});

	describe("file format", () => {
		it("should write JSON in a readable format", async () => {
			await persistenceManager.addActiveSession({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			});

			const filePath = join(testDir, "active-work.json");
			const fileContent = await readFile(filePath, "utf8");

			// Verify it's pretty-printed (has newlines)
			expect(fileContent).toContain("\n");

			// Verify it's valid JSON
			expect(() => JSON.parse(fileContent)).not.toThrow();
		});

		it("should be parseable after multiple updates", async () => {
			for (let i = 0; i < 5; i++) {
				await persistenceManager.addActiveSession({
					issueId: `issue-${i}`,
					issueIdentifier: `TEAM-${i}`,
					repositoryId: `repo-${i}`,
					sessionId: `session-${i}`,
					startedAt: Date.now(),
				});

				const status = await persistenceManager.getActiveWorkStatus();
				expect(status?.activeSessions[`session-${i}`]).toBeDefined();
			}

			const status = await persistenceManager.getActiveWorkStatus();
			expect(Object.keys(status!.activeSessions)).toHaveLength(5);
		});
	});
});
