import { describe, expect, it } from "vitest";
import { CursorRunner } from "../src/CursorRunner.js";
import { TEST_CYRUS_HOME, TEST_WORKING_DIR } from "./test-dirs.js";

function createRunner(): CursorRunner {
	return new CursorRunner({
		cyrusHome: TEST_CYRUS_HOME,
		workingDirectory: TEST_WORKING_DIR,
	});
}

describe("CursorRunner tool event mapping", () => {
	it("maps legacy gpt-5 model alias to a Cursor-supported model argument", () => {
		const runner = new CursorRunner({
			cyrusHome: TEST_CYRUS_HOME,
			workingDirectory: TEST_WORKING_DIR,
			model: "gpt-5",
		});
		const args = (runner as any).buildArgs("hello");
		const modelFlagIndex = args.indexOf("--model");

		expect(args[0]).toBe("acp");
		expect(modelFlagIndex).toBeGreaterThan(-1);
		expect(args[modelFlagIndex + 1]).toBe("auto");
		expect(args).toContain("--trust");
	});

	it("maps command_execution item.completed to assistant tool_use + user tool_result", () => {
		const runner = createRunner();
		(runner as any).sessionInfo = {
			sessionId: "session-1",
			startedAt: new Date(),
			isRunning: true,
		};

		(runner as any).handleEvent({
			type: "item.completed",
			item: {
				id: "item-1",
				type: "command_execution",
				status: "completed",
				command: "rg -n CursorRunner packages",
				aggregated_output: "packages/cursor-runner/src/CursorRunner.ts",
				exit_code: 0,
			},
		});

		const messages = runner.getMessages();
		expect(
			messages.find((message) => message.type === "assistant"),
		).toBeDefined();
		expect(messages.find((message) => message.type === "user")).toBeDefined();
	});

	it("does not emit duplicate tool_use for started + completed pair", () => {
		const runner = createRunner();
		(runner as any).sessionInfo = {
			sessionId: "session-1",
			startedAt: new Date(),
			isRunning: true,
		};

		(runner as any).handleEvent({
			type: "item.started",
			item: {
				id: "item-2",
				type: "command_execution",
				status: "started",
				command: "git status",
			},
		});
		(runner as any).handleEvent({
			type: "item.completed",
			item: {
				id: "item-2",
				type: "command_execution",
				status: "completed",
				command: "git status",
				aggregated_output: "On branch main",
				exit_code: 0,
			},
		});

		const assistantMessages = runner
			.getMessages()
			.filter((message) => message.type === "assistant");
		expect(assistantMessages).toHaveLength(1);
	});

	it("maps assistant event schema to an assistant message", () => {
		const runner = createRunner();
		(runner as any).sessionInfo = {
			sessionId: "session-1",
			startedAt: new Date(),
			isRunning: true,
		};

		(runner as any).handleEvent({
			type: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "cursor runner works" }],
			},
		});

		const assistantMessage = runner
			.getMessages()
			.find((message) => message.type === "assistant");
		expect(assistantMessage).toBeDefined();
	});

	it("maps tool_call started/completed events to tool_use + tool_result", () => {
		const runner = createRunner();
		(runner as any).sessionInfo = {
			sessionId: "session-1",
			startedAt: new Date(),
			isRunning: true,
		};

		(runner as any).handleEvent({
			type: "tool_call",
			subtype: "started",
			call_id: "tool-1",
			tool_call: {
				shellToolCall: {
					args: {
						command: "git status",
					},
				},
			},
		});
		(runner as any).handleEvent({
			type: "tool_call",
			subtype: "completed",
			call_id: "tool-1",
			tool_call: {
				shellToolCall: {
					args: {
						command: "git status",
					},
					result: {
						success: {
							stdout: "On branch cypack-804",
						},
					},
				},
			},
		});

		const messages = runner.getMessages();
		const assistantMessages = messages.filter(
			(message) => message.type === "assistant",
		);
		const userMessages = messages.filter((message) => message.type === "user");

		expect(assistantMessages).toHaveLength(1);
		expect(userMessages).toHaveLength(1);
	});

	it("coalesces ACP assistant message chunks into one assistant message", () => {
		const runner = createRunner();
		(runner as any).sessionInfo = {
			sessionId: "session-1",
			startedAt: new Date(),
			isRunning: true,
		};

		(runner as any).handleAcpSessionUpdate({
			sessionUpdate: "agent_message_chunk",
			messageId: "msg-1",
			content: {
				type: "text",
				text: "Cursor ",
			},
		});
		(runner as any).handleAcpSessionUpdate({
			sessionUpdate: "agent_message_chunk",
			messageId: "msg-1",
			content: {
				type: "text",
				text: "ACP works",
			},
		});
		(runner as any).flushPendingAssistantMessage();

		const assistantMessage = runner
			.getMessages()
			.find((message) => message.type === "assistant");
		expect(assistantMessage).toBeDefined();
		expect(
			JSON.stringify((assistantMessage as { message?: unknown }).message),
		).toContain("Cursor ACP works");
	});

	it("maps ACP tool_call and tool_call_update notifications to tool_use + tool_result", () => {
		const runner = createRunner();
		(runner as any).sessionInfo = {
			sessionId: "session-1",
			startedAt: new Date(),
			isRunning: true,
		};

		(runner as any).handleAcpSessionUpdate({
			sessionUpdate: "tool_call",
			toolCallId: "tool-2",
			kind: "execute",
			title: "Running git status",
			rawInput: {
				command: "git status",
			},
			status: "in_progress",
		});
		(runner as any).handleAcpSessionUpdate({
			sessionUpdate: "tool_call_update",
			toolCallId: "tool-2",
			status: "completed",
			rawOutput: {
				stdout: "On branch main",
			},
		});

		const messages = runner.getMessages();
		const assistantMessages = messages.filter(
			(message) => message.type === "assistant",
		);
		const userMessages = messages.filter((message) => message.type === "user");

		expect(assistantMessages).toHaveLength(1);
		expect(userMessages).toHaveLength(1);
		expect(JSON.stringify(userMessages[0])).toContain("On branch main");
	});
});
