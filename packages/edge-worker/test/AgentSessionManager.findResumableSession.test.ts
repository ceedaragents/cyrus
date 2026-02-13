import { AgentSessionStatus } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import type { IActivitySink } from "../src/sinks/IActivitySink";

/**
 * Tests for AgentSessionManager.findResumableSession()
 *
 * This method finds the most recent completed session with a captured
 * claudeSessionId for a given issueId, enabling session resume (--continue)
 * for subsequent comments on the same PR/issue.
 */
describe("AgentSessionManager - findResumableSession", () => {
	let manager: AgentSessionManager;
	let mockActivitySink: IActivitySink;
	const issueId = "repo/owner#42";

	beforeEach(() => {
		mockActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-123" }),
			createAgentSession: vi.fn().mockResolvedValue("session-123"),
		};

		manager = new AgentSessionManager(mockActivitySink);
	});

	function createSession(
		sessionId: string,
		forIssueId: string,
		platform: "github" | "linear" = "github",
	) {
		manager.createLinearAgentSession(
			sessionId,
			forIssueId,
			{
				id: forIssueId,
				identifier: "repo#42",
				title: "Test PR",
				branchName: "fix/test",
			},
			{ path: "/test/workspace", isGitWorktree: false },
			platform,
		);
	}

	it("returns undefined when no sessions exist for issueId", () => {
		const result = manager.findResumableSession(issueId);
		expect(result).toBeUndefined();
	});

	it("returns undefined when sessions exist but none are complete", () => {
		createSession("github-delivery-1", issueId);
		// Session is Active by default after creation

		const result = manager.findResumableSession(issueId);
		expect(result).toBeUndefined();
	});

	it("returns undefined when completed session has no claudeSessionId", () => {
		createSession("github-delivery-1", issueId);
		const session = manager.getSession("github-delivery-1")!;
		session.status = AgentSessionStatus.Complete;
		session.updatedAt = Date.now();

		const result = manager.findResumableSession(issueId);
		expect(result).toBeUndefined();
	});

	it("returns the most recent completed session with claudeSessionId", () => {
		createSession("github-delivery-1", issueId);
		const session = manager.getSession("github-delivery-1")!;
		session.status = AgentSessionStatus.Complete;
		session.claudeSessionId = "claude-abc-123";
		session.updatedAt = Date.now();

		const result = manager.findResumableSession(issueId);
		expect(result).toBeDefined();
		expect(result!.id).toBe("github-delivery-1");
		expect(result!.claudeSessionId).toBe("claude-abc-123");
	});

	it("excludes errored sessions", () => {
		createSession("github-delivery-1", issueId);
		const session = manager.getSession("github-delivery-1")!;
		session.status = AgentSessionStatus.Error;
		session.claudeSessionId = "claude-abc-123";
		session.updatedAt = Date.now();

		const result = manager.findResumableSession(issueId);
		expect(result).toBeUndefined();
	});

	it("returns most recent when multiple completed sessions exist", () => {
		// Older session
		createSession("github-delivery-1", issueId);
		const session1 = manager.getSession("github-delivery-1")!;
		session1.status = AgentSessionStatus.Complete;
		session1.claudeSessionId = "claude-old";
		session1.updatedAt = 1000;

		// Newer session
		createSession("github-delivery-2", issueId);
		const session2 = manager.getSession("github-delivery-2")!;
		session2.status = AgentSessionStatus.Complete;
		session2.claudeSessionId = "claude-new";
		session2.updatedAt = 2000;

		const result = manager.findResumableSession(issueId);
		expect(result).toBeDefined();
		expect(result!.id).toBe("github-delivery-2");
		expect(result!.claudeSessionId).toBe("claude-new");
	});

	it("does not return sessions from a different issueId", () => {
		createSession("github-delivery-1", "different-issue");
		const session = manager.getSession("github-delivery-1")!;
		session.status = AgentSessionStatus.Complete;
		session.claudeSessionId = "claude-abc-123";
		session.updatedAt = Date.now();

		const result = manager.findResumableSession(issueId);
		expect(result).toBeUndefined();
	});

	it("works with GitHub platform sessions", () => {
		createSession("github-delivery-1", issueId, "github");
		const session = manager.getSession("github-delivery-1")!;
		session.status = AgentSessionStatus.Complete;
		session.claudeSessionId = "claude-github-session";
		session.updatedAt = Date.now();

		const result = manager.findResumableSession(issueId);
		expect(result).toBeDefined();
		expect(result!.claudeSessionId).toBe("claude-github-session");
	});

	it("skips active sessions even with claudeSessionId", () => {
		createSession("github-delivery-1", issueId);
		const session = manager.getSession("github-delivery-1")!;
		// Session is Active (default), but has a claudeSessionId
		session.claudeSessionId = "claude-abc-123";
		session.updatedAt = Date.now();

		const result = manager.findResumableSession(issueId);
		expect(result).toBeUndefined();
	});
});
