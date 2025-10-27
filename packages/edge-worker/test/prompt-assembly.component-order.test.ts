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

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Add user authentication")
			.withLabels()
			.expectUserPrompt(`You are a masterful software engineer contributing to the undefined project.

<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>c3d4e5f6-a7b8-9012-cdef-123456789012</id>
  <identifier>CEE-789</identifier>
  <title>Build new feature</title>
  <description>
No description provided
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

User comment: Add user authentication`)
			.expectSystemPrompt(undefined)
			.expectPromptType("fallback")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});
});
