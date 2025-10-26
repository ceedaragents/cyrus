/**
 * Unit tests for prompt assembly system
 *
 * Tests all major prompt assembly scenarios with human-readable test helpers
 */

import type { Issue as LinearIssue } from "@linear/sdk";
import type {
	CyrusAgentSession,
	LinearWebhookAgentSession,
	LinearWebhookGuidanceRule,
	RepositoryConfig,
} from "cyrus-core";
import { describe, expect, it } from "vitest";
import type { SubroutineDefinition } from "../src/procedures/types.js";
import {
	buildPrompt,
	type IssueContextResult,
	type PromptAssemblyHelpers,
	type PromptAssemblyInput,
} from "../src/prompt-assembly/index.js";

// ============================================================================
// Test Helpers - Human-readable builders for test scenarios
// ============================================================================

/**
 * Create a minimal test session
 */
function createSession(
	overrides?: Partial<CyrusAgentSession>,
): CyrusAgentSession {
	return {
		issueId: "test-issue-id",
		issue: {
			id: "test-issue-id",
			identifier: "TEST-123",
			title: "Test Issue",
		},
		workspace: {
			path: "/test/workspace",
		},
		claudeSessionId: "test-claude-session",
		metadata: {},
		...overrides,
	} as CyrusAgentSession;
}

/**
 * Create a minimal test issue
 */
function createIssue(overrides?: Partial<LinearIssue>): LinearIssue {
	return {
		id: "test-issue-id",
		identifier: "TEST-123",
		title: "Test Issue",
		description: "Test Description",
		url: "https://linear.app/test/issue/TEST-123",
		...overrides,
	} as LinearIssue;
}

/**
 * Create a minimal test repository config
 */
function createRepository(
	overrides?: Partial<RepositoryConfig>,
): RepositoryConfig {
	return {
		id: "test-repo-id",
		linearUserId: "test-user-id",
		path: "/test/repo",
		...overrides,
	} as RepositoryConfig;
}

/**
 * Create mock helpers that return predictable values
 */
function createMockHelpers(
	overrides?: Partial<PromptAssemblyHelpers>,
): PromptAssemblyHelpers {
	return {
		determineSystemPrompt: async () => undefined,
		buildIssueContext: async (issue) => ({
			prompt: `Issue: ${issue.identifier} - ${issue.title}`,
		}),
		getCurrentSubroutine: () => null,
		loadSubroutinePrompt: async () => null,
		...overrides,
	};
}

/**
 * Create a subroutine definition
 */
function createSubroutine(name: string): SubroutineDefinition {
	return {
		name,
		promptPath: `${name}.md`,
		maxTurns: 10,
		description: `${name} subroutine`,
	};
}

/**
 * Create test input for prompt assembly
 */
function createInput(
	overrides?: Partial<PromptAssemblyInput>,
): PromptAssemblyInput {
	return {
		session: createSession(),
		fullIssue: createIssue(),
		repository: createRepository(),
		userComment: "Test comment",
		isNewSession: false,
		isStreaming: false,
		...overrides,
	};
}

// ============================================================================
// Tests - Organized by scenario
// ============================================================================

describe("Prompt Assembly", () => {
	describe("Streaming Sessions", () => {
		it("should pass through user comment as-is for streaming sessions", async () => {
			const input = createInput({
				userComment: "User's streaming comment",
				isStreaming: true,
				isNewSession: false,
			});

			const helpers = createMockHelpers();
			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toBe("User's streaming comment");
			expect(result.systemPrompt).toBeUndefined();
			expect(result.metadata.isStreaming).toBe(true);
			expect(result.metadata.components).toContain("user-comment");
		});

		it("should include attachment manifest in streaming sessions", async () => {
			const input = createInput({
				userComment: "Comment with attachments",
				attachmentManifest: "Attachment: file.txt",
				isStreaming: true,
			});

			const helpers = createMockHelpers();
			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toContain("Comment with attachments");
			expect(result.userPrompt).toContain("Attachment: file.txt");
			expect(result.metadata.components).toContain("attachment-manifest");
		});
	});

	describe("Continuation Sessions", () => {
		it("should only include user comment for continuation sessions", async () => {
			const input = createInput({
				userComment: "Follow-up comment",
				isNewSession: false,
				isStreaming: false,
			});

			const helpers = createMockHelpers();
			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toBe("Follow-up comment");
			expect(result.systemPrompt).toBeUndefined();
			expect(result.metadata.isNewSession).toBe(false);
			expect(result.metadata.promptType).toBe("continuation");
		});

		it("should include attachment manifest in continuation sessions", async () => {
			const input = createInput({
				userComment: "Follow-up with attachment",
				attachmentManifest: "Attachment: screenshot.png",
				isNewSession: false,
			});

			const helpers = createMockHelpers();
			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toContain("Follow-up with attachment");
			expect(result.userPrompt).toContain("Attachment: screenshot.png");
			expect(result.metadata.components).toContain("attachment-manifest");
		});
	});

	describe("New Session - Assignment-Based", () => {
		it("should include issue context for assignment-based sessions", async () => {
			const input = createInput({
				userComment: "",
				isNewSession: true,
				labels: [],
			});

			const helpers = createMockHelpers({
				buildIssueContext: async (issue) => ({
					prompt: `Full issue context for ${issue.identifier}`,
				}),
			});

			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toContain("Full issue context for TEST-123");
			expect(result.metadata.isNewSession).toBe(true);
			expect(result.metadata.components).toContain("issue-context");
			expect(result.metadata.promptType).toBe("fallback");
		});

		it("should include subroutine prompt in assignment-based sessions", async () => {
			const subroutine = createSubroutine("coding-guidance");
			const input = createInput({
				userComment: "",
				isNewSession: true,
			});

			const helpers = createMockHelpers({
				getCurrentSubroutine: () => subroutine,
				loadSubroutinePrompt: async (sub) =>
					`Subroutine prompt for ${sub.name}`,
			});

			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toContain(
				"Subroutine prompt for coding-guidance",
			);
			expect(result.metadata.components).toContain("subroutine-prompt");
			expect(result.metadata.subroutineName).toBe("coding-guidance");
		});

		it("should determine system prompt from labels", async () => {
			const input = createInput({
				userComment: "",
				isNewSession: true,
				labels: ["builder"],
			});

			const helpers = createMockHelpers({
				determineSystemPrompt: async (labels) =>
					labels.includes("builder") ? "Builder system prompt" : undefined,
			});

			const result = await buildPrompt(input, helpers);

			expect(result.systemPrompt).toBe("Builder system prompt");
			expect(result.metadata.promptType).toBe("label-based");
		});
	});

	describe("New Session - Mention-Triggered", () => {
		it("should use mention prompt type when mention triggered", async () => {
			const agentSession: LinearWebhookAgentSession = {
				id: "session-id",
				issue: {
					id: "issue-id",
					identifier: "TEST-123",
				},
				comment: {
					id: "comment-id",
					body: "@cyrus please help",
				},
			} as LinearWebhookAgentSession;

			const input = createInput({
				userComment: "@cyrus please help",
				isNewSession: true,
				isMentionTriggered: true,
				agentSession,
			});

			const helpers = createMockHelpers({
				buildIssueContext: async (
					issue,
					_repo,
					promptType,
				): Promise<IssueContextResult> => ({
					prompt: `Mention context for ${issue.identifier} (${promptType})`,
				}),
			});

			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toContain("Mention context for TEST-123");
			expect(result.userPrompt).toContain("mention");
			expect(result.metadata.promptType).toBe("mention");
		});

		it("should include subroutine prompt in mention-triggered sessions", async () => {
			const subroutine = createSubroutine("simple-question");
			const input = createInput({
				userComment: "@cyrus what is this?",
				isNewSession: true,
				isMentionTriggered: true,
				agentSession: {} as LinearWebhookAgentSession,
			});

			const helpers = createMockHelpers({
				getCurrentSubroutine: () => subroutine,
				loadSubroutinePrompt: async (sub) =>
					`Simple question guidance for ${sub.name}`,
			});

			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toContain(
				"Simple question guidance for simple-question",
			);
			expect(result.metadata.components).toContain("subroutine-prompt");
		});
	});

	describe("New Session - Label-Based Prompt Command", () => {
		it("should use label-based-prompt-command type when requested", async () => {
			const input = createInput({
				userComment: "/label-based-prompt",
				isNewSession: true,
				isMentionTriggered: true,
				isLabelBasedPromptRequested: true,
			});

			const helpers = createMockHelpers({
				buildIssueContext: async (
					_issue,
					_repo,
					promptType,
				): Promise<IssueContextResult> => ({
					prompt: `Label-based context (${promptType})`,
				}),
			});

			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toContain("Label-based context");
			expect(result.userPrompt).toContain("label-based-prompt-command");
			expect(result.metadata.promptType).toBe("label-based-prompt-command");
		});
	});

	describe("Component Assembly", () => {
		it("should assemble all components in correct order for new sessions", async () => {
			const subroutine = createSubroutine("full-development");
			const input = createInput({
				userComment: "Build new feature",
				attachmentManifest: "Attachment: design.png",
				isNewSession: true,
				labels: ["builder"],
				guidance: [
					{ body: "Follow coding standards" },
				] as LinearWebhookGuidanceRule[],
			});

			const helpers = createMockHelpers({
				determineSystemPrompt: async () => "Builder prompt",
				buildIssueContext: async () => ({
					prompt: "Issue context section",
				}),
				getCurrentSubroutine: () => subroutine,
				loadSubroutinePrompt: async () => "Subroutine guidance section",
			});

			const result = await buildPrompt(input, helpers);

			// Check order of components in the assembled prompt
			const issuePos = result.userPrompt.indexOf("Issue context section");
			const subroutinePos = result.userPrompt.indexOf(
				"Subroutine guidance section",
			);
			const commentPos = result.userPrompt.indexOf("Build new feature");

			expect(issuePos).toBeGreaterThan(-1);
			expect(subroutinePos).toBeGreaterThan(issuePos);
			expect(commentPos).toBeGreaterThan(subroutinePos);

			// Check metadata
			expect(result.metadata.components).toEqual([
				"issue-context",
				"subroutine-prompt",
				"user-comment",
				"guidance-rules",
			]);
			expect(result.metadata.subroutineName).toBe("full-development");
			expect(result.systemPrompt).toBe("Builder prompt");
		});

		it("should not include user comment when empty in new sessions", async () => {
			const input = createInput({
				userComment: "",
				isNewSession: true,
			});

			const helpers = createMockHelpers({
				buildIssueContext: async () => ({
					prompt: "Issue context",
				}),
			});

			const result = await buildPrompt(input, helpers);

			expect(result.userPrompt).toBe("Issue context");
			expect(result.metadata.components).not.toContain("user-comment");
		});

		it("should skip subroutine prompt when not available", async () => {
			const input = createInput({
				userComment: "Test",
				isNewSession: true,
			});

			const helpers = createMockHelpers({
				getCurrentSubroutine: () => null,
			});

			const result = await buildPrompt(input, helpers);

			expect(result.metadata.components).not.toContain("subroutine-prompt");
			expect(result.metadata.subroutineName).toBeUndefined();
		});

		it("should skip subroutine prompt when load fails", async () => {
			const subroutine = createSubroutine("missing");
			const input = createInput({
				userComment: "Test",
				isNewSession: true,
			});

			const helpers = createMockHelpers({
				getCurrentSubroutine: () => subroutine,
				loadSubroutinePrompt: async () => null, // Simulates failed load
			});

			const result = await buildPrompt(input, helpers);

			expect(result.metadata.components).not.toContain("subroutine-prompt");
			expect(result.metadata.subroutineName).toBeUndefined();
		});
	});

	describe("Metadata Tracking", () => {
		it("should track correct metadata for streaming session", async () => {
			const input = createInput({
				isStreaming: true,
				isNewSession: false,
			});

			const helpers = createMockHelpers();
			const result = await buildPrompt(input, helpers);

			expect(result.metadata).toEqual({
				components: ["user-comment"],
				promptType: "continuation",
				isNewSession: false,
				isStreaming: true,
			});
		});

		it("should track correct metadata for continuation session", async () => {
			const input = createInput({
				isStreaming: false,
				isNewSession: false,
				attachmentManifest: "file.txt",
			});

			const helpers = createMockHelpers();
			const result = await buildPrompt(input, helpers);

			expect(result.metadata.components).toContain("user-comment");
			expect(result.metadata.components).toContain("attachment-manifest");
			expect(result.metadata.promptType).toBe("continuation");
			expect(result.metadata.isNewSession).toBe(false);
			expect(result.metadata.isStreaming).toBe(false);
		});

		it("should track correct metadata for new label-based session", async () => {
			const input = createInput({
				isNewSession: true,
				labels: ["debugger"],
			});

			const helpers = createMockHelpers({
				determineSystemPrompt: async () => "Debugger prompt",
			});

			const result = await buildPrompt(input, helpers);

			expect(result.metadata.promptType).toBe("label-based");
			expect(result.metadata.isNewSession).toBe(true);
			expect(result.metadata.isStreaming).toBe(false);
		});
	});
});
