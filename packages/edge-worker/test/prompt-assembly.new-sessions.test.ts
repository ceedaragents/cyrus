/**
 * Prompt Assembly Tests - New Sessions
 *
 * Tests prompt assembly for new (initial) sessions with full issue context.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - New Sessions", () => {
	it("assignment-based (no labels) - should have undefined system prompt", async () => {
		const worker = createTestWorker();

		// Create minimal test data
		const session = {
			issueId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			identifier: "CEE-123",
			title: "Fix authentication bug",
			description: "Users cannot log in",
		};

		const repository = {
			id: "repo-uuid-1234-5678-90ab-cdef12345678",
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
  <id>a1b2c3d4-e5f6-7890-abcd-ef1234567890</id>
  <identifier>CEE-123</identifier>
  <title>Fix authentication bug</title>
  <description>
Users cannot log in
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

	it("assignment-based (with user comment) - should include user comment in prompt", async () => {
		const worker = createTestWorker();

		// Create minimal test data
		const session = {
			issueId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
			identifier: "CEE-456",
			title: "Implement new feature",
			description: "Add payment processing",
		};

		const repository = {
			id: "repo-uuid-2345-6789-01bc-def123456789",
			path: "/test/repo",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Please add Stripe integration")
			.withLabels()
			.expectUserPrompt(`You are a masterful software engineer contributing to the undefined project.

<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>b2c3d4e5-f6a7-8901-bcde-f12345678901</id>
  <identifier>CEE-456</identifier>
  <title>Implement new feature</title>
  <description>
Add payment processing
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
</execution_instructions>

User comment: Please add Stripe integration`)
			.expectSystemPrompt(undefined)
			.expectPromptType("fallback")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});
});
