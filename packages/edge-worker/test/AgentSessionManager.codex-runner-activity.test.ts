import { CodexRunner } from "cyrus-codex-runner";
import type { IIssueTrackerService } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

describe("AgentSessionManager - Codex tool activity mapping", () => {
	let manager: AgentSessionManager;
	let runner: CodexRunner;
	let mockIssueTracker: IIssueTrackerService;
	let createAgentActivitySpy: ReturnType<typeof vi.fn>;
	const sessionId = "test-session-codex";
	const issueId = "issue-codex";

	beforeEach(() => {
		mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-123" }),
			}),
			fetchIssue: vi.fn(),
			getIssueLabels: vi.fn().mockResolvedValue([]),
		} as any;

		createAgentActivitySpy = vi.spyOn(mockIssueTracker, "createAgentActivity");
		manager = new AgentSessionManager(mockIssueTracker);
		runner = new CodexRunner({
			workingDirectory: "/Users/connor/code/cyrus",
		});

		manager.createLinearAgentSession(
			sessionId,
			issueId,
			{
				id: issueId,
				identifier: "TEST-100",
				title: "Codex activity test",
				description: "",
				branchName: "test-branch",
			},
			{
				path: "/Users/connor/code/cyrus",
				isGitWorktree: false,
			},
		);
		manager.addAgentRunner(sessionId, runner);

		(runner as any).sessionInfo = {
			sessionId: "codex-session-1",
			startedAt: new Date(),
			isRunning: true,
		};
	});

	it("creates Linear action entries for Codex file_change events", async () => {
		(runner as any).handleEvent({
			type: "item.completed",
			item: {
				id: "patch_1",
				type: "file_change",
				changes: [
					{
						path: "/Users/connor/code/cyrus/packages/core/src/index.ts",
						kind: "update",
					},
				],
				status: "completed",
			},
		});

		for (const message of runner.getMessages()) {
			await manager.handleClaudeMessage(sessionId, message);
		}

		const calls = createAgentActivitySpy.mock.calls.map((call) => call[0]);
		expect(calls).toHaveLength(2);

		const actionWithParameter = calls.find(
			(call) =>
				call.content?.type === "action" &&
				call.content?.action === "Edit" &&
				typeof call.content?.parameter === "string",
		);
		expect(actionWithParameter).toBeDefined();
		expect(actionWithParameter?.content?.parameter).toContain(
			"packages/core/src/index.ts",
		);

		const actionWithResult = calls.find(
			(call) =>
				call.content?.type === "action" &&
				call.content?.action === "Edit" &&
				typeof call.content?.result === "string",
		);
		expect(actionWithResult).toBeDefined();
		expect(actionWithResult?.content?.result).toContain(
			"update packages/core/src/index.ts",
		);
	});
});
