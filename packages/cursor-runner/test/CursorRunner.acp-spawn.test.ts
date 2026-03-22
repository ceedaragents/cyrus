import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
	const actual =
		await vi.importActual<typeof import("node:child_process")>(
			"node:child_process",
		);
	return {
		...actual,
		spawn: spawnMock,
		spawnSync: spawnSyncMock,
	};
});

import { CursorRunner } from "../src/CursorRunner.js";
import { TEST_CYRUS_HOME } from "./test-dirs.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cursor-runner-acp-"));
	tempDirs.push(dir);
	return dir;
}

describe("CursorRunner ACP startup", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		spawnMock.mockReset();
		spawnSyncMock.mockReset();
	});

	it("launches ACP with piped stdin and completes a minimal JSON-RPC prompt", async () => {
		const workspace = createTempDir();

		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "",
			stderr: "",
		});

		spawnMock.mockImplementation(
			(_command: string, _args: string[], _options?: { stdio?: string[] }) => {
				const stdin = new PassThrough();
				const stdout = new PassThrough();
				const stderr = new PassThrough();
				const listeners = new Map<
					string,
					(value: number | Error | null) => void
				>();

				const send = (payload: unknown) => {
					stdout.write(`${JSON.stringify(payload)}\n`);
				};

				stdin.on("data", (chunk) => {
					const lines = chunk
						.toString()
						.split("\n")
						.map((line: string) => line.trim())
						.filter(Boolean);

					for (const line of lines) {
						const message = JSON.parse(line) as {
							id?: number;
							method?: string;
							params?: Record<string, unknown>;
						};

						if (message.method === "initialize") {
							send({
								jsonrpc: "2.0",
								id: message.id,
								result: {
									protocolVersion: 1,
									agentCapabilities: {
										loadSession: true,
									},
									authMethods: [],
								},
							});
							continue;
						}

						if (message.method === "session/new") {
							send({
								jsonrpc: "2.0",
								id: message.id,
								result: {
									sessionId: "cursor-acp-test-session",
								},
							});
							continue;
						}

						if (message.method === "session/prompt") {
							send({
								jsonrpc: "2.0",
								method: "session/update",
								params: {
									sessionId: "cursor-acp-test-session",
									update: {
										sessionUpdate: "agent_message_chunk",
										messageId: "assistant-1",
										content: {
											type: "text",
											text: "Cursor ACP test response",
										},
									},
								},
							});
							send({
								jsonrpc: "2.0",
								id: message.id,
								result: {
									stopReason: "end_turn",
									usage: {
										totalTokens: 6,
										inputTokens: 3,
										outputTokens: 3,
										cachedReadTokens: 0,
									},
								},
							});
							continue;
						}

						if (message.method === "session/cancel") {
							continue;
						}

						send({
							jsonrpc: "2.0",
							id: message.id,
							result: {},
						});
					}
				});

				return {
					stdin,
					stdout,
					stderr,
					kill: vi.fn(),
					on: (
						event: string,
						listener: (value: number | Error | null) => void,
					) => {
						listeners.set(event, listener);
						return undefined;
					},
				} as unknown as import("node:child_process").ChildProcess;
			},
		);

		const runner = new CursorRunner({
			cyrusHome: TEST_CYRUS_HOME,
			workingDirectory: workspace,
			model: "gpt-5",
		});

		const session = await runner.start("Test ACP startup");

		expect(session.sessionId).toBe("cursor-acp-test-session");
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(spawnMock.mock.calls[0]?.[1]).toContain("acp");
		expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
			cwd: workspace,
			stdio: ["pipe", "pipe", "pipe"],
		});
		expect(JSON.stringify(runner.getMessages())).toContain(
			"Cursor ACP test response",
		);
	});

	it("queues streamed follow-up prompts onto the same ACP session", async () => {
		const workspace = createTempDir();
		const promptTexts: string[] = [];
		let runner: CursorRunner;

		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "",
			stderr: "",
		});

		spawnMock.mockImplementation(
			(_command: string, _args: string[], _options?: { stdio?: string[] }) => {
				const stdin = new PassThrough();
				const stdout = new PassThrough();
				const stderr = new PassThrough();

				const send = (payload: unknown) => {
					stdout.write(`${JSON.stringify(payload)}\n`);
				};

				stdin.on("data", (chunk) => {
					const lines = chunk
						.toString()
						.split("\n")
						.map((line: string) => line.trim())
						.filter(Boolean);

					for (const line of lines) {
						const message = JSON.parse(line) as {
							id?: number;
							method?: string;
							params?: Record<string, unknown>;
						};

						if (message.method === "initialize") {
							send({
								jsonrpc: "2.0",
								id: message.id,
								result: {
									protocolVersion: 1,
									agentCapabilities: {
										loadSession: true,
									},
									authMethods: [],
								},
							});
							continue;
						}

						if (message.method === "session/new") {
							send({
								jsonrpc: "2.0",
								id: message.id,
								result: {
									sessionId: "cursor-acp-stream-session",
								},
							});
							continue;
						}

						if (message.method === "session/prompt") {
							const promptBlocks = Array.isArray(message.params?.prompt)
								? (message.params?.prompt as Array<Record<string, unknown>>)
								: [];
							const promptText =
								typeof promptBlocks[0]?.text === "string"
									? promptBlocks[0].text
									: "";
							promptTexts.push(promptText);

							if (promptTexts.length === 1) {
								queueMicrotask(() => {
									runner.addStreamMessage("Queued follow-up prompt");
								});
							}

							send({
								jsonrpc: "2.0",
								method: "session/update",
								params: {
									sessionId: "cursor-acp-stream-session",
									update: {
										sessionUpdate: "agent_message_chunk",
										messageId: `assistant-${promptTexts.length}`,
										content: {
											type: "text",
											text: `response ${promptTexts.length}`,
										},
									},
								},
							});
							send({
								jsonrpc: "2.0",
								id: message.id,
								result: {
									stopReason: "end_turn",
									usage: {
										totalTokens: 6,
										inputTokens: 3,
										outputTokens: 3,
										cachedReadTokens: 0,
									},
								},
							});
							continue;
						}

						send({
							jsonrpc: "2.0",
							id: message.id,
							result: {},
						});
					}
				});

				return {
					stdin,
					stdout,
					stderr,
					kill: vi.fn(),
					on: vi.fn(),
				} as unknown as import("node:child_process").ChildProcess;
			},
		);

		runner = new CursorRunner({
			cyrusHome: TEST_CYRUS_HOME,
			workingDirectory: workspace,
			model: "gpt-5",
		});

		const session = await runner.startStreaming("Initial prompt");

		expect(session.sessionId).toBe("cursor-acp-stream-session");
		expect(runner.supportsStreamingInput).toBe(true);
		expect(promptTexts).toEqual(["Initial prompt", "Queued follow-up prompt"]);
		expect(JSON.stringify(runner.getMessages())).toContain("response 2");
		expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
			cwd: workspace,
			stdio: ["pipe", "pipe", "pipe"],
		});
	});
});
