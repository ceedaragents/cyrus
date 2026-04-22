import { getReadOnlyTools } from "cyrus-claude-runner";
import { describe, expect, it, vi } from "vitest";
import type { ChatRepositoryProvider } from "../src/ChatRepositoryProvider.js";
import type { ChatPlatformAdapter } from "../src/ChatSessionHandler.js";
import { ChatSessionHandler } from "../src/ChatSessionHandler.js";
import type { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";
import { TEST_CYRUS_CHAT } from "./test-dirs.js";

interface GateEvent {
	eventId: string;
	threadKey: string;
}

function makeAdapter(threadKey: string) {
	const notifyUnavailable = vi.fn(
		async (_e: GateEvent, _k: string, _m: string) => {},
	);
	const adapter: ChatPlatformAdapter<GateEvent> = {
		platformName: "slack",
		extractTaskInstructions: () => "do a thing",
		getThreadKey: () => threadKey,
		getEventId: () => "event-1",
		buildSystemPrompt: () => "sys",
		fetchThreadContext: async () => "",
		postReply: async () => {},
		acknowledgeReceipt: async () => {},
		notifyBusy: async () => {},
		notifyUnavailable,
	};
	return { adapter, notifyUnavailable };
}

function makeRunnerConfigBuilder(): RunnerConfigBuilder {
	return {
		buildChatConfig: (input: any) => ({
			workingDirectory: input.workspacePath,
			allowedTools: Array.from(new Set(getReadOnlyTools())),
			disallowedTools: [],
			allowedDirectories: [input.workspacePath],
			workspaceName: input.workspaceName,
			cyrusHome: input.cyrusHome,
			appendSystemPrompt: input.systemPrompt,
			logger: input.logger,
			maxTurns: 200,
			onMessage: input.onMessage,
			onError: input.onError,
		}),
		buildIssueConfig: vi.fn(),
	} as unknown as RunnerConfigBuilder;
}

function makeProvider(): ChatRepositoryProvider {
	return {
		getRepositoryPaths: () => ["/repo/alpha"],
		getDefaultRepository: () => undefined,
		getDefaultLinearWorkspaceId: () => undefined,
	};
}

describe("runner gate wiring — ChatSessionHandler", () => {
	it("rejects new sessions and notifies the user when the gate fails", async () => {
		const { adapter, notifyUnavailable } = makeAdapter("gate-reject");
		const createRunner = vi.fn();
		const rejectionMessage = "Cyrus is at capacity (5/5 sessions running).";

		const handler = new ChatSessionHandler(adapter, {
			cyrusHome: TEST_CYRUS_CHAT,
			chatRepositoryProvider: makeProvider(),
			runnerConfigBuilder: makeRunnerConfigBuilder(),
			createRunner,
			onWebhookStart: vi.fn(),
			onWebhookEnd: vi.fn(),
			onStateChange: vi.fn().mockResolvedValue(undefined),
			onClaudeError: vi.fn(),
			checkRunnerGate: () => ({ ok: false, userMessage: rejectionMessage }),
		});

		await handler.handleEvent({
			eventId: "event-1",
			threadKey: "gate-reject",
		});

		expect(createRunner).not.toHaveBeenCalled();
		expect(notifyUnavailable).toHaveBeenCalledTimes(1);
		expect(notifyUnavailable).toHaveBeenCalledWith(
			expect.anything(),
			"gate-reject",
			rejectionMessage,
		);
	});

	it("spawns the runner when the gate passes", async () => {
		const { adapter, notifyUnavailable } = makeAdapter("gate-ok");
		const createRunner = vi.fn().mockReturnValue({
			supportsStreamingInput: false,
			start: vi.fn().mockResolvedValue({ sessionId: "s-1" }),
			stop: vi.fn(),
			isRunning: vi.fn().mockReturnValue(false),
			isStreaming: vi.fn().mockReturnValue(false),
			addStreamMessage: vi.fn(),
			getMessages: vi.fn().mockReturnValue([]),
		});

		const handler = new ChatSessionHandler(adapter, {
			cyrusHome: TEST_CYRUS_CHAT,
			chatRepositoryProvider: makeProvider(),
			runnerConfigBuilder: makeRunnerConfigBuilder(),
			createRunner,
			onWebhookStart: vi.fn(),
			onWebhookEnd: vi.fn(),
			onStateChange: vi.fn().mockResolvedValue(undefined),
			onClaudeError: vi.fn(),
			checkRunnerGate: () => ({ ok: true }),
		});

		await handler.handleEvent({
			eventId: "event-1",
			threadKey: "gate-ok",
		});

		expect(createRunner).toHaveBeenCalledTimes(1);
		expect(notifyUnavailable).not.toHaveBeenCalled();
	});

	it("spawns the runner when no gate is configured", async () => {
		const { adapter, notifyUnavailable } = makeAdapter("gate-absent");
		const createRunner = vi.fn().mockReturnValue({
			supportsStreamingInput: false,
			start: vi.fn().mockResolvedValue({ sessionId: "s-1" }),
			stop: vi.fn(),
			isRunning: vi.fn().mockReturnValue(false),
			isStreaming: vi.fn().mockReturnValue(false),
			addStreamMessage: vi.fn(),
			getMessages: vi.fn().mockReturnValue([]),
		});

		const handler = new ChatSessionHandler(adapter, {
			cyrusHome: TEST_CYRUS_CHAT,
			chatRepositoryProvider: makeProvider(),
			runnerConfigBuilder: makeRunnerConfigBuilder(),
			createRunner,
			onWebhookStart: vi.fn(),
			onWebhookEnd: vi.fn(),
			onStateChange: vi.fn().mockResolvedValue(undefined),
			onClaudeError: vi.fn(),
		});

		await handler.handleEvent({
			eventId: "event-1",
			threadKey: "gate-absent",
		});

		expect(createRunner).toHaveBeenCalledTimes(1);
		expect(notifyUnavailable).not.toHaveBeenCalled();
	});
});
