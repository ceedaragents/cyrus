/**
 * Tests for AnthropicAgentRunner adapter
 */

import type { AgentRunnerConfig } from "cyrus-interfaces";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicAgentRunner } from "../src/AnthropicAgentRunner.js";

describe("AnthropicAgentRunner", () => {
	let runner: AnthropicAgentRunner;
	let config: AgentRunnerConfig;

	beforeEach(() => {
		config = {
			workingDirectory: process.cwd(),
			cyrusHome: `${process.env.HOME}/.cyrus-test`,
		};
	});

	afterEach(async () => {
		if (runner) {
			await runner.cleanup();
		}
	});

	describe("Construction and Initialization", () => {
		it("should construct without errors", () => {
			expect(() => new AnthropicAgentRunner(config)).not.toThrow();
		});

		it("should store config", () => {
			runner = new AnthropicAgentRunner(config);
			expect(runner.config).toEqual(config);
		});

		it("should initialize successfully", async () => {
			runner = new AnthropicAgentRunner(config);
			await expect(runner.initialize()).resolves.not.toThrow();
		});

		it("should handle multiple initializations gracefully", async () => {
			runner = new AnthropicAgentRunner(config);
			await runner.initialize();
			await expect(runner.initialize()).resolves.not.toThrow();
		});
	});

	describe("Lifecycle Management", () => {
		beforeEach(async () => {
			runner = new AnthropicAgentRunner(config);
			await runner.initialize();
		});

		it("should cleanup successfully", async () => {
			await expect(runner.cleanup()).resolves.not.toThrow();
		});

		it("should handle cleanup when not initialized", async () => {
			await runner.cleanup();
			await expect(runner.cleanup()).resolves.not.toThrow();
		});

		it("should not allow execution before initialization", async () => {
			const uninitRunner = new AnthropicAgentRunner(config);
			await expect(uninitRunner.execute({ content: "test" })).rejects.toThrow(
				"must be initialized",
			);
		});
	});

	describe("Event Handlers", () => {
		beforeEach(async () => {
			runner = new AnthropicAgentRunner(config);
			await runner.initialize();
		});

		it("should accept message handlers", () => {
			expect(() => {
				runner.onMessage((msg) => {
					console.log(msg);
				});
			}).not.toThrow();
		});

		it("should accept async message handlers", () => {
			expect(() => {
				runner.onMessage(async (msg) => {
					await Promise.resolve();
					console.log(msg);
				});
			}).not.toThrow();
		});

		it("should accept complete handlers", () => {
			expect(() => {
				runner.onComplete((result) => {
					console.log(result);
				});
			}).not.toThrow();
		});

		it("should accept error handlers", () => {
			expect(() => {
				runner.onError((error) => {
					console.error(error);
				});
			}).not.toThrow();
		});

		it("should allow multiple handlers of same type", () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			runner.onMessage(handler1);
			runner.onMessage(handler2);

			// Both should be registered (will be called when messages arrive)
			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	describe("IAgentRunner Interface Compliance", () => {
		beforeEach(async () => {
			runner = new AnthropicAgentRunner(config);
			await runner.initialize();
		});

		it("should have all required IAgentRunner properties", () => {
			expect(runner).toHaveProperty("config");
			expect(runner.config).toBeDefined();
		});

		it("should have all required IAgentRunner methods", () => {
			expect(typeof runner.initialize).toBe("function");
			expect(typeof runner.cleanup).toBe("function");
			expect(typeof runner.execute).toBe("function");
			expect(typeof runner.onMessage).toBe("function");
			expect(typeof runner.onComplete).toBe("function");
			expect(typeof runner.onError).toBe("function");
		});

		it("should have readonly config", () => {
			// Check that config exists and is readonly (cannot be reassigned)
			expect(runner.config).toBeDefined();

			// Verify it's a readonly property by attempting to change it
			const originalConfig = runner.config;
			try {
				(runner as any).config = {};
				// If we get here, check that the config remained unchanged
				expect(runner.config).toBe(originalConfig);
			} catch (e) {
				// Property is truly readonly and threw an error
				expect(e).toBeDefined();
			}
		});
	});

	describe("Execution", () => {
		beforeEach(async () => {
			runner = new AnthropicAgentRunner(config);
			await runner.initialize();
		});

		it("should return AgentSession from execute", async () => {
			// Note: This will actually try to execute Claude, so we skip in CI
			if (process.env.CI) {
				return;
			}

			const session = await runner.execute({
				content: "Say hello",
			});

			expect(session).toHaveProperty("id");
			expect(session).toHaveProperty("messages");
			expect(session).toHaveProperty("result");
			expect(session).toHaveProperty("cancel");
			expect(session).toHaveProperty("addMessage");

			// Cancel immediately to avoid long test
			await session.cancel();
		});

		it("should not allow multiple concurrent sessions", async () => {
			if (process.env.CI) {
				return;
			}

			const session1 = await runner.execute({
				content: "Say hello",
			});

			// Try to start another session
			await expect(runner.execute({ content: "Say goodbye" })).rejects.toThrow(
				"already running",
			);

			await session1.cancel();
		});
	});

	describe("Configuration Handling", () => {
		it("should use provided working directory", () => {
			const customConfig: AgentRunnerConfig = {
				workingDirectory: "/custom/path",
				cyrusHome: "/custom/cyrus",
			};
			runner = new AnthropicAgentRunner(customConfig);
			expect(runner.config.workingDirectory).toBe("/custom/path");
		});

		it("should pass through environment variables", () => {
			const customConfig: AgentRunnerConfig = {
				workingDirectory: process.cwd(),
				environment: { TEST_VAR: "test_value" },
			};
			runner = new AnthropicAgentRunner(customConfig);
			expect(runner.config.environment).toEqual({ TEST_VAR: "test_value" });
		});

		it("should handle system prompt", () => {
			const customConfig: AgentRunnerConfig = {
				workingDirectory: process.cwd(),
				systemPrompt: "Custom system prompt",
			};
			runner = new AnthropicAgentRunner(customConfig);
			expect(runner.config.systemPrompt).toBe("Custom system prompt");
		});

		it("should handle model ID", () => {
			const customConfig: AgentRunnerConfig = {
				workingDirectory: process.cwd(),
				modelId: "opus",
			};
			runner = new AnthropicAgentRunner(customConfig);
			expect(runner.config.modelId).toBe("opus");
		});
	});
});
