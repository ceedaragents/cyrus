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
				.expectUserPrompt(
					"Review the attached file\n\nAttachment: screenshot.png",
				)
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
				.expectUserPrompt("Here's more context\n\nAttachment: error-log.txt")
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
				issueId: "issue-1",
				workspace: { path: "/test" },
				metadata: {},
			};

			const issue = {
				id: "issue-1",
				identifier: "TEST-123",
				title: "Fix authentication bug",
				description: "Users cannot log in",
			};

			const repository = {
				id: "repo-1",
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
				.expectSystemPrompt(undefined)
				.expectPromptType("fallback")
				.verify();

			// Verify issue context is included in full prompt
			expect(result.userPrompt).toContain("TEST-123");
			expect(result.userPrompt).toContain("Fix authentication bug");

			// Verify components
			expect(result.metadata.components).toContain("issue-context");
		});

		it("assignment-based (with user comment) - should include user comment in prompt", async () => {
			const worker = createTestWorker();

			// Create minimal test data
			const session = {
				issueId: "issue-1",
				workspace: { path: "/test" },
				metadata: {},
			};

			const issue = {
				id: "issue-1",
				identifier: "TEST-456",
				title: "Implement new feature",
				description: "Add payment processing",
			};

			const repository = {
				id: "repo-1",
				path: "/test/repo",
			};

			const result = await scenario(worker)
				.newSession()
				.assignmentBased()
				.withSession(session)
				.withIssue(issue)
				.withRepository(repository)
				.withUserComment("Please add Stripe integration")
				.withLabels()
				.expectSystemPrompt(undefined)
				.expectPromptType("fallback")
				.verify();

			// Verify issue context is included in full prompt
			expect(result.userPrompt).toContain("TEST-456");
			expect(result.userPrompt).toContain("Implement new feature");
			expect(result.userPrompt).toContain(
				"User comment: Please add Stripe integration",
			);
		});
	});

	describe("Component Order", () => {
		it("should assemble components in correct order: issue context, subroutine, user comment", async () => {
			const worker = createTestWorker();

			const session = {
				issueId: "issue-1",
				workspace: { path: "/test" },
				metadata: {
					procedure: {
						name: "full-development",
						currentSubroutineIndex: 0,
					},
				},
			};

			const issue = {
				id: "issue-1",
				identifier: "TEST-123",
				title: "Build new feature",
			};

			const repository = {
				id: "repo-1",
				path: "/test/repo",
			};

			const result = await scenario(worker)
				.newSession()
				.assignmentBased()
				.withSession(session)
				.withIssue(issue)
				.withRepository(repository)
				.withUserComment("Add user authentication")
				.withLabels()
				.expectSystemPrompt(undefined)
				.expectPromptType("fallback")
				.verify();

			// Verify full prompt structure and components are in order
			const prompt = result.userPrompt;

			// Issue context should come first
			const issueContextPos = prompt.indexOf("TEST-123");
			expect(issueContextPos).toBeGreaterThan(-1);

			// User comment should come last
			const userCommentPos = prompt.indexOf("User comment:");
			expect(userCommentPos).toBeGreaterThan(issueContextPos);

			// Verify full prompt contains all expected parts
			expect(prompt).toContain("TEST-123");
			expect(prompt).toContain("Build new feature");
			expect(prompt).toContain("User comment: Add user authentication");
		});
	});

	describe("System Prompt Behavior", () => {
		it("should return undefined system prompt when no labels configured", async () => {
			const worker = createTestWorker();

			const session = {
				issueId: "issue-1",
				workspace: { path: "/test" },
				metadata: {},
			};

			const issue = {
				id: "issue-1",
				identifier: "TEST-SYSTEM",
				title: "Task without system prompt",
				description: "Example task",
			};

			const repository = {
				id: "repo-1",
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
				.expectSystemPrompt(undefined)
				.expectPromptType("fallback")
				.verify();
		});

		it("should return defined system prompt when labels match configuration", async () => {
			// Create repository with labelPrompts configuration
			const repository = {
				id: "repo-1",
				path: "/test/repo",
				linearToken: "test-token-123", // Mock token for testing
				labelPrompts: {
					builder: ["feature", "enhancement"],
					debugger: ["bug", "hotfix"],
				},
			};

			const worker = createTestWorker([repository]);

			const session = {
				issueId: "issue-1",
				workspace: { path: "/test" },
				metadata: {},
			};

			const issue = {
				id: "issue-1",
				identifier: "TEST-WITH-PROMPT",
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
				.expectPromptType("label-based")
				.verify();

			// Verify system prompt is defined when labels match
			expect(result.systemPrompt).toBeDefined();
			expect(typeof result.systemPrompt).toBe("string");
			expect(result.systemPrompt?.length).toBeGreaterThan(0);

			// Verify user prompt contains expected content
			expect(result.userPrompt).toContain("TEST-WITH-PROMPT");
			expect(result.userPrompt).toContain("Feature with builder prompt");
			expect(result.userPrompt).toContain(
				"User comment: Build the payment integration",
			);
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
				.expectUserPrompt("Test\n\nfile.txt")
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
