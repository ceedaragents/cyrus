import { describe, expect, it, vi } from "vitest";

// Mock external dependencies that may not be built
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
}));

vi.mock("cyrus-claude-runner", () => ({
	ClaudeMessageFormatter: class MockClaudeMessageFormatter {
		formatMessage(message: unknown): string {
			return JSON.stringify(message);
		}
	},
}));

import { TeamRunner, type TeamRunnerConfig } from "../src/TeamRunner.js";
import type { TeamTask } from "../src/types.js";

function makeTasks(): TeamTask[] {
	return [
		{
			id: "task-1",
			subject: "Research the codebase",
			description: "Understand the existing architecture and patterns",
			activeForm: "researching the codebase",
			blockedBy: [],
			assignTo: "researcher",
			subroutineName: "research",
		},
		{
			id: "task-2",
			subject: "Implement the feature",
			description: "Build the new feature based on research findings",
			activeForm: "implementing the feature",
			blockedBy: ["task-1"],
			assignTo: "implementer",
			subroutineName: "coding-activity",
		},
		{
			id: "task-3",
			subject: "Write tests",
			description: "Add unit tests for the new feature",
			activeForm: "writing tests",
			blockedBy: ["task-2"],
			subroutineName: "testing",
		},
	];
}

function makeConfig(
	overrides: Partial<TeamRunnerConfig> = {},
): TeamRunnerConfig {
	return {
		cyrusHome: "/tmp/cyrus-test",
		tasks: makeTasks(),
		teamSize: 3,
		classification: "code",
		...overrides,
	};
}

describe("TeamRunner", () => {
	describe("constructor", () => {
		it("should initialize with the provided config", () => {
			const config = makeConfig();
			const runner = new TeamRunner(config);

			expect(runner.supportsStreamingInput).toBe(true);
			expect(runner.isRunning()).toBe(false);
			expect(runner.getMessages()).toEqual([]);
		});

		it("should register onMessage callback as event listener", () => {
			const onMessage = vi.fn();
			const config = makeConfig({ onMessage });
			const runner = new TeamRunner(config);

			expect(runner.listenerCount("message")).toBe(1);
		});

		it("should register onError callback as event listener", () => {
			const onError = vi.fn();
			const config = makeConfig({ onError });
			const runner = new TeamRunner(config);

			expect(runner.listenerCount("error")).toBe(1);
		});

		it("should register onComplete callback as event listener", () => {
			const onComplete = vi.fn();
			const config = makeConfig({ onComplete });
			const runner = new TeamRunner(config);

			expect(runner.listenerCount("complete")).toBe(1);
		});

		it("should not register listeners when callbacks are not provided", () => {
			const runner = new TeamRunner(makeConfig());

			expect(runner.listenerCount("message")).toBe(0);
			expect(runner.listenerCount("error")).toBe(0);
			expect(runner.listenerCount("complete")).toBe(0);
		});
	});

	describe("isRunning", () => {
		it("should return false initially", () => {
			const runner = new TeamRunner(makeConfig());
			expect(runner.isRunning()).toBe(false);
		});
	});

	describe("getMessages", () => {
		it("should return an empty array initially", () => {
			const runner = new TeamRunner(makeConfig());
			const messages = runner.getMessages();

			expect(messages).toEqual([]);
			expect(Array.isArray(messages)).toBe(true);
		});

		it("should return a copy of the messages array", () => {
			const runner = new TeamRunner(makeConfig());
			const messages1 = runner.getMessages();
			const messages2 = runner.getMessages();

			expect(messages1).not.toBe(messages2);
			expect(messages1).toEqual(messages2);
		});
	});

	describe("getFormatter", () => {
		it("should return a ClaudeMessageFormatter instance", () => {
			const runner = new TeamRunner(makeConfig());
			const formatter = runner.getFormatter();

			expect(formatter).toBeDefined();
			// Verify it has the expected interface methods
			expect(typeof formatter.formatMessage).toBe("function");
		});
	});

	describe("stop", () => {
		it("should not throw when not running", () => {
			const runner = new TeamRunner(makeConfig());
			expect(() => runner.stop()).not.toThrow();
		});

		it("should remain not running after stop when never started", () => {
			const runner = new TeamRunner(makeConfig());
			runner.stop();
			expect(runner.isRunning()).toBe(false);
		});
	});

	describe("start", () => {
		it("should throw if already running", async () => {
			const runner = new TeamRunner(makeConfig());

			// Manually set the session as running to simulate an active session
			// without actually calling the SDK
			(runner as any).sessionInfo = {
				sessionId: "test-session",
				startedAt: new Date(),
				isRunning: true,
			};

			await expect(runner.start("test prompt")).rejects.toThrow(
				"Team session already running",
			);
		});
	});

	describe("supportsStreamingInput", () => {
		it("should be true", () => {
			const runner = new TeamRunner(makeConfig());
			expect(runner.supportsStreamingInput).toBe(true);
		});
	});

	describe("startStreaming", () => {
		it("should throw if already running", async () => {
			const runner = new TeamRunner(makeConfig());

			// Manually set the session as running to simulate an active session
			(runner as any).sessionInfo = {
				sessionId: "test-session",
				startedAt: new Date(),
				isRunning: true,
			};

			await expect(runner.startStreaming("test prompt")).rejects.toThrow(
				"Team session already running",
			);
		});
	});

	describe("addStreamMessage", () => {
		it("should throw when not in streaming mode", () => {
			const runner = new TeamRunner(makeConfig());
			expect(() => runner.addStreamMessage("test")).toThrow(
				"Cannot add stream message when not in streaming mode",
			);
		});
	});

	describe("completeStream", () => {
		it("should not throw when no streaming prompt exists", () => {
			const runner = new TeamRunner(makeConfig());
			expect(() => runner.completeStream()).not.toThrow();
		});
	});

	describe("buildTeamLeadPrompt", () => {
		it("should include the original prompt", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("Fix the login bug");

			expect(prompt).toContain("Fix the login bug");
		});

		it("should include all task subjects", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("Research the codebase");
			expect(prompt).toContain("Implement the feature");
			expect(prompt).toContain("Write tests");
		});

		it("should include task IDs", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("Task task-1:");
			expect(prompt).toContain("Task task-2:");
			expect(prompt).toContain("Task task-3:");
		});

		it("should include task descriptions", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain(
				"Understand the existing architecture and patterns",
			);
			expect(prompt).toContain(
				"Build the new feature based on research findings",
			);
			expect(prompt).toContain("Add unit tests for the new feature");
		});

		it("should include dependency information", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("(no dependencies)");
			expect(prompt).toContain("(blocked by: task-1)");
			expect(prompt).toContain("(blocked by: task-2)");
		});

		it("should include multiple dependencies when present", () => {
			const tasks = makeTasks();
			tasks[2].blockedBy = ["task-1", "task-2"];
			const runner = new TeamRunner(makeConfig({ tasks }));
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("(blocked by: task-1, task-2)");
		});

		it("should include assignTo when specified", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("Assign to: researcher");
			expect(prompt).toContain("Assign to: implementer");
		});

		it("should default assignTo to 'any' when not specified", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			// task-3 has no assignTo
			expect(prompt).toContain("Assign to: any");
		});

		it("should include the team size", () => {
			const runner = new TeamRunner(makeConfig({ teamSize: 5 }));
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("Spawn 5 teammates:");
		});

		it("should include a dynamically generated team name", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toMatch(/Create a team named "cyrus-\d+"/);
		});

		it("should include critical rules about delegation", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("Do NOT implement tasks yourself");
			expect(prompt).toContain("delegate everything to teammates");
			expect(prompt).toContain("If a teammate fails, spawn a replacement");
		});

		it("should include coordination instructions", () => {
			const runner = new TeamRunner(makeConfig());
			const prompt = runner.buildTeamLeadPrompt("test");

			expect(prompt).toContain("Assign all unblocked tasks");
			expect(prompt).toContain("Shut down all teammates");
			expect(prompt).toContain("do NOT need to poll");
		});

		it("should handle empty task list", () => {
			const runner = new TeamRunner(makeConfig({ tasks: [] }));
			const prompt = runner.buildTeamLeadPrompt("test");

			// Should still produce a valid prompt
			expect(prompt).toContain("## Your Task");
			expect(prompt).toContain("## Team Setup Instructions");
		});
	});
});
