import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async () => {
	const actual =
		await vi.importActual<typeof import("node:child_process")>(
			"node:child_process",
		);
	return {
		...actual,
		spawn: vi.fn(),
	};
});

import { spawn } from "node:child_process";
import { CodexRunner } from "../src/CodexRunner.js";

class FakeChildProcess extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	kill = vi.fn(() => true);
}

function attachJsonRpcResponder(
	child: FakeChildProcess,
	options: { autoCompleteTurns?: boolean } = {},
): {
	sentMethods: string[];
	turnInputs: string[];
	steerInputs: string[];
	completeTurn: (turnNumber: number, text?: string) => void;
} {
	const sentMethods: string[] = [];
	const turnInputs: string[] = [];
	const steerInputs: string[] = [];
	let buffer = "";
	const autoCompleteTurns = options.autoCompleteTurns ?? true;

	function completeTurn(turnNumber: number, text?: string): void {
		const threadId = "thr_app_server_1";
		const turnId = `turn_app_server_${turnNumber}`;
		child.stdout.write(
			`${JSON.stringify({
				method: "item/completed",
				params: {
					threadId,
					turnId,
					item: {
						type: "agentMessage",
						id: `msg_${turnNumber}`,
						text: text || `App server response ${turnNumber}`,
					},
				},
			})}\n`,
		);
		child.stdout.write(
			`${JSON.stringify({
				method: "thread/tokenUsage/updated",
				params: {
					threadId,
					turnId,
					tokenUsage: {
						total: {
							inputTokens: 12,
							cachedInputTokens: 3,
							outputTokens: 7,
						},
						last: {
							inputTokens: 12,
							cachedInputTokens: 3,
							outputTokens: 7,
						},
					},
				},
			})}\n`,
		);
		child.stdout.write(
			`${JSON.stringify({
				method: "turn/completed",
				params: {
					threadId,
					turn: {
						id: turnId,
						status: "completed",
						error: null,
					},
				},
			})}\n`,
		);
	}

	child.stdin.on("data", (chunk: Buffer | string) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;
			const message = JSON.parse(line) as {
				id?: number;
				method?: string;
				params?: any;
			};
			if (message.method) {
				sentMethods.push(message.method);
			}

			switch (message.method) {
				case "initialize":
					child.stdout.write(
						`${JSON.stringify({ id: message.id, result: {} })}\n`,
					);
					break;
				case "thread/start":
					child.stdout.write(
						`${JSON.stringify({
							id: message.id,
							result: {
								thread: { id: "thr_app_server_1" },
							},
						})}\n`,
					);
					child.stdout.write(
						`${JSON.stringify({
							method: "thread/started",
							params: { thread: { id: "thr_app_server_1" } },
						})}\n`,
					);
					break;
				case "turn/start": {
					turnInputs.push(message.params?.input?.[0]?.text ?? "");
					const turnNumber = turnInputs.length;
					child.stdout.write(
						`${JSON.stringify({
							id: message.id,
							result: {
								turn: {
									id: `turn_app_server_${turnNumber}`,
									status: "inProgress",
									error: null,
								},
							},
						})}\n`,
					);
					if (autoCompleteTurns) {
						completeTurn(turnNumber, "App server response");
					}
					break;
				}
				case "turn/steer":
					steerInputs.push(message.params?.input?.[0]?.text ?? "");
					child.stdout.write(
						`${JSON.stringify({
							id: message.id,
							result: {
								turnId: message.params?.expectedTurnId ?? "turn_app_server_1",
							},
						})}\n`,
					);
					break;
				default:
					break;
			}
		}
	});

	return {
		sentMethods,
		turnInputs,
		steerInputs,
		completeTurn,
	};
}

describe("CodexRunner app-server transport", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uses codex app-server JSON-RPC instead of codex exec", async () => {
		const child = new FakeChildProcess();
		const responder = attachJsonRpcResponder(child);
		vi.mocked(spawn).mockReturnValue(child as any);

		const runner = new CodexRunner({
			cyrusHome: "/tmp/cyrus-home",
			workingDirectory: "/tmp/project",
			model: "gpt-5.4",
		});

		const session = await runner.start("Inspect the repository");

		expect(spawn).toHaveBeenCalledWith(
			"codex",
			["app-server", "--config", "sandbox_workspace_write.network_access=true"],
			{
				env: undefined,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		await vi.waitFor(() => {
			expect(responder.sentMethods).toEqual([
				"initialize",
				"initialized",
				"thread/start",
				"turn/start",
			]);
		});
		expect(session.sessionId).toBe("thr_app_server_1");

		const messages = runner.getMessages();
		expect(messages.some((message) => message.type === "system")).toBe(true);
		expect(messages.some((message) => message.type === "result")).toBe(true);
		expect(
			messages.some(
				(message) =>
					message.type === "assistant" &&
					JSON.stringify(message.message).includes("App server response"),
			),
		).toBe(true);
	});

	it("steers an active turn with follow-up prompts during streaming", async () => {
		const child = new FakeChildProcess();
		const responder = attachJsonRpcResponder(child, {
			autoCompleteTurns: false,
		});
		vi.mocked(spawn).mockReturnValue(child as any);

		const runner = new CodexRunner({
			cyrusHome: "/tmp/cyrus-home",
			workingDirectory: "/tmp/project",
			model: "gpt-5.4",
		});

		const completionPromise = new Promise<void>((resolve) => {
			runner.on("complete", () => resolve());
		});

		expect(runner.supportsStreamingInput).toBe(true);

		const session = await runner.startStreaming("Initial prompt");
		expect(session.sessionId).toBe("thr_app_server_1");

		await vi.waitFor(() => {
			expect(runner.isStreaming?.()).toBe(true);
			expect(responder.turnInputs).toEqual(["Initial prompt"]);
		});

		runner.addStreamMessage("Follow-up prompt");

		await vi.waitFor(() => {
			expect(responder.steerInputs).toEqual(["Follow-up prompt"]);
		});

		responder.completeTurn(1, "Second response");
		await completionPromise;

		expect(runner.isRunning()).toBe(false);
		expect(runner.isStreaming?.()).toBe(false);
		expect(responder.sentMethods).toEqual([
			"initialize",
			"initialized",
			"thread/start",
			"turn/start",
			"turn/steer",
		]);

		const messages = runner.getMessages();
		expect(
			messages.some(
				(message) =>
					message.type === "assistant" &&
					JSON.stringify(message.message).includes("Second response"),
			),
		).toBe(true);
	});
});
