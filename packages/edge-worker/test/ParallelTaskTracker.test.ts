import { beforeEach, describe, expect, it } from "vitest";
import { ParallelTaskTracker } from "../src/ParallelTaskTracker.js";

describe("ParallelTaskTracker", () => {
	let tracker: ParallelTaskTracker;

	beforeEach(() => {
		tracker = new ParallelTaskTracker();
	});

	describe("detectParallelTasks", () => {
		it("should return null for single Task tool", () => {
			const content = [
				{
					type: "tool_use",
					id: "tool_1",
					name: "Task",
					input: { prompt: "Test task" },
				},
			];

			const result = tracker.detectParallelTasks(content);
			expect(result).toBeNull();
		});

		it("should detect multiple Task tools as parallel", () => {
			const content = [
				{ type: "text", text: "Let me run these tasks in parallel" },
				{
					type: "tool_use",
					id: "tool_1",
					name: "Task",
					input: { prompt: "Explore codebase" },
				},
				{
					type: "tool_use",
					id: "tool_2",
					name: "Task",
					input: { prompt: "Search for tests" },
				},
			];

			const result = tracker.detectParallelTasks(content);
			expect(result).not.toBeNull();
			expect(result).toHaveLength(2);
			expect(result![0].id).toBe("tool_1");
			expect(result![1].id).toBe("tool_2");
		});

		it("should ignore non-Task tools in parallel detection", () => {
			const content = [
				{
					type: "tool_use",
					id: "tool_1",
					name: "Task",
					input: { prompt: "Task 1" },
				},
				{
					type: "tool_use",
					id: "tool_2",
					name: "Read",
					input: { file_path: "/test" },
				},
				{
					type: "tool_use",
					id: "tool_3",
					name: "Bash",
					input: { command: "ls" },
				},
			];

			const result = tracker.detectParallelTasks(content);
			expect(result).toBeNull(); // Only 1 Task, not parallel
		});
	});

	describe("startParallelGroup", () => {
		it("should create a parallel group with agents", () => {
			const tasks = [
				{
					id: "tool_1",
					name: "Task",
					input: { prompt: "Explore desktop app" },
				},
				{ id: "tool_2", name: "Task", input: { prompt: "Explore backend" } },
			];

			const group = tracker.startParallelGroup("session-1", tasks);

			expect(group.groupId).toBeDefined();
			expect(group.agents.size).toBe(2);
			expect(group.agents.get("tool_1")).toBeDefined();
			expect(group.agents.get("tool_2")).toBeDefined();
		});

		it("should extract description from task input", () => {
			const tasks = [
				{ id: "tool_1", name: "Task", input: { prompt: "Short description" } },
			];

			const group = tracker.startParallelGroup("session-1", tasks);
			const agent = group.agents.get("tool_1");

			expect(agent?.description).toBe("Short description");
		});

		it("should truncate long descriptions", () => {
			const longPrompt =
				"This is a very long description that should be truncated to fit the display";
			const tasks = [
				{ id: "tool_1", name: "Task", input: { prompt: longPrompt } },
			];

			const group = tracker.startParallelGroup("session-1", tasks);
			const agent = group.agents.get("tool_1");

			expect(agent?.description.length).toBeLessThanOrEqual(50);
			expect(agent?.description.endsWith("...")).toBe(true);
		});
	});

	describe("isParallelTaskParent", () => {
		it("should return true for tracked task tool_use_id", () => {
			const tasks = [
				{ id: "tool_1", name: "Task", input: { prompt: "Test" } },
				{ id: "tool_2", name: "Task", input: { prompt: "Test 2" } },
			];

			tracker.startParallelGroup("session-1", tasks);

			expect(tracker.isParallelTaskParent("tool_1")).toBe(true);
			expect(tracker.isParallelTaskParent("tool_2")).toBe(true);
			expect(tracker.isParallelTaskParent("unknown")).toBe(false);
		});
	});

	describe("updateAgentAction", () => {
		it("should update agent's current action and tool count", () => {
			const tasks = [
				{ id: "tool_1", name: "Task", input: { prompt: "Test" } },
				{ id: "tool_2", name: "Task", input: { prompt: "Test 2" } },
			];

			tracker.startParallelGroup("session-1", tasks);

			const group = tracker.updateAgentAction("tool_1", "Read", {
				file_path: "/path/to/file.ts",
			});

			expect(group).not.toBeNull();
			const agent = group!.agents.get("tool_1");
			expect(agent?.toolCount).toBe(1);
			expect(agent?.currentAction).toContain("Read");
			expect(agent?.currentAction).toContain("file.ts");
		});

		it("should return null for untracked tool_use_id", () => {
			const group = tracker.updateAgentAction("unknown", "Read", {});
			expect(group).toBeNull();
		});
	});

	describe("completeAgent", () => {
		it("should mark agent as completed", () => {
			const tasks = [
				{ id: "tool_1", name: "Task", input: { prompt: "Test" } },
				{ id: "tool_2", name: "Task", input: { prompt: "Test 2" } },
			];

			tracker.startParallelGroup("session-1", tasks);

			const result = tracker.completeAgent(
				"tool_1",
				"Agent completed successfully",
			);

			expect(result).not.toBeNull();
			expect(result!.allCompleted).toBe(false);
			expect(result!.group.agents.get("tool_1")?.completed).toBe(true);
			expect(result!.group.agents.get("tool_2")?.completed).toBe(false);
		});

		it("should return allCompleted=true when all agents complete", () => {
			const tasks = [
				{ id: "tool_1", name: "Task", input: { prompt: "Test" } },
				{ id: "tool_2", name: "Task", input: { prompt: "Test 2" } },
			];

			tracker.startParallelGroup("session-1", tasks);

			tracker.completeAgent("tool_1", "Done 1");
			const result = tracker.completeAgent("tool_2", "Done 2");

			expect(result!.allCompleted).toBe(true);
		});
	});

	describe("formatUnifiedView", () => {
		it("should format running agents view", () => {
			const tasks = [
				{
					id: "tool_1",
					name: "Task",
					input: { prompt: "Explore desktop app" },
				},
				{ id: "tool_2", name: "Task", input: { prompt: "Explore backend" } },
			];

			const group = tracker.startParallelGroup("session-1", tasks);
			const view = tracker.formatUnifiedView(group);

			expect(view).toContain("Running 2 of 2 agents");
			expect(view).toContain("Explore desktop app");
			expect(view).toContain("Explore backend");
		});

		it("should show completed status", () => {
			const tasks = [
				{ id: "tool_1", name: "Task", input: { prompt: "Test 1" } },
				{ id: "tool_2", name: "Task", input: { prompt: "Test 2" } },
			];

			const group = tracker.startParallelGroup("session-1", tasks);
			tracker.completeAgent("tool_1");
			tracker.completeAgent("tool_2");

			const view = tracker.formatUnifiedView(group);

			expect(view).toContain("Completed 2 agents");
		});

		it("should show tool count when agents have processed tools", () => {
			const tasks = [{ id: "tool_1", name: "Task", input: { prompt: "Test" } }];

			const group = tracker.startParallelGroup("session-1", tasks);
			tracker.updateAgentAction("tool_1", "Read", {});
			tracker.updateAgentAction("tool_1", "Grep", {});
			tracker.updateAgentAction("tool_1", "Bash", {});

			const view = tracker.formatUnifiedView(group);

			expect(view).toContain("3 tool uses");
		});
	});

	describe("clearSession", () => {
		it("should clear all tracking for a session", () => {
			const tasks = [{ id: "tool_1", name: "Task", input: { prompt: "Test" } }];

			tracker.startParallelGroup("session-1", tasks);
			expect(tracker.isParallelTaskParent("tool_1")).toBe(true);

			tracker.clearSession("session-1");
			expect(tracker.isParallelTaskParent("tool_1")).toBe(false);
		});
	});

	describe("removeGroup", () => {
		it("should remove a completed group and clean up lookups", () => {
			const tasks = [{ id: "tool_1", name: "Task", input: { prompt: "Test" } }];

			const group = tracker.startParallelGroup("session-1", tasks);
			expect(tracker.isParallelTaskParent("tool_1")).toBe(true);

			tracker.removeGroup("session-1", group.groupId);
			expect(tracker.isParallelTaskParent("tool_1")).toBe(false);
		});
	});
});
