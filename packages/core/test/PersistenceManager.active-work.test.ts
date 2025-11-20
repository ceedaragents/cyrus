import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActiveWorkStatus } from "../src/PersistenceManager.js";
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

	describe("setActiveWork", () => {
		it("should create active-work.json file with work status", async () => {
			const workStatus = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			};

			await persistenceManager.setActiveWork(workStatus);

			const filePath = join(testDir, "active-work.json");
			expect(existsSync(filePath)).toBe(true);

			const fileContent = await readFile(filePath, "utf8");
			const savedStatus: ActiveWorkStatus = JSON.parse(fileContent);

			expect(savedStatus.isWorking).toBe(true);
			expect(savedStatus.issueId).toBe(workStatus.issueId);
			expect(savedStatus.issueIdentifier).toBe(workStatus.issueIdentifier);
			expect(savedStatus.repositoryId).toBe(workStatus.repositoryId);
			expect(savedStatus.sessionId).toBe(workStatus.sessionId);
			expect(savedStatus.startedAt).toBe(workStatus.startedAt);
			expect(savedStatus.lastUpdated).toBeDefined();
			expect(typeof savedStatus.lastUpdated).toBe("number");
		});

		it("should update lastUpdated timestamp when setting active work", async () => {
			const workStatus = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
				sessionId: "session-789",
				startedAt: Date.now(),
			};

			await persistenceManager.setActiveWork(workStatus);
			const status1 = await persistenceManager.getActiveWorkStatus();

			// Wait a bit to ensure timestamp changes
			await new Promise((resolve) => setTimeout(resolve, 10));

			await persistenceManager.setActiveWork(workStatus);
			const status2 = await persistenceManager.getActiveWorkStatus();

			expect(status2?.lastUpdated).toBeGreaterThan(status1!.lastUpdated!);
		});

		it("should handle minimal work status", async () => {
			const workStatus = {
				issueId: "issue-123",
			};

			await persistenceManager.setActiveWork(workStatus);

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(true);
			expect(status?.issueId).toBe("issue-123");
			expect(status?.issueIdentifier).toBeUndefined();
			expect(status?.repositoryId).toBeUndefined();
		});
	});

	describe("clearActiveWork", () => {
		it("should set isWorking to false", async () => {
			// First set active work
			await persistenceManager.setActiveWork({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
			});

			// Verify it's set
			let status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(true);

			// Clear it
			await persistenceManager.clearActiveWork();

			// Verify it's cleared
			status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(false);
			expect(status?.issueId).toBeUndefined();
			expect(status?.issueIdentifier).toBeUndefined();
			expect(status?.repositoryId).toBeUndefined();
			expect(status?.sessionId).toBeUndefined();
			expect(status?.startedAt).toBeUndefined();
			expect(status?.lastUpdated).toBeDefined();
		});

		it("should work even if no active work was set", async () => {
			await persistenceManager.clearActiveWork();

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status?.isWorking).toBe(false);
		});
	});

	describe("getActiveWorkStatus", () => {
		it("should return null if file does not exist", async () => {
			const status = await persistenceManager.getActiveWorkStatus();
			expect(status).toBeNull();
		});

		it("should return active work status when file exists", async () => {
			const workStatus = {
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
				repositoryId: "repo-456",
			};

			await persistenceManager.setActiveWork(workStatus);
			const status = await persistenceManager.getActiveWorkStatus();

			expect(status).not.toBeNull();
			expect(status?.isWorking).toBe(true);
			expect(status?.issueId).toBe(workStatus.issueId);
		});

		it("should return cleared status after clearing", async () => {
			await persistenceManager.setActiveWork({
				issueId: "issue-123",
			});
			await persistenceManager.clearActiveWork();

			const status = await persistenceManager.getActiveWorkStatus();
			expect(status).not.toBeNull();
			expect(status?.isWorking).toBe(false);
		});
	});

	describe("isCurrentlyWorking", () => {
		it("should return false when no status file exists", async () => {
			const isWorking = await persistenceManager.isCurrentlyWorking();
			expect(isWorking).toBe(false);
		});

		it("should return true when active work is set", async () => {
			await persistenceManager.setActiveWork({
				issueId: "issue-123",
			});

			const isWorking = await persistenceManager.isCurrentlyWorking();
			expect(isWorking).toBe(true);
		});

		it("should return false when active work is cleared", async () => {
			await persistenceManager.setActiveWork({
				issueId: "issue-123",
			});
			await persistenceManager.clearActiveWork();

			const isWorking = await persistenceManager.isCurrentlyWorking();
			expect(isWorking).toBe(false);
		});
	});

	describe("file format", () => {
		it("should write JSON in a readable format", async () => {
			await persistenceManager.setActiveWork({
				issueId: "issue-123",
				issueIdentifier: "TEAM-123",
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
				await persistenceManager.setActiveWork({
					issueId: `issue-${i}`,
				});

				const status = await persistenceManager.getActiveWorkStatus();
				expect(status?.issueId).toBe(`issue-${i}`);
			}
		});
	});
});
