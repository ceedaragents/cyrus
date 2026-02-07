import { describe, expect, it } from "vitest";
import {
	buildDebuggerTasks,
	buildFullDevelopmentTasks,
	buildOrchestratorTasks,
} from "../src/TeamTaskBuilder.js";

const TEST_ISSUE_CONTEXT = "Fix the login button not responding on mobile";

describe("buildFullDevelopmentTasks", () => {
	it("should return 7 tasks", () => {
		const tasks = buildFullDevelopmentTasks(TEST_ISSUE_CONTEXT);
		expect(tasks).toHaveLength(7);
	});

	it("should include issue context in all task descriptions", () => {
		const tasks = buildFullDevelopmentTasks(TEST_ISSUE_CONTEXT);
		for (const task of tasks) {
			expect(task.description).toContain(TEST_ISSUE_CONTEXT);
		}
	});

	it("should have unique task IDs", () => {
		const tasks = buildFullDevelopmentTasks(TEST_ISSUE_CONTEXT);
		const ids = tasks.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("should assign correct roles", () => {
		const tasks = buildFullDevelopmentTasks(TEST_ISSUE_CONTEXT);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["fd-1"].assignTo).toBe("researcher");
		expect(byId["fd-2"].assignTo).toBe("implementer");
		expect(byId["fd-3"].assignTo).toBe("verifier");
		expect(byId["fd-4"].assignTo).toBe("implementer");
		expect(byId["fd-5"].assignTo).toBe("git-handler");
		expect(byId["fd-6"].assignTo).toBe("git-handler");
		expect(byId["fd-7"].assignTo).toBe("summarizer");
	});

	it("should set correct subroutine names", () => {
		const tasks = buildFullDevelopmentTasks(TEST_ISSUE_CONTEXT);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["fd-1"].subroutineName).toBe("coding-activity");
		expect(byId["fd-2"].subroutineName).toBe("coding-activity");
		expect(byId["fd-3"].subroutineName).toBe("verifications");
		expect(byId["fd-4"].subroutineName).toBe("changelog-update");
		expect(byId["fd-5"].subroutineName).toBe("git-commit");
		expect(byId["fd-6"].subroutineName).toBe("gh-pr");
		expect(byId["fd-7"].subroutineName).toBe("concise-summary");
	});

	it("should set correct dependency chains", () => {
		const tasks = buildFullDevelopmentTasks(TEST_ISSUE_CONTEXT);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		// Research has no dependencies
		expect(byId["fd-1"].blockedBy).toEqual([]);

		// Implementation blocked by research
		expect(byId["fd-2"].blockedBy).toEqual(["fd-1"]);

		// Verifications and changelog both blocked by implementation (parallel)
		expect(byId["fd-3"].blockedBy).toEqual(["fd-2"]);
		expect(byId["fd-4"].blockedBy).toEqual(["fd-2"]);

		// Commit blocked by both verifications and changelog
		expect(byId["fd-5"].blockedBy).toEqual(["fd-3", "fd-4"]);

		// PR blocked by commit
		expect(byId["fd-6"].blockedBy).toEqual(["fd-5"]);

		// Summary blocked by PR
		expect(byId["fd-7"].blockedBy).toEqual(["fd-6"]);
	});

	it("should allow verifications and changelog to run in parallel", () => {
		const tasks = buildFullDevelopmentTasks(TEST_ISSUE_CONTEXT);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		// Both depend only on fd-2, not on each other
		expect(byId["fd-3"].blockedBy).not.toContain("fd-4");
		expect(byId["fd-4"].blockedBy).not.toContain("fd-3");
		expect(byId["fd-3"].blockedBy).toContain("fd-2");
		expect(byId["fd-4"].blockedBy).toContain("fd-2");
	});
});

describe("buildDebuggerTasks", () => {
	it("should return 7 tasks", () => {
		const tasks = buildDebuggerTasks(TEST_ISSUE_CONTEXT);
		expect(tasks).toHaveLength(7);
	});

	it("should include issue context in all task descriptions", () => {
		const tasks = buildDebuggerTasks(TEST_ISSUE_CONTEXT);
		for (const task of tasks) {
			expect(task.description).toContain(TEST_ISSUE_CONTEXT);
		}
	});

	it("should have unique task IDs", () => {
		const tasks = buildDebuggerTasks(TEST_ISSUE_CONTEXT);
		const ids = tasks.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("should assign correct roles", () => {
		const tasks = buildDebuggerTasks(TEST_ISSUE_CONTEXT);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["dbg-1"].assignTo).toBe("researcher");
		expect(byId["dbg-2"].assignTo).toBe("researcher");
		expect(byId["dbg-3"].assignTo).toBe("researcher");
		expect(byId["dbg-4"].assignTo).toBe("implementer");
		expect(byId["dbg-5"].assignTo).toBe("verifier");
		expect(byId["dbg-6"].assignTo).toBe("git-handler");
		expect(byId["dbg-7"].assignTo).toBe("summarizer");
	});

	it("should set correct subroutine names", () => {
		const tasks = buildDebuggerTasks(TEST_ISSUE_CONTEXT);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["dbg-1"].subroutineName).toBe("debugger-reproduction");
		expect(byId["dbg-2"].subroutineName).toBe("debugger-reproduction");
		expect(byId["dbg-3"].subroutineName).toBe("debugger-reproduction");
		expect(byId["dbg-4"].subroutineName).toBe("debugger-fix");
		expect(byId["dbg-5"].subroutineName).toBe("verifications");
		expect(byId["dbg-6"].subroutineName).toBe("git-commit");
		expect(byId["dbg-7"].subroutineName).toBe("concise-summary");
	});

	it("should set correct dependency chains", () => {
		const tasks = buildDebuggerTasks(TEST_ISSUE_CONTEXT);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		// Three investigation tasks have no dependencies (parallel)
		expect(byId["dbg-1"].blockedBy).toEqual([]);
		expect(byId["dbg-2"].blockedBy).toEqual([]);
		expect(byId["dbg-3"].blockedBy).toEqual([]);

		// Fix blocked by all three investigations
		expect(byId["dbg-4"].blockedBy).toEqual(["dbg-1", "dbg-2", "dbg-3"]);

		// Verifications blocked by fix
		expect(byId["dbg-5"].blockedBy).toEqual(["dbg-4"]);

		// Git operations blocked by verifications
		expect(byId["dbg-6"].blockedBy).toEqual(["dbg-5"]);

		// Summary blocked by git operations
		expect(byId["dbg-7"].blockedBy).toEqual(["dbg-6"]);
	});

	it("should allow all investigation tasks to run in parallel", () => {
		const tasks = buildDebuggerTasks(TEST_ISSUE_CONTEXT);
		const investigationTasks = tasks.filter((t) =>
			["dbg-1", "dbg-2", "dbg-3"].includes(t.id),
		);

		for (const task of investigationTasks) {
			expect(task.blockedBy).toEqual([]);
		}
	});
});

describe("buildOrchestratorTasks", () => {
	it("should create paired impl/verify tasks for each sub-issue", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
			{ id: "SUB-2", title: "Add API routes", description: "Build routes" },
		];

		const tasks = buildOrchestratorTasks(subIssues);

		// 2 sub-issues x 2 tasks each = 4 tasks
		expect(tasks).toHaveLength(4);
	});

	it("should create correct task IDs from sub-issue IDs", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const ids = tasks.map((t) => t.id);

		expect(ids).toContain("orch-SUB-1-impl");
		expect(ids).toContain("orch-SUB-1-verify");
	});

	it("should set correct subjects with sub-issue titles", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["orch-SUB-1-impl"].subject).toBe("Implement: Add auth module");
		expect(byId["orch-SUB-1-verify"].subject).toBe("Verify: Add auth module");
	});

	it("should assign implementer and verifier roles", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["orch-SUB-1-impl"].assignTo).toBe("implementer");
		expect(byId["orch-SUB-1-verify"].assignTo).toBe("verifier");
	});

	it("should set correct subroutine names", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["orch-SUB-1-impl"].subroutineName).toBe("coding-activity");
		expect(byId["orch-SUB-1-verify"].subroutineName).toBe("verifications");
	});

	it("should make verify task depend on its impl task", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["orch-SUB-1-verify"].blockedBy).toEqual(["orch-SUB-1-impl"]);
	});

	it("should have no dependencies for independent sub-issues", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
			{ id: "SUB-2", title: "Add API routes", description: "Build routes" },
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		// Independent sub-issues have no cross-dependencies
		expect(byId["orch-SUB-1-impl"].blockedBy).toEqual([]);
		expect(byId["orch-SUB-2-impl"].blockedBy).toEqual([]);
	});

	it("should wire up cross-issue dependencies correctly", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Add auth module", description: "Build auth" },
			{
				id: "SUB-2",
				title: "Add API routes",
				description: "Build routes",
				dependsOn: ["SUB-1"],
			},
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		// SUB-2 impl should wait for SUB-1 verify
		expect(byId["orch-SUB-2-impl"].blockedBy).toEqual(["orch-SUB-1-verify"]);

		// SUB-1 impl has no dependencies
		expect(byId["orch-SUB-1-impl"].blockedBy).toEqual([]);
	});

	it("should handle multiple dependencies on a single sub-issue", () => {
		const subIssues = [
			{ id: "SUB-1", title: "Database schema", description: "Create schema" },
			{ id: "SUB-2", title: "Auth module", description: "Build auth" },
			{
				id: "SUB-3",
				title: "API layer",
				description: "Build API",
				dependsOn: ["SUB-1", "SUB-2"],
			},
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		// SUB-3 impl should wait for both SUB-1 and SUB-2 verify
		expect(byId["orch-SUB-3-impl"].blockedBy).toEqual([
			"orch-SUB-1-verify",
			"orch-SUB-2-verify",
		]);
	});

	it("should return empty array for empty sub-issues", () => {
		const tasks = buildOrchestratorTasks([]);
		expect(tasks).toEqual([]);
	});

	it("should include sub-issue description in impl task", () => {
		const subIssues = [
			{
				id: "SUB-1",
				title: "Add auth module",
				description: "Build the authentication module with JWT support",
			},
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["orch-SUB-1-impl"].description).toBe(
			"Build the authentication module with JWT support",
		);
	});

	it("should include sub-issue title in verify task description", () => {
		const subIssues = [
			{
				id: "SUB-1",
				title: "Add auth module",
				description: "Build the authentication module with JWT support",
			},
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		expect(byId["orch-SUB-1-verify"].description).toContain("Add auth module");
	});

	it("should ignore dependsOn references to unknown sub-issue IDs", () => {
		const subIssues = [
			{
				id: "SUB-1",
				title: "Add auth module",
				description: "Build auth",
				dependsOn: ["NONEXISTENT"],
			},
		];

		const tasks = buildOrchestratorTasks(subIssues);
		const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

		// Unknown dependency is silently ignored
		expect(byId["orch-SUB-1-impl"].blockedBy).toEqual([]);
	});
});
