import type {
	AgentActivity,
	RenderableSession,
	SessionSummary,
} from "cyrus-interfaces";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIRenderer } from "../../src/cli/CLIRenderer.js";

describe("CLIRenderer", () => {
	let renderer: CLIRenderer;

	beforeEach(() => {
		renderer = new CLIRenderer();
	});

	afterEach(() => {
		// Always stop renderer after each test
		renderer.stop();
	});

	describe("constructor", () => {
		it("should create a renderer with default config", () => {
			const renderer = new CLIRenderer();
			expect(renderer).toBeDefined();
			expect(renderer.getSessions().size).toBe(0);
		});

		it("should create a renderer with custom config", () => {
			const renderer = new CLIRenderer({
				verboseFormatting: false,
				maxActivities: 50,
				statusIcons: {
					thought: "T",
					action: "A",
				},
			});
			expect(renderer).toBeDefined();
		});
	});

	describe("renderSessionStart", () => {
		it("should start a new session", async () => {
			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};

			await renderer.renderSessionStart(session);

			const sessions = renderer.getSessions();
			expect(sessions.size).toBe(1);
			expect(sessions.has("session-1")).toBe(true);

			const sessionState = renderer.getSessionState("session-1");
			expect(sessionState).toBeDefined();
			expect(sessionState?.session.id).toBe("session-1");
			expect(sessionState?.status).toBe("running");
			expect(sessionState?.activities.length).toBeGreaterThan(0);
		});
	});

	describe("renderActivity", () => {
		beforeEach(async () => {
			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};
			await renderer.renderSessionStart(session);
		});

		it("should render thought activity", async () => {
			const activity: AgentActivity = {
				content: { type: "thought", body: "Thinking about the problem..." },
			} as AgentActivity;

			await renderer.renderActivity("session-1", activity);

			const sessionState = renderer.getSessionState("session-1");
			expect(sessionState?.activities.length).toBeGreaterThan(1);

			const thoughtActivity = sessionState?.activities.find(
				(a) => a.type === "thought",
			);
			expect(thoughtActivity).toBeDefined();
			expect(thoughtActivity?.content).toContain("Thinking about the problem");
		});

		it("should render action activity", async () => {
			const activity: AgentActivity = {
				content: {
					type: "action",
					action: "run_command",
					parameter: '{"command":"npm test"}',
					result: '{"exitCode":0}',
				},
			} as AgentActivity;

			await renderer.renderActivity("session-1", activity);

			const sessionState = renderer.getSessionState("session-1");
			const actionActivity = sessionState?.activities.find(
				(a) => a.type === "action",
			);
			expect(actionActivity).toBeDefined();
			expect(actionActivity?.content).toContain("run_command");
		});

		it("should throw error for non-existent session", async () => {
			const activity: AgentActivity = {
				content: { type: "thought", body: "Test" },
			} as AgentActivity;

			await expect(
				renderer.renderActivity("non-existent", activity),
			).rejects.toThrow("Session non-existent not found");
		});
	});

	describe("renderText", () => {
		beforeEach(async () => {
			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};
			await renderer.renderSessionStart(session);
		});

		it("should render text content", async () => {
			await renderer.renderText("session-1", "Plain text message");

			const sessionState = renderer.getSessionState("session-1");
			const textActivity = sessionState?.activities.find(
				(a) => a.type === "text",
			);
			expect(textActivity).toBeDefined();
			expect(textActivity?.content).toBe("Plain text message");
		});
	});

	describe("renderToolUse", () => {
		beforeEach(async () => {
			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};
			await renderer.renderSessionStart(session);
		});

		it("should render tool usage", async () => {
			await renderer.renderToolUse("session-1", "file_reader", {
				path: "/test/file.ts",
			});

			const sessionState = renderer.getSessionState("session-1");
			const toolActivity = sessionState?.activities.find(
				(a) => a.type === "tool-use",
			);
			expect(toolActivity).toBeDefined();
			expect(toolActivity?.content).toContain("file_reader");
			expect(toolActivity?.content).toContain("/test/file.ts");
		});
	});

	describe("renderComplete", () => {
		beforeEach(async () => {
			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};
			await renderer.renderSessionStart(session);
		});

		it("should mark session as complete", async () => {
			const summary: SessionSummary = {
				turns: 5,
				toolsUsed: 3,
				filesModified: ["file1.ts", "file2.ts"],
				summary: "Task completed successfully",
				exitCode: 0,
			};

			await renderer.renderComplete("session-1", summary);

			const sessionState = renderer.getSessionState("session-1");
			expect(sessionState?.status).toBe("complete");

			const completeActivity = sessionState?.activities.find(
				(a) => a.type === "complete",
			);
			expect(completeActivity).toBeDefined();
			expect(completeActivity?.content).toContain("Session completed");
			expect(completeActivity?.content).toContain("Turns: 5");
		});

		it("should throw error for non-existent session", async () => {
			const summary: SessionSummary = {
				turns: 0,
				toolsUsed: 0,
				filesModified: [],
				exitCode: 0,
			};

			await expect(
				renderer.renderComplete("non-existent", summary),
			).rejects.toThrow("Session non-existent not found");
		});
	});

	describe("renderError", () => {
		beforeEach(async () => {
			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};
			await renderer.renderSessionStart(session);
		});

		it("should mark session as error and render error", async () => {
			const error = new Error("Test error");
			error.stack = "Error stack trace";

			await renderer.renderError("session-1", error);

			const sessionState = renderer.getSessionState("session-1");
			expect(sessionState?.status).toBe("error");
			expect(sessionState?.error).toBe(error);

			const errorActivity = sessionState?.activities.find(
				(a) => a.type === "error",
			);
			expect(errorActivity).toBeDefined();
			expect(errorActivity?.content).toContain("Test error");
		});

		it("should throw error for non-existent session", async () => {
			const error = new Error("Test error");

			await expect(renderer.renderError("non-existent", error)).rejects.toThrow(
				"Session non-existent not found",
			);
		});
	});

	describe("getUserInput", () => {
		beforeEach(async () => {
			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};
			await renderer.renderSessionStart(session);
		});

		it("should yield user input from the queue", async () => {
			const inputGenerator = renderer.getUserInput("session-1");

			// Simulate user input
			setTimeout(() => {
				(renderer as any).handleUserMessage("session-1", "Hello");
			}, 10);

			const result = await inputGenerator.next();
			expect(result.done).toBe(false);
			expect(result.value?.type).toBe("message");
			if (result.value?.type === "message") {
				expect(result.value.content).toBe("Hello");
			}
		});

		it("should throw error for non-existent session", async () => {
			// getUserInput returns an async iterator, so it throws on next(), not on call
			await expect(async () => {
				const inputGenerator = renderer.getUserInput("non-existent");
				await inputGenerator.next();
			}).rejects.toThrow("Session non-existent not found");
		});
	});

	describe("start and stop", () => {
		it("should start and stop the CLI interface", () => {
			renderer.start();
			expect(renderer.getInkInstance()).toBeDefined();

			renderer.stop();
			expect(renderer.getInkInstance()).toBeNull();
		});
	});

	describe("custom status icons", () => {
		it("should use custom status icons", async () => {
			const renderer = new CLIRenderer({
				statusIcons: {
					thought: "[T]",
				},
			});

			const session: RenderableSession = {
				id: "session-1",
				issueId: "TEST-123",
				issueTitle: "Test Issue",
				startedAt: new Date(),
			};
			await renderer.renderSessionStart(session);

			const activity: AgentActivity = {
				content: { type: "thought", body: "Test thought" },
			} as AgentActivity;
			await renderer.renderActivity("session-1", activity);

			const sessionState = renderer.getSessionState("session-1");
			const thoughtActivity = sessionState?.activities.find(
				(a) => a.type === "thought",
			);
			expect(thoughtActivity?.icon).toBe("[T]");

			renderer.stop();
		});
	});
});
