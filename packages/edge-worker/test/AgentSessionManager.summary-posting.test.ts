import type {
	SDKAssistantMessage,
	SDKResultMessage,
} from "cyrus-claude-runner";
import type { IIssueTrackerService } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";
import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";
import { PROCEDURES } from "../src/procedures/registry";

/**
 * Tests for summary message posting behavior.
 *
 * Bug: CYPACK-559 - Summary messages aren't being posted to Linear
 *
 * When a summary subroutine (like concise-summary) has suppressThoughtPosting=true:
 * - Intermediate "thought" and "action" activities should be suppressed
 * - But the final summary from the result message should still be posted as a "response"
 *
 * The issue is that the assistant message containing the summary is classified as
 * a "thought" and suppressed, and the result message's "response" activity should
 * still be posted to Linear.
 */
describe("AgentSessionManager - Summary Posting", () => {
	let agentSessionManager: AgentSessionManager;
	let procedureAnalyzer: ProcedureAnalyzer;
	let mockIssueTracker: IIssueTrackerService;
	let createAgentActivitySpy: ReturnType<typeof vi.spyOn>;

	const sessionId = "test-session-123";
	const issueId = "issue-123";
	const claudeSessionId = "claude-session-456";

	beforeEach(() => {
		// Create mock IIssueTrackerService
		mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-123" }),
			}),
			fetchIssue: vi.fn(),
			getIssueLabels: vi.fn().mockResolvedValue([]),
		} as unknown as IIssueTrackerService;

		createAgentActivitySpy = vi.spyOn(
			mockIssueTracker,
			"createAgentActivity",
		) as any;

		// Create ProcedureAnalyzer
		procedureAnalyzer = new ProcedureAnalyzer({
			cyrusHome: "/test/.cyrus",
		});

		// Create AgentSessionManager with procedure analyzer
		agentSessionManager = new AgentSessionManager(
			mockIssueTracker,
			undefined, // getParentSessionId
			undefined, // resumeParentSession
			procedureAnalyzer,
		);

		// Create a test session
		agentSessionManager.createLinearAgentSession(
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
	});

	describe("suppressThoughtPosting behavior", () => {
		it("should suppress thought activities during summary subroutine", async () => {
			// Setup: Initialize procedure and advance to concise-summary
			const session = agentSessionManager.getSession(sessionId)!;
			const fullDevProcedure = PROCEDURES["full-development"];
			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Advance to concise-summary (last subroutine)
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId); // coding-activity -> verifications
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId); // verifications -> git-gh
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId); // git-gh -> concise-summary

			// Verify we're at concise-summary with suppression enabled
			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("concise-summary");
			expect(currentSubroutine?.suppressThoughtPosting).toBe(true);

			// Update session with Claude session ID
			session.claudeSessionId = claudeSessionId;

			// Reset spy to clear any previous calls
			createAgentActivitySpy.mockClear();

			// Simulate an assistant message (which would contain the summary)
			const assistantMessage: SDKAssistantMessage = {
				type: "assistant",
				session_id: claudeSessionId,
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "## Summary\n\nI have completed the implementation as requested.",
						},
					],
				},
			};

			await agentSessionManager.handleClaudeMessage(
				sessionId,
				assistantMessage,
			);

			// The assistant message should be SUPPRESSED (not posted to Linear)
			// because it's classified as a "thought" and suppressThoughtPosting is true
			const thoughtCalls = createAgentActivitySpy.mock.calls.filter(
				(call: any) => call[0]?.content?.type === "thought",
			);
			expect(thoughtCalls).toHaveLength(0);
		});

		it("should post result as response activity when summary subroutine completes", async () => {
			// Setup: Initialize procedure and advance to concise-summary
			const session = agentSessionManager.getSession(sessionId)!;
			const fullDevProcedure = PROCEDURES["full-development"];
			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Advance to concise-summary (last subroutine)
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);

			// Verify we're at concise-summary
			const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
			expect(currentSubroutine?.name).toBe("concise-summary");

			// Update session with Claude session ID
			session.claudeSessionId = claudeSessionId;

			// Reset spy
			createAgentActivitySpy.mockClear();

			// Simulate the result message with the summary content
			const resultMessage: SDKResultMessage = {
				type: "result",
				subtype: "success",
				session_id: claudeSessionId,
				duration_ms: 5000,
				duration_api_ms: 4500,
				is_error: false,
				num_turns: 1,
				result:
					"## Summary\n\nI have completed the implementation as requested.",
				total_cost_usd: 0.01,
				usage: {
					input_tokens: 1000,
					output_tokens: 500,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
				modelUsage: {},
				permission_denials: [],
				uuid: "test-uuid" as any,
			};

			await agentSessionManager.handleClaudeMessage(sessionId, resultMessage);

			// The result should be posted as a "response" activity
			// This verifies the bug fix: response activities should NOT be suppressed
			const responseCalls = createAgentActivitySpy.mock.calls.filter(
				(call: any) => call[0]?.content?.type === "response",
			);

			// Response activities are NOT suppressed, only thoughts and actions
			expect(responseCalls).toHaveLength(1);
			expect(responseCalls[0][0]).toMatchObject({
				agentSessionId: sessionId,
				content: {
					type: "response",
					body: "## Summary\n\nI have completed the implementation as requested.",
				},
			});
		});

		it("should handle complete summary subroutine flow: suppress thoughts but post response", async () => {
			// Setup: Initialize procedure and advance to concise-summary
			const session = agentSessionManager.getSession(sessionId)!;
			const fullDevProcedure = PROCEDURES["full-development"];
			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Advance to concise-summary (last subroutine)
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);

			// Update session with Claude session ID
			session.claudeSessionId = claudeSessionId;

			// Reset spy
			createAgentActivitySpy.mockClear();

			const summaryText =
				"## Summary\n\nImplementation complete. Created PR #123.";

			// Step 1: Claude sends an assistant message with the summary
			const assistantMessage: SDKAssistantMessage = {
				type: "assistant",
				session_id: claudeSessionId,
				message: {
					role: "assistant",
					content: [{ type: "text", text: summaryText }],
				},
			};
			await agentSessionManager.handleClaudeMessage(
				sessionId,
				assistantMessage,
			);

			// Step 2: Claude sends the result message
			const resultMessage: SDKResultMessage = {
				type: "result",
				subtype: "success",
				session_id: claudeSessionId,
				duration_ms: 5000,
				duration_api_ms: 4500,
				is_error: false,
				num_turns: 1,
				result: summaryText, // Claude includes the final text in the result
				total_cost_usd: 0.01,
				usage: {
					input_tokens: 1000,
					output_tokens: 500,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
				modelUsage: {},
				permission_denials: [],
				uuid: "test-uuid" as any,
			};
			await agentSessionManager.handleClaudeMessage(sessionId, resultMessage);

			// Verify: assistant message (thought) should be SUPPRESSED
			const thoughtCalls = createAgentActivitySpy.mock.calls.filter(
				(call: any) => call[0]?.content?.type === "thought",
			);
			expect(thoughtCalls).toHaveLength(0);

			// Verify: result message (response) should be POSTED
			const responseCalls = createAgentActivitySpy.mock.calls.filter(
				(call: any) => call[0]?.content?.type === "response",
			);

			// Response activities are NOT suppressed, only thoughts and actions
			expect(responseCalls).toHaveLength(1);
			expect(responseCalls[0][0].content.body).toBe(summaryText);
		});
	});

	describe("Edge cases", () => {
		it("should still post response when result field is populated", async () => {
			// This test verifies the condition: if ("result" in resultMessage && resultMessage.result)
			const session = agentSessionManager.getSession(sessionId)!;
			const fullDevProcedure = PROCEDURES["full-development"];
			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Advance to concise-summary
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);

			session.claudeSessionId = claudeSessionId;
			createAgentActivitySpy.mockClear();

			// Result message with populated result field
			const resultMessage: SDKResultMessage = {
				type: "result",
				subtype: "success",
				session_id: claudeSessionId,
				duration_ms: 5000,
				duration_api_ms: 4500,
				is_error: false,
				num_turns: 1,
				result: "This is the summary text that should be posted.",
				total_cost_usd: 0.01,
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
				modelUsage: {},
				permission_denials: [],
				uuid: "test-uuid" as any,
			};

			await agentSessionManager.handleClaudeMessage(sessionId, resultMessage);

			// Verify response was posted
			const responseCalls = createAgentActivitySpy.mock.calls.filter(
				(call: any) => call[0]?.content?.type === "response",
			);

			expect(responseCalls).toHaveLength(1);
			expect(responseCalls[0][0].content.body).toBe(
				"This is the summary text that should be posted.",
			);
		});

		it("should post response even when result field is empty string", async () => {
			// After fix: empty result fields should still trigger response posting
			// The condition now only checks for field presence, not truthiness
			const session = agentSessionManager.getSession(sessionId)!;
			const fullDevProcedure = PROCEDURES["full-development"];
			procedureAnalyzer.initializeProcedureMetadata(session, fullDevProcedure);

			// Advance to concise-summary
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);
			procedureAnalyzer.advanceToNextSubroutine(session, claudeSessionId);

			session.claudeSessionId = claudeSessionId;
			createAgentActivitySpy.mockClear();

			// Result message with EMPTY result field
			const resultMessage: SDKResultMessage = {
				type: "result",
				subtype: "success",
				session_id: claudeSessionId,
				duration_ms: 5000,
				duration_api_ms: 4500,
				is_error: false,
				num_turns: 1,
				result: "", // Empty string - now handled correctly
				total_cost_usd: 0.01,
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
				modelUsage: {},
				permission_denials: [],
				uuid: "test-uuid" as any,
			};

			await agentSessionManager.handleClaudeMessage(sessionId, resultMessage);

			// After fix: response IS posted even with empty string result
			const responseCalls = createAgentActivitySpy.mock.calls.filter(
				(call: any) => call[0]?.content?.type === "response",
			);

			// Fixed behavior: empty response is still posted
			expect(responseCalls).toHaveLength(1);
			expect(responseCalls[0][0].content.body).toBe("");
		});
	});
});
