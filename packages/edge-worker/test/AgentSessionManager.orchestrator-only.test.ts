import type {
	SDKAssistantMessage,
	SDKSystemMessage,
} from "cyrus-claude-runner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import type { IActivitySink } from "../src/sinks/IActivitySink";

describe("AgentSessionManager - orchestrator-only visibility", () => {
	let manager: AgentSessionManager;
	let mockActivitySink: IActivitySink;
	const sessionId = "test-session-123";
	const issueId = "issue-123";

	beforeEach(() => {
		mockActivitySink = {
			id: "test-workspace",
			postActivity: vi.fn().mockResolvedValue({ activityId: "activity-123" }),
			createAgentSession: vi.fn().mockResolvedValue("session-123"),
		};

		manager = new AgentSessionManager();
		manager.createCyrusAgentSession(
			sessionId,
			issueId,
			{
				id: issueId,
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				branchName: "test-branch",
			},
			{
				path: "/test/workspace",
				isGitWorktree: false,
			},
		);
		manager.setActivitySink(sessionId, mockActivitySink);
		manager.addAgentRunner(sessionId, {
			constructor: { name: "CodexRunner" },
		} as any);

		const session = manager.getSession(sessionId)!;
		session.metadata = {
			agentExecution: {
				mode: "external_launcher",
				runner: "codex",
				command: "/Users/top/bin/codex-api-kk",
				visibility: "orchestrator_only",
			},
		};
	});

	it("suppresses model and raw assistant activity while still recording the codex session id", async () => {
		const systemMessage: SDKSystemMessage = {
			type: "system",
			subtype: "init",
			session_id: "codex-session-123",
			model: "gpt-5-codex",
			tools: ["Read", "Edit"],
			permissionMode: "allowed_tools",
			apiKeySource: "codex_home",
		};
		const assistantMessage: SDKAssistantMessage = {
			type: "assistant",
			session_id: "codex-session-123",
			parent_tool_use_id: null,
			message: {
				id: "msg_1",
				role: "assistant",
				content: [{ type: "text", text: "Internal runner thinking" }],
			} as any,
		};

		await manager.handleClaudeMessage(sessionId, systemMessage);
		await manager.handleClaudeMessage(sessionId, assistantMessage);

		expect(manager.getSession(sessionId)?.codexSessionId).toBe(
			"codex-session-123",
		);
		expect(mockActivitySink.postActivity).not.toHaveBeenCalled();
		expect(manager.getSessionEntries(sessionId)).toHaveLength(0);
	});
});
