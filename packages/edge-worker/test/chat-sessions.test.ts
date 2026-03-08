import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ChatPlatformAdapter } from "../src/ChatSessionHandler.js";
import { ChatSessionHandler } from "../src/ChatSessionHandler.js";
import { SlackChatAdapter } from "../src/SlackChatAdapter.js";
import { TEST_CYRUS_CHAT } from "./test-dirs.js";

interface TestEvent {
	eventId: string;
	threadKey: string;
}

class TestChatAdapter implements ChatPlatformAdapter<TestEvent> {
	public platformName = "slack" as const;

	constructor(private readonly threadKey: string) {}

	extractTaskInstructions(_event: TestEvent): string {
		return "Inspect repository configuration";
	}

	getThreadKey(_event: TestEvent): string {
		return this.threadKey;
	}

	getEventId(_event: TestEvent): string {
		return "test-event";
	}

	buildSystemPrompt(_event: TestEvent): string {
		return "You are a test chat assistant.";
	}

	async fetchThreadContext(_event: TestEvent): Promise<string> {
		return "";
	}

	async postReply(_event: TestEvent, _runner: unknown): Promise<void> {
		return;
	}

	async acknowledgeReceipt(_event: TestEvent): Promise<void> {
		return;
	}

	async notifyBusy(_event: TestEvent): Promise<void> {
		return;
	}
}

describe("ChatSessionHandler chat session permissions", () => {
	it("grants read-only tools, explicit git pull, and repository read access", async () => {
		const event: TestEvent = {
			eventId: "test-event",
			threadKey: "test-thread",
		};
		const cyrusHome = TEST_CYRUS_CHAT;
		const chatRepositoryPaths = ["/repo/chat-one", "/repo/chat-two"];
		let capturedConfig: any;

		const adapter = new TestChatAdapter("thread-key");
		const createRunner = vi.fn((config: any) => {
			capturedConfig = config;
			return {
				supportsStreamingInput: false,
				start: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
				stop: vi.fn(),
				isRunning: vi.fn().mockReturnValue(false),
				isStreaming: vi.fn().mockReturnValue(false),
				addStreamMessage: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
			} as any;
		});
		const onWebhookStart = vi.fn();
		const onWebhookEnd = vi.fn();
		const onStateChange = vi.fn().mockResolvedValue(undefined);
		const onClaudeError = vi.fn();

		const handler = new ChatSessionHandler(adapter, {
			cyrusHome,
			chatRepositoryPaths,
			createRunner: createRunner,
			onWebhookStart,
			onWebhookEnd,
			onStateChange,
			onClaudeError,
		});

		await handler.handleEvent(event as any);

		expect(capturedConfig).toBeDefined();
		expect(capturedConfig.allowedTools).toContain("Read(**)");
		expect(capturedConfig.allowedTools).toContain("TodoRead");
		expect(capturedConfig.allowedTools).toContain("Bash(git -C * pull)");
		expect(capturedConfig.allowedTools).not.toContain("Edit(**)");

		const expectedWorkspace = join(cyrusHome, "slack-workspaces", "thread-key");
		expect(capturedConfig.allowedDirectories).toContain(expectedWorkspace);
		for (const path of chatRepositoryPaths) {
			expect(capturedConfig.allowedDirectories).toContain(path);
		}
	});
});

describe("SlackChatAdapter system prompt", () => {
	it("includes configured repository context and git pull instructions", () => {
		const repositoryPaths = ["/repo/chat-one", "/repo/chat-two"];
		const adapter = new SlackChatAdapter(repositoryPaths);
		const systemPrompt = adapter.buildSystemPrompt({
			payload: {
				user: "U1",
				channel: "C1",
				text: "<@cyrus> inspect code",
				ts: "1700000000.000100",
				event_ts: "1700000000.000100",
				type: "app_mention",
			},
		} as any);

		expect(systemPrompt).toContain("## Repository Access");
		expect(systemPrompt).toContain("- /repo/chat-one");
		expect(systemPrompt).toContain("- /repo/chat-two");
		expect(systemPrompt).toContain("Bash(git -C * pull)");
	});

	it("includes orchestrator routing context and self-assignment workflow", () => {
		const repositoryPaths = ["/repo/chat-one", "/repo/chat-two"];
		const repositoryRoutingContext =
			"<repository_routing_context>\n  <description>Use repo routing tags.</description>\n</repository_routing_context>";
		const adapter = new SlackChatAdapter(repositoryPaths, undefined, {
			repositoryRoutingContext,
		});
		const systemPrompt = adapter.buildSystemPrompt({
			payload: {
				user: "U1",
				channel: "C1",
				text: "<@cyrus> assign this work",
				ts: "1700000000.000100",
				event_ts: "1700000000.000100",
				type: "app_mention",
			},
		} as any);

		expect(systemPrompt).toContain(repositoryRoutingContext);
		expect(systemPrompt).toContain("mcp__linear__get_user");
		expect(systemPrompt).toContain('query: "me"');
		expect(systemPrompt).toContain("linear_get_agent_sessions");
	});
});
