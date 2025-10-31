import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Message,
	MessageRole,
	SessionState,
	SessionStatus,
} from "cyrus-interfaces";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSessionStorage } from "./FileSessionStorage.js";

describe("FileSessionStorage", () => {
	let storage: FileSessionStorage;
	let testDir: string;

	beforeEach(async () => {
		// Create a unique temp directory for each test
		testDir = join(
			tmpdir(),
			`cyrus-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(testDir, { recursive: true });
		storage = new FileSessionStorage(testDir);
	});

	afterEach(async () => {
		// Clean up test directory
		if (existsSync(testDir)) {
			await rm(testDir, { recursive: true, force: true });
		}
	});

	const createTestSession = (
		overrides?: Partial<SessionState>,
	): SessionState => ({
		id: "session-123",
		issueId: "issue-456",
		agentSessionId: "agent-789",
		startedAt: new Date("2025-01-31T12:00:00Z"),
		status: "running" as SessionStatus,
		messages: [],
		metadata: {},
		...overrides,
	});

	const createTestMessage = (overrides?: Partial<Message>): Message => ({
		id: "msg-1",
		role: "user" as MessageRole,
		content: "Test message",
		timestamp: new Date("2025-01-31T12:01:00Z"),
		...overrides,
	});

	describe("saveSession", () => {
		it("should save a session to the correct file path", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			const expectedPath = join(
				testDir,
				session.issueId,
				`session-${session.id}.json`,
			);
			expect(existsSync(expectedPath)).toBe(true);
		});

		it("should create issue directory if it doesn't exist", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			const issueDir = join(testDir, session.issueId);
			expect(existsSync(issueDir)).toBe(true);
		});

		it("should save session with messages", async () => {
			const session = createTestSession({
				messages: [
					createTestMessage({ id: "msg-1", content: "Hello" }),
					createTestMessage({ id: "msg-2", content: "World" }),
				],
			});

			await storage.saveSession(session);

			const loaded = await storage.loadSession(session.id);
			expect(loaded).not.toBeNull();
			expect(loaded!.messages).toHaveLength(2);
			expect(loaded!.messages[0].content).toBe("Hello");
			expect(loaded!.messages[1].content).toBe("World");
		});

		it("should update existing session", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			session.status = "completed";
			session.endedAt = new Date("2025-01-31T13:00:00Z");

			await storage.saveSession(session);

			const loaded = await storage.loadSession(session.id);
			expect(loaded!.status).toBe("completed");
			expect(loaded!.endedAt).toEqual(session.endedAt);
		});

		it("should create metadata file", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			const metadataPath = join(testDir, session.issueId, "metadata.json");
			expect(existsSync(metadataPath)).toBe(true);
		});

		it("should update metadata when session is saved", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			const metadataPath = join(testDir, session.issueId, "metadata.json");
			const metadataContent = await readFile(metadataPath, "utf8");
			const metadata = JSON.parse(metadataContent);

			expect(metadata[session.id]).toBeDefined();
			expect(metadata[session.id].id).toBe(session.id);
			expect(metadata[session.id].status).toBe(session.status);
		});
	});

	describe("loadSession", () => {
		it("should load an existing session", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			const loaded = await storage.loadSession(session.id);

			expect(loaded).not.toBeNull();
			expect(loaded!.id).toBe(session.id);
			expect(loaded!.issueId).toBe(session.issueId);
			expect(loaded!.agentSessionId).toBe(session.agentSessionId);
			expect(loaded!.status).toBe(session.status);
		});

		it("should return null for non-existent session", async () => {
			const loaded = await storage.loadSession("non-existent");

			expect(loaded).toBeNull();
		});

		it("should deserialize dates correctly", async () => {
			const session = createTestSession({
				startedAt: new Date("2025-01-31T12:00:00Z"),
				endedAt: new Date("2025-01-31T13:00:00Z"),
			});

			await storage.saveSession(session);

			const loaded = await storage.loadSession(session.id);

			expect(loaded!.startedAt).toBeInstanceOf(Date);
			expect(loaded!.startedAt.toISOString()).toBe("2025-01-31T12:00:00.000Z");
			expect(loaded!.endedAt).toBeInstanceOf(Date);
			expect(loaded!.endedAt!.toISOString()).toBe("2025-01-31T13:00:00.000Z");
		});

		it("should deserialize message timestamps correctly", async () => {
			const session = createTestSession({
				messages: [createTestMessage()],
			});

			await storage.saveSession(session);

			const loaded = await storage.loadSession(session.id);

			expect(loaded!.messages[0].timestamp).toBeInstanceOf(Date);
		});
	});

	describe("listSessions", () => {
		it("should return empty array for non-existent issue", async () => {
			const sessions = await storage.listSessions("non-existent");

			expect(sessions).toEqual([]);
		});

		it("should list all sessions for an issue", async () => {
			const session1 = createTestSession({ id: "session-1" });
			const session2 = createTestSession({ id: "session-2" });

			await storage.saveSession(session1);
			await storage.saveSession(session2);

			const sessions = await storage.listSessions(session1.issueId);

			expect(sessions).toHaveLength(2);
			expect(sessions.find((s) => s.id === "session-1")).toBeDefined();
			expect(sessions.find((s) => s.id === "session-2")).toBeDefined();
		});

		it("should only list sessions for the specified issue", async () => {
			const session1 = createTestSession({
				id: "session-1",
				issueId: "issue-1",
			});
			const session2 = createTestSession({
				id: "session-2",
				issueId: "issue-2",
			});

			await storage.saveSession(session1);
			await storage.saveSession(session2);

			const sessions = await storage.listSessions("issue-1");

			expect(sessions).toHaveLength(1);
			expect(sessions[0].id).toBe("session-1");
		});
	});

	describe("querySessions", () => {
		beforeEach(async () => {
			// Create test data
			const sessions = [
				createTestSession({
					id: "session-1",
					issueId: "issue-1",
					status: "running",
					startedAt: new Date("2025-01-31T10:00:00Z"),
				}),
				createTestSession({
					id: "session-2",
					issueId: "issue-1",
					status: "completed",
					startedAt: new Date("2025-01-31T11:00:00Z"),
					endedAt: new Date("2025-01-31T11:30:00Z"),
				}),
				createTestSession({
					id: "session-3",
					issueId: "issue-2",
					status: "failed",
					startedAt: new Date("2025-01-31T12:00:00Z"),
					endedAt: new Date("2025-01-31T12:15:00Z"),
				}),
			];

			for (const session of sessions) {
				await storage.saveSession(session);
			}
		});

		it("should filter by issueId", async () => {
			const results = await storage.querySessions({ issueId: "issue-1" });

			expect(results).toHaveLength(2);
			expect(results.every((s) => s.issueId === "issue-1")).toBe(true);
		});

		it("should filter by single status", async () => {
			const results = await storage.querySessions({ status: "completed" });

			expect(results).toHaveLength(1);
			expect(results[0].status).toBe("completed");
		});

		it("should filter by multiple statuses", async () => {
			const results = await storage.querySessions({
				status: ["completed", "failed"],
			});

			expect(results).toHaveLength(2);
			expect(
				results.every((s) => s.status === "completed" || s.status === "failed"),
			).toBe(true);
		});

		it("should filter by startedAfter", async () => {
			const results = await storage.querySessions({
				startedAfter: new Date("2025-01-31T10:30:00Z"),
			});

			expect(results).toHaveLength(2);
			expect(
				results.every((s) => s.startedAt >= new Date("2025-01-31T10:30:00Z")),
			).toBe(true);
		});

		it("should filter by startedBefore", async () => {
			const results = await storage.querySessions({
				startedBefore: new Date("2025-01-31T11:30:00Z"),
			});

			expect(results).toHaveLength(2);
			expect(
				results.every((s) => s.startedAt <= new Date("2025-01-31T11:30:00Z")),
			).toBe(true);
		});

		it("should filter by endedAfter", async () => {
			const results = await storage.querySessions({
				endedAfter: new Date("2025-01-31T11:20:00Z"),
			});

			expect(results).toHaveLength(2);
		});

		it("should filter by endedBefore", async () => {
			const results = await storage.querySessions({
				endedBefore: new Date("2025-01-31T11:40:00Z"),
			});

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("session-2");
		});

		it("should sort by startedAt ascending", async () => {
			const results = await storage.querySessions({
				sortBy: "startedAt",
				sortOrder: "asc",
			});

			expect(results).toHaveLength(3);
			expect(results[0].id).toBe("session-1");
			expect(results[1].id).toBe("session-2");
			expect(results[2].id).toBe("session-3");
		});

		it("should sort by startedAt descending (default)", async () => {
			const results = await storage.querySessions({});

			expect(results).toHaveLength(3);
			expect(results[0].id).toBe("session-3");
			expect(results[1].id).toBe("session-2");
			expect(results[2].id).toBe("session-1");
		});

		it("should apply limit", async () => {
			const results = await storage.querySessions({ limit: 2 });

			expect(results).toHaveLength(2);
		});

		it("should apply offset", async () => {
			const results = await storage.querySessions({
				offset: 1,
				sortBy: "startedAt",
				sortOrder: "asc",
			});

			expect(results).toHaveLength(2);
			expect(results[0].id).toBe("session-2");
		});

		it("should apply offset and limit together", async () => {
			const results = await storage.querySessions({
				offset: 1,
				limit: 1,
				sortBy: "startedAt",
				sortOrder: "asc",
			});

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("session-2");
		});

		it("should combine multiple filters", async () => {
			const results = await storage.querySessions({
				issueId: "issue-1",
				status: "completed",
				startedAfter: new Date("2025-01-31T10:30:00Z"),
			});

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("session-2");
		});
	});

	describe("deleteSession", () => {
		it("should delete an existing session", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			await storage.deleteSession(session.id);

			const loaded = await storage.loadSession(session.id);
			expect(loaded).toBeNull();
		});

		it("should throw error when deleting non-existent session", async () => {
			await expect(storage.deleteSession("non-existent")).rejects.toThrow();
		});

		it("should remove session from metadata", async () => {
			const session = createTestSession();

			await storage.saveSession(session);
			await storage.deleteSession(session.id);

			const metadataPath = join(testDir, session.issueId, "metadata.json");
			expect(existsSync(metadataPath)).toBe(false);
		});

		it("should remove empty issue directory", async () => {
			const session = createTestSession();

			await storage.saveSession(session);
			await storage.deleteSession(session.id);

			const issueDir = join(testDir, session.issueId);
			expect(existsSync(issueDir)).toBe(false);
		});

		it("should not remove issue directory if other sessions exist", async () => {
			const session1 = createTestSession({ id: "session-1" });
			const session2 = createTestSession({ id: "session-2" });

			await storage.saveSession(session1);
			await storage.saveSession(session2);

			await storage.deleteSession(session1.id);

			const issueDir = join(testDir, session1.issueId);
			expect(existsSync(issueDir)).toBe(true);
		});
	});

	describe("sessionExists", () => {
		it("should return true for existing session", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			const exists = await storage.sessionExists(session.id);
			expect(exists).toBe(true);
		});

		it("should return false for non-existent session", async () => {
			const exists = await storage.sessionExists("non-existent");
			expect(exists).toBe(false);
		});
	});

	describe("addMessage", () => {
		it("should add a message to existing session", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			const message = createTestMessage();
			await storage.addMessage(session.id, message);

			const loaded = await storage.loadSession(session.id);
			expect(loaded!.messages).toHaveLength(1);
			expect(loaded!.messages[0].id).toBe(message.id);
			expect(loaded!.messages[0].content).toBe(message.content);
		});

		it("should throw error when adding message to non-existent session", async () => {
			const message = createTestMessage();

			await expect(
				storage.addMessage("non-existent", message),
			).rejects.toThrow();
		});

		it("should preserve existing messages when adding new one", async () => {
			const session = createTestSession({
				messages: [createTestMessage({ id: "msg-1" })],
			});

			await storage.saveSession(session);

			const message2 = createTestMessage({ id: "msg-2" });
			await storage.addMessage(session.id, message2);

			const loaded = await storage.loadSession(session.id);
			expect(loaded!.messages).toHaveLength(2);
			expect(loaded!.messages[0].id).toBe("msg-1");
			expect(loaded!.messages[1].id).toBe("msg-2");
		});
	});

	describe("updateStatus", () => {
		it("should update session status", async () => {
			const session = createTestSession({ status: "running" });

			await storage.saveSession(session);

			await storage.updateStatus(session.id, "completed");

			const loaded = await storage.loadSession(session.id);
			expect(loaded!.status).toBe("completed");
		});

		it("should throw error when updating non-existent session", async () => {
			await expect(
				storage.updateStatus("non-existent", "completed"),
			).rejects.toThrow();
		});

		it("should set endedAt when marking as completed", async () => {
			const session = createTestSession({ status: "running" });

			await storage.saveSession(session);

			await storage.updateStatus(session.id, "completed");

			const loaded = await storage.loadSession(session.id);
			expect(loaded!.endedAt).toBeDefined();
			expect(loaded!.endedAt).toBeInstanceOf(Date);
		});

		it("should set endedAt when marking as failed", async () => {
			const session = createTestSession({ status: "running" });

			await storage.saveSession(session);

			await storage.updateStatus(session.id, "failed");

			const loaded = await storage.loadSession(session.id);
			expect(loaded!.endedAt).toBeDefined();
			expect(loaded!.endedAt).toBeInstanceOf(Date);
		});

		it("should not overwrite existing endedAt", async () => {
			const endedAt = new Date("2025-01-31T12:00:00Z");
			const session = createTestSession({
				status: "completed",
				endedAt,
			});

			await storage.saveSession(session);

			await storage.updateStatus(session.id, "failed");

			const loaded = await storage.loadSession(session.id);
			expect(loaded!.endedAt!.toISOString()).toBe(endedAt.toISOString());
		});
	});

	describe("directory structure", () => {
		it("should create correct directory structure", async () => {
			const session = createTestSession({
				issueId: "ISSUE-123",
				id: "session-abc",
			});

			await storage.saveSession(session);

			const issueDir = join(testDir, "ISSUE-123");
			const sessionFile = join(issueDir, "session-session-abc.json");
			const metadataFile = join(issueDir, "metadata.json");

			expect(existsSync(issueDir)).toBe(true);
			expect(existsSync(sessionFile)).toBe(true);
			expect(existsSync(metadataFile)).toBe(true);
		});

		it("should support multiple issues in base directory", async () => {
			const session1 = createTestSession({
				issueId: "issue-1",
				id: "session-1",
			});
			const session2 = createTestSession({
				issueId: "issue-2",
				id: "session-2",
			});

			await storage.saveSession(session1);
			await storage.saveSession(session2);

			const issues = await readdir(testDir);

			expect(issues).toContain("issue-1");
			expect(issues).toContain("issue-2");
		});
	});

	describe("error handling", () => {
		it("should handle corrupted session files gracefully", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			// Corrupt the session file
			const sessionPath = join(
				testDir,
				session.issueId,
				`session-${session.id}.json`,
			);
			await writeFile(sessionPath, "invalid json{{{", "utf8");

			const loaded = await storage.loadSession(session.id);
			expect(loaded).toBeNull();
		});

		it("should handle corrupted metadata gracefully", async () => {
			const session = createTestSession();

			await storage.saveSession(session);

			// Corrupt the metadata file
			const metadataPath = join(testDir, session.issueId, "metadata.json");
			await writeFile(metadataPath, "invalid json", "utf8");

			// Should still be able to save a new session
			const session2 = createTestSession({ id: "session-2" });
			await expect(storage.saveSession(session2)).resolves.not.toThrow();
		});
	});
});

// Helper to write files for testing
import { writeFile } from "node:fs/promises";
