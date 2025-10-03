import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	spawnSyncMock: vi.fn(() => ({
		stdout:
			"Usage: codex exec [OPTIONS]\n\n        --experimental-json  Stream JSON events",
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
				"  --experimental-json",
				"  --sandbox <MODE>",
				"  --approval-policy <POLICY>",
				"  --full-auto",
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
			prompt: "do the thing",
			model: "o4-mini",
			approvalPolicy: "on-request",
			sandbox: "workspace-write",
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
				"--experimental-json",
				"--cd",
				"/tmp/workspace",
				"-m",
				"o4-mini",
				"--approval-policy",
				"on-request",
				"--sandbox",
				"workspace-write",
				"do the thing",
			]),
			expect.objectContaining({
				cwd: "/tmp/workspace",
				env: expect.objectContaining({ TEST_ENV: "1" }),
			}),
		);
		const args = spawnMock.mock.calls[0]?.[1];
		expect(args?.[1]).toBe("--experimental-json");

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

	it("passes resume arguments when resumeSessionId is provided", async () => {
		spawnSyncMock.mockReturnValueOnce({
			stdout: [
				"Usage: codex exec [OPTIONS]",
				"  --experimental-json",
				"  --sandbox <MODE>",
				"  --approval-policy <POLICY>",
				"  --full-auto",
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
			prompt: "continue please",
			resumeSessionId: "session-xyz",
			sandbox: "danger-full-access",
			fullAuto: true,
			approvalPolicy: "never",
		});

		await adapter.start(() => {
			// No-op for this assertion-focused test
		});

		expect(spawnMock).toHaveBeenCalledWith(
			"codex",
			[
				"exec",
				"--experimental-json",
				"--cd",
				"/tmp/workspace",
				"--sandbox",
				"danger-full-access",
				"--dangerously-bypass-approvals-and-sandbox",
				"--full-auto",
				"--approval-policy",
				"never",
				"resume",
				"session-xyz",
				"continue please",
			],
			expect.objectContaining({ cwd: "/tmp/workspace" }),
		);

		mockChild.emit("close", 0, null);
	});

	it("adds sandbox bypass flag for danger-full-access profiles", async () => {
		spawnSyncMock.mockReturnValueOnce({
			stdout: [
				"Usage: codex exec [OPTIONS]",
				"  --experimental-json",
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
		expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
		expect(
			events.some(
				(event) =>
					event.kind === "log" &&
					"text" in event &&
					typeof event.text === "string" &&
					event.text.includes(
						"enabling --dangerously-bypass-approvals-and-sandbox",
					),
			),
		).toBe(true);

		mockChild.emit("close", 0, null);
	});
});
