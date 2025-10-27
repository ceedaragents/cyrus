/**
 * Prompt Assembly Tests - Subroutines
 *
 * Tests that subroutine prompts are correctly included in prompt assembly
 * and verifies the full resultant prompts with subroutine content.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Subroutines", () => {
	it("should include coding-activity subroutine prompt in full-development procedure", async () => {
		const worker = createTestWorker();

		// Session with full-development procedure at coding-activity subroutine
		const session = {
			issueId: "f1a2b3c4-d5e6-7890-f1a2-b3c4d5e6f789",
			workspace: { path: "/test" },
			metadata: {
				procedure: {
					procedureName: "full-development",
					currentSubroutineIndex: 0, // coding-activity is first subroutine
				},
			},
		};

		const issue = {
			id: "f1a2b3c4-d5e6-7890-f1a2-b3c4d5e6f789",
			identifier: "CEE-3000",
			title: "Implement payment processing",
			description: "Add Stripe integration for payments",
		};

		const repository = {
			id: "repo-uuid-coding-test-1234",
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
			.expectPromptType("fallback")
			.expectComponents("issue-context", "subroutine-prompt")
			.expectSystemPrompt(`<task_management_instructions>
CRITICAL: You MUST use the TodoWrite and TodoRead tools extensively:
- IMMEDIATELY create a comprehensive task list at the beginning of your work
- Break down complex tasks into smaller, actionable items
- Mark tasks as 'in_progress' when you start them
- Mark tasks as 'completed' immediately after finishing them
- Only have ONE task 'in_progress' at a time
- Add new tasks as you discover them during your work
- Your first response should focus on creating a thorough task breakdown

Remember: Your first message is internal planning. Use this time to:
1. Thoroughly analyze the issue and requirements
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

2. Check branch status using git commands

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
			.expectUserPrompt(`<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>f1a2b3c4-d5e6-7890-f1a2-b3c4d5e6f789</id>
  <identifier>CEE-3000</identifier>
  <title>Implement payment processing</title>
  <description>
Add Stripe integration for payments
  </description>
  <state>Unknown</state>
  <priority>None</priority>
  <url></url>
</linear_issue>

<linear_comments>
No comments yet.
</linear_comments>

# Implementation Phase

Implement the requested changes:
- Write production-ready code
- Run tests to verify it works
- Follow existing patterns

**Do NOT**: commit, push, or create PRs (next phase handles that)

Complete with: \`Implementation complete - [what was done].\``)
			.verify();
	});

	it("should include question-investigation subroutine prompt in simple-question procedure", async () => {
		const worker = createTestWorker();

		// Session with simple-question procedure at investigation phase
		const session = {
			issueId: "a1b2c3d4-e5f6-7890-a1b2-c3d4e5f67890",
			workspace: { path: "/test" },
			metadata: {
				procedure: {
					procedureName: "simple-question",
					currentSubroutineIndex: 0, // question-investigation is first
				},
			},
		};

		const issue = {
			id: "a1b2c3d4-e5f6-7890-a1b2-c3d4e5f67890",
			identifier: "CEE-4000",
			title: "How does authentication work?",
			description: "Can you explain the authentication flow?",
		};

		const repository = {
			id: "repo-uuid-question-test-5678",
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
			.expectPromptType("fallback")
			.expectComponents("issue-context", "subroutine-prompt")
			.expectSystemPrompt(`<task_management_instructions>
CRITICAL: You MUST use the TodoWrite and TodoRead tools extensively:
- IMMEDIATELY create a comprehensive task list at the beginning of your work
- Break down complex tasks into smaller, actionable items
- Mark tasks as 'in_progress' when you start them
- Mark tasks as 'completed' immediately after finishing them
- Only have ONE task 'in_progress' at a time
- Add new tasks as you discover them during your work
- Your first response should focus on creating a thorough task breakdown

Remember: Your first message is internal planning. Use this time to:
1. Thoroughly analyze the issue and requirements
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

2. Check branch status using git commands

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
			.expectUserPrompt(`<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>a1b2c3d4-e5f6-7890-a1b2-c3d4e5f67890</id>
  <identifier>CEE-4000</identifier>
  <title>How does authentication work?</title>
  <description>
Can you explain the authentication flow?
  </description>
  <state>Unknown</state>
  <priority>None</priority>
  <url></url>
</linear_issue>

<linear_comments>
No comments yet.
</linear_comments>

# Investigate Question

Gather information to answer the question (DON'T answer yet):
- Search codebase for relevant files/functions
- Read necessary files
- Use tools if needed

Complete with: \`Investigation complete - gathered information from [sources].\``)
			.verify();
	});

	it("should include question-answer subroutine prompt in simple-question procedure", async () => {
		const worker = createTestWorker();

		// Session with simple-question procedure at answer phase
		const session = {
			issueId: "b2c3d4e5-f6a7-8901-b2c3-d4e5f6a78901",
			workspace: { path: "/test" },
			metadata: {
				procedure: {
					procedureName: "simple-question",
					currentSubroutineIndex: 1, // question-answer is second (index 1)
				},
			},
		};

		const issue = {
			id: "b2c3d4e5-f6a7-8901-b2c3-d4e5f6a78901",
			identifier: "CEE-5000",
			title: "How does caching work?",
			description: "Explain the caching implementation",
		};

		const repository = {
			id: "repo-uuid-answer-test-9012",
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
			.expectPromptType("fallback")
			.expectComponents("issue-context", "subroutine-prompt")
			.expectSystemPrompt(`<task_management_instructions>
CRITICAL: You MUST use the TodoWrite and TodoRead tools extensively:
- IMMEDIATELY create a comprehensive task list at the beginning of your work
- Break down complex tasks into smaller, actionable items
- Mark tasks as 'in_progress' when you start them
- Mark tasks as 'completed' immediately after finishing them
- Only have ONE task 'in_progress' at a time
- Add new tasks as you discover them during your work
- Your first response should focus on creating a thorough task breakdown

Remember: Your first message is internal planning. Use this time to:
1. Thoroughly analyze the issue and requirements
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

2. Check branch status using git commands

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
			.expectUserPrompt(`<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>b2c3d4e5-f6a7-8901-b2c3-d4e5f6a78901</id>
  <identifier>CEE-5000</identifier>
  <title>How does caching work?</title>
  <description>
Explain the caching implementation
  </description>
  <state>Unknown</state>
  <priority>None</priority>
  <url></url>
</linear_issue>

<linear_comments>
No comments yet.
</linear_comments>

# Answer Question

Provide a clear, direct answer using investigation findings:
- Use markdown formatting (posted to Linear)
- Include code references with line numbers
- Be complete but concise

Don't mention the investigation process - just answer the question.`)
			.verify();
	});
});
