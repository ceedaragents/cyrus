import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	spawnSyncMock: vi.fn(() => ({
		stdout: "Usage: codex exec [OPTIONS]\n\n        --json  Stream JSON events",
		stderr: "",
	})),
}));

vi.mock("node:child_process", async () => {
	const actual =
		await vi.importActual<typeof import("node:child_process")>(
			"node:child_process",
		);
	return {
		...actual,
		spawn: spawnMock as typeof actual.spawn,
		spawnSync: spawnSyncMock as typeof actual.spawnSync,
	};
});

import type { RunnerEvent } from "../../types.ts";
import {
	__resetCodexFeatureCacheForTests,
	CodexRunnerAdapter,
} from "../CodexRunnerAdapter.ts";

class MockChildProcess
	extends EventEmitter
	implements Partial<ChildProcessWithoutNullStreams>
{
	public stdout = new PassThrough();
	public stderr = new PassThrough();
	public stdin = new PassThrough();
	public killed = false;

	kill = vi.fn(() => {
		this.killed = true;
		queueMicrotask(() => {
			this.emit("exit", 0, null);
			this.emit("close", 0, null);
		});
		return true;
	});
}

const flushAsync = async (): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
};

describe("CodexRunnerAdapter", () => {
	beforeEach(() => {
		spawnMock.mockReset();
		spawnSyncMock.mockClear();
	});

	afterEach(() => {
		spawnMock.mockReset();
		spawnSyncMock.mockClear();
		__resetCodexFeatureCacheForTests();
	});

	it("emits normalized events for JSON stream", async () => {
		spawnSyncMock.mockReturnValueOnce({
			stdout: [
				"Usage: codex exec [OPTIONS]",
				"  --json",
				"  --sandbox <MODE>",
				"  --approval-policy <POLICY>",
				"  --full-auto",
			].join("\n"),
			stderr: "",
		});
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "do the thing",
			model: "o4-mini",
			approvalPolicy: "on-request",
			sandbox: "danger-full-access",
			env: { TEST_ENV: "1" },
		});

		const events: RunnerEvent[] = [];
		const startResult = await adapter.start((event) => {
			events.push(event);
		});

		expect(startResult.capabilities?.jsonStream).toBe(true);
		expect(startResult.sessionId).toBeUndefined();
		expect(spawnMock).toHaveBeenCalledWith(
			"codex",
			expect.arrayContaining([
				"exec",
				"--json",
				"--cd",
				"/tmp/workspace",
				"-m",
				"o4-mini",
				"--approval-policy",
				"on-request",
				"--sandbox",
				"danger-full-access",
				"do the thing",
			]),
			expect.objectContaining({
				cwd: "/tmp/workspace",
				env: expect.objectContaining({ TEST_ENV: "1" }),
			}),
		);
		const args = spawnMock.mock.calls[0]?.[1];
		expect(args?.[1]).toBe("--json");

		mockChild.stdout.write(
			`${JSON.stringify({
				type: "session.created",
				session_id: "session-123",
			})}\n`,
		);
		mockChild.stdout.write(
			`${JSON.stringify({
				type: "item.completed",
				item: { id: "item_0", item_type: "reasoning", text: " thinking " },
			})}\n`,
		);
		mockChild.stdout.write(
			`${JSON.stringify({
				type: "item.completed",
				item: {
					id: "item_1",
					item_type: "command_execution",
					command: "bash -lc ls",
					aggregated_output: "apps\\nREADME.md\\n",
				},
			})}\n`,
		);
		mockChild.stdout.write(
			`${JSON.stringify({ type: "status", message: "token usage" })}\n`,
		);
		const finalPayload = {
			type: "item.completed",
			item: {
				id: "item_2",
				item_type: "assistant_message",
				text: ["final response", "item_2"],
			},
		};
		mockChild.stdout.write(`${JSON.stringify(finalPayload)}\n`);
		mockChild.stdout.write(
			`${JSON.stringify({
				type: "session.failed",
				error: { message: "fail" },
			})}\n`,
		);

		await flushAsync();
		mockChild.emit("close", 0, null);
		await flushAsync();

		expect(events).toHaveLength(9);
		const [
			sessionEvent,
			sessionLog,
			thought,
			action,
			statusLog,
			finalEvent,
			finalLog,
			errorLog,
			errorEvent,
		] = events as [
			RunnerEvent & { kind: "session"; id: string },
			RunnerEvent,
			RunnerEvent,
			RunnerEvent & { kind: "action"; detail: string; name: string },
			RunnerEvent,
			RunnerEvent,
			RunnerEvent,
			RunnerEvent,
			RunnerEvent & { kind: "error"; error: Error },
		];

		expect(sessionEvent).toEqual({ kind: "session", id: "session-123" });

		expect(sessionLog).toEqual({
			kind: "log",
			text: "[codex:session] session-123",
		});

		expect(thought).toEqual({ kind: "thought", text: "thinking" });

		expect(action.kind).toBe("action");
		expect(action.name).toBe("bash -lc ls");
		expect(action.detail).toContain("command: bash -lc ls");
		expect(action.detail).toContain("apps");
		expect(action.detail).toContain("README.md");
		expect(action.itemType).toBe("command_execution");
		expect(action.icon).toBe("⚙️");

		expect(statusLog).toEqual({ kind: "log", text: "token usage" });

		expect(finalEvent).toEqual({ kind: "final", text: "final response" });

		expect(finalLog).toEqual({
			kind: "log",
			text: '[codex:final] {"type":"item.completed","item":{"id":"item_2","item_type":"assistant_message","text":["final response","item_2"]}}',
		});

		expect(errorLog).toEqual({
			kind: "log",
			text: '[codex:error] {"type":"session.failed","error":{"message":"fail"}}',
		});

		expect(errorEvent.kind).toBe("error");
		expect(errorEvent.error.message).toBe("fail");
	});

	it("falls back when sandbox and approvals are unsupported", async () => {
		spawnSyncMock.mockReturnValueOnce({
			stdout: "Usage: codex exec [OPTIONS]\n  --json",
			stderr: "",
		});
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "safe mode",
			sandbox: "workspace-write",
			approvalPolicy: "never",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => events.push(event));

		expect(spawnMock.mock.calls[0]?.[1]).toEqual([
			"exec",
			"--json",
			"--cd",
			"/tmp/workspace",
			"safe mode",
		]);
		expect(spawnMock.mock.calls[0]?.[1]).not.toContain("--sandbox");
		expect(spawnMock.mock.calls[0]?.[1]).not.toContain("--approval-policy");
		expect(
			events.some(
				(event) =>
					event.kind === "log" &&
					"text" in event &&
					typeof event.text === "string" &&
					event.text.includes("lacks --sandbox"),
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.kind === "log" &&
					"text" in event &&
					typeof event.text === "string" &&
					event.text.includes("does not expose --full-auto"),
			),
		).toBe(true);
	});

	it("includes command details in error events", async () => {
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "run checks",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => {
			events.push(event);
		});

		mockChild.stdout.write(
			`${JSON.stringify({
				type: "item.completed",
				item: {
					item_type: "command_execution",
					command: "bash -lc 'flutter analyze'",
					exit_code: -1,
					aggregated_output:
						"failed in sandbox: permission denied\nMore details...",
					status: "failed",
				},
			})}\n`,
		);

		await flushAsync();

		const errorEvent = events.find(
			(event): event is Extract<RunnerEvent, { kind: "error" }> =>
				event.kind === "error",
		);
		expect(errorEvent).toBeDefined();
		expect(errorEvent?.error.message).toContain("bash -lc 'flutter analyze'");
		expect(errorEvent?.error.message).toContain("exit -1");
		expect(errorEvent?.error.message).toContain("failed in sandbox");
		expect(
			events.some(
				(event) => event.kind === "log" && event.text.includes("[codex:error]"),
			),
		).toBe(true);
	});

	it("escalates to SIGKILL when SIGTERM does not terminate the process", async () => {
		vi.useFakeTimers();
		try {
			const mockChild = new MockChildProcess();
			mockChild.kill = vi.fn((_signal?: string | number) => {
				mockChild.killed = true;
				return true;
			}) as unknown as typeof mockChild.kill;
			spawnMock.mockReturnValue(
				mockChild as unknown as ChildProcessWithoutNullStreams,
			);

			const adapter = new CodexRunnerAdapter({
				type: "codex",
				cwd: "/tmp/workspace",
				prompt: "noop",
			});

			await adapter.start(() => {});
			const stopPromise = adapter.stop();

			expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
			mockChild.kill.mockClear();

			vi.advanceTimersByTime(5000);
			vi.runOnlyPendingTimers();
			await Promise.resolve();
			expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");

			mockChild.emit("close", 0, null);
			await Promise.resolve();
			await stopPromise;
		} finally {
			vi.useRealTimers();
		}
	});

	it("only emits the first final event", async () => {
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "final twice",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => {
			events.push(event);
		});

		const finalPayload = JSON.stringify({
			type: "item.completed",
			item: {
				item_type: "assistant_message",
				text: "first",
			},
		});
		mockChild.stdout.write(`${finalPayload}\n`);
		mockChild.stdout.write(`${finalPayload}\n`);

		await flushAsync();
		const finals = events.filter((event) => event.kind === "final");
		expect(finals).toHaveLength(1);
	});

	it("waits for assistant completion events before finalizing", async () => {
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "check completion",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => {
			events.push(event);
		});

		mockChild.stdout.write(
			`${JSON.stringify({
				type: "item.updated",
				item: {
					id: "item_0",
					item_type: "assistant_message",
					text: "  Working on it  ",
				},
			})}\n`,
		);
		mockChild.stdout.write(
			`${JSON.stringify({
				type: "item.completed",
				item: {
					id: "item_0",
					item_type: "assistant_message",
					text: "Done.",
				},
			})}\n`,
		);

		await flushAsync();
		mockChild.emit("close", 0, null);
		await flushAsync();

		const responseEvents = events.filter(
			(event): event is Extract<RunnerEvent, { kind: "response" }> =>
				event.kind === "response",
		);
		expect(responseEvents).toHaveLength(1);
		expect(responseEvents[0]?.text).toBe("Working on it");

		const finalEvents = events.filter(
			(event): event is Extract<RunnerEvent, { kind: "final" }> =>
				event.kind === "final",
		);
		expect(finalEvents).toHaveLength(1);
		expect(finalEvents[0]?.text).toBe("Done.");
	});

	it("handles thread and turn events with structured item types", async () => {
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "structured stream",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => {
			events.push(event);
		});

		const writes = [
			{ type: "thread.started", thread_id: "thread-123" },
			{ type: "turn.started", turn_id: "turn-1" },
			{
				type: "item.started",
				item: { id: "item_0", type: "reasoning", text: " reasoning " },
			},
			{
				type: "item.completed",
				item: { id: "item_0", type: "reasoning", text: " reasoning " },
			},
			{
				type: "item.started",
				item: {
					id: "item_1",
					type: "mcp_tool_call",
					tool_name: "linear.issue",
					arguments: { id: "ISSUE-1" },
				},
			},
			{
				type: "item.completed",
				item: {
					id: "item_1",
					type: "mcp_tool_call",
					tool_name: "linear.issue",
					arguments: { id: "ISSUE-1" },
					output: "ok",
				},
			},
			{
				type: "item.completed",
				item: { id: "item_2", type: "agent_message", text: "Result" },
			},
			{ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
		];

		for (const payload of writes) {
			mockChild.stdout.write(`${JSON.stringify(payload)}\n`);
		}

		await flushAsync();
		mockChild.emit("close", 0, null);
		await flushAsync();

		const sessionEvent = events.find(
			(event): event is Extract<RunnerEvent, { kind: "session"; id: string }> =>
				event.kind === "session",
		);
		expect(sessionEvent?.id).toBe("thread-123");

		const actionEvents = events.filter(
			(event): event is Extract<RunnerEvent, { kind: "action" }> =>
				event.kind === "action",
		);
		expect(actionEvents.length).toBeGreaterThanOrEqual(1);
		const mcpAction = actionEvents.find(
			(event) => event.itemType === "mcp_tool_call",
		);
		expect(mcpAction?.icon).toBe("🧰");
		expect(mcpAction?.detail).toContain("linear.issue");
		expect(mcpAction?.detail).toContain("ISSUE-1");

		const finalEvent = events.find(
			(event): event is Extract<RunnerEvent, { kind: "final" }> =>
				event.kind === "final",
		);
		expect(finalEvent?.text).toBe("Result");

		const turnCompletedLog = events.find(
			(event) =>
				event.kind === "log" &&
				typeof event.text === "string" &&
				event.text.includes("turn completed"),
		);
		expect(turnCompletedLog?.text).toContain("input_tokens: 10");
		expect(turnCompletedLog?.text).toContain("output_tokens: 5");
	});

	it("passes resume arguments when resumeSessionId is provided", async () => {
		spawnSyncMock.mockReturnValueOnce({
			stdout: [
				"Usage: codex exec [OPTIONS]",
				"  --json",
				"  --sandbox <MODE>",
				"  --approval-policy <POLICY>",
				"  --full-auto",
			].join("\n"),
			stderr: "",
		});
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "continue please",
			resumeSessionId: "session-xyz",
			sandbox: "danger-full-access",
			fullAuto: true,
			approvalPolicy: "never",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => {
			events.push(event);
		});

		expect(spawnMock).toHaveBeenCalledWith(
			"codex",
			[
				"exec",
				"--json",
				"--cd",
				"/tmp/workspace",
				"--sandbox",
				"danger-full-access",
				"--full-auto",
				"--approval-policy",
				"never",
				"resume",
				"session-xyz",
				"continue please",
			],
			expect.objectContaining({ cwd: "/tmp/workspace" }),
		);
		expect(
			events.every(
				(event) =>
					event.kind !== "log" ||
					typeof event.text !== "string" ||
					!event.text.includes("dangerously-bypass"),
			),
		).toBe(true);

		mockChild.emit("close", 0, null);
	});

	it("avoids sandbox bypass flag for danger-full-access profiles", async () => {
		spawnSyncMock.mockReturnValueOnce({
			stdout: [
				"Usage: codex exec [OPTIONS]",
				"  --json",
				"  --sandbox <MODE>",
				"  --dangerously-bypass-approvals-and-sandbox",
			].join("\n"),
			stderr: "",
		});
		const mockChild = new MockChildProcess();
		spawnMock.mockReturnValue(
			mockChild as unknown as ChildProcessWithoutNullStreams,
		);

		const adapter = new CodexRunnerAdapter({
			type: "codex",
			cwd: "/tmp/workspace",
			prompt: "danger mode",
			sandbox: "danger-full-access",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => {
			events.push(event);
		});

		const args = spawnMock.mock.calls[0]?.[1] ?? [];
		expect(args).toContain("--sandbox");
		expect(args).toContain("danger-full-access");
		expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
		expect(
			events.every(
				(event) =>
					event.kind !== "log" ||
					typeof event.text !== "string" ||
					!event.text.includes("dangerously-bypass"),
			),
		).toBe(true);

		mockChild.emit("close", 0, null);
	});
});
