import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { RepositoryConfig } from "../src/types.js";

type TestEdgeWorker = EdgeWorker & { config: any; cyrusHome: string };

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

		const edgeWorker = Object.create(EdgeWorker.prototype) as TestEdgeWorker;
		edgeWorker.config = { promptDefaults: {} };
		edgeWorker.cyrusHome = process.cwd();
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

		const edgeWorker = Object.create(EdgeWorker.prototype) as TestEdgeWorker;
		edgeWorker.config = { promptDefaults: {} };
		edgeWorker.cyrusHome = process.cwd();
		const result = await (edgeWorker as any).determineSystemPromptFromLabels(
			["bug"],
			repository,
		);

		expect(result).toBeUndefined();
	});

	it("loads custom repository prompt when promptPath is provided", async () => {
		const tmpDir = mkdtempSync(join(process.cwd(), "edge-worker-prompts-"));
		const promptPath = join(tmpDir, "custom-debugger.md");
		writeFileSync(
			promptPath,
			'<version-tag value="custom-debugger-v1" />\nCustom debugger content',
			"utf-8",
		);

		type TestEdgeWorker = EdgeWorker & { config: any; cyrusHome: string };
		const edgeWorker = Object.create(EdgeWorker.prototype) as TestEdgeWorker;
		edgeWorker.config = { promptDefaults: {} };
		edgeWorker.cyrusHome = tmpDir;

		const repository: RepositoryConfig = {
			...baseRepository,
			labelPrompts: {
				debugger: { labels: ["bug"], promptPath },
			},
		};

		const result = await (edgeWorker as any).determineSystemPromptFromLabels(
			["bug"],
			repository,
		);

		expect(result?.type).toBe("debugger");
		expect(result?.version).toBe("custom-debugger-v1");
		expect(result?.prompt).toContain("Custom debugger content");

		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("falls back to global promptPath when repository template missing", async () => {
		const tmpDir = mkdtempSync(
			join(process.cwd(), "edge-worker-global-prompts-"),
		);
		const promptPath = join(tmpDir, "global-builder.md");
		writeFileSync(
			promptPath,
			'<version-tag value="global-builder-v1" />\nGlobal builder content',
			"utf-8",
		);

		type TestEdgeWorker = EdgeWorker & { config: any; cyrusHome: string };
		const edgeWorker = Object.create(EdgeWorker.prototype) as TestEdgeWorker;
		edgeWorker.config = {
			promptDefaults: {
				builder: { labels: ["feature"], promptPath },
			},
		};
		edgeWorker.cyrusHome = tmpDir;

		const repository: RepositoryConfig = {
			...baseRepository,
			labelPrompts: {
				builder: { labels: ["feature"] },
			},
		};

		const result = await (edgeWorker as any).determineSystemPromptFromLabels(
			["feature"],
			repository,
		);

		expect(result?.type).toBe("builder");
		expect(result?.version).toBe("global-builder-v1");
		expect(result?.prompt).toContain("Global builder content");

		rmSync(tmpDir, { recursive: true, force: true });
	});
});
