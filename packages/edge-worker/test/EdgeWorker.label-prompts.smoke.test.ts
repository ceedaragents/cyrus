import { describe, expect, it } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { RepositoryConfig } from "../src/types.js";

describe("EdgeWorker label prompt selection", () => {
	const baseRepository: RepositoryConfig = {
		id: "repo-smoke",
		name: "Smoke Repo",
		repositoryPath: "/tmp/repo-smoke",
		workspaceBaseDir: "/tmp/workspaces/repo-smoke",
		baseBranch: "main",
		linearToken: "linear-token",
		linearWorkspaceId: "workspace-id",
		isActive: true,
	};

	it("uses the debugger prompt when labels match", async () => {
		const repository: RepositoryConfig = {
			...baseRepository,
			labelPrompts: {
				debugger: { labels: ["bug"] },
			},
		};

		const edgeWorker = Object.create(EdgeWorker.prototype) as EdgeWorker;
		const result = await (edgeWorker as any).determineSystemPromptFromLabels(
			["bug"],
			repository,
		);

		expect(result).toBeDefined();
		expect(result?.type).toBe("debugger");
		expect(result?.version).toMatch(/^debugger-v/i);
		expect(result?.prompt).toContain("masterful software engineer");
	});

	it("returns undefined when no prompt labels match", async () => {
		const repository: RepositoryConfig = {
			...baseRepository,
			labelPrompts: {
				builder: { labels: ["feature"] },
			},
		};

		const edgeWorker = Object.create(EdgeWorker.prototype) as EdgeWorker;
		const result = await (edgeWorker as any).determineSystemPromptFromLabels(
			["bug"],
			repository,
		);

		expect(result).toBeUndefined();
	});
});
