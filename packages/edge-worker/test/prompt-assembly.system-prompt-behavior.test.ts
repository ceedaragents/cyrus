/**
 * Prompt Assembly Tests - System Prompt Behavior
 *
 * Tests system prompt loading based on label configuration.
 */

import { describe, expect, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - System Prompt Behavior", () => {
	it("should return system prompt with shared instructions when no labels configured", async () => {
		const worker = createTestWorker();

		const session = {
			issueId: "d4e5f6a7-b8c9-0123-def1-234567890123",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "d4e5f6a7-b8c9-0123-def1-234567890123",
			identifier: "CEE-1000",
			title: "Task without system prompt",
			description: "Example task",
		};

		const repository = {
			id: "repo-uuid-4567-8901-23de-f12345678901",
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
			.expectUserPrompt(`<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>d4e5f6a7-b8c9-0123-def1-234567890123</id>
  <identifier>CEE-1000</identifier>
  <title>Task without system prompt</title>
  <description>
Example task
  </description>
  <state>Unknown</state>
  <priority>None</priority>
  <url></url>
</linear_issue>

<linear_comments>
No comments yet.
</linear_comments>`)
			.expectPromptType("fallback")
			.expectComponents("issue-context")
			.verify();

		// Verify system prompt contains shared instructions (but no label-based prompt)
		expect(result.systemPrompt).toBeDefined();
		expect(result.systemPrompt).toContain("<task_management_instructions>");
		expect(result.systemPrompt).toContain("<situation_assessment>");
		expect(result.systemPrompt).toContain("<execution_instructions>");
		expect(result.systemPrompt).not.toContain("builder");
		expect(result.systemPrompt).not.toContain("debugger");
	});

	it("should return label-based system prompt without shared instructions", async () => {
		// Create repository with labelPrompts configuration
		const repository = {
			id: "repo-uuid-5678-9012-34ef-123456789012",
			path: "/test/repo",
			linearToken: "test-token-123", // Mock token for testing
			labelPrompts: {
				builder: ["feature", "enhancement"],
				debugger: ["bug", "hotfix"],
			},
		};

		const worker = createTestWorker([repository]);

		const session = {
			issueId: "e5f6a7b8-c9d0-1234-ef12-345678901234",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "e5f6a7b8-c9d0-1234-ef12-345678901234",
			identifier: "CEE-2000",
			title: "Feature with builder prompt",
			description: "Task that should trigger builder system prompt",
		};

		const result = await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Build the payment integration")
			.withLabels("feature")
			.expectUserPrompt(`<git_context>
<repository>undefined</repository>
<base_branch>undefined</base_branch>
</git_context>

<linear_issue>
<id>e5f6a7b8-c9d0-1234-ef12-345678901234</id>
<identifier>CEE-2000</identifier>
<title>Feature with builder prompt</title>
<description>Task that should trigger builder system prompt</description>
<url></url>
<assignee>
<id></id>
<name></name>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Build the payment integration
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();

		// Verify system prompt contains ONLY label-based content (NO shared instructions)
		expect(result.systemPrompt).toBeDefined();
		expect(typeof result.systemPrompt).toBe("string");
		expect(result.systemPrompt?.length).toBeGreaterThan(0);

		// Check for label-based (builder) prompt content
		expect(result.systemPrompt).toContain("builder");
		expect(result.systemPrompt).toContain("Task tool");
		expect(result.systemPrompt).toContain("<builder_specific_instructions>");

		// Verify scenarios-system-prompt instructions are NOT included in label-based prompts
		// Check for unique content from scenarios-system-prompt that won't be in builder prompt
		expect(result.systemPrompt).not.toContain(
			"CRITICAL: You MUST use the TodoWrite and TodoRead tools extensively",
		);
		expect(result.systemPrompt).not.toContain("YOU ARE IN 1 OF 2 SITUATIONS");
		expect(result.systemPrompt).not.toContain("**Situation 1 - Execute**");
		expect(result.systemPrompt).not.toContain("**Situation 2 - Clarify**");
	});
});
