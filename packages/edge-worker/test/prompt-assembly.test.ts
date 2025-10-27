/**
 * Prompt Assembly Tests
 *
 * Tests the EdgeWorker.assemblePrompt() method using a human-readable DSL.
 * All test assertions show complete prompt bodies for maximum clarity.
 */

import type { RepositoryConfig } from "cyrus-core";
import { describe, expect, it } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

// ============================================================================
// Human-Readable Test Framework
// ============================================================================

/**
 * Create an EdgeWorker instance for testing
 */
function createTestWorker(repositories: RepositoryConfig[] = []): EdgeWorker {
	const config: EdgeWorkerConfig = {
		cyrusHome: "/tmp/test-cyrus-home",
		defaultModel: "sonnet",
		repositories,
		linearClients: new Map(),
		mcpServers: {},
	};
	return new EdgeWorker(config);
}

/**
 * Scenario builder for test cases - provides human-readable DSL
 */
class PromptScenario {
	private worker: EdgeWorker;
	private input: any = {};
	private expectedUserPrompt?: string;
	private expectedSystemPrompt?: string;
	private expectedComponents?: string[];
	private expectedPromptType?: string;

	constructor(worker: EdgeWorker) {
		this.worker = worker;
	}

	// ===== Input Builders =====

	streamingSession() {
		this.input.isStreaming = true;
		this.input.isNewSession = false;
		return this;
	}

	continuationSession() {
		this.input.isStreaming = false;
		this.input.isNewSession = false;
		return this;
	}

	newSession() {
		this.input.isStreaming = false;
		this.input.isNewSession = true;
		return this;
	}

	assignmentBased() {
		this.input.isMentionTriggered = false;
		this.input.isLabelBasedPromptRequested = false;
		return this;
	}

	mentionTriggered() {
		this.input.isMentionTriggered = true;
		this.input.isLabelBasedPromptRequested = false;
		return this;
	}

	labelBasedPromptCommand() {
		this.input.isMentionTriggered = true;
		this.input.isLabelBasedPromptRequested = true;
		return this;
	}

	withUserComment(comment: string) {
		this.input.userComment = comment;
		return this;
	}

	withAttachments(manifest: string) {
		this.input.attachmentManifest = manifest;
		return this;
	}

	withLabels(...labels: string[]) {
		this.input.labels = labels;
		return this;
	}

	withSession(session: any) {
		this.input.session = session;
		return this;
	}

	withIssue(issue: any) {
		this.input.fullIssue = issue;
		return this;
	}

	withRepository(repo: any) {
		this.input.repository = repo;
		return this;
	}

	withGuidance(guidance: any[]) {
		this.input.guidance = guidance;
		return this;
	}

	withAgentSession(agentSession: any) {
		this.input.agentSession = agentSession;
		return this;
	}

	// ===== Expectation Builders =====

	expectUserPrompt(prompt: string) {
		this.expectedUserPrompt = prompt;
		return this;
	}

	expectSystemPrompt(prompt: string | undefined) {
		this.expectedSystemPrompt = prompt;
		return this;
	}

	expectComponents(...components: string[]) {
		this.expectedComponents = components;
		return this;
	}

	expectPromptType(type: string) {
		this.expectedPromptType = type;
		return this;
	}

	// ===== Execution =====

	async verify() {
		const result = await (this.worker as any).assemblePrompt(this.input);

		if (this.expectedUserPrompt !== undefined) {
			expect(result.userPrompt).toBe(this.expectedUserPrompt);
		}

		if (this.expectedSystemPrompt !== undefined) {
			expect(result.systemPrompt).toBe(this.expectedSystemPrompt);
		}

		if (this.expectedComponents) {
			expect(result.metadata.components).toEqual(this.expectedComponents);
		}

		if (this.expectedPromptType) {
			expect(result.metadata.promptType).toBe(this.expectedPromptType);
		}

		return result;
	}
}

/**
 * Start building a test scenario
 */
function scenario(worker: EdgeWorker): PromptScenario {
	return new PromptScenario(worker);
}

// ============================================================================
// Tests
// ============================================================================

describe("Prompt Assembly", () => {
	describe("Streaming Sessions", () => {
		it("should pass through user comment unchanged", async () => {
			const worker = createTestWorker();

			await scenario(worker)
				.streamingSession()
				.withUserComment("Continue with the current task")
				.expectUserPrompt("Continue with the current task")
				.expectSystemPrompt(undefined)
				.expectComponents("user-comment")
				.expectPromptType("continuation")
				.verify();
		});

		it("should include attachment manifest", async () => {
			const worker = createTestWorker();

			await scenario(worker)
				.streamingSession()
				.withUserComment("Review the attached file")
				.withAttachments("Attachment: screenshot.png")
				.expectUserPrompt(`Review the attached file

Attachment: screenshot.png`)
				.expectSystemPrompt(undefined)
				.expectComponents("user-comment", "attachment-manifest")
				.expectPromptType("continuation")
				.verify();
		});
	});

	describe("Continuation Sessions", () => {
		it("should only include user comment", async () => {
			const worker = createTestWorker();

			await scenario(worker)
				.continuationSession()
				.withUserComment("Please fix the bug")
				.expectUserPrompt("Please fix the bug")
				.expectSystemPrompt(undefined)
				.expectComponents("user-comment")
				.expectPromptType("continuation")
				.verify();
		});

		it("should include attachments if present", async () => {
			const worker = createTestWorker();

			await scenario(worker)
				.continuationSession()
				.withUserComment("Here's more context")
				.withAttachments("Attachment: error-log.txt")
				.expectUserPrompt(`Here's more context

Attachment: error-log.txt`)
				.expectSystemPrompt(undefined)
				.expectComponents("user-comment", "attachment-manifest")
				.expectPromptType("continuation")
				.verify();
		});
	});

	describe("New Sessions", () => {
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

	describe("Component Order", () => {
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

	describe("System Prompt Behavior", () => {
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

	describe("Metadata Tracking", () => {
		it("should track correct metadata for streaming session", async () => {
			const worker = createTestWorker();

			const result = await scenario(worker)
				.streamingSession()
				.withUserComment("Test")
				.expectUserPrompt("Test")
				.expectSystemPrompt(undefined)
				.expectPromptType("continuation")
				.verify();

			// Verify metadata
			expect(result.metadata).toMatchObject({
				components: ["user-comment"],
				promptType: "continuation",
				isNewSession: false,
				isStreaming: true,
			});
		});

		it("should track correct metadata for continuation session", async () => {
			const worker = createTestWorker();

			const result = await scenario(worker)
				.continuationSession()
				.withUserComment("Test")
				.withAttachments("file.txt")
				.expectUserPrompt(`Test

file.txt`)
				.expectSystemPrompt(undefined)
				.expectPromptType("continuation")
				.verify();

			// Verify metadata
			expect(result.metadata).toMatchObject({
				components: ["user-comment", "attachment-manifest"],
				promptType: "continuation",
				isNewSession: false,
				isStreaming: false,
			});
		});
	});
});
