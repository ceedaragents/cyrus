import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { RepositoryConfig } from "cyrus-edge-worker";
import { BUILT_IN_PROMPT_TYPES } from "./prompt-list.js";
import { PROMPTS_DIRECTORY } from "./prompt-paths.js";

export type PromptScope = "global" | "repository";

type PromptToolPreset = string[] | "readOnly" | "safe" | "all" | "coordinator";

export interface PromptRuleConfigShape {
	labels?: string[];
	allowedTools?: PromptToolPreset;
	disallowedTools?: string[];
	promptPath?: string;
}

export interface PromptAwareConfig {
	promptDefaults?: Record<string, PromptRuleConfigShape | undefined>;
	repositories?: RepositoryConfig[];
}

export interface LabelConflict {
	label: string;
	prompt: string;
	scope: PromptScope;
	repositoryId?: string;
}

export interface PromptPlan {
	action: "create" | "edit" | "delete";
	scope: PromptScope;
	promptName: string;
	displayName: string;
	repositoryId?: string;
	repositoryName?: string;
	labels?: string[];
	previousLabels?: string[];
	promptPath?: string;
	previousPromptPath?: string;
	fileOperation?: {
		type: "create" | "update" | "delete" | "none";
		path?: string;
		nextContent?: string;
		previousContent?: string;
	};
	warnings: string[];
	conflicts: LabelConflict[];
	existingSource?: "built-in" | "custom";
	nextConfig: PromptAwareConfig;
}

export interface CreatePromptOptions {
	name: string;
	labels: string[];
	repoId?: string;
	fromFilePath?: string;
}

export interface EditPromptOptions {
	name: string;
	labels?: string[];
	repoId?: string;
	promptFilePath?: string;
}

export interface DeletePromptOptions {
	name: string;
	repoId?: string;
}

function cloneConfig<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function toKebabCase(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
}

function normalizePromptName(rawName: string): {
	displayName: string;
	key: string;
} {
	const displayName = rawName.trim();
	if (!displayName) {
		throw new Error("Prompt name is required");
	}

	const key = toKebabCase(displayName);
	if (!key) {
		throw new Error("Prompt name must include alphanumeric characters");
	}

	return { displayName, key };
}

function parseLabels(raw: string[]): {
	labels: string[];
	duplicates: string[];
} {
	const seen = new Map<string, string>();
	const duplicates: string[] = [];

	for (const input of raw) {
		const label = input.trim();
		if (!label) {
			continue;
		}
		const normalized = label.toLowerCase();
		if (!seen.has(normalized)) {
			seen.set(normalized, normalized);
		} else {
			duplicates.push(label);
		}
	}

	return { labels: Array.from(seen.values()), duplicates };
}

function resolveRepository(
	config: PromptAwareConfig,
	repoId: string | undefined,
): RepositoryConfig | undefined {
	if (!repoId) {
		return undefined;
	}

	const repositories = config.repositories ?? [];
	return repositories.find((repo) => repo.id === repoId);
}

function getPromptSet(
	scope: PromptScope,
	config: PromptAwareConfig,
	repository: RepositoryConfig | undefined,
): Record<string, PromptRuleConfigShape | string[] | undefined> {
	if (scope === "global") {
		return config.promptDefaults ?? {};
	}

	if (!repository) {
		return {};
	}

	return repository.labelPrompts ?? {};
}

function toPromptRuleConfig(
	value: PromptRuleConfigShape | string[] | undefined,
): PromptRuleConfigShape | undefined {
	if (!value) {
		return undefined;
	}

	if (Array.isArray(value)) {
		return { labels: value };
	}

	return value;
}

function collectLabelConflicts(
	scope: PromptScope,
	config: PromptAwareConfig,
	repository: RepositoryConfig | undefined,
	targetPrompt: string,
	candidateLabels: string[],
): LabelConflict[] {
	const conflicts: LabelConflict[] = [];
	const normalizedCandidate = candidateLabels.map((label) =>
		label.toLowerCase(),
	);

	if (scope === "global") {
		const entries = config.promptDefaults ?? {};
		for (const [promptName, rawConfig] of Object.entries(entries)) {
			if (promptName === targetPrompt) {
				continue;
			}
			const configValue = toPromptRuleConfig(rawConfig);
			const labels = configValue?.labels ?? [];
			for (const label of labels) {
				if (normalizedCandidate.includes(label.toLowerCase())) {
					conflicts.push({
						label,
						prompt: promptName,
						scope: "global",
					});
				}
			}
		}
		return conflicts;
	}

	const repo = repository;
	if (!repo) {
		return conflicts;
	}

	const entries = repo.labelPrompts ?? {};
	for (const [promptName, rawConfig] of Object.entries(entries)) {
		if (promptName === targetPrompt) {
			continue;
		}
		const configValue = toPromptRuleConfig(rawConfig);
		const labels = configValue?.labels ?? [];
		for (const label of labels) {
			if (normalizedCandidate.includes(label.toLowerCase())) {
				conflicts.push({
					label,
					prompt: promptName,
					scope: "repository",
					repositoryId: repo.id,
				});
			}
		}
	}

	return conflicts;
}

function generatePromptFilePath(
	scope: PromptScope,
	promptKey: string,
	repository: RepositoryConfig | undefined,
): string {
	if (scope === "global") {
		return join(PROMPTS_DIRECTORY, `custom-${promptKey}.md`);
	}

	const repoSlug = toKebabCase(repository?.id ?? repository?.name ?? "repo");
	return join(PROMPTS_DIRECTORY, `custom-${promptKey}-${repoSlug}.md`);
}

function resolvePromptFilePath(
	promptPath: string | undefined,
): string | undefined {
	if (!promptPath) {
		return undefined;
	}

	if (isAbsolute(promptPath)) {
		return promptPath;
	}

	if (promptPath.startsWith("~/")) {
		const home = process.env.HOME || "";
		return resolve(home, promptPath.slice(2));
	}

	return resolve(PROMPTS_DIRECTORY, promptPath);
}

function resolveSourcePath(
	fromFilePath: string | undefined,
): string | undefined {
	if (!fromFilePath) {
		return undefined;
	}

	if (isAbsolute(fromFilePath)) {
		return fromFilePath;
	}

	if (fromFilePath.startsWith("~/")) {
		const home = process.env.HOME || "";
		return resolve(home, fromFilePath.slice(2));
	}

	return resolve(process.cwd(), fromFilePath);
}

function buildPromptStub(displayName: string, promptKey: string): string {
	return `<version-tag value="${promptKey}-v1.0.0" />\n\n# ${displayName}\n\nDescribe the workflow this prompt should follow.\n`;
}

function ensurePromptEntryContainer(
	scope: PromptScope,
	nextConfig: PromptAwareConfig,
	repository: RepositoryConfig | undefined,
): void {
	if (scope === "global") {
		nextConfig.promptDefaults = nextConfig.promptDefaults ?? {};
		return;
	}

	if (!repository) {
		return;
	}

	repository.labelPrompts = repository.labelPrompts ?? {};
}

function copyRepositoryReference(
	repository: RepositoryConfig | undefined,
	nextConfig: PromptAwareConfig,
): RepositoryConfig | undefined {
	if (!repository) {
		return undefined;
	}

	const repositories = nextConfig.repositories ?? [];
	const index = repositories.findIndex((repo) => repo.id === repository.id);
	if (index === -1) {
		return repository;
	}

	const nextRepo = repositories[index];
	return nextRepo;
}

function readPromptSource(path: string | undefined): string | undefined {
	if (!path) {
		return undefined;
	}

	return readFileSync(path, "utf-8");
}

export function buildCreatePromptPlan(
	config: PromptAwareConfig,
	options: CreatePromptOptions,
): PromptPlan {
	const { displayName, key } = normalizePromptName(options.name);
	const scope: PromptScope = options.repoId ? "repository" : "global";
	const repository = resolveRepository(config, options.repoId);

	if (options.repoId && !repository) {
		throw new Error(`Repository with id "${options.repoId}" was not found`);
	}

	if (BUILT_IN_PROMPT_TYPES.includes(key as any)) {
		throw new Error(
			`Prompt "${key}" already exists as a built-in template. Use 'cyrus prompts edit ${key}' to update its labels instead.`,
		);
	}

	const existingSet = getPromptSet(scope, config, repository);
	if (existingSet[key]) {
		throw new Error(
			`Prompt "${key}" already exists in the ${scope === "global" ? "global" : "repository"} configuration. Use 'cyrus prompts edit ${key}' to modify it.`,
		);
	}

	const { labels, duplicates } = parseLabels(options.labels);
	if (labels.length === 0) {
		throw new Error("At least one label is required");
	}

	const duplicatesWarning = duplicates.length
		? `Duplicate labels removed: ${duplicates.join(", ")}`
		: undefined;

	const promptPath = generatePromptFilePath(scope, key, repository);
	if (existsSync(promptPath)) {
		throw new Error(
			`Prompt file already exists at ${promptPath}. Choose a different name or delete the existing prompt first.`,
		);
	}
	const sourcePath = resolveSourcePath(options.fromFilePath);
	const promptContent = sourcePath
		? readPromptSource(sourcePath)
		: buildPromptStub(displayName, key);

	const nextConfig = cloneConfig(config);
	const nextRepository = copyRepositoryReference(repository, nextConfig);
	ensurePromptEntryContainer(scope, nextConfig, nextRepository);

	const promptRule: PromptRuleConfigShape = {
		labels,
		promptPath,
	};

	if (scope === "global") {
		nextConfig.promptDefaults![key] = promptRule;
	} else if (nextRepository) {
		const container =
			(nextRepository.labelPrompts as Record<string, unknown>) ?? {};
		container[key] = promptRule;
		nextRepository.labelPrompts = container as RepositoryConfig["labelPrompts"];
	}

	const conflicts = collectLabelConflicts(
		scope,
		nextConfig,
		nextRepository,
		key,
		labels,
	);

	const warnings = [duplicatesWarning].filter((message): message is string =>
		Boolean(message),
	);

	return {
		action: "create",
		scope,
		promptName: key,
		displayName,
		repositoryId: nextRepository?.id,
		repositoryName: nextRepository?.name,
		labels,
		promptPath,
		fileOperation: {
			type: "create",
			path: promptPath,
			nextContent: promptContent,
		},
		warnings,
		conflicts,
		nextConfig,
	};
}

export function buildEditPromptPlan(
	config: PromptAwareConfig,
	options: EditPromptOptions,
): PromptPlan {
	const { displayName, key } = normalizePromptName(options.name);
	const scope: PromptScope = options.repoId ? "repository" : "global";
	const repository = resolveRepository(config, options.repoId);

	if (options.repoId && !repository) {
		throw new Error(`Repository with id "${options.repoId}" was not found`);
	}

	const currentSet = getPromptSet(scope, config, repository);
	const currentValue = currentSet[key];

	if (!currentValue) {
		throw new Error(
			`Prompt "${key}" does not exist in the ${scope === "global" ? "global" : "repository"} configuration.`,
		);
	}

	const currentRule = toPromptRuleConfig(currentValue) ?? { labels: [] };
	const existingSource = currentRule.promptPath ? "custom" : "built-in";

	if (existingSource === "built-in" && options.promptFilePath) {
		throw new Error(
			"Built-in prompts can only update labels. Use a custom prompt to replace content.",
		);
	}

	const newLabelsInput = options.labels ?? currentRule.labels ?? [];
	const { labels, duplicates } = parseLabels(newLabelsInput);
	if (labels.length === 0) {
		throw new Error("At least one label is required");
	}

	const promptPath = resolvePromptFilePath(currentRule.promptPath);
	const nextContent = options.promptFilePath
		? readPromptSource(resolveSourcePath(options.promptFilePath))
		: undefined;

	const nextConfig = cloneConfig(config);
	const nextRepository = copyRepositoryReference(repository, nextConfig);
	ensurePromptEntryContainer(scope, nextConfig, nextRepository);

	const updatedRule: PromptRuleConfigShape = {
		labels,
		...(currentRule.promptPath ? { promptPath: promptPath } : {}),
		...(currentRule.allowedTools
			? { allowedTools: currentRule.allowedTools }
			: {}),
		...(currentRule.disallowedTools
			? { disallowedTools: currentRule.disallowedTools }
			: {}),
	};

	if (scope === "global") {
		nextConfig.promptDefaults![key] = updatedRule;
	} else if (nextRepository?.labelPrompts) {
		const container = nextRepository.labelPrompts as Record<string, unknown>;
		container[key] = updatedRule;
	}

	const conflicts = collectLabelConflicts(
		scope,
		nextConfig,
		nextRepository,
		key,
		labels,
	);

	const warnings = (
		duplicates.length
			? [`Duplicate labels removed: ${duplicates.join(", ")}`]
			: []
	) as string[];

	let fileOperation: PromptPlan["fileOperation"] | undefined;
	if (promptPath) {
		if (nextContent !== undefined) {
			fileOperation = {
				type: "update",
				path: promptPath,
				nextContent,
			};
		} else {
			fileOperation = {
				type: "none",
				path: promptPath,
			};
		}
	} else {
		fileOperation = { type: "none" };
	}

	return {
		action: "edit",
		scope,
		promptName: key,
		displayName,
		repositoryId: nextRepository?.id,
		repositoryName: nextRepository?.name,
		labels,
		previousLabels: currentRule.labels,
		promptPath: promptPath,
		previousPromptPath: currentRule.promptPath,
		fileOperation,
		warnings,
		conflicts,
		existingSource,
		nextConfig,
	};
}

export function buildDeletePromptPlan(
	config: PromptAwareConfig,
	options: DeletePromptOptions,
): PromptPlan {
	const { displayName, key } = normalizePromptName(options.name);
	const scope: PromptScope = options.repoId ? "repository" : "global";
	const repository = resolveRepository(config, options.repoId);

	if (options.repoId && !repository) {
		throw new Error(`Repository with id "${options.repoId}" was not found`);
	}

	const currentSet = getPromptSet(scope, config, repository);
	const currentValue = currentSet[key];

	if (!currentValue) {
		throw new Error(
			`Prompt "${key}" does not exist in the ${scope === "global" ? "global" : "repository"} configuration.`,
		);
	}

	const currentRule = toPromptRuleConfig(currentValue) ?? { labels: [] };
	if (!currentRule.promptPath) {
		throw new Error(
			"Built-in prompts cannot be deleted. Remove label bindings instead.",
		);
	}

	const promptPath = resolvePromptFilePath(currentRule.promptPath);
	const nextConfig = cloneConfig(config);
	const nextRepository = copyRepositoryReference(repository, nextConfig);

	if (scope === "global") {
		if (nextConfig.promptDefaults) {
			delete nextConfig.promptDefaults[key];
		}
	} else if (nextRepository?.labelPrompts) {
		delete nextRepository.labelPrompts[key];
	}

	return {
		action: "delete",
		scope,
		promptName: key,
		displayName,
		repositoryId: nextRepository?.id,
		repositoryName: nextRepository?.name,
		labels: currentRule.labels ?? [],
		promptPath,
		previousPromptPath: currentRule.promptPath,
		fileOperation: {
			type: "delete",
			path: promptPath,
		},
		warnings: [],
		conflicts: [],
		existingSource: "custom",
		nextConfig,
	};
}
