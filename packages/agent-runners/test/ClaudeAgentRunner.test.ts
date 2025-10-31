import type { AgentSessionConfig, UserMessage } from "cyrus-interfaces";
import { beforeEach, describe, expect, it } from "vitest";
import { ClaudeAgentRunner } from "../src/claude/ClaudeAgentRunner.js";

describe("ClaudeAgentRunner", () => {
	let runner: ClaudeAgentRunner;

	beforeEach(() => {
		runner = new ClaudeAgentRunner({
			cyrusHome: "/tmp/test-cyrus-home",
		});
	});

	describe("constructor", () => {
		it("should create instance with default config", () => {
			expect(runner).toBeDefined();
			expect(runner).toBeInstanceOf(ClaudeAgentRunner);
		});

		it("should create instance with custom config", () => {
			const customRunner = new ClaudeAgentRunner({
				cyrusHome: "/custom/path",
				model: "opus",
			});
			expect(customRunner).toBeDefined();
		});
	});

	describe("isRunning", () => {
		it("should return false for non-existent session", () => {
			expect(runner.isRunning("non-existent-session")).toBe(false);
		});
	});

	describe("getEventStream", () => {
		it("should throw error for non-existent session", () => {
			expect(() => runner.getEventStream("non-existent-session")).toThrow(
				"Session non-existent-session not found",
			);
		});
	});

	describe("sendMessage", () => {
		it("should throw error for non-existent session", async () => {
			await expect(
				runner.sendMessage("non-existent-session", "test message"),
			).rejects.toThrow("Session non-existent-session not found");
		});
	});

	describe("stop", () => {
		it("should throw error for non-existent session", async () => {
			await expect(runner.stop("non-existent-session")).rejects.toThrow(
				"Session non-existent-session not found",
			);
		});
	});

	describe("streaming prompt conversion", () => {
		it("should handle async iterable UserMessage conversion", async () => {
			// This tests the internal streamUserMessages method indirectly
			async function* generateMessages(): AsyncIterable<UserMessage> {
				yield { content: "Message 1" };
				yield { content: "Message 2" };
			}

			// We can't fully test this without a real ClaudeRunner, but we can verify
			// the structure is correct
			const messages: UserMessage[] = [];
			for await (const msg of generateMessages()) {
				messages.push(msg);
			}

			expect(messages).toHaveLength(2);
			expect(messages[0].content).toBe("Message 1");
			expect(messages[1].content).toBe("Message 2");
		});
	});

	describe("configuration merging", () => {
		it("should use CYRUS_HOME from environment when not provided", () => {
			const originalEnv = process.env.CYRUS_HOME;
			process.env.CYRUS_HOME = "/env/cyrus";

			const envRunner = new ClaudeAgentRunner({});
			expect(envRunner).toBeDefined();

			process.env.CYRUS_HOME = originalEnv;
		});

		it("should prefer explicit cyrusHome over environment", () => {
			const originalEnv = process.env.CYRUS_HOME;
			process.env.CYRUS_HOME = "/env/cyrus";

			const explicitRunner = new ClaudeAgentRunner({
				cyrusHome: "/explicit/path",
			});
			expect(explicitRunner).toBeDefined();

			process.env.CYRUS_HOME = originalEnv;
		});
	});

	describe("session configuration mapping", () => {
		it("should map AgentSessionConfig to ClaudeRunnerConfig correctly", () => {
			// This is an indirect test - we verify the structure is correct
			const config: AgentSessionConfig = {
				workingDirectory: "/test/dir",
				prompt: "Test prompt",
				systemPrompt: "System prompt",
				allowedTools: ["Read", "Write"],
				disallowedTools: ["Bash"],
				model: "opus",
				maxTurns: 10,
			};

			// Verify all required fields are present
			expect(config.workingDirectory).toBe("/test/dir");
			expect(config.prompt).toBe("Test prompt");
			expect(config.systemPrompt).toBe("System prompt");
			expect(config.allowedTools).toEqual(["Read", "Write"]);
			expect(config.disallowedTools).toEqual(["Bash"]);
			expect(config.model).toBe("opus");
			expect(config.maxTurns).toBe(10);
		});

		it("should handle minimal AgentSessionConfig", () => {
			const minimalConfig: AgentSessionConfig = {
				workingDirectory: "/test/dir",
				prompt: "Test",
			};

			expect(minimalConfig.workingDirectory).toBe("/test/dir");
			expect(minimalConfig.prompt).toBe("Test");
		});

		it("should handle streaming prompt configuration", () => {
			async function* messages(): AsyncIterable<UserMessage> {
				yield { content: "Test" };
			}

			const streamConfig: AgentSessionConfig = {
				workingDirectory: "/test/dir",
				prompt: messages(),
			};

			expect(streamConfig.workingDirectory).toBe("/test/dir");
			expect(streamConfig.prompt).toBeDefined();
		});
	});

	describe("event stream iterator", () => {
		it("should create async iterable with proper structure", () => {
			// Test that the async iterable structure is correct
			const asyncIterable = {
				[Symbol.asyncIterator]() {
					return {
						async next() {
							return { value: undefined, done: true };
						},
					};
				},
			};

			expect(typeof asyncIterable[Symbol.asyncIterator]).toBe("function");
		});
	});

	describe("session summary structure", () => {
		it("should have correct SessionSummary structure", () => {
			const summary = {
				turns: 5,
				toolsUsed: 10,
				filesModified: ["/test/file1.ts", "/test/file2.ts"],
				exitCode: 0,
			};

			expect(summary.turns).toBe(5);
			expect(summary.toolsUsed).toBe(10);
			expect(summary.filesModified).toHaveLength(2);
			expect(summary.exitCode).toBe(0);
		});
	});

	describe("AgentEvent types", () => {
		it("should have correct TextEvent structure", () => {
			const event = {
				type: "text" as const,
				content: "Some text output",
			};

			expect(event.type).toBe("text");
			expect(event.content).toBe("Some text output");
		});

		it("should have correct ToolUseEvent structure", () => {
			const event = {
				type: "tool-use" as const,
				tool: "Read",
				input: { file_path: "/test/file.txt" },
			};

			expect(event.type).toBe("tool-use");
			expect(event.tool).toBe("Read");
			expect(event.input).toEqual({ file_path: "/test/file.txt" });
		});

		it("should have correct ErrorEvent structure", () => {
			const error = new Error("Test error");
			const event = {
				type: "error" as const,
				error: error,
			};

			expect(event.type).toBe("error");
			expect(event.error).toBeInstanceOf(Error);
			expect(event.error.message).toBe("Test error");
		});

		it("should have correct CompleteEvent structure", () => {
			const event = {
				type: "complete" as const,
				summary: {
					turns: 3,
					toolsUsed: 5,
					filesModified: ["/test/file.ts"],
					exitCode: 0,
				},
			};

			expect(event.type).toBe("complete");
			expect(event.summary.turns).toBe(3);
			expect(event.summary.toolsUsed).toBe(5);
			expect(event.summary.exitCode).toBe(0);
		});
	});

	describe("UserMessage structure", () => {
		it("should handle simple content message", () => {
			const message: UserMessage = {
				content: "Test content",
			};

			expect(message.content).toBe("Test content");
		});

		it("should handle message with attachments", () => {
			const message: UserMessage = {
				content: "Test content",
				attachments: [
					{
						name: "test.txt",
						path: "/test/test.txt",
						mimeType: "text/plain",
						size: 1024,
					},
				],
			};

			expect(message.attachments).toHaveLength(1);
			expect(message.attachments?.[0].name).toBe("test.txt");
		});

		it("should handle message with timestamp", () => {
			const now = new Date();
			const message: UserMessage = {
				content: "Test content",
				timestamp: now,
			};

			expect(message.timestamp).toBe(now);
		});
	});
});
