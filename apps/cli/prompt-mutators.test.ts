import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const testPromptDir = mkdtempSync(join(tmpdir(), "prompt-mutations-"));
const testConfigDir = mkdtempSync(join(tmpdir(), "prompt-config-"));

vi.mock("./prompt-paths.js", () => ({
	PROMPTS_DIRECTORY: testPromptDir,
	ensurePromptsDirectory: () => {
		if (!existsSync(testPromptDir)) {
			mkdirSync(testPromptDir, { recursive: true });
		}
	},
}));

const { buildCreatePromptPlan, buildEditPromptPlan, buildDeletePromptPlan } =
	await import("./prompt-mutators.js");
const { applyPromptPlan } = await import("./prompt-executor.js");

function createBaseConfig() {
	return {
		repositories: [
			{
				id: "repo-1",
				name: "Repo One",
				repositoryPath: "/tmp/repo-one",
				baseBranch: "main",
				linearWorkspaceId: "workspace-1",
				linearToken: "token-1",
				workspaceBaseDir: "/tmp/workspaces",
				labelPrompts: {},
			},
		],
		promptDefaults: {},
	};
}

function setupExecutionEnv(config: any) {
	const configPath = join(testConfigDir, `config-${Date.now()}.json`);
	writeFileSync(configPath, JSON.stringify(config, null, 2));
	let savedConfig: any = null;
	return {
		env: {
			configPath,
			saveConfig: (nextConfig: any) => {
				savedConfig = JSON.parse(JSON.stringify(nextConfig));
				writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
			},
		},
		configPath,
		getSavedConfig: () => savedConfig,
	};
}

function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, "utf-8"));
}

beforeAll(() => {
	mkdirSync(testPromptDir, { recursive: true });
	mkdirSync(testConfigDir, { recursive: true });
});

afterEach(() => {
	for (const file of readdirSync(testPromptDir)) {
		rmSync(join(testPromptDir, file));
	}
	for (const file of readdirSync(testConfigDir)) {
		rmSync(join(testConfigDir, file));
	}
});

afterAll(() => {
	rmSync(testPromptDir, { recursive: true, force: true });
	rmSync(testConfigDir, { recursive: true, force: true });
});

describe("prompt mutation plans", () => {
	it("creates a global prompt plan and applies it", () => {
		const config = createBaseConfig();
		const plan = buildCreatePromptPlan(config, {
			name: "Feature Planner",
			labels: ["feature"],
		});
		expect(plan.scope).toBe("global");
		expect(plan.promptPath.endsWith("custom-feature-planner.md")).toBe(true);

		const { env, configPath, getSavedConfig } = setupExecutionEnv(config);
		const result = applyPromptPlan(plan, env);

		expect(result.action).toBe("create");
		expect(result.prompt.promptPath).toBe(plan.promptPath);
		expect(existsSync(plan.promptPath)).toBe(true);
		const fileContent = readFileSync(plan.promptPath, "utf-8");
		expect(fileContent).toContain("Describe the workflow");

		const savedConfig = getSavedConfig();
		expect(savedConfig?.promptDefaults?.["feature-planner"].promptPath).toBe(
			plan.promptPath,
		);

		const backupExists = readdirSync(resolve(configPath, "..")).filter(
			(name) => name.startsWith("config-") && name.includes(".json."),
		).length;
		expect(backupExists).toBeGreaterThan(0);
	});

	it("creates a repository prompt plan with conflict warning", () => {
		const config = createBaseConfig();
		config.repositories[0].labelPrompts = {
			builder: { labels: ["feature"] },
		};

		const plan = buildCreatePromptPlan(config, {
			name: "custom-builder",
			labels: ["feature"],
			repoId: config.repositories[0].id,
		});

		expect(plan.scope).toBe("repository");
		expect(plan.conflicts.length).toBe(1);
	});

	it("deduplicates labels when creating prompts", () => {
		const config = createBaseConfig();
		const plan = buildCreatePromptPlan(config, {
			name: "debug-helper",
			labels: ["Bug", "bug"],
		});
		expect(plan.warnings[0]).toMatch(/Duplicate labels removed/);
		expect(plan.labels).toEqual(["bug"]);
	});

	it("updates prompt content using edit plan", () => {
		const config = createBaseConfig();
		const planCreate = buildCreatePromptPlan(config, {
			name: "writer",
			labels: ["write"],
		});
		const { env, configPath } = setupExecutionEnv(config);
		applyPromptPlan(planCreate, env);

		writeFileSync(
			join(testConfigDir, "replacement.md"),
			"Updated content",
			"utf-8",
		);
		const configAfterCreate = readJson(configPath);
		const editPlan = buildEditPromptPlan(configAfterCreate, {
			name: "writer",
			labels: ["write", "doc"],
			promptFilePath: join(testConfigDir, "replacement.md"),
		});
		const editEnv = {
			configPath,
			saveConfig: (nextConfig: any) => {
				writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
			},
		};
		const result = applyPromptPlan(editPlan, editEnv);
		expect(result.action).toBe("edit");
		expect(readFileSync(editPlan.promptPath ?? "", "utf-8")).toBe(
			"Updated content",
		);
	});

	it("deletes a custom prompt", () => {
		const config = createBaseConfig();
		const planCreate = buildCreatePromptPlan(config, {
			name: "deleteme",
			labels: ["cleanup"],
		});
		const { env, configPath } = setupExecutionEnv(config);
		applyPromptPlan(planCreate, env);
		const configAfterCreate = readJson(configPath);
		const deletePlan = buildDeletePromptPlan(configAfterCreate, {
			name: "deleteme",
		});
		const result = applyPromptPlan(deletePlan, {
			configPath,
			saveConfig: (nextConfig: any) => {
				writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
			},
		});
		expect(result.action).toBe("delete");
		expect(result.fileOperation).toBe("delete");
		expect(existsSync(deletePlan.promptPath ?? "")).toBe(false);
	});
});
