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
		const worker = createTestWorker([], "ceedar");

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
			url: "https://linear.app/ceedar/issue/CEE-3000",
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
</task_management_instructions>`)
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
  <url>https://linear.app/ceedar/issue/CEE-3000</url>
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
		const worker = createTestWorker([], "ceedar");

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
			url: "https://linear.app/ceedar/issue/CEE-4000",
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
</task_management_instructions>`)
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
  <url>https://linear.app/ceedar/issue/CEE-4000</url>
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
		const worker = createTestWorker([], "ceedar");

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
			url: "https://linear.app/ceedar/issue/CEE-5000",
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
</task_management_instructions>`)
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
  <url>https://linear.app/ceedar/issue/CEE-5000</url>
</linear_issue>

<linear_comments>
No comments yet.
</linear_comments>

# Answer Question

Provide a clear, direct answer using investigation findings:
- Present in Linear-compatible markdown (supports \`+++collapsible+++\`, @mentions via \`https://linear.app/ceedar/profiles/username\`)
- Include code references with line numbers
- Be complete but concise

Don't mention the investigation process - just answer the question.`)
			.verify();
	});

	it("should include user-testing subroutine prompt in user-testing procedure", async () => {
		const worker = createTestWorker([], "ceedar");

		// Session with user-testing procedure at user-testing subroutine
		const session = {
			issueId: "c3d4e5f6-a7b8-9012-c3d4-e5f6a7b89012",
			workspace: { path: "/test" },
			metadata: {
				procedure: {
					procedureName: "user-testing",
					currentSubroutineIndex: 0, // user-testing is first subroutine
				},
			},
		};

		const issue = {
			id: "c3d4e5f6-a7b8-9012-c3d4-e5f6a7b89012",
			identifier: "CEE-6000",
			title: "Test the checkout flow",
			description: "Please test the checkout flow manually",
			url: "https://linear.app/ceedar/issue/CEE-6000",
		};

		const repository = {
			id: "repo-uuid-testing-test-3456",
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
</task_management_instructions>`)
			.expectUserPrompt(`<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>c3d4e5f6-a7b8-9012-c3d4-e5f6a7b89012</id>
  <identifier>CEE-6000</identifier>
  <title>Test the checkout flow</title>
  <description>
Please test the checkout flow manually
  </description>
  <state>Unknown</state>
  <priority>None</priority>
  <url>https://linear.app/ceedar/issue/CEE-6000</url>
</linear_issue>

<linear_comments>
No comments yet.
</linear_comments>

# User Testing Phase

Perform testing as requested by the user. This subroutine allows interactive testing based on user instructions.

## Your Task

Execute the testing activities requested by the user:

### 1. Understand the Testing Request
- Review the user's testing requirements from the issue description
- Identify what needs to be tested (features, workflows, integrations, etc.)
- Clarify the scope and success criteria for the testing

### 2. Execute Tests
- Run the tests or testing scenarios as requested
- Follow any specific testing instructions provided by the user
- Document test results and observations as you go
- Note any unexpected behavior or issues discovered

### 3. Interactive Testing
- Be responsive to user feedback during the testing process
- The user may provide additional instructions or adjustments mid-session
- Adapt your testing approach based on user guidance
- Report progress and findings to enable real-time feedback

### 4. Document Findings
- Track all test results (pass/fail/observations)
- Note any bugs, issues, or areas of concern discovered
- Document reproduction steps for any failures
- Capture relevant logs, error messages, or screenshots if applicable

## Important Notes

- **Do NOT commit or push changes** - that happens in a separate subroutine if needed
- **Do NOT create or update PRs** - focus on testing only
- **Be thorough and methodical** - test systematically based on user requirements
- **Communicate clearly** - report findings as you discover them
- **Follow user instructions** - this is a user-driven testing session

## Expected Output

Provide a completion message summarizing the testing session:

\`\`\`
Testing complete - [X] scenarios tested, [Y] passed, [Z] issues found.
\`\`\`

Example: "Testing complete - 5 scenarios tested, 4 passed, 1 issue found (login redirect failure)."
`)
			.verify();
	});

	it("should include user-testing-summary subroutine prompt in user-testing procedure", async () => {
		const worker = createTestWorker([], "ceedar");

		// Session with user-testing procedure at summary phase
		const session = {
			issueId: "d4e5f6a7-b8c9-0123-d4e5-f6a7b8c90123",
			workspace: { path: "/test" },
			metadata: {
				procedure: {
					procedureName: "user-testing",
					currentSubroutineIndex: 1, // user-testing-summary is second (index 1)
				},
			},
		};

		const issue = {
			id: "d4e5f6a7-b8c9-0123-d4e5-f6a7b8c90123",
			identifier: "CEE-7000",
			title: "Test the login flow",
			description: "Please test the login flow manually",
			url: "https://linear.app/ceedar/issue/CEE-7000",
		};

		const repository = {
			id: "repo-uuid-summary-test-7890",
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
</task_management_instructions>`)
			.expectUserPrompt(`<context>
  <repository>undefined</repository>
  <working_directory>undefined</working_directory>
  <base_branch>undefined</base_branch>
</context>

<linear_issue>
  <id>d4e5f6a7-b8c9-0123-d4e5-f6a7b8c90123</id>
  <identifier>CEE-7000</identifier>
  <title>Test the login flow</title>
  <description>
Please test the login flow manually
  </description>
  <state>Unknown</state>
  <priority>None</priority>
  <url>https://linear.app/ceedar/issue/CEE-7000</url>
</linear_issue>

<linear_comments>
No comments yet.
</linear_comments>

# User Testing Summary - Final Response for Linear

Generate a comprehensive summary of the user testing session for posting to Linear.

## Your Task

Create a clear, structured summary that covers:

### 1. Testing Overview
- What was tested (features, workflows, integrations)
- Testing approach and methodology used
- Scope of the testing session

### 2. Test Results
- Total number of scenarios/tests executed
- Pass/fail breakdown
- Key observations and findings

### 3. Issues Discovered (if any)
- Description of each issue found
- Severity assessment (critical/high/medium/low)
- Reproduction steps for failures
- Relevant error messages or logs

### 4. Recommendations
- Suggested fixes or follow-up actions
- Areas that may need additional testing
- Any improvements identified during testing

## Format Requirements

- **Be concise but comprehensive** - aim for a well-structured summary
- Use clear, professional language suitable for Linear
- Use markdown formatting for readability
- Focus on what matters to stakeholders
- **To mention someone**: Use \`https://linear.app/ceedar/profiles/username\` syntax where \`username\` is the Linear username (e.g., \`https://linear.app/ceedar/profiles/alice\` to mention @alice)

## Constraints

- **You have exactly 1 turn** - generate the summary in a single response
- This is the final output that will be posted to Linear
- Make it informative and actionable

## Example Format

\`\`\`
## Testing Summary

[Brief overview of what was tested and the testing approach]

### Results

| Status | Count |
|--------|-------|
| ✅ Passed | X |
| ❌ Failed | Y |
| ⚠️ Observations | Z |

+++Test Details
- [Test 1]: [Result and notes]
- [Test 2]: [Result and notes]
+++

+++Issues Found
1. **[Issue title]** - [Severity]
   - Description: [What went wrong]
   - Steps to reproduce: [How to trigger]
   - Notes: [Additional context]
+++

## Recommendations

[Next steps and suggested actions]

## Status

[Overall testing status and conclusions]
\`\`\`

## Collapsible Sections

**IMPORTANT**: When creating your summary, make the following sections collapsible (collapsed by default):

- **"Test Details"** section - Wrap with \`+++Test Details\\n...\\n+++\`
- **"Issues Found"** section - Wrap with \`+++Issues Found\\n...\\n+++\`

This keeps the summary concise while preserving detailed information for those who want to expand and read it.
`)
			.verify();
	});
});
