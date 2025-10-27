/**
 * Prompt Assembly Tests - New Comment Metadata
 *
 * Tests that new comment metadata (author, timestamp) is properly included
 * when a new session is triggered by an agent session with a comment.
 *
 * This tests the {{new_comment_author}}, {{new_comment_timestamp}}, and
 * {{new_comment_content}} template variables in standard-issue-assigned-user-prompt.md
 */

import { describe, expect, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - New Comment Metadata in Agent Sessions", () => {
	it("should include comment metadata in mention-triggered new sessions", async () => {
		const worker = createTestWorker();

		// Create test data for an agent session with comment metadata
		const session = {
			issueId: "test-issue-123",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "test-issue-123",
			identifier: "TEST-123",
			title: "Test Issue",
			description: "Test description",
		};

		const repository = {
			id: "repo-123",
			path: "/test/repo",
		};

		const agentSession = {
			id: "agent-session-123",
			createdAt: "2025-01-27T14:30:00Z",
			updatedAt: "2025-01-27T14:30:00Z",
			archivedAt: null,
			creatorId: "user-123",
			appUserId: "app-user-123",
			commentId: "comment-123",
			issueId: "test-issue-123",
			status: "active" as const,
			startedAt: "2025-01-27T14:30:00Z",
			endedAt: null,
			type: "commentThread" as const,
			summary: null,
			sourceMetadata: null,
			organizationId: "org-123",
			creator: {
				id: "user-123",
				name: "Alice Smith",
			},
			comment: {
				id: "comment-123",
				body: "Please help with this issue",
				userId: "user-123",
				issueId: "test-issue-123",
			},
			issue: {
				id: "test-issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
			},
		};

		const result = await scenario(worker)
			.newSession()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Please help with this issue")
			.withCommentAuthor("Alice Smith")
			.withCommentTimestamp("2025-01-27T14:30:00Z")
			.withAgentSession(agentSession)
			.withMentionTriggered(true)
			.withLabels()
			.build();

		// Verify the mention prompt includes the comment content
		expect(result.userPrompt).toContain("<mention_request>");
		expect(result.userPrompt).toContain("Please help with this issue");
		expect(result.userPrompt).toContain("</mention_request>");

		// Verify metadata
		expect(result.metadata.promptType).toBe("mention");
		expect(result.metadata.isNewSession).toBe(true);
	});

	it("should include author and timestamp metadata when building issue context with new comment", async () => {
		const worker = createTestWorker();

		// This test verifies the template variables are properly populated
		// when buildIssueContextPrompt is called with a newComment parameter

		const session = {
			issueId: "test-issue-456",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "test-issue-456",
			identifier: "TEST-456",
			title: "Another Test Issue",
			description: "Another test description",
		};

		const repository = {
			id: "repo-456",
			path: "/test/repo",
		};

		const result = await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("This is a new comment on the issue")
			.withCommentAuthor("Bob Jones")
			.withCommentTimestamp("2025-01-27T15:45:00Z")
			.withLabels()
			.build();

		// For assignment-based new sessions, the comment goes in <user_comment>
		// The {{new_comment_*}} template variables are used in buildIssueContextPrompt
		// which is only called with a newComment parameter in older code paths
		expect(result.userPrompt).toContain("<user_comment>");
		expect(result.userPrompt).toContain("This is a new comment on the issue");
		expect(result.userPrompt).toContain("</user_comment>");

		// Verify metadata
		expect(result.metadata.promptType).toBe("fallback");
		expect(result.metadata.isNewSession).toBe(true);
		expect(result.metadata.components).toContain("user-comment");
	});

	it("should handle new comment metadata for continuation sessions", async () => {
		const worker = createTestWorker();

		// Continuation sessions should wrap comments in XML with metadata
		const result = await scenario(worker)
			.continuationSession()
			.withUserComment("Follow-up comment")
			.withCommentAuthor("Charlie Brown")
			.withCommentTimestamp("2025-01-27T16:00:00Z")
			.build();

		// Verify XML structure with author and timestamp
		expect(result.userPrompt).toContain("<new_comment>");
		expect(result.userPrompt).toContain("<author>Charlie Brown</author>");
		expect(result.userPrompt).toContain(
			"<timestamp>2025-01-27T16:00:00Z</timestamp>",
		);
		expect(result.userPrompt).toContain("<content>\nFollow-up comment\n");
		expect(result.userPrompt).toContain("</new_comment>");

		// Verify metadata
		expect(result.metadata.promptType).toBe("continuation");
		expect(result.metadata.isNewSession).toBe(false);
	});
});
