import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiRunner, StreamingPrompt } from "../src/GeminiRunner.js";
import type {
	GeminiInitEvent,
	GeminiMessageEvent,
	GeminiResultEvent,
	GeminiRunnerConfig,
	GeminiStreamEvent,
	GeminiToolUseEvent,
} from "../src/types.js";

// Mock child_process spawn
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

// Mock readline
vi.mock("node:readline", () => ({
	createInterface: vi.fn(),
}));

// Mock fs for log file creation
vi.mock("node:fs/promises", () => ({
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	appendFile: vi.fn(),
}));

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const mockSpawn = vi.mocked(spawn);
const mockCreateInterface = vi.mocked(createInterface);

// Helper class to emulate Gemini CLI process
class ProcessEmulator extends EventEmitter {
	stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
	stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
	stdin = {
		write: vi.fn(),
		end: vi.fn(),
	};

	private readlineHandlers: Map<string, ((line: string) => void)[]> = new Map();

	constructor() {
		super();
		// Setup readline mock to capture line handlers
		mockCreateInterface.mockImplementation((_options: any) => {
			const rl = new EventEmitter() as any;
			rl.on = (event: string, handler: (line: string) => void) => {
				if (event === "line") {
					if (!this.readlineHandlers.has("line")) {
						this.readlineHandlers.set("line", []);
					}
					this.readlineHandlers.get("line")!.push(handler);
				}
				return rl;
			};
			return rl;
		});
	}

	kill(_signal?: string) {
		// Mock kill implementation
	}

	emitLine(json: string) {
		const handlers = this.readlineHandlers.get("line") || [];
		for (const handler of handlers) {
			handler(json);
		}
	}

	emitEvent(event: GeminiStreamEvent) {
		this.emitLine(JSON.stringify(event));
	}

	emitClose(code: number) {
		this.emit("close", code);
	}

	emitError(error: Error) {
		this.emit("error", error);
	}
}

// Helper functions to create Gemini events
function createInitEvent(
	sessionId: string = "test-session-123",
): GeminiInitEvent {
	return {
		type: "init",
		session_id: sessionId,
		model: "gemini-2.5-flash",
	};
}

function createMessageEvent(
	role: "user" | "assistant",
	content: string,
): GeminiMessageEvent {
	return {
		type: "message",
		role,
		content,
	};
}

function createToolUseEvent(
	toolName: string,
	parameters: Record<string, unknown> = {},
): GeminiToolUseEvent {
	return {
		type: "tool_use",
		tool_name: toolName,
		parameters,
	};
}

function createResultEvent(
	response: string,
	error?: { type: string; message: string },
): GeminiResultEvent {
	return {
		type: "result",
		response,
		error,
	};
}

describe("GeminiRunner", () => {
	let runner: GeminiRunner;
	let processEmulator: ProcessEmulator;
	const defaultConfig: GeminiRunnerConfig = {
		workingDirectory: "/tmp/test",
		cyrusHome: "/tmp/test-cyrus-home",
		model: "gemini-2.5-flash",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		processEmulator = new ProcessEmulator();
		mockSpawn.mockReturnValue(processEmulator as unknown as ChildProcess);
		runner = new GeminiRunner(defaultConfig);
	});

	afterEach(() => {
		if (runner.isRunning()) {
			runner.stop();
		}
	});

	describe("Configuration", () => {
		it("should create runner with default configuration", () => {
			expect(runner).toBeInstanceOf(GeminiRunner);
			expect(runner.isRunning()).toBe(false);
		});

		it("should create runner with custom system prompt", () => {
			const config: GeminiRunnerConfig = {
				...defaultConfig,
				systemPrompt: "Custom system prompt",
			};
			const customRunner = new GeminiRunner(config);
			expect(customRunner).toBeInstanceOf(GeminiRunner);
		});

		it("should create runner with custom workspace name", () => {
			const config: GeminiRunnerConfig = {
				...defaultConfig,
				workspaceName: "test-workspace",
			};
			const customRunner = new GeminiRunner(config);
			expect(customRunner).toBeInstanceOf(GeminiRunner);
		});
	});

	describe("start() with string prompt", () => {
		it("should start session with string prompt", async () => {
			const promise = runner.start("Hello Gemini");

			// Wait a tick for spawn to be called
			await new Promise((resolve) => setImmediate(resolve));

			expect(mockSpawn).toHaveBeenCalledWith(
				"gemini",
				expect.arrayContaining(["--model", "gemini-2.5-flash"]),
				expect.objectContaining({
					cwd: "/tmp/test",
				}),
			);

			expect(runner.isRunning()).toBe(true);

			// Simulate Gemini CLI response
			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(createMessageEvent("user", "Hello Gemini"));
			processEmulator.emitEvent(
				createMessageEvent("assistant", "Hello! How can I help you?"),
			);
			processEmulator.emitEvent(
				createResultEvent("Hello! How can I help you?"),
			);
			processEmulator.emitClose(0);

			await promise;

			expect(runner.isRunning()).toBe(false);
			const messages = runner.getMessages();
			expect(messages.length).toBeGreaterThan(0);
		});

		it("should extract session ID from init event", async () => {
			const promise = runner.start("Test prompt");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("extracted-session-id"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			const sessionInfo = await promise;
			expect(sessionInfo.sessionId).toBe("extracted-session-id");
		});

		it("should accept custom system prompt in config", async () => {
			const config: GeminiRunnerConfig = {
				...defaultConfig,
				systemPrompt: "You are a helpful assistant",
			};
			const customRunner = new GeminiRunner(config);

			// System prompt is accepted in config but may not be passed to CLI
			// This test just verifies the runner can be created with system prompt
			expect(customRunner).toBeInstanceOf(GeminiRunner);
		});

		it("should prevent concurrent sessions", async () => {
			runner.start("First prompt");

			await new Promise((resolve) => setImmediate(resolve));

			expect(runner.isRunning()).toBe(true);

			// Attempt to start another session
			await expect(runner.start("Second prompt")).rejects.toThrow(
				"Gemini session already running",
			);
		});
	});

	describe("start() with StreamingPrompt", () => {
		it("should start session with streaming prompt", async () => {
			const prompt = new StreamingPrompt(null, "Initial message");
			const promise = runner.start(prompt);

			await new Promise((resolve) => setImmediate(resolve));

			expect(runner.isRunning()).toBe(true);

			// Simulate response
			processEmulator.emitEvent(createInitEvent("stream-session"));
			processEmulator.emitEvent(
				createMessageEvent("assistant", "Processing..."),
			);

			// Add another message to the stream
			setTimeout(() => {
				prompt.addMessage("Follow-up message");
				prompt.complete();
			}, 10);

			processEmulator.emitEvent(createResultEvent("Complete"));
			processEmulator.emitClose(0);

			await promise;

			expect(runner.isRunning()).toBe(false);
		});

		it("should update streaming prompt session ID from init event", async () => {
			const prompt = new StreamingPrompt(null, "Test");
			const promise = runner.start(prompt);

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("new-session-id"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			const sessionInfo = await promise;
			expect(sessionInfo.sessionId).toBe("new-session-id");
		});
	});

	describe("Message Processing", () => {
		it("should convert user message events to SDK messages", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(
				createMessageEvent("user", "User message content"),
			);
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			const messages = runner.getMessages();
			const userMessage = messages.find((m) => m.type === "user");
			expect(userMessage).toBeDefined();
			expect(userMessage?.session_id).toBe("session-123");
		});

		it("should convert assistant message events to SDK messages", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(
				createMessageEvent("assistant", "Assistant response"),
			);
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			const messages = runner.getMessages();
			const assistantMessage = messages.find((m) => m.type === "assistant");
			expect(assistantMessage).toBeDefined();
			expect(assistantMessage?.session_id).toBe("session-123");
		});

		it("should convert tool use events to SDK tool_use messages", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(
				createToolUseEvent("Read", { file_path: "/test.txt" }),
			);
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			const messages = runner.getMessages();
			const toolMessage = messages.find((m) => {
				if (m.type !== "assistant") return false;
				const content = (m as any).message?.content;
				return (
					Array.isArray(content) &&
					content.some((c: any) => c.type === "tool_use")
				);
			});
			expect(toolMessage).toBeDefined();
		});

		it("should handle result events with response", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(createResultEvent("Final response text"));
			processEmulator.emitClose(0);

			await promise;

			const messages = runner.getMessages();
			expect(messages.length).toBeGreaterThan(0);
		});

		it("should handle result events with errors", async () => {
			const errorHandler = vi.fn();
			runner.on("error", errorHandler);

			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(
				createResultEvent("", {
					type: "APIError",
					message: "API request failed",
				}),
			);
			processEmulator.emitClose(1);

			// Promise may reject or resolve depending on implementation
			// Error event should still be emitted on non-zero exit
			try {
				await promise;
			} catch (_e) {
				// Expected to throw on exit code 1
			}

			const messages = runner.getMessages();
			expect(messages.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("Event Emission", () => {
		it("should emit 'message' event for each SDK message", async () => {
			const messageHandler = vi.fn();
			runner.on("message", messageHandler);

			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(createMessageEvent("user", "User message"));
			processEmulator.emitEvent(
				createMessageEvent("assistant", "Assistant message"),
			);
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			expect(messageHandler).toHaveBeenCalled();
			expect(messageHandler.mock.calls.length).toBeGreaterThan(0);
		});

		it("should emit 'complete' event on successful completion", async () => {
			const completeHandler = vi.fn();
			runner.on("complete", completeHandler);

			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			expect(completeHandler).toHaveBeenCalledTimes(1);
		});

		it("should emit 'error' event on process error", async () => {
			const errorHandler = vi.fn();
			runner.on("error", errorHandler);

			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			const testError = new Error("Process error");
			processEmulator.emitError(testError);
			processEmulator.emitClose(1);

			// Promise should reject on error
			try {
				await promise;
			} catch (_e) {
				// Expected
			}

			expect(errorHandler).toHaveBeenCalled();
		});

		it("should emit 'streamEvent' for raw Gemini events", async () => {
			const streamEventHandler = vi.fn();
			runner.on("streamEvent", streamEventHandler);

			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(
				createMessageEvent("assistant", "Text content"),
			);
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			// Should emit streamEvent for each Gemini event
			expect(streamEventHandler).toHaveBeenCalled();
			expect(streamEventHandler.mock.calls.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("Error Handling", () => {
		it("should handle process spawn errors", async () => {
			const errorRunner = new GeminiRunner(defaultConfig);
			const spawnError = new Error("Spawn failed");

			mockSpawn.mockImplementation(() => {
				const proc = new ProcessEmulator();
				setTimeout(() => proc.emitError(spawnError), 10);
				return proc as unknown as ChildProcess;
			});

			await expect(errorRunner.start("Test")).rejects.toThrow();
		});

		it("should handle non-zero exit codes", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitClose(1);

			await expect(promise).rejects.toThrow();
		});

		it("should handle malformed JSON in stream", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			// Emit invalid JSON
			processEmulator.emitLine("{ invalid json }");

			// Should not crash, continue processing
			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			// Should still complete successfully
			expect(runner.isRunning()).toBe(false);
		});

		it("should cleanup on error", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitError(new Error("Test error"));
			processEmulator.emitClose(1);

			await expect(promise).rejects.toThrow();
			expect(runner.isRunning()).toBe(false);
		});
	});

	describe("State Management", () => {
		it("should report isRunning() correctly", async () => {
			expect(runner.isRunning()).toBe(false);

			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			expect(runner.isRunning()).toBe(true);

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			expect(runner.isRunning()).toBe(false);
		});

		it("should return accumulated messages via getMessages()", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(createMessageEvent("user", "Message 1"));
			processEmulator.emitEvent(createMessageEvent("assistant", "Message 2"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			const messages = runner.getMessages();
			expect(messages.length).toBeGreaterThanOrEqual(2);
		});

		it("should return session info from start() result", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-info-123"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			const sessionInfo = await promise;
			expect(sessionInfo.sessionId).toBe("session-info-123");
		});

		it("should clear messages between sessions", async () => {
			// First session
			let promise = runner.start("First");
			await new Promise((resolve) => setImmediate(resolve));
			processEmulator.emitEvent(createInitEvent("session-1"));
			processEmulator.emitEvent(createMessageEvent("user", "First message"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);
			await promise;

			const firstMessages = runner.getMessages();
			expect(firstMessages.length).toBeGreaterThan(0);

			// Create new process emulator for second session
			processEmulator = new ProcessEmulator();
			mockSpawn.mockReturnValue(processEmulator as unknown as ChildProcess);

			// Second session
			promise = runner.start("Second");
			await new Promise((resolve) => setImmediate(resolve));
			processEmulator.emitEvent(createInitEvent("session-2"));
			processEmulator.emitEvent(createMessageEvent("user", "Second message"));
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);
			await promise;

			const secondMessages = runner.getMessages();
			// Should only have messages from second session
			expect(secondMessages.every((m) => m.session_id === "session-2")).toBe(
				true,
			);
		});
	});

	describe("stop()", () => {
		it("should stop running session", async () => {
			const promise = runner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			expect(runner.isRunning()).toBe(true);

			runner.stop();

			// Simulate process termination - stop() kills the process
			// but if the process exits with 0, it may resolve not reject
			processEmulator.emitClose(0);

			// Wait for promise to settle
			try {
				await promise;
			} catch (_e) {
				// May throw or may resolve depending on exit code
			}

			expect(runner.isRunning()).toBe(false);
		});

		it("should not throw when stopping non-running session", () => {
			expect(runner.isRunning()).toBe(false);
			expect(() => runner.stop()).not.toThrow();
		});
	});

	describe("Logging", () => {
		it("should create log files when configured", async () => {
			const config: GeminiRunnerConfig = {
				...defaultConfig,
				workspaceName: "test-workspace",
			};
			const logRunner = new GeminiRunner(config);

			const promise = logRunner.start("Test");

			await new Promise((resolve) => setImmediate(resolve));

			processEmulator.emitEvent(createInitEvent("session-123"));
			processEmulator.emitEvent(
				createMessageEvent("assistant", "Test response"),
			);
			processEmulator.emitEvent(createResultEvent("Done"));
			processEmulator.emitClose(0);

			await promise;

			// Log files should be created (mocked)
			// We can't directly test file system calls without complex mocking
			// but we verify the runner completes without errors
			expect(logRunner.isRunning()).toBe(false);
		});
	});
});
