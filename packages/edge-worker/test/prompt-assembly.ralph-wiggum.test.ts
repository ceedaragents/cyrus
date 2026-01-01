/**
 * Prompt Assembly Tests - Ralph Wiggum Loop
 *
 * Tests that Ralph Wiggum metadata does NOT affect the system prompt assembly.
 * Iteration tracking is handled by the Stop hook continuation prompt, not the
 * initial system prompt (since system prompts are only sent once at session start).
 *
 * @see https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-wiggum
 * @see https://platform.claude.com/docs/en/agent-sdk/plugins
 */

import { describe, expect, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Ralph Wiggum Loop", () => {
	it("should NOT add iteration info to system prompt (handled by Stop hook continuation)", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "ralph-wiggum-test-id-1",
			workspace: { path: "/test" },
			metadata: {
				ralphWiggum: {
					maxIterations: 5,
					currentIteration: 2,
					originalPrompt: "Test prompt",
					isActive: true,
				},
			},
		};

		const issue = {
			id: "ralph-wiggum-test-id-1",
			identifier: "TEST-1",
			title: "Ralph Wiggum Test",
			description: "Test task for Ralph Wiggum loop",
		};

		const repository = {
			id: "repo-ralph-wiggum-test",
			path: "/test/repo",
		};

		const result = await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("")
			.withLabels()
			.expectPromptType("fallback")
			.expectComponents("issue-context")
			.verify();

		// System prompt should NOT contain Ralph Wiggum iteration info
		// because system prompts are only sent once at session start.
		// The Stop hook handles iteration tracking via continuation prompts.
		expect(result.systemPrompt).toBeDefined();
		expect(result.systemPrompt).not.toContain("Ralph Wiggum");
		expect(result.systemPrompt).not.toContain("iteration");
		expect(result.systemPrompt).not.toContain("<promise>DONE</promise>");
	});

	it("should NOT add iteration info when Ralph Wiggum is inactive", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "ralph-wiggum-test-id-2",
			workspace: { path: "/test" },
			metadata: {
				ralphWiggum: {
					maxIterations: 5,
					currentIteration: 5,
					originalPrompt: "Test prompt",
					isActive: false, // Inactive - loop has ended
				},
			},
		};

		const issue = {
			id: "ralph-wiggum-test-id-2",
			identifier: "TEST-2",
			title: "Ralph Wiggum Inactive Test",
			description: "Test task for inactive Ralph Wiggum loop",
		};

		const repository = {
			id: "repo-ralph-wiggum-test-2",
			path: "/test/repo",
		};

		const result = await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("")
			.withLabels()
			.verify();

		// Verify system prompt does NOT contain Ralph Wiggum iteration info
		expect(result.systemPrompt).toBeDefined();
		expect(result.systemPrompt).not.toContain("Ralph Wiggum");
		expect(result.systemPrompt).not.toContain("iteration");
	});

	it("should NOT add iteration info when no Ralph Wiggum metadata exists", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "ralph-wiggum-test-id-3",
			workspace: { path: "/test" },
			metadata: {}, // No ralphWiggum metadata
		};

		const issue = {
			id: "ralph-wiggum-test-id-3",
			identifier: "TEST-3",
			title: "No Ralph Wiggum Test",
			description: "Test task without Ralph Wiggum",
		};

		const repository = {
			id: "repo-ralph-wiggum-test-3",
			path: "/test/repo",
		};

		const result = await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("")
			.withLabels()
			.verify();

		// Verify system prompt does NOT contain Ralph Wiggum iteration info
		expect(result.systemPrompt).toBeDefined();
		expect(result.systemPrompt).not.toContain("Ralph Wiggum");
		expect(result.systemPrompt).not.toContain("iteration");
	});

	it("should preserve Ralph Wiggum metadata in session for Stop hook to use", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "ralph-wiggum-test-id-4",
			workspace: { path: "/test" },
			metadata: {
				ralphWiggum: {
					maxIterations: 3,
					currentIteration: 1,
					originalPrompt: "Test prompt",
					isActive: true,
				},
			},
		};

		const issue = {
			id: "ralph-wiggum-test-id-4",
			identifier: "TEST-4",
			title: "Metadata Preservation Test",
			description: "Test that Ralph Wiggum metadata is preserved",
		};

		const repository = {
			id: "repo-ralph-wiggum-test-4",
			path: "/test/repo",
		};

		const result = await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("")
			.withLabels()
			.verify();

		// The prompt assembly should work normally - metadata is preserved
		// on the session object for the Stop hook to access later
		expect(result.systemPrompt).toBeDefined();
		expect(result.userPrompt).toBeDefined();
		// Session metadata remains intact for Stop hook to use
		expect(session.metadata.ralphWiggum).toBeDefined();
		expect(session.metadata.ralphWiggum.maxIterations).toBe(3);
		expect(session.metadata.ralphWiggum.currentIteration).toBe(1);
		expect(session.metadata.ralphWiggum.isActive).toBe(true);
	});
});
