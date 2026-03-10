import type { SDKSystemMessage } from "cyrus-claude-runner";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { GlobalSessionRegistry } from "../src/GlobalSessionRegistry.js";
import type { IActivitySink } from "../src/sinks/IActivitySink.js";

describe("AgentSessionManager - repository association sync", () => {
	it("syncs created sessions and subsequent lifecycle updates into the global registry", async () => {
		const activitySink: IActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-123" }),
			createAgentSession: vi.fn().mockResolvedValue("session-123"),
		};
		const registry = new GlobalSessionRegistry();
		const manager = new AgentSessionManager(activitySink, registry);

		manager.createLinearAgentSession(
			"session-1",
			"issue-1",
			{
				id: "issue-1",
				identifier: "TEST-1",
				title: "Test issue",
				branchName: "test-1",
			},
			{ path: "/tmp/test-1", isGitWorktree: false },
			"linear",
			{
				repositoryId: "repo-1",
				associationOrigin: "restored",
				status: "selected",
			},
		);

		const systemMessage = {
			type: "system",
			subtype: "init",
			session_id: "claude-session-1",
			model: "claude-sonnet-4-5-20250514",
			tools: ["Read", "Edit"],
			permissionMode: "default",
			apiKeySource: "user",
		} as SDKSystemMessage;

		manager.updateAgentSessionWithClaudeSessionId("session-1", systemMessage);

		expect(registry.getSessionsByRepositoryId("repo-1")).toHaveLength(1);
		expect(registry.getSession("session-1")).toMatchObject({
			claudeSessionId: "claude-session-1",
			repositoryAssociations: [
				{
					repositoryId: "repo-1",
					associationOrigin: "restored",
					status: "selected",
				},
			],
			metadata: {
				model: "claude-sonnet-4-5-20250514",
				tools: ["Read", "Edit"],
			},
		});
	});

	it("can sync restored state into the global registry when requested", () => {
		const activitySink: IActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-123" }),
			createAgentSession: vi.fn().mockResolvedValue("session-123"),
		};
		const registry = new GlobalSessionRegistry();
		const manager = new AgentSessionManager(activitySink, registry);

		manager.restoreState(
			{
				"session-restore": {
					id: "session-restore",
					externalSessionId: "session-restore",
					type: "comment-thread",
					status: "active",
					context: "comment-thread",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					issueContext: {
						trackerId: "linear",
						issueId: "issue-restore",
						issueIdentifier: "TEST-RESTORE",
					},
					issueId: "issue-restore",
					issue: {
						id: "issue-restore",
						identifier: "TEST-RESTORE",
						title: "Restored issue",
						branchName: "restore-branch",
					},
					repositoryAssociations: [
						{
							repositoryId: "repo-restore",
							associationOrigin: "restored",
							status: "selected",
						},
					],
					workspace: {
						path: "/tmp/restore",
						isGitWorktree: false,
					},
				},
			},
			{
				"session-restore": [
					{
						type: "user",
						content: "hello",
						metadata: { timestamp: Date.now() },
					},
				],
			},
			{ syncRegistry: true },
		);

		expect(registry.getSession("session-restore")).toMatchObject({
			id: "session-restore",
			repositoryAssociations: [
				{
					repositoryId: "repo-restore",
					associationOrigin: "restored",
					status: "selected",
				},
			],
		});
		expect(registry.getEntries("session-restore")).toHaveLength(1);
	});
});
