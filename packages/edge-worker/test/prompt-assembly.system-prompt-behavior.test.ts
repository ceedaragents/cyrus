/**
 * Prompt Assembly Tests - System Prompt Behavior
 *
 * Tests system prompt loading based on label configuration.
 */

import { describe, expect, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - System Prompt Behavior", () => {
	it("should return undefined system prompt when no labels configured", async () => {
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

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("")
			.withLabels()
			.expectUserPrompt(`You are a masterful software engineer contributing to the undefined project.

<context>
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
</linear_comments>



<task_management_instructions>
CRITICAL: You MUST use the TodoWrite and TodoRead tools extensively:
- IMMEDIATELY create a comprehensive task list at the beginning of your work
- Break down complex tasks into smaller, actionable items
- Mark tasks as 'in_progress' when you start them
- Mark tasks as 'completed' immediately after finishing them
- Only have ONE task 'in_progress' at a time
- Add new tasks as you discover them during your work
- Your first response should focus on creating a thorough task breakdown

Remember: Your first message is internal planning. Use this time to:
1. Thoroughly analyze the 
2. Create detailed todos using TodoWrite
3. Plan your approach systematically
</task_management_instructions>

<situation_assessment>
YOU ARE IN 1 OF 2 SITUATIONS - determine which one:

**Situation 1 - Execute**: Clear problem definition AND clear solution definition
- Look for specific acceptance criteria, clear requirements, well-defined outcomes
- Action: Create implementation tasks and execute

**Situation 2 - Clarify**: Vague problem or unclear acceptance criteria  
- Look for ambiguities, missing requirements, unclear goals
- Action: Create investigation tasks and ask clarifying questions
</situation_assessment>

<execution_instructions>
### If Situation 1 (Execute):
1. Use TodoWrite to create tasks including:
   - Understanding current branch status
   - Implementation tasks (by component/feature)
   - Testing tasks

2. Check branch status:
   \`\`\`
   git diff undefined...HEAD
   \`\`\`

3. Work through tasks systematically
4. Ensure code quality throughout implementation

### If Situation 2 (Clarify):
1. Use TodoWrite to create investigation tasks
2. Explore codebase for context
3. DO NOT make code changes
4. Provide clear summary of:
   - What you understand
   - What needs clarification
   - Specific questions
   - Suggested acceptance criteria
</execution_instructions>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("fallback")
			.expectComponents("issue-context")
			.verify();
	});

	it("should return defined system prompt when labels match configuration", async () => {
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

User comment: Build the payment integration`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();

		// Verify system prompt is defined when labels match
		expect(result.systemPrompt).toBeDefined();
		expect(typeof result.systemPrompt).toBe("string");
		expect(result.systemPrompt?.length).toBeGreaterThan(0);
		expect(result.systemPrompt).toContain("builder");
		expect(result.systemPrompt).toContain("Task tool");
	});
});
