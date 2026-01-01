/**
 * Prompt Assembly Tests - Ralph Wiggum Loop
 *
 * Tests that the Ralph Wiggum iteration info is added to the system prompt
 * when a session has active Ralph Wiggum state.
 *
 * @see https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-wiggum
 * @see https://platform.claude.com/docs/en/agent-sdk/plugins
 */

import { describe, expect, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Ralph Wiggum Loop", () => {
	it("should add iteration info to system prompt when Ralph Wiggum is active", async () => {
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

		// Verify system prompt contains Ralph Wiggum iteration info
		expect(result.systemPrompt).toBeDefined();
		expect(result.systemPrompt).toContain("## Ralph Wiggum Loop Status");
		expect(result.systemPrompt).toContain("You are in iteration 2 of 5");
		expect(result.systemPrompt).toContain(
			"When you output `<promise>DONE</promise>`, the loop will end",
		);
		expect(result.systemPrompt).toContain(
			"Do NOT output `<promise>DONE</promise>` until you have completed ALL iterations",
		);
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
		expect(result.systemPrompt).not.toContain("## Ralph Wiggum Loop Status");
		expect(result.systemPrompt).not.toContain("You are in iteration");
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
		expect(result.systemPrompt).not.toContain("## Ralph Wiggum Loop Status");
		expect(result.systemPrompt).not.toContain("You are in iteration");
	});

	it("should show correct iteration numbers for first iteration", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "ralph-wiggum-test-id-4",
			workspace: { path: "/test" },
			metadata: {
				ralphWiggum: {
					maxIterations: 3,
					currentIteration: 1, // First iteration
					originalPrompt: "Test prompt",
					isActive: true,
				},
			},
		};

		const issue = {
			id: "ralph-wiggum-test-id-4",
			identifier: "TEST-4",
			title: "First Iteration Test",
			description: "Test task for first iteration",
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

		// Verify system prompt shows iteration 1 of 3
		expect(result.systemPrompt).toContain("You are in iteration 1 of 3");
	});

	it("should show correct iteration numbers for last iteration", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "ralph-wiggum-test-id-5",
			workspace: { path: "/test" },
			metadata: {
				ralphWiggum: {
					maxIterations: 10,
					currentIteration: 10, // Last iteration
					originalPrompt: "Test prompt",
					isActive: true,
				},
			},
		};

		const issue = {
			id: "ralph-wiggum-test-id-5",
			identifier: "TEST-5",
			title: "Last Iteration Test",
			description: "Test task for last iteration",
		};

		const repository = {
			id: "repo-ralph-wiggum-test-5",
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

		// Verify system prompt shows iteration 10 of 10
		expect(result.systemPrompt).toContain("You are in iteration 10 of 10");
	});
});
