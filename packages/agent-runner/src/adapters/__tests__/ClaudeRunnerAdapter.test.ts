import type { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunnerEvent } from "../../types.ts";
import { ClaudeRunnerAdapter } from "../ClaudeRunnerAdapter.ts";

type MockClaudeRunnerInstance = EventEmitter & {
	startStreaming: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
};

const hoisted = vi.hoisted(() => ({
	instances: [] as MockClaudeRunnerInstance[],
	mock: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock("cyrus-claude-runner", async () => {
	const eventsModule =
		await vi.importActual<typeof import("node:events")>("node:events");

	class MockClaudeRunner extends eventsModule.EventEmitter {
		public startStreaming = vi.fn(async (_prompt: string) => ({
			sessionId: "claude-session-123",
		}));

		public stop = vi.fn(() => {
			// no-op
		});
	}

	const mock = vi.fn(() => {
		const instance = new MockClaudeRunner();
		hoisted.instances.push(instance as MockClaudeRunnerInstance);
		return instance;
	});

	hoisted.mock = mock;

	return { ClaudeRunner: mock };
});

describe("ClaudeRunnerAdapter", () => {
	beforeEach(() => {
		hoisted.mock?.mockClear();
		hoisted.instances.length = 0;
	});

	it("emits normalized events for Claude stream", async () => {
		const adapter = new ClaudeRunnerAdapter({
			type: "claude",
			claudeConfig: {} as any,
			cwd: "/tmp/workspace",
			prompt: "build summary",
		});

		const events: RunnerEvent[] = [];
		const startResult = await adapter.start((event) => {
			events.push(event);
		});

		const mock = hoisted.mock!;
		expect(mock).toHaveBeenCalledTimes(1);
		expect(startResult.sessionId).toBe("claude-session-123");

		expect(hoisted.instances).toHaveLength(1);
		const runner = hoisted.instances[0]!;
		expect(runner).toBeDefined();
		expect(runner.startStreaming).toHaveBeenCalledWith("build summary");

		runner.emit("text", "  thinking deeply  ");
		runner.emit("tool-use", "bash -lc ls", { output: "docs" });
		const emittedError = new Error("failure");
		runner.emit("error", emittedError);
		runner.emit("complete", [
			{
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "done" },
						{ type: "text", text: "with summary" },
					],
				},
			},
		] as any);

		expect(events.map((event) => event.kind)).toEqual([
			"thought",
			"action",
			"error",
			"final",
		]);

		const thoughtEvent = events[0] as { kind: "thought"; text: string };
		expect(thoughtEvent.text).toBe("thinking deeply");

		const actionEvent = events[1] as {
			kind: "action";
			name: string;
			detail?: string;
		};
		expect(actionEvent.name).toBe("bash -lc ls");
		expect(actionEvent.detail).toContain('"output": "docs"');

		const errorEvent = events[2] as { kind: "error"; error: Error };
		expect(errorEvent.error).toBe(emittedError);

		const finalEvent = events[3] as { kind: "final"; text: string };
		expect(finalEvent.text).toBe("done\nwith summary");

		expect(
			events.every((event) =>
				["thought", "action", "error", "final"].includes(event.kind),
			),
		).toBe(true);
	});

	it("emits default final when no assistant message is present", async () => {
		const adapter = new ClaudeRunnerAdapter({
			type: "claude",
			claudeConfig: {} as any,
			cwd: "/tmp/workspace",
			prompt: "do nothing",
		});

		const events: RunnerEvent[] = [];
		await adapter.start((event) => {
			events.push(event);
		});

		const runner = hoisted.instances[0]!;
		runner.emit("complete", [{ type: "user" }] as any);

		expect(events).toContainEqual({
			kind: "final",
			text: "Claude run completed",
		});
	});
});
