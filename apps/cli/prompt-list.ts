import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RepositoryConfig } from "cyrus-edge-worker";

export const BUILT_IN_PROMPT_TYPES = [
	"debugger",
	"builder",
	"scoper",
	"orchestrator",
] as const;

const BUILT_IN_PROMPT_SET = new Set<string>(BUILT_IN_PROMPT_TYPES);

type PromptSource = "built-in" | "custom";

export interface PromptSummary {
	prompt: string;
	source: PromptSource;
	labels: string[];
	definitionId: string;
}

export interface RepositoryPromptSummary {
	repositoryId: string;
	repositoryName?: string;
	prompts: PromptSummary[];
}

export interface SummarizePromptOptions {
	repoId?: string;
}

export interface PromptDefinitionSummary {
	id: string;
	prompt: string;
	source: PromptSource;
	scope: "global" | "repository";
	repositoryId?: string;
	content?: string;
}

export interface PromptInventory {
	definitions: PromptDefinitionSummary[];
	repositories: RepositoryPromptSummary[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUILT_IN_PROMPT_CACHE = new Map<string, string | undefined>();

function resolveBuiltInPromptDirectory(): string | undefined {
	const candidates = [
		resolve(__dirname, "packages", "edge-worker", "prompts"),
		resolve(__dirname, "..", "packages", "edge-worker", "prompts"),
		resolve(__dirname, "..", "..", "packages", "edge-worker", "prompts"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

function loadBuiltInPromptContent(promptName: string): string | undefined {
	if (BUILT_IN_PROMPT_CACHE.has(promptName)) {
		return BUILT_IN_PROMPT_CACHE.get(promptName);
	}

	const directory = resolveBuiltInPromptDirectory();
	if (!directory) {
		BUILT_IN_PROMPT_CACHE.set(promptName, undefined);
		return undefined;
	}

	const filePath = join(directory, `${promptName}.md`);
	if (!existsSync(filePath)) {
		BUILT_IN_PROMPT_CACHE.set(promptName, undefined);
		return undefined;
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		BUILT_IN_PROMPT_CACHE.set(promptName, content);
		return content;
	} catch (_error) {
		BUILT_IN_PROMPT_CACHE.set(promptName, undefined);
	}

	return undefined;
}

function normalizeLabels(values: unknown): string[] {
	if (!values) {
		return [];
	}

	const rawLabels = Array.isArray(values) ? values : undefined;
	if (rawLabels) {
		return uniqueStrings(rawLabels);
	}

	if (typeof values === "object") {
		const candidate = (values as { labels?: unknown }).labels;
		if (Array.isArray(candidate)) {
			return uniqueStrings(candidate);
		}
	}

	return [];
}

function uniqueStrings(values: unknown[]): string[] {
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string") {
			continue;
		}
		const normalized = value.trim().toLowerCase();
		if (!normalized) {
			continue;
		}
		seen.add(normalized);
	}
	return Array.from(seen);
}

type InternalPromptEntry = {
	prompt: string;
	source: PromptSource;
	labels: string[];
	rawConfig?: unknown;
};

function buildPromptEntries(
	repository: RepositoryConfig,
): Map<string, InternalPromptEntry> {
	const entries = new Map<string, InternalPromptEntry>();
	const labelPrompts = repository.labelPrompts as
		| Record<string, unknown>
		| undefined;

	if (labelPrompts) {
		for (const [promptName, rawConfig] of Object.entries(labelPrompts)) {
			const labels = normalizeLabels(rawConfig);
			const source: PromptSource = BUILT_IN_PROMPT_SET.has(promptName)
				? "built-in"
				: "custom";
			entries.set(promptName, {
				prompt: promptName,
				source,
				labels,
				rawConfig,
			});
		}
	}

	for (const builtIn of BUILT_IN_PROMPT_TYPES) {
		if (!entries.has(builtIn)) {
			entries.set(builtIn, {
				prompt: builtIn,
				source: "built-in",
				labels: [],
			});
		}
	}

	return entries;
}

function resolveDefinitionId(
	prompt: string,
	source: PromptSource,
	repositoryId: string,
): string {
	return source === "built-in" ? prompt : `${repositoryId}:${prompt}`;
}

function loadPromptContent(entry: InternalPromptEntry): string | undefined {
	if (entry.source === "built-in") {
		return loadBuiltInPromptContent(entry.prompt);
	}

	if (entry.rawConfig && typeof entry.rawConfig === "object") {
		const possiblePath = (entry.rawConfig as Record<string, unknown>)
			.promptPath;
		if (typeof possiblePath === "string") {
			const absolutePath = resolve(possiblePath);
			if (existsSync(absolutePath)) {
				try {
					return readFileSync(absolutePath, "utf-8");
				} catch (_error) {
					return undefined;
				}
			}
		}
	}

	return undefined;
}

export function summarizePromptMappings(
	repositories: RepositoryConfig[] | undefined,
	options: SummarizePromptOptions = {},
): PromptInventory {
	if (!repositories || repositories.length === 0) {
		return { definitions: [], repositories: [] };
	}

	const { repoId } = options;
	const targetRepositories = repoId
		? repositories.filter((repository) => repository.id === repoId)
		: repositories;

	const definitions = new Map<string, PromptDefinitionSummary>();
	const repositorySummaries: RepositoryPromptSummary[] = [];

	for (const repository of targetRepositories) {
		const entries = buildPromptEntries(repository);

		const builtIns = BUILT_IN_PROMPT_TYPES.map((builtIn) =>
			entries.get(builtIn),
		).filter((value): value is InternalPromptEntry => Boolean(value));
		const customPrompts = Array.from(entries.values())
			.filter((entry) => entry.source === "custom")
			.sort((a, b) => a.prompt.localeCompare(b.prompt));

		const orderedEntries = [...builtIns, ...customPrompts];
		const prompts: PromptSummary[] = orderedEntries.map((entry) => {
			const definitionId = resolveDefinitionId(
				entry.prompt,
				entry.source,
				repository.id,
			);

			if (!definitions.has(definitionId)) {
				const content = loadPromptContent(entry);
				definitions.set(definitionId, {
					id: definitionId,
					prompt: entry.prompt,
					source: entry.source,
					scope: entry.source === "built-in" ? "global" : "repository",
					repositoryId: entry.source === "built-in" ? undefined : repository.id,
					content,
				});
			}

			return {
				prompt: entry.prompt,
				source: entry.source,
				labels: entry.labels,
				definitionId,
			};
		});

		repositorySummaries.push({
			repositoryId: repository.id,
			repositoryName: repository.name,
			prompts,
		});
	}

	return {
		definitions: Array.from(definitions.values()).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		repositories: repositorySummaries,
	};
}
