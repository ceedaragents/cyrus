import type { IAgentRunner } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ChatPlatformAdapter,
	ChatSessionHandlerDeps,
} from "../src/ChatSessionHandler";
import { ChatSessionHandler } from "../src/ChatSessionHandler";
import type { RunnerConfigBuilder } from "../src/RunnerConfigBuilder";

/**
 * Minimal mock event for testing chat session handler.
 */
interface MockEvent {
	id: string;
	channel: string;
	thread_ts: string;
	text: string;
}

/**
 * Creates a mock ChatPlatformAdapter for testing.
 */
function createMockAdapter(
	overrides?: Partial<ChatPlatformAdapter<MockEvent>>,
): ChatPlatformAdapter<MockEvent> {
	return {
		platformName: "slack",
		extractTaskInstructions: (event) => event.text,
		getThreadKey: (event) => `${event.channel}:${event.thread_ts}`,
		getEventId: (event) => event.id,
		buildSystemPrompt: () => "You are a helpful assistant.",
		fetchThreadContext: vi.fn().mockResolvedValue(""),
		postReply: vi.fn().mockResolvedValue(undefined),
		acknowledgeReceipt: vi.fn().mockResolvedValue(undefined),
		notifyBusy: vi.fn().mockResolvedValue(undefined),
		postThreadMessage: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

/**
 * Creates a mock runner that resolves immediately with messages.
 */
function createMockRunner(): IAgentRunner {
	const messages: any[] = [];
	return {
		isRunning: () => false,
		supportsStreamingInput: false,
		getMessages: () => messages,
		start: vi.fn().mockResolvedValue({ sessionId: "test-session" }),
		stop: vi.fn().mockResolvedValue(undefined),
		getFormatter: () => null,
		getUsage: () => ({ inputTokens: 0, outputTokens: 0, totalCost: 0 }),
	} as unknown as IAgentRunner;
}

/**
 * Creates mock ChatSessionHandlerDeps.
 */
function createMockDeps(runner: IAgentRunner): ChatSessionHandlerDeps {
	const mockRunnerConfigBuilder = {
		buildChatConfig: vi.fn().mockReturnValue({
			workingDirectory: "/tmp/test",
			systemPrompt: "test",
		}),
	} as unknown as RunnerConfigBuilder;

	return {
		cyrusHome: "/tmp/cyrus-test",
		runnerConfigBuilder: mockRunnerConfigBuilder,
		createRunner: () => runner,
		onWebhookStart: vi.fn(),
		onWebhookEnd: vi.fn(),
		onStateChange: vi.fn().mockResolvedValue(undefined),
		onClaudeError: vi.fn(),
	};
}

describe("ChatSessionHandler - Linear Issue Creation Notification", () => {
	describe("extractLinearIssueUrl", () => {
		let handler: ChatSessionHandler<MockEvent>;

		beforeEach(() => {
			const adapter = createMockAdapter();
			const runner = createMockRunner();
			const deps = createMockDeps(runner);
			handler = new ChatSessionHandler(adapter, deps);
		});

		it("extracts URL from JSON response", () => {
			const content = JSON.stringify({
				id: "abc123",
				identifier: "CYPACK-1234",
				title: "Test issue",
				url: "https://linear.app/ceedar/issue/CYPACK-1234/test-issue",
			});

			const result = (handler as any).extractLinearIssueUrl(content);
			expect(result).toBe(
				"https://linear.app/ceedar/issue/CYPACK-1234/test-issue",
			);
		});

		it("extracts URL from plain text", () => {
			const content =
				"Created issue CYPACK-1234: https://linear.app/ceedar/issue/CYPACK-1234/test-issue";

			const result = (handler as any).extractLinearIssueUrl(content);
			expect(result).toBe(
				"https://linear.app/ceedar/issue/CYPACK-1234/test-issue",
			);
		});

		it("returns null when no URL found", () => {
			const content = "Issue created successfully";
			const result = (handler as any).extractLinearIssueUrl(content);
			expect(result).toBeNull();
		});

		it("handles empty content", () => {
			const result = (handler as any).extractLinearIssueUrl("");
			expect(result).toBeNull();
		});
	});

	describe("extractLinearIssueIdentifier", () => {
		let handler: ChatSessionHandler<MockEvent>;

		beforeEach(() => {
			const adapter = createMockAdapter();
			const runner = createMockRunner();
			const deps = createMockDeps(runner);
			handler = new ChatSessionHandler(adapter, deps);
		});

		it("extracts identifier from JSON response", () => {
			const content = JSON.stringify({
				identifier: "CYPACK-1234",
				title: "Test issue",
			});

			const result = (handler as any).extractLinearIssueIdentifier(content);
			expect(result).toBe("CYPACK-1234");
		});

		it("extracts identifier from plain text", () => {
			const content = "Created issue CYPACK-1234 successfully";
			const result = (handler as any).extractLinearIssueIdentifier(content);
			expect(result).toBe("CYPACK-1234");
		});

		it("returns null when no identifier found", () => {
			const content = "Issue created successfully";
			const result = (handler as any).extractLinearIssueIdentifier(content);
			expect(result).toBeNull();
		});
	});

	describe("handleToolResultNotification", () => {
		let adapter: ChatPlatformAdapter<MockEvent>;
		let handler: ChatSessionHandler<MockEvent>;
		const mockEvent: MockEvent = {
			id: "evt-1",
			channel: "C123",
			thread_ts: "1704110400.000100",
			text: "Create an issue",
		};

		beforeEach(() => {
			adapter = createMockAdapter();
			const runner = createMockRunner();
			const deps = createMockDeps(runner);
			handler = new ChatSessionHandler(adapter, deps);

			// Simulate storing a session event
			(handler as any).sessionEvents.set("test-session", mockEvent);
		});

		it("posts thread message when Linear issue is created", async () => {
			const toolResultContent = JSON.stringify({
				id: "abc123",
				identifier: "CYPACK-1234",
				title: "Test issue",
				url: "https://linear.app/ceedar/issue/CYPACK-1234/test-issue",
			});

			await (handler as any).handleToolResultNotification({
				sessionId: "test-session",
				toolName: "mcp__linear__save_issue",
				toolInput: { title: "Test issue" },
				toolResultContent,
				isError: false,
			});

			expect(adapter.postThreadMessage).toHaveBeenCalledWith(
				mockEvent,
				"Created CYPACK-1234: https://linear.app/ceedar/issue/CYPACK-1234/test-issue",
			);
		});

		it("does not post when tool is not mcp__linear__save_issue", async () => {
			await (handler as any).handleToolResultNotification({
				sessionId: "test-session",
				toolName: "mcp__linear__get_issue",
				toolInput: { id: "CYPACK-1234" },
				toolResultContent: "some result",
				isError: false,
			});

			expect(adapter.postThreadMessage).not.toHaveBeenCalled();
		});

		it("does not post when tool result is an error", async () => {
			await (handler as any).handleToolResultNotification({
				sessionId: "test-session",
				toolName: "mcp__linear__save_issue",
				toolInput: { title: "Test issue" },
				toolResultContent: "Error creating issue",
				isError: true,
			});

			expect(adapter.postThreadMessage).not.toHaveBeenCalled();
		});

		it("does not post when no event is stored for session", async () => {
			await (handler as any).handleToolResultNotification({
				sessionId: "unknown-session",
				toolName: "mcp__linear__save_issue",
				toolInput: { title: "Test issue" },
				toolResultContent: JSON.stringify({
					url: "https://linear.app/ceedar/issue/CYPACK-1234/test",
				}),
				isError: false,
			});

			expect(adapter.postThreadMessage).not.toHaveBeenCalled();
		});

		it("does not post when adapter lacks postThreadMessage", async () => {
			const adapterWithoutPost = createMockAdapter();
			delete (adapterWithoutPost as any).postThreadMessage;
			const runner = createMockRunner();
			const deps = createMockDeps(runner);
			const handlerWithoutPost = new ChatSessionHandler(
				adapterWithoutPost,
				deps,
			);
			(handlerWithoutPost as any).sessionEvents.set("test-session", mockEvent);

			await (handlerWithoutPost as any).handleToolResultNotification({
				sessionId: "test-session",
				toolName: "mcp__linear__save_issue",
				toolInput: { title: "Test issue" },
				toolResultContent: JSON.stringify({
					url: "https://linear.app/ceedar/issue/CYPACK-1234/test",
				}),
				isError: false,
			});

			// No error thrown, just silently skipped
		});

		it("does not post when URL cannot be extracted from result", async () => {
			await (handler as any).handleToolResultNotification({
				sessionId: "test-session",
				toolName: "mcp__linear__save_issue",
				toolInput: { title: "Test issue" },
				toolResultContent: "Issue created but no URL in response",
				isError: false,
			});

			expect(adapter.postThreadMessage).not.toHaveBeenCalled();
		});

		it("uses plain display text when identifier cannot be extracted", async () => {
			const toolResultContent = JSON.stringify({
				url: "https://linear.app/ceedar/issue/CYPACK-1234/test-issue",
			});

			await (handler as any).handleToolResultNotification({
				sessionId: "test-session",
				toolName: "mcp__linear__save_issue",
				toolInput: { title: "Test issue" },
				toolResultContent,
				isError: false,
			});

			// URL contains CYPACK-1234, which the regex will still pick up from the URL itself
			expect(adapter.postThreadMessage).toHaveBeenCalledWith(
				mockEvent,
				expect.stringContaining(
					"https://linear.app/ceedar/issue/CYPACK-1234/test-issue",
				),
			);
		});
	});
});
