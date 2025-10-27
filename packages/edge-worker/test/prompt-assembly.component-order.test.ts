/**
 * Prompt Assembly Tests - Component Order
 *
 * Tests that prompt components are assembled in the correct order.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Component Order", () => {
	it("should assemble components in correct order: issue context, subroutine, user comment", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
			workspace: { path: "/test" },
			metadata: {
				procedure: {
					name: "full-development",
					currentSubroutineIndex: 0,
				},
			},
		};

		const issue = {
			id: "c3d4e5f6-a7b8-9012-cdef-123456789012",
			identifier: "CEE-789",
			title: "Build new feature",
		};

		const repository = {
			id: "repo-uuid-3456-7890-12cd-ef1234567890",
			path: "/test/repo",
		};

		// Note: This test verifies component ordering but doesn't check full prompt body
		// since subroutine prompts are loaded from files and may change
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Add user authentication")
			.withLabels()
			.expectPromptType("fallback")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});
});
