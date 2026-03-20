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

function attachJsonRpcResponder(child: FakeChildProcess): string[] {
	const sentMethods: string[] = [];
	let buffer = "";

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
				case "turn/start":
					child.stdout.write(
						`${JSON.stringify({
							id: message.id,
							result: {
								turn: {
									id: "turn_app_server_1",
									status: "inProgress",
									error: null,
								},
							},
						})}\n`,
					);
					child.stdout.write(
						`${JSON.stringify({
							method: "item/completed",
							params: {
								threadId: "thr_app_server_1",
								turnId: "turn_app_server_1",
								item: {
									type: "agentMessage",
									id: "msg_1",
									text: "App server response",
								},
							},
						})}\n`,
					);
					child.stdout.write(
						`${JSON.stringify({
							method: "thread/tokenUsage/updated",
							params: {
								threadId: "thr_app_server_1",
								turnId: "turn_app_server_1",
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
								threadId: "thr_app_server_1",
								turn: {
									id: "turn_app_server_1",
									status: "completed",
									error: null,
								},
							},
						})}\n`,
					);
					break;
				default:
					break;
			}
		}
	});

	return sentMethods;
}

describe("CodexRunner app-server transport", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uses codex app-server JSON-RPC instead of codex exec", async () => {
		const child = new FakeChildProcess();
		const sentMethods = attachJsonRpcResponder(child);
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
		expect(sentMethods).toEqual([
			"initialize",
			"initialized",
			"thread/start",
			"turn/start",
		]);
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
});
