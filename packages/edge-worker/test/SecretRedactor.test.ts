/**
 * Unit tests for SecretRedactor, redactActivityContent, and sink integration.
 */

import type { AgentActivityContent } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ISecretRedactor,
	redactActivityContent,
	SecretRedactor,
} from "../src/utils/SecretRedactor.js";

/**
 * Build fake tokens at runtime so GitHub push protection doesn't flag test strings.
 */
function fakeToken(prefix: string, suffix: string): string {
	return `${prefix}${suffix}`;
}

describe("SecretRedactor", () => {
	let redactor: SecretRedactor;

	beforeEach(() => {
		redactor = new SecretRedactor();
	});

	describe("addSecrets() and redact()", () => {
		it("should redact a registered secret value", () => {
			redactor.addSecrets(["my-super-secret-api-key-12345"]);
			const result = redactor.redact(
				"The key is my-super-secret-api-key-12345 here",
			);
			expect(result).toBe("The key is [REDACTED] here");
		});

		it("should redact multiple registered secrets", () => {
			redactor.addSecrets([
				"secret-value-one-abcdef",
				"secret-value-two-ghijkl",
			]);
			const result = redactor.redact(
				"First: secret-value-one-abcdef, Second: secret-value-two-ghijkl",
			);
			expect(result).toBe("First: [REDACTED], Second: [REDACTED]");
		});

		it("should ignore short secrets (less than 8 chars)", () => {
			redactor.addSecrets(["short"]);
			const result = redactor.redact("The value is short here");
			expect(result).toBe("The value is short here");
		});

		it("should handle empty string input", () => {
			redactor.addSecrets(["my-secret-value-xyz"]);
			expect(redactor.redact("")).toBe("");
		});

		it("should handle null/undefined-like empty input", () => {
			expect(redactor.redact("")).toBe("");
		});

		it("should replace all occurrences of a secret", () => {
			redactor.addSecrets(["repeated-secret-value"]);
			const result = redactor.redact(
				"repeated-secret-value and repeated-secret-value",
			);
			expect(result).toBe("[REDACTED] and [REDACTED]");
		});

		it("should replace longest secret first to avoid partial matches", () => {
			redactor.addSecrets(["sk-ant-api-key", "sk-ant-api-key-extended-value"]);
			const result = redactor.redact(
				"Token: sk-ant-api-key-extended-value end",
			);
			expect(result).toBe("Token: [REDACTED] end");
		});

		it("should trim whitespace from secrets before registering", () => {
			redactor.addSecrets(["  my-padded-secret-value  "]);
			const result = redactor.redact("Using my-padded-secret-value in text");
			expect(result).toBe("Using [REDACTED] in text");
		});
	});

	describe("well-known token patterns", () => {
		it("should redact Anthropic API keys (sk-ant-*)", () => {
			const result = redactor.redact("Key: sk-ant-api03-abcdefghijklmnopqrst");
			expect(result).toBe("Key: [REDACTED]");
		});

		it("should redact OpenAI project-scoped keys (sk-proj-*)", () => {
			const result = redactor.redact("Key: sk-proj-abcdefghijklmnopqrstuvwxyz");
			expect(result).toBe("Key: [REDACTED]");
		});

		it("should redact generic OpenAI keys (sk-*)", () => {
			const result = redactor.redact("Key: sk-abcdefghijklmnopqrstuvwxyz");
			expect(result).toBe("Key: [REDACTED]");
		});

		it("should redact Slack bot tokens (xoxb-*)", () => {
			const token = fakeToken("xoxb-", "123456789-abcdefghijklmnopqrstuvwxyz");
			const result = redactor.redact(`Token: ${token}`);
			expect(result).toBe("Token: [REDACTED]");
		});

		it("should redact Slack user tokens (xoxp-*)", () => {
			const token = fakeToken("xoxp-", "123456789-abcdefghijklmnopqrstuvwxyz");
			const result = redactor.redact(`Token: ${token}`);
			expect(result).toBe("Token: [REDACTED]");
		});

		it("should redact Slack app tokens (xapp-*)", () => {
			const token = fakeToken("xapp-", "123456789-abcdefghijklmnopqrstuvwxyz");
			const result = redactor.redact(`Token: ${token}`);
			expect(result).toBe("Token: [REDACTED]");
		});

		it("should redact GitHub personal access tokens (ghp_*)", () => {
			const result = redactor.redact(
				"Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn",
			);
			expect(result).toBe("Token: [REDACTED]");
		});

		it("should redact GitHub server tokens (ghs_*)", () => {
			const result = redactor.redact(
				"Token: ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn",
			);
			expect(result).toBe("Token: [REDACTED]");
		});

		it("should redact GitHub user tokens (ghu_*)", () => {
			const result = redactor.redact(
				"Token: ghu_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn",
			);
			expect(result).toBe("Token: [REDACTED]");
		});

		it("should redact GitLab tokens (glpat-*)", () => {
			const result = redactor.redact("Token: glpat-abcdefghijklmnopqrstuvwx");
			expect(result).toBe("Token: [REDACTED]");
		});

		it("should redact Google API keys (AIza*)", () => {
			const result = redactor.redact(
				"Key: AIzaSyA1234567890abcdefghijklmnopqrstuv",
			);
			expect(result).toBe("Key: [REDACTED]");
		});

		it("should redact AWS access key IDs (AKIA*)", () => {
			const result = redactor.redact("Key: AKIAIOSFODNN7EXAMPLE");
			expect(result).toBe("Key: [REDACTED]");
		});

		it("should redact Bearer tokens", () => {
			const result = redactor.redact(
				"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature",
			);
			expect(result).toBe("Authorization: [REDACTED]");
		});

		it("should redact multiple token patterns in one string", () => {
			const slackToken = fakeToken(
				"xoxb-",
				"123456789-abcdefghijklmnopqrstuvwxyz",
			);
			const result = redactor.redact(
				`GitHub: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn, Slack: ${slackToken}`,
			);
			expect(result).toBe("GitHub: [REDACTED], Slack: [REDACTED]");
		});

		it("should not redact non-matching strings", () => {
			const safe = "This is a normal message with no secrets";
			expect(redactor.redact(safe)).toBe(safe);
		});
	});

	describe("combined exact + pattern redaction", () => {
		it("should redact both registered secrets and pattern-matched tokens", () => {
			redactor.addSecrets(["my-custom-secret-value-xyz"]);
			const result = redactor.redact(
				"Custom: my-custom-secret-value-xyz, GitHub: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn",
			);
			expect(result).toBe("Custom: [REDACTED], GitHub: [REDACTED]");
		});
	});
});

describe("redactActivityContent()", () => {
	let redactor: ISecretRedactor;

	beforeEach(() => {
		const r = new SecretRedactor();
		r.addSecrets(["super-secret-api-key-value"]);
		redactor = r;
	});

	it("should redact body in thought activities", () => {
		const content: AgentActivityContent = {
			type: "thought" as any,
			body: "Found super-secret-api-key-value in env",
		};
		const result = redactActivityContent(redactor, content);
		expect((result as any).body).toBe("Found [REDACTED] in env");
	});

	it("should redact body in response activities", () => {
		const content: AgentActivityContent = {
			type: "response" as any,
			body: "The key super-secret-api-key-value was used",
		};
		const result = redactActivityContent(redactor, content);
		expect((result as any).body).toBe("The key [REDACTED] was used");
	});

	it("should redact body in error activities", () => {
		const content: AgentActivityContent = {
			type: "error" as any,
			body: "Error: invalid key super-secret-api-key-value",
		};
		const result = redactActivityContent(redactor, content);
		expect((result as any).body).toBe("Error: invalid key [REDACTED]");
	});

	it("should redact body in elicitation activities", () => {
		const content: AgentActivityContent = {
			type: "elicitation" as any,
			body: "Should I use super-secret-api-key-value?",
		};
		const result = redactActivityContent(redactor, content);
		expect((result as any).body).toBe("Should I use [REDACTED]?");
	});

	it("should redact action, parameter, and result in action activities", () => {
		const content: AgentActivityContent = {
			type: "action" as any,
			action: "run super-secret-api-key-value",
			parameter: "super-secret-api-key-value.json",
			result: "output: super-secret-api-key-value",
		};
		const result = redactActivityContent(redactor, content) as any;
		expect(result.action).toBe("run [REDACTED]");
		expect(result.parameter).toBe("[REDACTED].json");
		expect(result.result).toBe("output: [REDACTED]");
	});

	it("should handle action activities with no result", () => {
		const content: AgentActivityContent = {
			type: "action" as any,
			action: "test_action",
			parameter: "super-secret-api-key-value",
		};
		const result = redactActivityContent(redactor, content) as any;
		expect(result.action).toBe("test_action");
		expect(result.parameter).toBe("[REDACTED]");
		expect(result.result).toBeUndefined();
	});

	it("should not mutate the original content object", () => {
		const content: AgentActivityContent = {
			type: "thought" as any,
			body: "secret: super-secret-api-key-value",
		};
		const original = { ...content };
		redactActivityContent(redactor, content);
		expect(content).toEqual(original);
	});

	it("should also catch pattern-matched tokens in activity content", () => {
		const content: AgentActivityContent = {
			type: "thought" as any,
			body: "Found token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn in output",
		};
		const result = redactActivityContent(redactor, content);
		expect((result as any).body).toBe("Found token [REDACTED] in output");
	});
});

describe("LinearActivitySink with redactor", () => {
	it("should redact activity content before posting to Linear", async () => {
		const { LinearActivitySink } = await import(
			"../src/sinks/LinearActivitySink.js"
		);

		const redactor = new SecretRedactor();
		redactor.addSecrets(["my-anthropic-api-key-secret"]);

		const mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			}),
			createAgentSessionOnIssue: vi.fn(),
		};

		const sink = new LinearActivitySink(
			mockIssueTracker as any,
			"workspace-123",
			redactor,
		);

		await sink.postActivity("session-1", {
			type: "thought" as any,
			body: "Found my-anthropic-api-key-secret in the environment",
		});

		expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				content: expect.objectContaining({
					body: "Found [REDACTED] in the environment",
				}),
			}),
		);
	});

	it("should pass through unmodified when no redactor is provided", async () => {
		const { LinearActivitySink } = await import(
			"../src/sinks/LinearActivitySink.js"
		);

		const mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			}),
			createAgentSessionOnIssue: vi.fn(),
		};

		const sink = new LinearActivitySink(
			mockIssueTracker as any,
			"workspace-123",
		);

		const activity = {
			type: "thought" as any,
			body: "This has no secrets to redact",
		};
		await sink.postActivity("session-1", activity);

		expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				content: activity,
			}),
		);
	});
});

describe("GitHubCommentService with scrubContent", () => {
	it("should scrub body before posting issue comment", async () => {
		const { GitHubCommentService } = await import(
			"cyrus-github-event-transport"
		);

		const redactor = new SecretRedactor();
		redactor.addSecrets(["github-secret-token-value"]);

		const service = new GitHubCommentService({
			apiBaseUrl: "https://api.github.com",
			scrubContent: (text: string) => redactor.redact(text),
		});

		const mockResponse = {
			ok: true,
			json: () =>
				Promise.resolve({
					id: 1,
					html_url: "https://github.com/test/pr/1#comment-1",
					body: "[REDACTED]",
				}),
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse as any);

		await service.postIssueComment({
			token: "test-token",
			owner: "test",
			repo: "repo",
			issueNumber: 1,
			body: "Found github-secret-token-value in logs",
		});

		const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
		expect(fetchBody.body).toBe("Found [REDACTED] in logs");

		fetchSpy.mockRestore();
	});

	it("should scrub body before posting review comment reply", async () => {
		const { GitHubCommentService } = await import(
			"cyrus-github-event-transport"
		);

		const redactor = new SecretRedactor();
		redactor.addSecrets(["github-secret-token-value"]);

		const service = new GitHubCommentService({
			scrubContent: (text: string) => redactor.redact(text),
		});

		const mockResponse = {
			ok: true,
			json: () =>
				Promise.resolve({
					id: 2,
					html_url: "https://github.com/test/pr/1#comment-2",
					body: "[REDACTED]",
				}),
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse as any);

		await service.postReviewCommentReply({
			token: "test-token",
			owner: "test",
			repo: "repo",
			pullNumber: 1,
			commentId: 100,
			body: "Here is github-secret-token-value leaked",
		});

		const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
		expect(fetchBody.body).toBe("Here is [REDACTED] leaked");

		fetchSpy.mockRestore();
	});
});

describe("GitLabCommentService with scrubContent", () => {
	it("should scrub body before posting MR note", async () => {
		const { GitLabCommentService } = await import(
			"cyrus-gitlab-event-transport"
		);

		const redactor = new SecretRedactor();
		redactor.addSecrets(["gitlab-secret-token-value"]);

		const service = new GitLabCommentService({
			apiBaseUrl: "https://gitlab.com",
			scrubContent: (text: string) => redactor.redact(text),
		});

		const mockResponse = {
			ok: true,
			json: () =>
				Promise.resolve({
					id: 1,
					body: "[REDACTED]",
					created_at: "2025-01-01",
					author: { id: 1, username: "bot", name: "Bot" },
				}),
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse as any);

		await service.postMRNote({
			token: "test-token",
			projectId: 123,
			mrIid: 1,
			body: "Found gitlab-secret-token-value in MR",
		});

		const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
		expect(fetchBody.body).toBe("Found [REDACTED] in MR");

		fetchSpy.mockRestore();
	});

	it("should scrub body before posting discussion reply", async () => {
		const { GitLabCommentService } = await import(
			"cyrus-gitlab-event-transport"
		);

		const redactor = new SecretRedactor();
		redactor.addSecrets(["gitlab-secret-token-value"]);

		const service = new GitLabCommentService({
			scrubContent: (text: string) => redactor.redact(text),
		});

		const mockResponse = {
			ok: true,
			json: () =>
				Promise.resolve({
					id: 2,
					body: "[REDACTED]",
					created_at: "2025-01-01",
					author: { id: 1, username: "bot", name: "Bot" },
				}),
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse as any);

		await service.postDiscussionReply({
			token: "test-token",
			projectId: 123,
			mrIid: 1,
			discussionId: "disc-1",
			body: "Reply with gitlab-secret-token-value",
		});

		const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
		expect(fetchBody.body).toBe("Reply with [REDACTED]");

		fetchSpy.mockRestore();
	});
});

describe("SlackMessageService with scrubContent", () => {
	it("should scrub text before posting message", async () => {
		const { SlackMessageService } = await import("cyrus-slack-event-transport");

		const redactor = new SecretRedactor();
		redactor.addSecrets(["slack-secret-token-value"]);

		const service = new SlackMessageService({
			apiBaseUrl: "https://slack.com/api",
			scrubContent: (text: string) => redactor.redact(text),
		});

		const mockResponse = {
			ok: true,
			json: () => Promise.resolve({ ok: true }),
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse as any);

		await service.postMessage({
			token: "xoxb-test",
			channel: "C123",
			text: "Message with slack-secret-token-value",
			thread_ts: "1234567890.123456",
		});

		const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
		expect(fetchBody.text).toBe("Message with [REDACTED]");

		fetchSpy.mockRestore();
	});
});
