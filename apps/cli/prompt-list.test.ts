import type { RepositoryConfig } from "cyrus-edge-worker";
import { describe, expect, it } from "vitest";
import { summarizePromptMappings } from "./prompt-list.js";

describe("summarizePromptMappings", () => {
	const baseRepository: RepositoryConfig = {
		id: "repo-1",
		name: "Primary Repo",
		repositoryPath: "/tmp/repo-1",
		workspaceBaseDir: "/tmp/workspaces/repo-1",
		baseBranch: "main",
		linearToken: "token-1",
		linearWorkspaceId: "workspace-1",
		isActive: true,
	};

	it("includes built-in prompts even when not configured", () => {
		const repositories: RepositoryConfig[] = [
			{
				...baseRepository,
				labelPrompts: {
					debugger: { labels: ["Bug", "Bug"] },
					customAudit: { labels: ["Audit"] },
				} as any,
			},
		];

		const inventory = summarizePromptMappings(repositories);

		expect(inventory.repositories).toHaveLength(1);
		const repoSummary = inventory.repositories[0];

		const debuggerPrompt = repoSummary.prompts.find(
			(prompt) => prompt.prompt === "debugger",
		);
		expect(debuggerPrompt?.source).toBe("built-in");
		expect(debuggerPrompt?.labels).toEqual(["bug"]);

		const orchestratorPrompt = repoSummary.prompts.find(
			(prompt) => prompt.prompt === "orchestrator",
		);
		expect(orchestratorPrompt?.labels).toEqual([]);

		const customPrompt = repoSummary.prompts.find(
			(prompt) => prompt.prompt === "customAudit",
		);
		expect(customPrompt?.source).toBe("custom");
		expect(customPrompt?.labels).toEqual(["audit"]);

		const definitions = new Map(
			inventory.definitions.map((definition) => [definition.id, definition]),
		);
		const debuggerDefinition = definitions.get("debugger");
		expect(debuggerDefinition?.scope).toBe("global");
		expect(debuggerDefinition?.content).toContain(
			"masterful software engineer",
		);

		const customDefinition = definitions.get("repo-1:customAudit");
		expect(customDefinition?.scope).toBe("repository");
		expect(customDefinition?.repositoryId).toBe("repo-1");
		expect(customDefinition?.content).toBeUndefined();
	});

	it("supports legacy array-only prompt configuration", () => {
		const repositories: RepositoryConfig[] = [
			{
				...baseRepository,
				id: "repo-2",
				name: "Legacy Repo",
				labelPrompts: {
					builder: ["feature", "Feature"],
				} as any,
			},
		];

		const inventory = summarizePromptMappings(repositories);
		const repoSummary = inventory.repositories[0];

		expect(
			repoSummary.prompts.find((prompt) => prompt.prompt === "builder")?.labels,
		).toEqual(["feature"]);
	});

	it("filters repositories by id when requested", () => {
		const repositories: RepositoryConfig[] = [
			{
				...baseRepository,
				id: "repo-a",
				name: "Repo A",
			},
			{
				...baseRepository,
				id: "repo-b",
				name: "Repo B",
				labelPrompts: {
					debugger: { labels: ["bug"] },
				} as any,
			},
		];

		const inventory = summarizePromptMappings(repositories, {
			repoId: "repo-b",
		});
		expect(inventory.repositories).toHaveLength(1);
		expect(inventory.repositories[0].repositoryId).toBe("repo-b");
		const definitions = new Map(
			inventory.definitions.map((definition) => [definition.id, definition]),
		);
		expect(definitions.has("repo-a:debugger")).toBe(false);
	});

	it("returns an empty inventory when no repositories exist", () => {
		expect(summarizePromptMappings(undefined)).toEqual({
			definitions: [],
			repositories: [],
		});
		expect(summarizePromptMappings([])).toEqual({
			definitions: [],
			repositories: [],
		});
	});
});
