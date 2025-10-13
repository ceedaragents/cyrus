#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { Issue } from "@linear/sdk";
import { DEFAULT_PROXY_URL, type EdgeConfig } from "cyrus-core";
import {
	type CliDefaults,
	type EdgeCredentials,
	EdgeWorker,
	type EdgeWorkerConfig,
	type RepositoryConfig,
	type RunnerType,
	SAFE_BASH_TOOL_ALLOWLIST,
	SharedApplicationServer,
} from "cyrus-edge-worker";
import dotenv from "dotenv";
import open from "open";
import {
	applyPromptPlan,
	type PromptCommandResult,
} from "./prompt-executor.js";
import type { PromptDefinitionSummary } from "./prompt-list.js";
import { summarizePromptMappings } from "./prompt-list.js";
import {
	buildCreatePromptPlan,
	buildDeletePromptPlan,
	buildEditPromptPlan,
	type LabelConflict,
	type PromptAwareConfig,
	type PromptPlan,
	type PromptRuleConfigShape,
} from "./prompt-mutators.js";
import { ensurePromptsDirectory } from "./prompt-paths.js";

// Parse command line arguments
const args = process.argv.slice(2);
const envFileArg = args.find((arg) => arg.startsWith("--env-file="));
const cyrusHomeArg = args.find((arg) => arg.startsWith("--cyrus-home="));

// Constants are imported from cyrus-core

// Determine the Cyrus home directory once at startup
let CYRUS_HOME: string;
if (cyrusHomeArg) {
	const customPath = cyrusHomeArg.split("=")[1];
	if (customPath) {
		CYRUS_HOME = resolve(customPath);
	} else {
		console.error("Error: --cyrus-home flag requires a directory path");
		process.exit(1);
	}
} else {
	CYRUS_HOME = resolve(homedir(), ".cyrus");
}

// Get the directory of the current module for reading package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the actual version
const packageJsonPath = resolve(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

// Handle --version argument
if (args.includes("--version")) {
	console.log(packageJson.version);
	process.exit(0);
}

// Handle --help argument
if (args.includes("--help") || args.includes("-h")) {
	console.log(`
cyrus - AI-powered Linear issue automation using Claude

Usage: cyrus [command] [options]

Commands:
  start              Start the edge worker (default)
  check-tokens       Check the status of all Linear tokens
  refresh-token      Refresh a specific Linear token
  add-repository     Add a new repository configuration
  billing            Open Stripe billing portal (Pro plan only)
  set-customer-id    Set your Stripe customer ID
  connect-openai     Store OpenAI credentials and sync Codex
  set-default-cli    Set the global default CLI runner
  set-default-model  Configure default models for a CLI provider
  migrate-config     Backup and upgrade config for multi-CLI support
  validate           Run connectivity and dependency checks
  prompts list       List current prompt-label mappings
  prompts create     Create a custom prompt mapping
  prompts edit       Update labels or markdown content for a prompt
  prompts delete     Remove a custom prompt mapping
  prompts tui        Launch interactive prompt manager

Options:
  --version          Show version number
  --help, -h         Show help
  --env-file=<path>  Load environment variables from file
  --cyrus-home=<dir> Specify custom Cyrus config directory (default: ~/.cyrus)

Examples:
  cyrus                          Start the edge worker
  cyrus check-tokens             Check all Linear token statuses
  cyrus refresh-token            Interactive token refresh
  cyrus add-repository           Add a new repository interactively
  cyrus connect-openai --non-interactive --api-key $OPENAI_API_KEY
  cyrus set-default-cli codex
  cyrus set-default-model codex gpt-4o-mini
  cyrus migrate-config --backup-dir ~/.cyrus/backups
  cyrus validate
  cyrus --cyrus-home=/tmp/cyrus  Use custom config directory
`);
	process.exit(0);
}

// Load environment variables only if --env-file is specified
if (envFileArg) {
	const envFile = envFileArg.split("=")[1];
	if (envFile) {
		dotenv.config({ path: envFile });
	}
}

interface LinearCredentials {
	linearToken: string;
	linearWorkspaceId: string;
	linearWorkspaceName: string;
}

// Extend EdgeConfig locally with multi-CLI fields that aren't in core yet
interface ExtendedEdgeConfig extends Omit<EdgeConfig, "repositories"> {
	repositories: RepositoryConfig[]; // Override with extended RepositoryConfig from edge-worker
	defaultCli?: RunnerType; // Default runner to use when repository doesn't override
	cliDefaults?: CliDefaults; // Default per-runner configuration options
	credentials?: EdgeCredentials; // Stored credential references (e.g., OpenAI API key)
	promptDefaults?: Record<string, PromptRuleConfigShape | undefined>;
}

interface Workspace {
	path: string;
	isGitWorktree: boolean;
}

function ensureCliDefaultsStructure(config: ExtendedEdgeConfig): void {
	config.cliDefaults = config.cliDefaults || {};
	config.cliDefaults.claude = config.cliDefaults.claude || {};
	config.cliDefaults.codex = config.cliDefaults.codex || {};
}

function ensureCredentialsStructure(config: ExtendedEdgeConfig): void {
	config.credentials = config.credentials || {};
}

function applyDefaultCli(
	config: ExtendedEdgeConfig,
	target: RunnerType,
): { previous?: RunnerType; changed: boolean } {
	ensureCliDefaultsStructure(config);
	const previous = config.defaultCli;
	if (previous === target) {
		return { previous, changed: false };
	}
	config.defaultCli = target;
	return { previous, changed: true };
}

function applyDefaultModel(
	config: ExtendedEdgeConfig,
	cli: RunnerType,
	model: string,
): {
	previousModel?: string;
	changed: boolean;
} {
	ensureCliDefaultsStructure(config);
	const cliDefaultsMap = config.cliDefaults!;
	const cliDefaults = cliDefaultsMap[cli] as Record<string, any>;
	const previousModel = cliDefaults?.model;
	let changed = false;
	if (model && model !== previousModel) {
		cliDefaults.model = model;
		changed = true;
	}
	return { previousModel, changed };
}

function ensureRepositoryScaffold(repo: RepositoryConfig): void {
	repo.runner = repo.runner || "claude";
	repo.runnerModels = repo.runnerModels || {
		claude: {},
		codex: {},
	};
	repo.runnerModels.claude = repo.runnerModels.claude || {};
	repo.runnerModels.codex = repo.runnerModels.codex || {};
	repo.labelAgentRouting = repo.labelAgentRouting || [];
}

function copyLegacyModelDefaultsToCli(config: ExtendedEdgeConfig): void {
	if (!config.defaultModel && !config.defaultFallbackModel) {
		return;
	}
	ensureCliDefaultsStructure(config);
	const cliDefaultsMap = config.cliDefaults!;
	const claudeDefaults = cliDefaultsMap.claude as Record<string, any>;
	if (config.defaultModel && claudeDefaults.model === undefined) {
		claudeDefaults.model = config.defaultModel;
	}
	if (
		config.defaultFallbackModel &&
		claudeDefaults.fallbackModel === undefined
	) {
		claudeDefaults.fallbackModel = config.defaultFallbackModel;
	}
}

function getFlagValue(commandArgs: string[], name: string): string | undefined {
	const eqFlag = `--${name}=`;
	for (let i = 0; i < commandArgs.length; i += 1) {
		const arg = commandArgs[i];
		if (!arg) {
			continue;
		}
		if (arg.startsWith(eqFlag)) {
			return arg.slice(eqFlag.length);
		}
		if (arg === `--${name}`) {
			return commandArgs[i + 1];
		}
	}
	return undefined;
}

function hasFlag(commandArgs: string[], name: string): boolean {
	return commandArgs.some((arg) => {
		if (!arg) {
			return false;
		}
		return arg === `--${name}` || arg.startsWith(`--${name}=`);
	});
}

function removeFlagWithValue(commandArgs: string[], name: string): string[] {
	const result: string[] = [];
	for (let i = 0; i < commandArgs.length; i += 1) {
		const arg = commandArgs[i];
		if (!arg) {
			continue;
		}
		if (arg === `--${name}`) {
			i += 1;
			continue;
		}
		if (arg.startsWith(`--${name}=`)) {
			continue;
		}
		result.push(arg);
	}
	return result;
}

function splitCommaSeparated(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function detectUnknownFlags(
	argsToCheck: string[],
	options: { valueFlags: string[]; booleanFlags: string[] },
): string[] {
	let remaining = [...argsToCheck];
	for (const name of options.valueFlags) {
		remaining = removeFlagWithValue(remaining, name);
		remaining = remaining.filter((arg) => !arg.startsWith(`--${name}=`));
	}
	remaining = remaining.filter((arg) => {
		if (!arg) {
			return false;
		}
		if (!arg.startsWith("--")) {
			return false;
		}
		if (arg === "--help" || arg === "-h") {
			return false;
		}
		for (const name of options.booleanFlags) {
			if (arg === `--${name}`) {
				return false;
			}
			if (arg.startsWith(`--${name}=`)) {
				return false;
			}
		}
		return true;
	});
	return remaining;
}

function createPromptExecutionEnv(app: EdgeApp) {
	return {
		configPath: app.getEdgeConfigPath(),
		saveConfig: (config: PromptAwareConfig) =>
			app.saveEdgeConfig(config as EdgeConfig),
		ensurePromptsDirectory,
	};
}

async function confirmPromptPlan(
	app: EdgeApp,
	plan: PromptPlan,
	options: {
		yes: boolean;
		jsonOutput: boolean;
		requireExplicitConfirm?: boolean;
	},
): Promise<void> {
	const needsConfirmation =
		!options.yes &&
		(options.requireExplicitConfirm || plan.conflicts.length > 0);
	if (!needsConfirmation) {
		return;
	}

	if (options.jsonOutput) {
		throw new Error(
			"Confirmation required for this operation. Re-run with --yes to proceed.",
		);
	}

	const conflictMessage = plan.conflicts.length
		? `The following labels already map to other prompts: ${joinLabelConflicts(plan.conflicts)}\n`
		: "";
	const actionMessage =
		plan.action === "delete"
			? `This will delete the markdown file and configuration for "${plan.promptName}".\n`
			: "";
	const answer = await app.askQuestion(
		`${conflictMessage}${actionMessage}Proceed? (y/N): `,
	);
	if (!answer || !answer.toLowerCase().startsWith("y")) {
		console.log("Prompt command cancelled.");
		process.exit(0);
	}
}

function joinLabelConflicts(conflicts: LabelConflict[]): string {
	return conflicts
		.map((conflict) => {
			if (conflict.scope === "repository") {
				return `${conflict.label} → ${conflict.prompt} (repo ${conflict.repositoryId})`;
			}
			return `${conflict.label} → ${conflict.prompt} (global)`;
		})
		.join(", ");
}

function describePromptScope(prompt: PromptCommandResult["prompt"]): string {
	if (!prompt.repositoryId) {
		return "global";
	}
	const name = prompt.repositoryName
		? `${prompt.repositoryName} (${prompt.repositoryId})`
		: prompt.repositoryId;
	return `repository ${name}`;
}

function printPromptCommandResult(result: PromptCommandResult): void {
	const scopeLabel = describePromptScope(result.prompt);
	switch (result.action) {
		case "create":
			console.log(
				`✅ Created prompt "${result.prompt.name}" for ${scopeLabel}.`,
			);
			break;
		case "edit":
			console.log(
				`✅ Updated prompt "${result.prompt.name}" for ${scopeLabel}.`,
			);
			break;
		case "delete":
			console.log(
				`✅ Deleted prompt "${result.prompt.name}" from ${scopeLabel}.`,
			);
			break;
	}

	if (result.prompt.promptPath) {
		console.log(`  File: ${result.prompt.promptPath}`);
	}
	if (result.prompt.labels) {
		const labelList = result.prompt.labels.length
			? result.prompt.labels.join(", ")
			: "(none)";
		console.log(`  Labels: ${labelList}`);
	}
	if (result.action === "edit" && result.fileOperation === "none") {
		console.log("  Content unchanged (labels updated only).");
	}
	if (result.backupPath && !result.dryRun) {
		console.log(`  Backup saved to ${result.backupPath}`);
	}
	for (const warning of result.warnings) {
		console.log(`⚠️  ${warning}`);
	}
	if (result.conflicts.length > 0) {
		console.log(
			`⚠️  Label overlaps detected: ${joinLabelConflicts(result.conflicts)}`,
		);
	}
	if (result.dryRun) {
		console.log("ℹ️  Dry run: no changes were written.");
	}
}

function toError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	if (typeof value === "string") {
		return new Error(value);
	}
	try {
		return new Error(JSON.stringify(value));
	} catch (_error) {
		return new Error("Unknown error");
	}
}

function handlePromptCommandError(
	error: unknown,
	options: { jsonOutput: boolean },
): never {
	const normalized = toError(error);
	if (options.jsonOutput) {
		console.log(
			JSON.stringify(
				{
					status: "error",
					message: normalized.message,
				},
				null,
				2,
			),
		);
	} else {
		console.error(`Error: ${normalized.message}`);
	}
	process.exit(1);
}

function formatPromptLabels(labels: string[]): string {
	if (!labels || labels.length === 0) {
		return "(none)";
	}
	return labels.join(", ");
}

function printIndentedContent(content: string, indent = "    "): void {
	const trimmed = content.trimEnd();
	const lines = trimmed.split(/\r?\n/);
	for (const line of lines) {
		console.log(`${indent}${line}`);
	}
}

function printDefinitionSection(
	label: string,
	definitions: PromptDefinitionSummary[],
): void {
	if (definitions.length === 0) {
		return;
	}

	console.log(`${label}:\n`);
	for (const definition of definitions) {
		console.log(`  ${definition.prompt} [${definition.source}]`);
		if (definition.content) {
			console.log("    Content:");
			printIndentedContent(definition.content, "      ");
		} else {
			console.log("    Content: (not available)");
		}
		console.log("");
	}
}

function printPromptsHelp(): void {
	console.log(`
Usage: cyrus prompts <command>

Commands:
  list   List prompt-label mappings
  create Create a custom prompt definition
  edit   Update labels or content for a prompt
  delete Remove a custom prompt definition
  tui    Launch interactive prompt manager

Run 'cyrus prompts list --help' or 'cyrus prompts tui --help' for details.
`);
}

function printPromptsListHelp(): void {
	console.log(`
Usage: cyrus prompts list [--repo <id>] [--json]

Options:
  --repo <id>  Filter prompt mappings to a specific repository id
  --json       Output machine-readable JSON
`);
}

function printPromptsCreateHelp(): void {
	console.log(`
Usage: cyrus prompts create <name> --labels <label1,label2> [--repo <id>] [--from-file <path>] [--dry-run] [--json] [--yes]

Options:
  --labels <list>      Comma-separated labels to bind to the prompt (required)
  --repo <id>          Target repository id (omit for global defaults)
  --from-file <path>   Seed prompt content from an existing markdown file
  --dry-run            Preview changes without writing files or updating config
  --json               Emit machine-readable output
  --yes                Skip confirmation prompts
`);
}

function printPromptsEditHelp(): void {
	console.log(`
Usage: cyrus prompts edit <name> [--labels <label1,label2>] [--repo <id>] [--prompt-file <path>] [--dry-run] [--json] [--yes]

Options:
  --labels <list>        Replace the prompt's label bindings (comma-separated)
  --repo <id>            Target repository id (omit for global defaults)
  --prompt-file <path>   Replace prompt content with the contents of the given file (custom prompts only)
  --dry-run              Preview changes without writing files or updating config
  --json                 Emit machine-readable output
  --yes                  Skip confirmation prompts
`);
}

function printPromptsDeleteHelp(): void {
	console.log(`
Usage: cyrus prompts delete <name> [--repo <id>] [--dry-run] [--json] [--yes]

Options:
  --repo <id>  Target repository id (omit to delete a global prompt)
  --dry-run    Preview changes without writing files or updating config
  --json       Emit machine-readable output
  --yes        Skip confirmation prompts
`);
}

async function promptsTuiCommand(): Promise<void> {
	const app = new EdgeApp(CYRUS_HOME);
	const loadInventory = () => {
		const config = app.loadEdgeConfig();
		return summarizePromptMappings(config.repositories ?? [], {
			promptDefaults: config.promptDefaults,
		});
	};

	try {
		const { runPromptTui } = await import("./prompt-tui.js");
		await runPromptTui({
			loadInventory,
			loadConfig: () => app.loadEdgeConfig(),
			saveConfig: (config: PromptAwareConfig) =>
				app.saveEdgeConfig(config as EdgeConfig),
			configPath: app.getEdgeConfigPath(),
		});
	} catch (error) {
		console.error(
			"Failed to launch prompt manager TUI:",
			(error as Error).message,
		);
		process.exit(1);
	}
}

async function promptsListCommand(subArgs: string[]): Promise<void> {
	if (subArgs.includes("-h") || hasFlag(subArgs, "help")) {
		printPromptsListHelp();
		return;
	}

	const repoId = getFlagValue(subArgs, "repo");
	const jsonOutput = hasFlag(subArgs, "json");

	const argsWithoutRepo = removeFlagWithValue(subArgs, "repo");
	const cleanedArgs = argsWithoutRepo.filter((arg) => {
		if (!arg) {
			return false;
		}
		if (arg === "--help" || arg === "-h") {
			return false;
		}
		if (arg === "--json" || arg.startsWith("--json=")) {
			return false;
		}
		return true;
	});

	const positional = cleanedArgs.filter((arg) => !arg.startsWith("--"));
	if (positional.length > 0) {
		console.error(
			`Unexpected argument(s): ${positional.join(", ")}. Run 'cyrus prompts list --help' for usage info.`,
		);
		process.exit(1);
	}

	const unknownFlags = cleanedArgs.filter((arg) => arg.startsWith("--"));
	if (unknownFlags.length > 0) {
		console.error(
			`Unknown flag(s): ${unknownFlags.join(", ")}. Run 'cyrus prompts list --help' for usage info.`,
		);
		process.exit(1);
	}

	const app = new EdgeApp(CYRUS_HOME);
	const config = app.loadEdgeConfig();
	const repositories = config.repositories ?? [];

	if (repoId) {
		const repository = repositories.find((repo) => repo.id === repoId);
		if (!repository) {
			console.error(`Repository with id "${repoId}" was not found.`);
			process.exit(1);
		}
	}

	const inventory = summarizePromptMappings(repositories, {
		repoId,
		promptDefaults: config.promptDefaults,
	});
	const definitionsById = new Map(
		inventory.definitions.map((definition) => [definition.id, definition]),
	);

	if (jsonOutput) {
		console.log(
			JSON.stringify(
				{
					promptDefinitions: inventory.definitions,
					repositories: inventory.repositories,
				},
				null,
				2,
			),
		);
		return;
	}

	if (inventory.repositories.length === 0) {
		if (repositories.length === 0) {
			console.log(
				'No repositories configured. Add one with "cyrus add-repository" before managing prompts.',
			);
			return;
		}
		console.log("No prompt mappings found.");
		return;
	}

	console.log("\nPrompt mappings:\n");

	const globalDefinitions = inventory.definitions.filter(
		(definition) => definition.scope === "global",
	);
	printDefinitionSection("Global prompts", globalDefinitions);

	for (const summary of inventory.repositories) {
		const repoLabel = summary.repositoryName
			? `${summary.repositoryName} (${summary.repositoryId})`
			: summary.repositoryId;
		console.log(`Repository: ${repoLabel}`);
		for (const prompt of summary.prompts) {
			const labelList = formatPromptLabels(prompt.labels);
			const definition = definitionsById.get(prompt.definitionId);
			const scopeSuffix = definition?.scope === "global" ? " (shared)" : "";
			console.log(
				`  ${prompt.prompt} [${prompt.source}] labels: ${labelList}${scopeSuffix}`,
			);
			if (definition && definition.scope !== "global") {
				if (definition.content) {
					console.log("    Content:");
					printIndentedContent(definition.content, "      ");
				} else {
					console.log("    Content: (not available)");
				}
			}
		}
		console.log("");
	}
}

async function promptsCreateCommand(subArgs: string[]): Promise<void> {
	if (subArgs.includes("-h") || subArgs.includes("--help")) {
		printPromptsCreateHelp();
		return;
	}

	if (subArgs.length === 0) {
		console.error(
			"Prompt name is required. Run 'cyrus prompts create --help' for usage info.",
		);
		process.exit(1);
	}

	const [nameArg, ...flagArgs] = subArgs;
	if (!nameArg || nameArg.startsWith("--")) {
		console.error("Prompt name must be provided as the first argument.");
		process.exit(1);
	}

	const labelsValue = getFlagValue(flagArgs, "labels");
	if (!labelsValue) {
		console.error(
			"Missing required --labels option. Provide a comma-separated list of labels.",
		);
		process.exit(1);
	}

	const labels = splitCommaSeparated(labelsValue);
	if (labels.length === 0) {
		console.error("At least one label must be provided.");
		process.exit(1);
	}

	const repoId = getFlagValue(flagArgs, "repo");
	const fromFilePath = getFlagValue(flagArgs, "from-file");
	const dryRun = hasFlag(flagArgs, "dry-run");
	const jsonOutput = hasFlag(flagArgs, "json");
	const yes = hasFlag(flagArgs, "yes");

	const unknownFlags = detectUnknownFlags(flagArgs, {
		valueFlags: ["labels", "repo", "from-file"],
		booleanFlags: ["dry-run", "json", "yes"],
	});
	if (unknownFlags.length > 0) {
		console.error(
			`Unknown flag(s): ${unknownFlags.join(", ")}. Run 'cyrus prompts create --help' for usage info.`,
		);
		process.exit(1);
	}

	const app = new EdgeApp(CYRUS_HOME);
	const config = app.loadEdgeConfig();

	let plan: PromptPlan;
	try {
		plan = buildCreatePromptPlan(config, {
			name: nameArg,
			labels,
			repoId,
			fromFilePath,
		});
	} catch (error) {
		handlePromptCommandError(error, { jsonOutput });
	}

	try {
		await confirmPromptPlan(app, plan!, {
			yes,
			jsonOutput,
			requireExplicitConfirm: false,
		});
		const env = createPromptExecutionEnv(app);
		const result = applyPromptPlan(plan!, env, { dryRun });
		if (jsonOutput) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			printPromptCommandResult(result);
		}
	} catch (error) {
		handlePromptCommandError(error, { jsonOutput });
	}
}

async function promptsEditCommand(subArgs: string[]): Promise<void> {
	if (subArgs.includes("-h") || subArgs.includes("--help")) {
		printPromptsEditHelp();
		return;
	}

	if (subArgs.length === 0) {
		console.error(
			"Prompt name is required. Run 'cyrus prompts edit --help' for usage info.",
		);
		process.exit(1);
	}

	const [nameArg, ...flagArgs] = subArgs;
	if (!nameArg || nameArg.startsWith("--")) {
		console.error("Prompt name must be provided as the first argument.");
		process.exit(1);
	}

	const labelsValue = getFlagValue(flagArgs, "labels");
	const labels = labelsValue ? splitCommaSeparated(labelsValue) : undefined;
	if (labelsValue && labels && labels.length === 0) {
		console.error("When provided, --labels must contain at least one label.");
		process.exit(1);
	}

	const repoId = getFlagValue(flagArgs, "repo");
	const promptFilePath = getFlagValue(flagArgs, "prompt-file");
	const dryRun = hasFlag(flagArgs, "dry-run");
	const jsonOutput = hasFlag(flagArgs, "json");
	const yes = hasFlag(flagArgs, "yes");

	const unknownFlags = detectUnknownFlags(flagArgs, {
		valueFlags: ["labels", "repo", "prompt-file"],
		booleanFlags: ["dry-run", "json", "yes"],
	});
	if (unknownFlags.length > 0) {
		console.error(
			`Unknown flag(s): ${unknownFlags.join(", ")}. Run 'cyrus prompts edit --help' for usage info.`,
		);
		process.exit(1);
	}

	const app = new EdgeApp(CYRUS_HOME);
	const config = app.loadEdgeConfig();

	let plan: PromptPlan;
	try {
		plan = buildEditPromptPlan(config, {
			name: nameArg,
			labels,
			repoId,
			promptFilePath,
		});
	} catch (error) {
		handlePromptCommandError(error, { jsonOutput });
	}

	try {
		await confirmPromptPlan(app, plan!, {
			yes,
			jsonOutput,
			requireExplicitConfirm: false,
		});
		const env = createPromptExecutionEnv(app);
		const result = applyPromptPlan(plan!, env, { dryRun });
		if (jsonOutput) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			printPromptCommandResult(result);
		}
	} catch (error) {
		handlePromptCommandError(error, { jsonOutput });
	}
}

async function promptsDeleteCommand(subArgs: string[]): Promise<void> {
	if (subArgs.includes("-h") || subArgs.includes("--help")) {
		printPromptsDeleteHelp();
		return;
	}

	if (subArgs.length === 0) {
		console.error(
			"Prompt name is required. Run 'cyrus prompts delete --help' for usage info.",
		);
		process.exit(1);
	}

	const [nameArg, ...flagArgs] = subArgs;
	if (!nameArg || nameArg.startsWith("--")) {
		console.error("Prompt name must be provided as the first argument.");
		process.exit(1);
	}

	const repoId = getFlagValue(flagArgs, "repo");
	const dryRun = hasFlag(flagArgs, "dry-run");
	const jsonOutput = hasFlag(flagArgs, "json");
	const yes = hasFlag(flagArgs, "yes");

	const unknownFlags = detectUnknownFlags(flagArgs, {
		valueFlags: ["repo"],
		booleanFlags: ["dry-run", "json", "yes"],
	});
	if (unknownFlags.length > 0) {
		console.error(
			`Unknown flag(s): ${unknownFlags.join(", ")}. Run 'cyrus prompts delete --help' for usage info.`,
		);
		process.exit(1);
	}

	const app = new EdgeApp(CYRUS_HOME);
	const config = app.loadEdgeConfig();

	let plan: PromptPlan;
	try {
		plan = buildDeletePromptPlan(config, {
			name: nameArg,
			repoId,
		});
	} catch (error) {
		handlePromptCommandError(error, { jsonOutput });
	}

	try {
		await confirmPromptPlan(app, plan!, {
			yes,
			jsonOutput,
			requireExplicitConfirm: true,
		});
		const env = createPromptExecutionEnv(app);
		const result = applyPromptPlan(plan!, env, { dryRun });
		if (jsonOutput) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			printPromptCommandResult(result);
		}
	} catch (error) {
		handlePromptCommandError(error, { jsonOutput });
	}
}

async function promptsCommand(): Promise<void> {
	const subcommand = args[1];
	if (!subcommand || subcommand === "--help" || subcommand === "-h") {
		printPromptsHelp();
		return;
	}

	switch (subcommand) {
		case "list":
			await promptsListCommand(args.slice(2));
			break;

		case "create":
			await promptsCreateCommand(args.slice(2));
			break;

		case "edit":
			await promptsEditCommand(args.slice(2));
			break;

		case "delete":
			await promptsDeleteCommand(args.slice(2));
			break;

		case "tui":
			await promptsTuiCommand();
			break;
		default:
			console.error(`Unknown prompts subcommand: ${subcommand}`);
			printPromptsHelp();
			process.exit(1);
	}
}

function configRequiresCodex(config: ExtendedEdgeConfig): boolean {
	if (config.defaultCli === "codex") {
		return true;
	}
	return config.repositories.some((repo) => {
		if (repo.runner === "codex") {
			return true;
		}
		return (
			repo.labelAgentRouting?.some((rule) => rule.runner === "codex") ?? false
		);
	});
}

async function promptHiddenInput(prompt: string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});

	return await new Promise((resolve) => {
		const mutableRl = rl as readline.Interface & { stdoutMuted?: boolean } & {
			_writeToOutput?: (string: string) => void;
		};
		const originalWrite = mutableRl._writeToOutput?.bind(rl);
		const output = (
			rl as readline.Interface & {
				output?: NodeJS.WriteStream;
			}
		).output;
		mutableRl.stdoutMuted = true;
		mutableRl._writeToOutput = (stringToWrite: string) => {
			if (mutableRl.stdoutMuted) {
				output?.write("*");
			} else if (originalWrite) {
				originalWrite(stringToWrite);
			} else {
				output?.write(stringToWrite);
			}
		};

		rl.question(prompt, (answer) => {
			mutableRl.stdoutMuted = false;
			output?.write("\n");
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Edge application that uses EdgeWorker from package
 */
class EdgeApp {
	private edgeWorker: EdgeWorker | null = null;
	private isShuttingDown = false;
	private cyrusHome: string;

	constructor(cyrusHome: string) {
		this.cyrusHome = cyrusHome;
	}

	/**
	 * Get the edge configuration file path
	 */
	getEdgeConfigPath(): string {
		return resolve(this.cyrusHome, "config.json");
	}

	/**
	 * Get the legacy edge configuration file path (for migration)
	 */
	getLegacyEdgeConfigPath(): string {
		return resolve(process.cwd(), ".edge-config.json");
	}

	/**
	 * Migrate configuration from legacy location if needed
	 */
	private migrateConfigIfNeeded(): void {
		const newConfigPath = this.getEdgeConfigPath();
		const legacyConfigPath = this.getLegacyEdgeConfigPath();

		// If new config already exists, no migration needed
		if (existsSync(newConfigPath)) {
			return;
		}

		// If legacy config doesn't exist, no migration needed
		if (!existsSync(legacyConfigPath)) {
			return;
		}

		try {
			// Ensure the ~/.cyrus directory exists
			const configDir = dirname(newConfigPath);
			if (!existsSync(configDir)) {
				mkdirSync(configDir, { recursive: true });
			}

			// Copy the legacy config to the new location
			copyFileSync(legacyConfigPath, newConfigPath);

			console.log(
				`📦 Migrated configuration from ${legacyConfigPath} to ${newConfigPath}`,
			);
			console.log(
				`💡 You can safely remove the old ${legacyConfigPath} file if desired`,
			);
		} catch (error) {
			console.warn(
				`⚠️  Failed to migrate config from ${legacyConfigPath}:`,
				(error as Error).message,
			);
			console.warn(
				`   Please manually copy your configuration to ${newConfigPath}`,
			);
		}
	}

	/**
	 * Load edge configuration (credentials and repositories)
	 * Note: Strips promptTemplatePath from all repositories to ensure built-in template is used
	 */
	loadEdgeConfig(): ExtendedEdgeConfig {
		// Migrate from legacy location if needed
		this.migrateConfigIfNeeded();

		const edgeConfigPath = this.getEdgeConfigPath();
		let config: ExtendedEdgeConfig = { repositories: [] };

		if (existsSync(edgeConfigPath)) {
			try {
				config = JSON.parse(readFileSync(edgeConfigPath, "utf-8"));
			} catch (e) {
				console.error("Failed to load edge config:", (e as Error).message);
			}
		}

		// Strip promptTemplatePath from all repositories to ensure built-in template is used
		if (config.repositories) {
			config.repositories = config.repositories.map((repo) => {
				const { promptTemplatePath, ...repoWithoutTemplate } = repo;
				if (promptTemplatePath) {
					console.log(
						`Ignoring custom prompt template for repository: ${repo.name} (using built-in template)`,
					);
				}
				return repoWithoutTemplate;
			});
		}

		return config;
	}

	/**
	 * Save edge configuration
	 */
	saveEdgeConfig(config: ExtendedEdgeConfig): void {
		const edgeConfigPath = this.getEdgeConfigPath();
		const configDir = dirname(edgeConfigPath);

		// Ensure the ~/.cyrus directory exists
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true });
		}

		writeFileSync(edgeConfigPath, JSON.stringify(config, null, 2));
	}

	private ensureCliDefaultsBucket(
		config: ExtendedEdgeConfig,
		runner: RunnerType,
	): void {
		config.cliDefaults = config.cliDefaults || {};
		if (runner === "claude") {
			config.cliDefaults.claude = config.cliDefaults.claude || {};
		} else if (runner === "codex") {
			config.cliDefaults.codex = config.cliDefaults.codex || {};
		}
	}

	private async promptForDefaultCli(): Promise<RunnerType> {
		console.log("\n⚙️  Default CLI Configuration");
		console.log("─".repeat(50));
		console.log(
			"Select which CLI Cyrus should use by default when routing issues.",
		);
		console.log("1. Claude (Anthropic Claude Code)");
		console.log("2. Codex (OpenAI Codex CLI)");

		const choice = await this.askQuestion(
			"\nChoose default CLI [1-2] (default: 1): ",
		);

		if (choice === "2") {
			return "codex";
		}
		return "claude";
	}

	private copyLegacyModelDefaults(config: ExtendedEdgeConfig): void {
		if (!config.cliDefaults?.claude) {
			return;
		}
		if (config.defaultModel && config.cliDefaults.claude.model === undefined) {
			config.cliDefaults.claude.model = config.defaultModel;
		}
		if (
			config.defaultFallbackModel &&
			config.cliDefaults.claude.fallbackModel === undefined
		) {
			config.cliDefaults.claude.fallbackModel = config.defaultFallbackModel;
		}
	}

	private async ensureDefaultCliConfigured(
		config: ExtendedEdgeConfig,
	): Promise<void> {
		if (config.defaultCli) {
			this.ensureCliDefaultsBucket(config, config.defaultCli);
			if (config.defaultCli === "claude") {
				this.copyLegacyModelDefaults(config);
			}
			return;
		}

		const hasRepositories = (config.repositories?.length || 0) > 0;

		if (hasRepositories) {
			config.defaultCli = "claude";
			this.ensureCliDefaultsBucket(config, "claude");
			this.copyLegacyModelDefaults(config);
			this.saveEdgeConfig(config);
			console.log(
				"\nℹ️  Default CLI set to Claude for compatibility with existing configuration.",
			);
			return;
		}

		const selectedDefault = await this.promptForDefaultCli();
		config.defaultCli = selectedDefault;
		this.ensureCliDefaultsBucket(config, selectedDefault);
		if (selectedDefault === "claude") {
			this.copyLegacyModelDefaults(config);
		}
		this.saveEdgeConfig(config);
		console.log(
			`\n✅ Saved ${selectedDefault} as the global default CLI. You can change this later with "cyrus set-default-cli".`,
		);
	}

	/**
	 * Interactive setup wizard for repository configuration
	 */
	async setupRepositoryWizard(
		linearCredentials: LinearCredentials,
		rl?: readline.Interface,
	): Promise<RepositoryConfig> {
		const shouldCloseRl = !rl;
		if (!rl) {
			rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
		}

		const question = (prompt: string): Promise<string> =>
			new Promise((resolve) => {
				rl.question(prompt, resolve);
			});

		console.log("\n📁 Repository Setup");
		console.log("─".repeat(50));

		try {
			// Ask for repository details
			const repositoryPath =
				(await question(`Repository path (default: ${process.cwd()}): `)) ||
				process.cwd();
			const repositoryName =
				(await question(
					`Repository name (default: ${basename(repositoryPath)}): `,
				)) || basename(repositoryPath);
			const baseBranch =
				(await question("Base branch (default: main): ")) || "main";
			// Create a path-safe version of the repository name for namespacing
			const repoNameSafe = repositoryName
				.replace(/[^a-zA-Z0-9-_]/g, "-")
				.toLowerCase();
			const workspaceBaseDir = resolve(
				this.cyrusHome,
				"workspaces",
				repoNameSafe,
			);

			// Note: Prompt template is now hardcoded - no longer configurable

			// Set reasonable defaults for configuration
			// Allowed tools - default to the safe preset (read/write tools plus vetted git/gh commands)
			// Note: MCP tools (mcp__linear, mcp__cyrus-mcp-tools) are automatically added by EdgeWorker
			const allowedTools = [
				"Read(**)",
				"Edit(**)",
				"Task",
				"WebFetch",
				"WebSearch",
				"TodoRead",
				"TodoWrite",
				"NotebookRead",
				"NotebookEdit",
				"Batch",
				...SAFE_BASH_TOOL_ALLOWLIST,
			];

			// Label prompts - default to common label mappings
			const labelPrompts = {
				debugger: {
					labels: ["Bug"],
				},
				builder: {
					labels: ["Feature", "Improvement"],
				},
				scoper: {
					labels: ["PRD"],
				},
				orchestrator: {
					labels: ["Orchestrator"],
					allowedTools: "coordinator" as const, // Uses coordinator tools (all except file editing)
				},
			};

			if (shouldCloseRl) {
				rl.close();
			}

			// Create repository configuration
			const repository: RepositoryConfig = {
				id: `${linearCredentials.linearWorkspaceId}-${Date.now()}`,
				name: repositoryName,
				repositoryPath: resolve(repositoryPath),
				baseBranch,
				linearWorkspaceId: linearCredentials.linearWorkspaceId,
				linearToken: linearCredentials.linearToken,
				workspaceBaseDir: resolve(workspaceBaseDir),
				isActive: true,
				allowedTools,
				labelPrompts,
			};

			return repository;
		} catch (error) {
			if (shouldCloseRl) {
				rl.close();
			}
			throw error;
		}
	}

	/**
	 * Start OAuth flow to get Linear token using EdgeWorker's shared server
	 */
	async startOAuthFlow(proxyUrl: string): Promise<LinearCredentials> {
		if (this.edgeWorker) {
			// Use existing EdgeWorker's OAuth flow
			const port = this.edgeWorker.getServerPort();
			const callbackBaseUrl =
				process.env.CYRUS_BASE_URL || `http://localhost:${port}`;
			const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

			// Let SharedApplicationServer print the messages, but we handle browser opening
			const resultPromise = this.edgeWorker.startOAuthFlow(proxyUrl);

			// Open browser after SharedApplicationServer prints its messages
			open(authUrl).catch(() => {
				// Error is already communicated by SharedApplicationServer
			});

			return resultPromise;
		} else {
			// Create temporary SharedApplicationServer for OAuth flow during initial setup
			const serverPort = process.env.CYRUS_SERVER_PORT
				? parseInt(process.env.CYRUS_SERVER_PORT, 10)
				: 3456;
			const tempServer = new SharedApplicationServer(serverPort);

			try {
				// Start the server
				await tempServer.start();

				const port = tempServer.getPort();
				const callbackBaseUrl =
					process.env.CYRUS_BASE_URL || `http://localhost:${port}`;
				const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

				// Start OAuth flow (this prints the messages)
				const resultPromise = tempServer.startOAuthFlow(proxyUrl);

				// Open browser after SharedApplicationServer prints its messages
				open(authUrl).catch(() => {
					// Error is already communicated by SharedApplicationServer
				});

				// Wait for OAuth flow to complete
				const result = await resultPromise;

				return {
					linearToken: result.linearToken,
					linearWorkspaceId: result.linearWorkspaceId,
					linearWorkspaceName: result.linearWorkspaceName,
				};
			} finally {
				// Clean up temporary server
				await tempServer.stop();
			}
		}
	}

	/**
	 * Get ngrok auth token from config or prompt user
	 */
	async getNgrokAuthToken(
		config: ExtendedEdgeConfig,
	): Promise<string | undefined> {
		// Return existing token if available
		if (config.ngrokAuthToken) {
			return config.ngrokAuthToken;
		}

		// Skip ngrok setup if using external host
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		if (isExternalHost) {
			console.log(
				`\n📡 Using external host configuration (CYRUS_HOST_EXTERNAL=true)`,
			);
			console.log(
				`   Skipping ngrok setup - using ${process.env.CYRUS_BASE_URL || "configured base URL"}`,
			);
			return undefined;
		}

		// Prompt user for ngrok auth token
		console.log(`\n🔗 Ngrok Setup Required`);
		console.log(`─`.repeat(50));
		console.log(
			`Linear payloads need to reach your computer, so we use the secure technology ngrok for that.`,
		);
		console.log(`This requires a free ngrok account and auth token.`);
		console.log(``);
		console.log(`To get your ngrok auth token:`);
		console.log(`1. Sign up at https://ngrok.com/ (free)`);
		console.log(
			`2. Go to https://dashboard.ngrok.com/get-started/your-authtoken`,
		);
		console.log(`3. Copy your auth token`);
		console.log(``);
		console.log(
			`Alternatively, you can set CYRUS_HOST_EXTERNAL=true and CYRUS_BASE_URL`,
		);
		console.log(`to handle port forwarding or reverse proxy yourself.`);
		console.log(``);

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return new Promise((resolve) => {
			rl.question(
				`Enter your ngrok auth token (or press Enter to skip): `,
				async (token) => {
					rl.close();

					if (!token.trim()) {
						console.log(
							`\n⚠️  Skipping ngrok setup. You can set CYRUS_HOST_EXTERNAL=true and CYRUS_BASE_URL manually.`,
						);
						resolve(undefined);
						return;
					}

					// Save token to config
					config.ngrokAuthToken = token.trim();
					try {
						this.saveEdgeConfig(config);
						console.log(`✅ Ngrok auth token saved to config`);
						resolve(token.trim());
					} catch (error) {
						console.error(`❌ Failed to save ngrok auth token:`, error);
						resolve(token.trim()); // Still use the token for this session
					}
				},
			);
		});
	}

	/**
	 * Start the EdgeWorker with given configuration
	 */
	async startEdgeWorker({
		proxyUrl,
		repositories,
	}: {
		proxyUrl: string;
		repositories: RepositoryConfig[];
	}): Promise<void> {
		const storedConfig = this.loadEdgeConfig();
		// Get ngrok auth token (prompt if needed and not external host)
		let ngrokAuthToken: string | undefined;
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		if (!isExternalHost) {
			ngrokAuthToken = await this.getNgrokAuthToken(storedConfig);
		}

		// Create EdgeWorker configuration
		const config: EdgeWorkerConfig = {
			proxyUrl,
			repositories,
			cyrusHome: this.cyrusHome,
			defaultAllowedTools:
				process.env.ALLOWED_TOOLS?.split(",").map((t) => t.trim()) || [],
			defaultDisallowedTools:
				process.env.DISALLOWED_TOOLS?.split(",").map((t) => t.trim()) ||
				undefined,
			// Model configuration: environment variables take precedence over config file
			defaultModel:
				process.env.CYRUS_DEFAULT_MODEL || storedConfig.defaultModel,
			defaultFallbackModel:
				process.env.CYRUS_DEFAULT_FALLBACK_MODEL ||
				storedConfig.defaultFallbackModel,
			defaultCli: storedConfig.defaultCli,
			cliDefaults: storedConfig.cliDefaults,
			credentials: storedConfig.credentials,
			webhookBaseUrl: process.env.CYRUS_BASE_URL,
			serverPort: process.env.CYRUS_SERVER_PORT
				? parseInt(process.env.CYRUS_SERVER_PORT, 10)
				: 3456,
			serverHost: isExternalHost ? "0.0.0.0" : "localhost",
			ngrokAuthToken,
			features: {
				enableContinuation: true,
			},
			handlers: {
				createWorkspace: async (
					issue: Issue,
					repository: RepositoryConfig,
				): Promise<Workspace> => {
					return this.createGitWorktree(issue, repository);
				},
				onOAuthCallback: async (
					token: string,
					workspaceId: string,
					workspaceName: string,
				): Promise<void> => {
					const linearCredentials: LinearCredentials = {
						linearToken: token,
						linearWorkspaceId: workspaceId,
						linearWorkspaceName: workspaceName,
					};

					// Handle OAuth completion for repository setup
					if (this.edgeWorker) {
						console.log(
							"\n📋 Setting up new repository for workspace:",
							workspaceName,
						);
						console.log("─".repeat(50));

						try {
							const newRepo =
								await this.setupRepositoryWizard(linearCredentials);

							// Add to existing repositories
							const edgeConfig = this.loadEdgeConfig();
							console.log(
								`📊 Current config has ${
									edgeConfig.repositories?.length || 0
								} repositories`,
							);
							edgeConfig.repositories = [
								...(edgeConfig.repositories || []),
								newRepo,
							];
							console.log(
								`📊 Adding repository "${newRepo.name}", new total: ${edgeConfig.repositories.length}`,
							);
							this.saveEdgeConfig(edgeConfig);
							console.log("\n✅ Repository configured successfully!");
							console.log(
								"📝 ~/.cyrus/config.json file has been updated with your new repository configuration.",
							);
							console.log(
								"💡 You can edit this file and restart Cyrus at any time to modify settings.",
							);
							console.log(
								"📖 Configuration docs: https://github.com/ceedaragents/cyrus#configuration",
							);

							// Restart edge worker with new config
							await this.edgeWorker!.stop();
							this.edgeWorker = null;

							// Give a small delay to ensure file is written
							await new Promise((resolve) => setTimeout(resolve, 100));

							// Reload configuration and restart worker without going through setup
							const updatedConfig = this.loadEdgeConfig();
							console.log(
								`\n🔄 Reloading with ${
									updatedConfig.repositories?.length || 0
								} repositories from config file`,
							);

							return this.startEdgeWorker({
								proxyUrl,
								repositories: updatedConfig.repositories || [],
							});
						} catch (error) {
							console.error(
								"\n❌ Repository setup failed:",
								(error as Error).message,
							);
						}
					}
				},
			},
		};

		// Create and start EdgeWorker
		this.edgeWorker = new EdgeWorker(config);

		// Set config path for dynamic reloading
		const configPath = this.getEdgeConfigPath();
		this.edgeWorker.setConfigPath(configPath);

		// Set up event handlers
		this.setupEventHandlers();

		// Start the worker
		await this.edgeWorker.start();

		console.log("\n✅ Edge worker started successfully");
		console.log(`Configured proxy URL: ${config.proxyUrl}`);
		const defaultCli = config.defaultCli ?? "claude";
		console.log(`Runner defaults: ${defaultCli}`);
		console.log(`Managing ${repositories.length} repositories:`);
		repositories.forEach((repo) => {
			const runner = repo.runner ?? defaultCli;
			const labelRoutes = repo.labelAgentRouting?.length ?? 0;
			const routingNote =
				labelRoutes > 0 ? `, label routes: ${labelRoutes}` : "";
			console.log(
				`  - ${repo.name} (${repo.repositoryPath}) → runner: ${runner}${routingNote}`,
			);
		});
	}

	/**
	 * Check subscription status with the Cyrus API
	 */
	async checkSubscriptionStatus(customerId: string): Promise<{
		hasActiveSubscription: boolean;
		status: string;
		requiresPayment: boolean;
		isReturningCustomer?: boolean;
	}> {
		const response = await fetch(
			`https://www.atcyrus.com/api/subscription-status?customerId=${encodeURIComponent(customerId)}`,
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.ok) {
			if (response.status === 400) {
				const data = (await response.json()) as { error?: string };
				throw new Error(data.error || "Invalid customer ID format");
			}
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = (await response.json()) as {
			hasActiveSubscription: boolean;
			status: string;
			requiresPayment: boolean;
			isReturningCustomer?: boolean;
		};
		return data;
	}

	/**
	 * Validate customer ID format
	 */
	public validateCustomerId(customerId: string): void {
		if (!customerId.startsWith("cus_")) {
			console.error("\n❌ Invalid customer ID format");
			console.log('Customer IDs should start with "cus_"');
			process.exit(1);
		}
	}

	/**
	 * Handle subscription validation failure
	 */
	private handleSubscriptionFailure(subscriptionStatus: {
		hasActiveSubscription: boolean;
		status: string;
		requiresPayment: boolean;
		isReturningCustomer?: boolean;
	}): void {
		console.error("\n❌ Subscription Invalid");
		console.log("─".repeat(50));

		if (subscriptionStatus.isReturningCustomer) {
			console.log("Your subscription has expired or been cancelled.");
			console.log(`Status: ${subscriptionStatus.status}`);
			console.log(
				"\nPlease visit https://www.atcyrus.com/pricing to reactivate your subscription.",
			);
		} else {
			console.log("No active subscription found for this customer ID.");
			console.log(
				"\nPlease visit https://www.atcyrus.com/pricing to start a subscription.",
			);
			console.log("Once you obtain a valid customer ID,");
			console.log("Run: cyrus set-customer-id cus_XXXXX");
		}

		process.exit(1);
	}

	/**
	 * Validate subscription and handle failures
	 */
	public async validateAndHandleSubscription(
		customerId: string,
	): Promise<void> {
		console.log("\n🔐 Validating subscription...");
		try {
			const subscriptionStatus = await this.checkSubscriptionStatus(customerId);

			if (subscriptionStatus.requiresPayment) {
				this.handleSubscriptionFailure(subscriptionStatus);
			}

			console.log(`✅ Subscription active (${subscriptionStatus.status})`);
		} catch (error) {
			console.error("\n❌ Failed to validate subscription");
			console.log(`Error: ${(error as Error).message}`);
			console.log(
				'Run "cyrus set-customer-id cus_XXXXX" with a valid customer ID',
			);
			process.exit(1);
		}
	}

	/**
	 * Create readline interface and ask question
	 */
	public async askQuestion(prompt: string): Promise<string> {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return new Promise((resolve) => {
			rl.question(prompt, (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		});
	}

	/**
	 * Start the edge application
	 */
	async start(): Promise<void> {
		try {
			// Set proxy URL with default
			const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;

			// No need to validate Claude CLI - using Claude TypeScript SDK now

			// Load edge configuration
			let edgeConfig = this.loadEdgeConfig();
			await this.ensureDefaultCliConfigured(edgeConfig);
			let repositories = edgeConfig.repositories || [];

			// Check if using default proxy URL without a customer ID
			const isUsingDefaultProxy = proxyUrl === DEFAULT_PROXY_URL;
			const hasCustomerId = !!edgeConfig.stripeCustomerId;

			if (isUsingDefaultProxy && !hasCustomerId) {
				console.log("\n🎯 Pro Plan Required");
				console.log("─".repeat(50));
				console.log("You are using the default Cyrus proxy URL.");
				console.log("\nWith Cyrus Pro you get:");
				console.log("• No-hassle configuration");
				console.log("• Priority support");
				console.log("• Help fund product development");
				console.log("\nChoose an option:");
				console.log("1. Start a free trial");
				console.log("2. I have a customer ID to enter");
				console.log("3. Setup your own proxy (advanced)");
				console.log("4. Exit");

				const choice = await this.askQuestion("\nYour choice (1-4): ");

				if (choice === "1") {
					console.log("\n👉 Opening your browser to start a free trial...");
					console.log("Visit: https://www.atcyrus.com/pricing");
					await open("https://www.atcyrus.com/pricing");
					process.exit(0);
				} else if (choice === "2") {
					console.log(
						"\n📋 After completing payment, you'll see your customer ID on the success page.",
					);
					console.log(
						'It starts with "cus_" and can be copied from the website.',
					);

					const customerId = await this.askQuestion(
						"\nPaste your customer ID here: ",
					);

					this.validateCustomerId(customerId);
					edgeConfig.stripeCustomerId = customerId;
					this.saveEdgeConfig(edgeConfig);

					console.log("✅ Customer ID saved successfully!");
					console.log("Continuing with startup...\n");

					// Reload config to include the new customer ID
					edgeConfig = this.loadEdgeConfig();
				} else if (choice === "3") {
					console.log("\n🔧 Self-Hosted Proxy Setup");
					console.log("─".repeat(50));
					console.log(
						"Configure your own Linear app and proxy to have full control over your stack.",
					);
					console.log("\nDocumentation:");
					console.log(
						"• Linear OAuth setup: https://linear.app/developers/agents",
					);
					console.log(
						"• Proxy implementation: https://github.com/ceedaragents/cyrus/tree/main/apps/proxy-worker",
					);
					console.log(
						"\nOnce deployed, set the PROXY_URL environment variable:",
					);
					console.log("export PROXY_URL=https://your-proxy-url.com");
					process.exit(0);
				} else {
					console.log("\nExiting...");
					process.exit(0);
				}
			}

			// If using default proxy and has customer ID, validate subscription
			if (isUsingDefaultProxy && edgeConfig.stripeCustomerId) {
				try {
					await this.validateAndHandleSubscription(edgeConfig.stripeCustomerId);
				} catch (error) {
					console.error("\n⚠️ Warning: Could not validate subscription");
					console.log("─".repeat(50));
					console.error(
						"Unable to connect to subscription service:",
						(error as Error).message,
					);
					process.exit(1);
				}
			}

			// Check if we need to set up
			const needsSetup = repositories.length === 0;
			const hasLinearCredentials =
				repositories.some((r) => r.linearToken) ||
				process.env.LINEAR_OAUTH_TOKEN;

			if (needsSetup) {
				console.log("🚀 Welcome to Cyrus Edge Worker!");

				// Check if they want to use existing credentials or add new workspace
				let linearCredentials: LinearCredentials | null = null;

				if (hasLinearCredentials) {
					// Show available workspaces from existing repos
					const workspaces = new Map<
						string,
						{ id: string; name: string; token: string }
					>();
					for (const repo of edgeConfig.repositories || []) {
						if (!workspaces.has(repo.linearWorkspaceId)) {
							workspaces.set(repo.linearWorkspaceId, {
								id: repo.linearWorkspaceId,
								name: "Unknown Workspace",
								token: repo.linearToken,
							});
						}
					}

					if (workspaces.size === 1) {
						// Only one workspace, use it
						const ws = Array.from(workspaces.values())[0];
						if (ws) {
							linearCredentials = {
								linearToken: ws.token,
								linearWorkspaceId: ws.id,
								linearWorkspaceName: ws.name,
							};
							console.log(
								`\n📋 Using Linear workspace: ${linearCredentials.linearWorkspaceName}`,
							);
						}
					} else if (workspaces.size > 1) {
						// Multiple workspaces, let user choose
						console.log("\n📋 Available Linear workspaces:");
						const workspaceList = Array.from(workspaces.values());
						workspaceList.forEach((ws, i) => {
							console.log(`${i + 1}. ${ws.name}`);
						});

						const choice = await this.askQuestion(
							"\nSelect workspace (number) or press Enter for new: ",
						);

						const index = parseInt(choice, 10) - 1;
						if (index >= 0 && index < workspaceList.length) {
							const ws = workspaceList[index];
							if (ws) {
								linearCredentials = {
									linearToken: ws.token,
									linearWorkspaceId: ws.id,
									linearWorkspaceName: ws.name,
								};
								console.log(
									`Using workspace: ${linearCredentials.linearWorkspaceName}`,
								);
							}
						} else {
							// Get new credentials
							linearCredentials = null;
						}
					} else if (process.env.LINEAR_OAUTH_TOKEN) {
						// Use env vars
						linearCredentials = {
							linearToken: process.env.LINEAR_OAUTH_TOKEN,
							linearWorkspaceId: process.env.LINEAR_WORKSPACE_ID || "unknown",
							linearWorkspaceName: "Your Workspace",
						};
					}

					if (linearCredentials) {
						console.log(
							"(OAuth server will start with EdgeWorker to connect additional workspaces)",
						);
					}
				} else {
					// Get new Linear credentials
					console.log("\n📋 Step 1: Connect to Linear");
					console.log("─".repeat(50));

					try {
						linearCredentials = await this.startOAuthFlow(proxyUrl);
						console.log("\n✅ Linear connected successfully!");
					} catch (error) {
						console.error("\n❌ OAuth flow failed:", (error as Error).message);
						console.log("\nAlternatively, you can:");
						console.log(
							"1. Visit",
							`${proxyUrl}/oauth/authorize`,
							"in your browser",
						);
						console.log("2. Copy the token after authorization");
						console.log(
							"3. Add it to your .env.cyrus file as LINEAR_OAUTH_TOKEN",
						);
						process.exit(1);
					}
				}

				if (!linearCredentials) {
					console.error("❌ No Linear credentials available");
					process.exit(1);
				}

				// Now set up repository
				console.log("\n📋 Step 2: Configure Repository");
				console.log("─".repeat(50));

				// Create a single readline interface for the entire repository setup process
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});

				try {
					// Loop to allow adding multiple repositories
					let continueAdding = true;
					while (continueAdding) {
						try {
							const newRepo = await this.setupRepositoryWizard(
								linearCredentials,
								rl,
							);

							// Add to repositories
							repositories = [...(edgeConfig.repositories || []), newRepo];
							edgeConfig.repositories = repositories;
							this.saveEdgeConfig(edgeConfig);

							console.log("\n✅ Repository configured successfully!");
							console.log(
								"📝 ~/.cyrus/config.json file has been updated with your repository configuration.",
							);
							console.log(
								"💡 You can edit this file and restart Cyrus at any time to modify settings.",
							);
							console.log(
								"📖 Configuration docs: https://github.com/ceedaragents/cyrus#configuration",
							);

							// Ask if they want to add another
							const addAnother = await new Promise<boolean>((resolve) => {
								rl.question("\nAdd another repository? (y/N): ", (answer) => {
									resolve(answer.toLowerCase() === "y");
								});
							});

							continueAdding = addAnother;
							if (continueAdding) {
								console.log("\n📋 Configure Additional Repository");
								console.log("─".repeat(50));
							}
						} catch (error) {
							console.error(
								"\n❌ Repository setup failed:",
								(error as Error).message,
							);
							throw error;
						}
					}
				} finally {
					// Always close the readline interface when done
					rl.close();
				}
			}

			// Validate we have repositories
			if (repositories.length === 0) {
				console.error("❌ No repositories configured");
				console.log(
					"\nUse the authorization link above to configure your first repository.",
				);
				process.exit(1);
			}

			// Start the edge worker
			await this.startEdgeWorker({ proxyUrl, repositories });

			// Display plan status
			const isUsingDefaultProxyForStatus = proxyUrl === DEFAULT_PROXY_URL;
			const hasCustomerIdForStatus = !!edgeConfig.stripeCustomerId;

			console.log(`\n${"─".repeat(70)}`);
			if (isUsingDefaultProxyForStatus && hasCustomerIdForStatus) {
				console.log("💎 Plan: Cyrus Pro");
				console.log(`📋 Customer ID: ${edgeConfig.stripeCustomerId}`);
				console.log('💳 Manage subscription: Run "cyrus billing"');
			} else if (!isUsingDefaultProxyForStatus) {
				console.log("🛠️  Plan: Community (Self-hosted proxy)");
				console.log(`🔗 Proxy URL: ${proxyUrl}`);
			}
			console.log("─".repeat(70));

			// Display OAuth information after EdgeWorker is started
			const serverPort = this.edgeWorker?.getServerPort() || 3456;
			const oauthCallbackBaseUrl =
				process.env.CYRUS_BASE_URL || `http://localhost:${serverPort}`;
			console.log(`\n🔐 OAuth server running on port ${serverPort}`);
			console.log(`👉 To authorize Linear (new workspace or re-auth):`);
			console.log(
				`   ${proxyUrl}/oauth/authorize?callback=${oauthCallbackBaseUrl}/callback`,
			);
			console.log("─".repeat(70));

			// Handle graceful shutdown
			process.on("SIGINT", () => this.shutdown());
			process.on("SIGTERM", () => this.shutdown());

			// Handle uncaught exceptions and unhandled promise rejections
			process.on("uncaughtException", (error) => {
				console.error("🚨 Uncaught Exception:", error.message);
				console.error("Error type:", error.constructor.name);
				console.error("Stack:", error.stack);
				console.error(
					"This error was caught by the global handler, preventing application crash",
				);

				// Attempt graceful shutdown but don't wait indefinitely
				this.shutdown().finally(() => {
					console.error("Process exiting due to uncaught exception");
					process.exit(1);
				});
			});

			process.on("unhandledRejection", (reason, promise) => {
				console.error("🚨 Unhandled Promise Rejection at:", promise);
				console.error("Reason:", reason);
				console.error(
					"This rejection was caught by the global handler, continuing operation",
				);

				// Log stack trace if reason is an Error
				if (reason instanceof Error && reason.stack) {
					console.error("Stack:", reason.stack);
				}

				// Log the error but don't exit the process for promise rejections
				// as they might be recoverable
			});
		} catch (error: any) {
			console.error("\n❌ Failed to start edge application:", error.message);

			// Provide more specific guidance for common errors
			if (error.message?.includes("Failed to connect any repositories")) {
				console.error("\n💡 This usually happens when:");
				console.error("   - All Linear OAuth tokens have expired");
				console.error("   - The Linear API is temporarily unavailable");
				console.error("   - Your network connection is having issues");
				console.error("\nPlease check your edge configuration and try again.");
			}

			await this.shutdown();
			process.exit(1);
		}
	}

	/**
	 * Check if a branch exists locally or remotely
	 */
	async branchExists(branchName: string, repoPath: string): Promise<boolean> {
		const { execSync } = await import("node:child_process");

		try {
			// Check if branch exists locally
			execSync(`git rev-parse --verify "${branchName}"`, {
				cwd: repoPath,
				stdio: "pipe",
			});
			return true;
		} catch {
			// Branch doesn't exist locally, check remote
			try {
				const remoteOutput = execSync(
					`git ls-remote --heads origin "${branchName}"`,
					{
						cwd: repoPath,
						stdio: "pipe",
					},
				);
				// Check if output is non-empty (branch actually exists on remote)
				return remoteOutput && remoteOutput.toString().trim().length > 0;
			} catch {
				return false;
			}
		}
	}

	/**
	 * Set up event handlers for EdgeWorker
	 */
	setupEventHandlers(): void {
		if (!this.edgeWorker) return;

		// Session events
		this.edgeWorker.on(
			"session:started",
			(issueId: string, _issue: Issue, repositoryId: string) => {
				console.log(
					`Started session for issue ${issueId} in repository ${repositoryId}`,
				);
			},
		);

		this.edgeWorker.on(
			"session:ended",
			(issueId: string, exitCode: number | null, repositoryId: string) => {
				console.log(
					`Session for issue ${issueId} ended with exit code ${exitCode} in repository ${repositoryId}`,
				);
			},
		);

		// Connection events
		this.edgeWorker.on("connected", (token: string) => {
			console.log(
				`✅ Connected to proxy with token ending in ...${token.slice(-4)}`,
			);
		});

		this.edgeWorker.on("disconnected", (token: string, reason?: string) => {
			console.error(
				`❌ Disconnected from proxy (token ...${token.slice(-4)}): ${
					reason || "Unknown reason"
				}`,
			);
		});

		// Error events
		this.edgeWorker.on("error", (error: Error) => {
			console.error("EdgeWorker error:", error);
		});
	}

	/**
	 * Run a setup script with proper error handling and logging
	 */
	private async runSetupScript(
		scriptPath: string,
		scriptType: "global" | "repository",
		workspacePath: string,
		issue: Issue,
	): Promise<void> {
		const { execSync } = await import("node:child_process");
		const { existsSync, statSync } = await import("node:fs");
		const { basename } = await import("node:path");
		const os = await import("node:os");

		// Expand ~ to home directory
		const expandedPath = scriptPath.replace(/^~/, os.homedir());

		// Check if script exists
		if (!existsSync(expandedPath)) {
			console.warn(
				`⚠️  ${scriptType === "global" ? "Global" : "Repository"} setup script not found: ${scriptPath}`,
			);
			return;
		}

		// Check if script is executable (Unix only)
		if (process.platform !== "win32") {
			try {
				const stats = statSync(expandedPath);
				// Check if file has execute permission for the owner
				if (!(stats.mode & 0o100)) {
					console.warn(
						`⚠️  ${scriptType === "global" ? "Global" : "Repository"} setup script is not executable: ${scriptPath}`,
					);
					console.warn(`   Run: chmod +x "${expandedPath}"`);
					return;
				}
			} catch (error) {
				console.warn(
					`⚠️  Cannot check permissions for ${scriptType} setup script: ${(error as Error).message}`,
				);
				return;
			}
		}

		const scriptName = basename(expandedPath);
		console.log(`ℹ️  Running ${scriptType} setup script: ${scriptName}`);

		try {
			// Determine the command based on the script extension and platform
			let command: string;
			const isWindows = process.platform === "win32";

			if (scriptPath.endsWith(".ps1")) {
				command = `powershell -ExecutionPolicy Bypass -File "${expandedPath}"`;
			} else if (scriptPath.endsWith(".cmd") || scriptPath.endsWith(".bat")) {
				command = `"${expandedPath}"`;
			} else if (isWindows) {
				// On Windows, try to run with bash if available (Git Bash/WSL)
				command = `bash "${expandedPath}"`;
			} else {
				// On Unix, run directly with bash
				command = `bash "${expandedPath}"`;
			}

			execSync(command, {
				cwd: workspacePath,
				stdio: "inherit",
				env: {
					...process.env,
					LINEAR_ISSUE_ID: issue.id,
					LINEAR_ISSUE_IDENTIFIER: issue.identifier,
					LINEAR_ISSUE_TITLE: issue.title || "",
				},
				timeout: 5 * 60 * 1000, // 5 minute timeout
			});

			console.log(
				`✅ ${scriptType === "global" ? "Global" : "Repository"} setup script completed successfully`,
			);
		} catch (error) {
			const errorMessage =
				(error as any).signal === "SIGTERM"
					? "Script execution timed out (exceeded 5 minutes)"
					: (error as Error).message;

			console.error(
				`❌ ${scriptType === "global" ? "Global" : "Repository"} setup script failed: ${errorMessage}`,
			);

			// Log stderr if available
			if ((error as any).stderr) {
				console.error("   stderr:", (error as any).stderr.toString());
			}

			// Continue execution despite setup script failure
			console.log(`   Continuing with worktree creation...`);
		}
	}

	/**
	 * Create a git worktree for an issue
	 */
	async createGitWorktree(
		issue: Issue,
		repository: RepositoryConfig,
	): Promise<Workspace> {
		const { execSync } = await import("node:child_process");
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");

		try {
			// Verify this is a git repository
			try {
				execSync("git rev-parse --git-dir", {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
			} catch (_e) {
				console.error(`${repository.repositoryPath} is not a git repository`);
				throw new Error("Not a git repository");
			}

			// Sanitize branch name by removing backticks to prevent command injection
			const sanitizeBranchName = (name: string): string =>
				name ? name.replace(/`/g, "") : name;

			// Use Linear's preferred branch name, or generate one if not available
			const rawBranchName =
				issue.branchName ||
				`${issue.identifier}-${issue.title
					?.toLowerCase()
					.replace(/\s+/g, "-")
					.substring(0, 30)}`;
			const branchName = sanitizeBranchName(rawBranchName);
			const workspacePath = join(repository.workspaceBaseDir, issue.identifier);

			// Ensure workspace directory exists
			mkdirSync(repository.workspaceBaseDir, { recursive: true });

			// Check if worktree already exists
			try {
				const worktrees = execSync("git worktree list --porcelain", {
					cwd: repository.repositoryPath,
					encoding: "utf-8",
				});

				if (worktrees.includes(workspacePath)) {
					console.log(
						`Worktree already exists at ${workspacePath}, using existing`,
					);
					return {
						path: workspacePath,
						isGitWorktree: true,
					};
				}
			} catch (_e) {
				// git worktree command failed, continue with creation
			}

			// Check if branch already exists
			let createBranch = true;
			try {
				execSync(`git rev-parse --verify "${branchName}"`, {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
				createBranch = false;
			} catch (_e) {
				// Branch doesn't exist, we'll create it
			}

			// Determine base branch for this issue
			let baseBranch = repository.baseBranch;

			// Check if issue has a parent
			try {
				const parent = await (issue as any).parent;
				if (parent) {
					console.log(
						`Issue ${issue.identifier} has parent: ${parent.identifier}`,
					);

					// Get parent's branch name
					const parentRawBranchName =
						parent.branchName ||
						`${parent.identifier}-${parent.title
							?.toLowerCase()
							.replace(/\s+/g, "-")
							.substring(0, 30)}`;
					const parentBranchName = sanitizeBranchName(parentRawBranchName);

					// Check if parent branch exists
					const parentBranchExists = await this.branchExists(
						parentBranchName,
						repository.repositoryPath,
					);

					if (parentBranchExists) {
						baseBranch = parentBranchName;
						console.log(
							`Using parent issue branch '${parentBranchName}' as base for sub-issue ${issue.identifier}`,
						);
					} else {
						console.log(
							`Parent branch '${parentBranchName}' not found, using default base branch '${repository.baseBranch}'`,
						);
					}
				}
			} catch (_error) {
				// Parent field might not exist or couldn't be fetched, use default base branch
				console.log(
					`No parent issue found for ${issue.identifier}, using default base branch '${repository.baseBranch}'`,
				);
			}

			// Fetch latest changes from remote
			console.log("Fetching latest changes from remote...");
			let hasRemote = true;
			try {
				execSync("git fetch origin", {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
			} catch (e) {
				console.warn(
					"Warning: git fetch failed, proceeding with local branch:",
					(e as Error).message,
				);
				hasRemote = false;
			}

			// Create the worktree - use determined base branch
			let worktreeCmd: string;
			if (createBranch) {
				if (hasRemote) {
					// Check if the base branch exists remotely
					let useRemoteBranch = false;
					try {
						const remoteOutput = execSync(
							`git ls-remote --heads origin "${baseBranch}"`,
							{
								cwd: repository.repositoryPath,
								stdio: "pipe",
							},
						);
						// Check if output is non-empty (branch actually exists on remote)
						useRemoteBranch =
							remoteOutput && remoteOutput.toString().trim().length > 0;
						if (!useRemoteBranch) {
							console.log(
								`Base branch '${baseBranch}' not found on remote, checking locally...`,
							);
						}
					} catch {
						// Base branch doesn't exist remotely, use local or fall back to default
						console.log(
							`Base branch '${baseBranch}' not found on remote, checking locally...`,
						);
					}

					if (useRemoteBranch) {
						// Use remote version of base branch
						const remoteBranch = `origin/${baseBranch}`;
						console.log(
							`Creating git worktree at ${workspacePath} from ${remoteBranch}`,
						);
						worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${remoteBranch}"`;
					} else {
						// Check if base branch exists locally
						try {
							execSync(`git rev-parse --verify "${baseBranch}"`, {
								cwd: repository.repositoryPath,
								stdio: "pipe",
							});
							// Use local base branch
							console.log(
								`Creating git worktree at ${workspacePath} from local ${baseBranch}`,
							);
							worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${baseBranch}"`;
						} catch {
							// Base branch doesn't exist locally either, fall back to remote default
							console.log(
								`Base branch '${baseBranch}' not found locally, falling back to remote ${repository.baseBranch}`,
							);
							const defaultRemoteBranch = `origin/${repository.baseBranch}`;
							worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${defaultRemoteBranch}"`;
						}
					}
				} else {
					// No remote, use local branch
					console.log(
						`Creating git worktree at ${workspacePath} from local ${baseBranch}`,
					);
					worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${baseBranch}"`;
				}
			} else {
				// Branch already exists, just check it out
				console.log(
					`Creating git worktree at ${workspacePath} with existing branch ${branchName}`,
				);
				worktreeCmd = `git worktree add "${workspacePath}" "${branchName}"`;
			}

			execSync(worktreeCmd, {
				cwd: repository.repositoryPath,
				stdio: "pipe",
			});

			// First, run the global setup script if configured
			const config = this.loadEdgeConfig();
			if (config.global_setup_script) {
				await this.runSetupScript(
					config.global_setup_script,
					"global",
					workspacePath,
					issue,
				);
			}

			// Then, check for repository setup scripts (cross-platform)
			const isWindows = process.platform === "win32";
			const setupScripts = [
				{
					file: "cyrus-setup.sh",
					platform: "unix",
				},
				{
					file: "cyrus-setup.ps1",
					platform: "windows",
				},
				{
					file: "cyrus-setup.cmd",
					platform: "windows",
				},
				{
					file: "cyrus-setup.bat",
					platform: "windows",
				},
			];

			// Find the first available setup script for the current platform
			const availableScript = setupScripts.find((script) => {
				const scriptPath = join(repository.repositoryPath, script.file);
				const isCompatible = isWindows
					? script.platform === "windows"
					: script.platform === "unix";
				return existsSync(scriptPath) && isCompatible;
			});

			// Fallback: on Windows, try bash if no Windows scripts found (for Git Bash/WSL users)
			const fallbackScript =
				!availableScript && isWindows
					? setupScripts.find((script) => {
							const scriptPath = join(repository.repositoryPath, script.file);
							return script.platform === "unix" && existsSync(scriptPath);
						})
					: null;

			const scriptToRun = availableScript || fallbackScript;

			if (scriptToRun) {
				const scriptPath = join(repository.repositoryPath, scriptToRun.file);
				await this.runSetupScript(
					scriptPath,
					"repository",
					workspacePath,
					issue,
				);
			}

			return {
				path: workspacePath,
				isGitWorktree: true,
			};
		} catch (error) {
			console.error("Failed to create git worktree:", (error as Error).message);
			// Fall back to regular directory if git worktree fails
			const fallbackPath = join(repository.workspaceBaseDir, issue.identifier);
			mkdirSync(fallbackPath, { recursive: true });
			return {
				path: fallbackPath,
				isGitWorktree: false,
			};
		}
	}

	/**
	 * Shut down the application
	 */
	async shutdown(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		console.log("\nShutting down edge worker...");

		// Stop edge worker (includes stopping shared application server)
		if (this.edgeWorker) {
			await this.edgeWorker.stop();
		}

		console.log("Shutdown complete");
		process.exit(0);
	}
}

// Helper function to check Linear token status
async function checkLinearToken(
	token: string,
): Promise<{ valid: boolean; error?: string }> {
	try {
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: token,
			},
			body: JSON.stringify({
				query: "{ viewer { id email name } }",
			}),
		});

		const data = (await response.json()) as any;

		if (data.errors) {
			return {
				valid: false,
				error: data.errors[0]?.message || "Unknown error",
			};
		}

		return { valid: true };
	} catch (error) {
		return { valid: false, error: (error as Error).message };
	}
}

// Command: check-tokens
async function checkTokensCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	if (!existsSync(configPath)) {
		console.error("No edge configuration found. Please run setup first.");
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(configPath, "utf-8")) as EdgeConfig;

	console.log("Checking Linear tokens...\n");

	for (const repo of config.repositories) {
		process.stdout.write(`${repo.name} (${repo.linearWorkspaceName}): `);
		const result = await checkLinearToken(repo.linearToken);

		if (result.valid) {
			console.log("✅ Valid");
		} else {
			console.log(`❌ Invalid - ${result.error}`);
		}
	}
}

// Command: refresh-token
async function refreshTokenCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	if (!existsSync(configPath)) {
		console.error("No edge configuration found. Please run setup first.");
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(configPath, "utf-8")) as EdgeConfig;

	// Show repositories with their token status
	console.log("Checking current token status...\n");
	const tokenStatuses: Array<{ repo: RepositoryConfig; valid: boolean }> = [];

	for (const repo of config.repositories) {
		const result = await checkLinearToken(repo.linearToken);
		tokenStatuses.push({ repo, valid: result.valid });
		console.log(
			`${tokenStatuses.length}. ${repo.name} (${repo.linearWorkspaceName}): ${
				result.valid ? "✅ Valid" : "❌ Invalid"
			}`,
		);
	}

	// Ask which token to refresh
	const answer = await app.askQuestion(
		'\nWhich repository token would you like to refresh? (Enter number or "all"): ',
	);

	const indicesToRefresh: number[] = [];

	if (answer.toLowerCase() === "all") {
		indicesToRefresh.push(
			...Array.from({ length: tokenStatuses.length }, (_, i) => i),
		);
	} else {
		const index = parseInt(answer, 10) - 1;
		if (Number.isNaN(index) || index < 0 || index >= tokenStatuses.length) {
			console.error("Invalid selection");
			process.exit(1);
		}
		indicesToRefresh.push(index);
	}

	// Refresh tokens
	for (const index of indicesToRefresh) {
		const tokenStatus = tokenStatuses[index];
		if (!tokenStatus) continue;

		const { repo } = tokenStatus;
		console.log(
			`\nRefreshing token for ${repo.name} (${
				repo.linearWorkspaceName || repo.linearWorkspaceId
			})...`,
		);
		console.log("Opening Linear OAuth flow in your browser...");

		// Use the proxy's OAuth flow with a callback to localhost
		const serverPort = process.env.CYRUS_SERVER_PORT
			? parseInt(process.env.CYRUS_SERVER_PORT, 10)
			: 3456;
		const callbackUrl = `http://localhost:${serverPort}/callback`;
		const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;
		const oauthUrl = `${proxyUrl}/oauth/authorize?callback=${encodeURIComponent(
			callbackUrl,
		)}`;

		console.log(`\nPlease complete the OAuth flow in your browser.`);
		console.log(
			`If the browser doesn't open automatically, visit:\n${oauthUrl}\n`,
		);

		// Start a temporary server to receive the OAuth callback
		let tokenReceived: string | null = null;

		const server = await new Promise<any>((resolve) => {
			const s = http.createServer((req: any, res: any) => {
				if (req.url?.startsWith("/callback")) {
					const url = new URL(req.url, `http://localhost:${serverPort}`);
					tokenReceived = url.searchParams.get("token");

					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(`
            <html>
              <head>
                <meta charset="UTF-8">
              </head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h2>✅ Authorization successful!</h2>
                <p>You can close this window and return to your terminal.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);
				} else {
					res.writeHead(404);
					res.end("Not found");
				}
			});
			s.listen(serverPort, () => {
				console.log("Waiting for OAuth callback...");
				resolve(s);
			});
		});

		await open(oauthUrl);

		// Wait for the token with timeout
		const startTime = Date.now();
		while (!tokenReceived && Date.now() - startTime < 120000) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		server.close();

		const newToken = tokenReceived;

		if (!newToken || !(newToken as string).startsWith("lin_oauth_")) {
			console.error("Invalid token received from OAuth flow");
			continue;
		}

		// Verify the new token
		const verifyResult = await checkLinearToken(newToken);
		if (!verifyResult.valid) {
			console.error(`❌ New token is invalid: ${verifyResult.error}`);
			continue;
		}

		// Update the config - update ALL repositories that had the same old token
		const oldToken = repo.linearToken;
		let updatedCount = 0;

		for (let i = 0; i < config.repositories.length; i++) {
			const currentRepo = config.repositories[i];
			if (currentRepo && currentRepo.linearToken === oldToken) {
				currentRepo.linearToken = newToken;
				updatedCount++;
				console.log(`✅ Updated token for ${currentRepo.name}`);
			}
		}

		if (updatedCount > 1) {
			console.log(
				`\n📝 Updated ${updatedCount} repositories that shared the same token`,
			);
		}
	}

	// Save the updated config
	writeFileSync(configPath, JSON.stringify(config, null, 2));
	console.log("\n✅ Configuration saved");
}

// Command: add-repository
async function addRepositoryCommand() {
	const app = new EdgeApp(CYRUS_HOME);

	console.log("📋 Add New Repository");
	console.log("─".repeat(50));
	console.log();

	try {
		// Load existing configuration
		const config = app.loadEdgeConfig();

		// Check if we have any Linear credentials
		const existingRepos = config.repositories || [];
		let linearCredentials: LinearCredentials | null = null;

		if (existingRepos.length > 0) {
			// Try to get credentials from existing repositories
			const repoWithToken = existingRepos.find((r) => r.linearToken);
			if (repoWithToken) {
				linearCredentials = {
					linearToken: repoWithToken.linearToken,
					linearWorkspaceId: repoWithToken.linearWorkspaceId,
					linearWorkspaceName:
						repoWithToken.linearWorkspaceName || "Your Workspace",
				};
				console.log(`✅ Using Linear credentials from existing configuration`);
				console.log(`   Workspace: ${linearCredentials.linearWorkspaceName}`);
			}
		}

		// If no credentials found, run OAuth flow
		if (!linearCredentials) {
			console.log("🔐 No Linear credentials found. Starting OAuth flow...");

			// Start OAuth flow using the default proxy URL
			const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;
			linearCredentials = await app.startOAuthFlow(proxyUrl);

			if (!linearCredentials) {
				throw new Error("OAuth flow cancelled or failed");
			}
		}

		// Now set up the new repository
		console.log("\n📂 Configure New Repository");
		console.log("─".repeat(50));

		const newRepo = await app.setupRepositoryWizard(linearCredentials);

		// Add to existing repositories
		config.repositories = [...existingRepos, newRepo];

		// Save the updated configuration
		app.saveEdgeConfig(config);

		console.log("\n✅ Repository added successfully!");
		console.log(`📁 Repository: ${newRepo.name}`);
		console.log(`🔗 Path: ${newRepo.repositoryPath}`);
		console.log(`🌿 Base branch: ${newRepo.baseBranch}`);
		console.log(`📂 Workspace directory: ${newRepo.workspaceBaseDir}`);
	} catch (error) {
		console.error("\n❌ Failed to add repository:", error);
		throw error;
	}
}

// Command: set-customer-id
async function setCustomerIdCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	// Get customer ID from command line args
	const customerId = args[1];

	if (!customerId) {
		console.error("Please provide a customer ID");
		console.log("Usage: cyrus set-customer-id cus_XXXXX");
		process.exit(1);
	}

	app.validateCustomerId(customerId);

	try {
		// Check if using default proxy
		const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;
		const isUsingDefaultProxy = proxyUrl === DEFAULT_PROXY_URL;

		// Validate subscription for default proxy users
		if (isUsingDefaultProxy) {
			await app.validateAndHandleSubscription(customerId);
		}

		// Load existing config or create new one
		let config: ExtendedEdgeConfig = { repositories: [] };

		if (existsSync(configPath)) {
			config = JSON.parse(readFileSync(configPath, "utf-8"));
		}

		// Update customer ID
		config.stripeCustomerId = customerId;

		// Save config
		app.saveEdgeConfig(config);

		console.log("\n✅ Customer ID saved successfully!");
		console.log("─".repeat(50));
		console.log(`Customer ID: ${customerId}`);
		if (isUsingDefaultProxy) {
			console.log("\nYou now have access to Cyrus Pro features.");
		}
		console.log('Run "cyrus" to start the edge worker.');
	} catch (error) {
		console.error("Failed to save customer ID:", (error as Error).message);
		process.exit(1);
	}
}

// Command: billing
async function billingCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	if (!existsSync(configPath)) {
		console.error(
			'No configuration found. Please run "cyrus" to set up first.',
		);
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(configPath, "utf-8")) as EdgeConfig;

	if (!config.stripeCustomerId) {
		console.log("\n🎯 No Pro Plan Active");
		console.log("─".repeat(50));
		console.log("You don't have an active subscription.");
		console.log("Please start a free trial at:");
		console.log("\n  https://www.atcyrus.com/pricing\n");
		console.log(
			"After signing up, your customer ID will be saved automatically.",
		);
		process.exit(0);
	}

	console.log("\n🌐 Opening Billing Portal...");
	console.log("─".repeat(50));

	try {
		// Open atcyrus.com with the customer ID to handle Stripe redirect
		const billingUrl = `https://www.atcyrus.com/billing/${config.stripeCustomerId}`;

		console.log("✅ Opening billing portal in browser...");
		console.log(`\n👉 URL: ${billingUrl}\n`);

		// Open the billing portal URL in the default browser
		await open(billingUrl);

		console.log("The billing portal should now be open in your browser.");
		console.log(
			"You can manage your subscription, update payment methods, and download invoices.",
		);
	} catch (error) {
		console.error(
			"❌ Failed to open billing portal:",
			(error as Error).message,
		);
		console.log("\nPlease visit: https://www.atcyrus.com/billing");
		console.log("Customer ID:", config.stripeCustomerId);
		process.exit(1);
	}
}

async function connectOpenAiCommand() {
	const commandArgs = args.slice(1);
	const nonInteractive = hasFlag(commandArgs, "non-interactive");
	const force = hasFlag(commandArgs, "force");
	let apiKey = getFlagValue(commandArgs, "api-key");

	if (!apiKey && nonInteractive) {
		console.error("Error: --api-key is required when using --non-interactive.");
		process.exit(1);
	}

	if (!apiKey) {
		apiKey = await promptHiddenInput("Enter your OpenAI API key: ");
	}

	if (!apiKey) {
		console.error("No API key provided.");
		process.exit(1);
	}

	const trimmedKey = apiKey.trim();
	if (!trimmedKey) {
		console.error("API key cannot be empty.");
		process.exit(1);
	}

	const app = new EdgeApp(CYRUS_HOME);
	const config = app.loadEdgeConfig();
	ensureCliDefaultsStructure(config);
	ensureCredentialsStructure(config);
	copyLegacyModelDefaultsToCli(config);

	const existingKey = config.credentials?.openaiApiKey;
	const keyToUse = existingKey && !force ? existingKey : trimmedKey;
	let saved = false;

	if (!existingKey || force) {
		config.credentials!.openaiApiKey = trimmedKey;
		app.saveEdgeConfig(config);
		saved = true;
	}

	if (saved) {
		console.log("\n✅ OpenAI API key saved to ~/.cyrus/config.json");
	} else {
		console.log(
			"\nℹ️  Existing OpenAI API key found. Reusing stored credential.",
		);
	}

	console.log(
		"🔐 Environment variables override stored credentials (OPENAI_API_KEY).",
	);

	await runCodexLogin(keyToUse);

	console.log("\n🎉 OpenAI credential setup complete.");
	console.log("Run 'cyrus validate' to confirm Codex connectivity when ready.");
}

function runCodexLogin(apiKey: string): Promise<void> {
	return new Promise((resolve) => {
		const loginProcess = spawn("codex", ["login", "--api-key", apiKey], {
			stdio: "inherit",
		});

		loginProcess.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				console.log(
					"\nℹ️  Codex CLI not found on PATH. Skipping codex login step.",
				);
				resolve();
				return;
			}
			console.warn("\n⚠️  Failed to launch Codex CLI:", error.message);
			resolve();
		});

		loginProcess.on("close", (code) => {
			if (code === 0) {
				console.log("\n✅ Codex CLI login succeeded.");
			} else if (code !== null) {
				console.warn(
					`\n⚠️  Codex CLI exited with code ${code}. Try running 'codex login --api-key <key>' manually if needed.`,
				);
			}
			resolve();
		});
	});
}

async function setDefaultCliCommand() {
	const commandArgs = args.slice(1);
	const nonInteractive = hasFlag(commandArgs, "non-interactive");
	const positional = removeFlagWithValue(commandArgs, "non-interactive").filter(
		(arg) => !arg.startsWith("--"),
	);
	const target = positional[0]?.toLowerCase();

	if (!target || !["claude", "codex"].includes(target)) {
		console.error(
			"Usage: cyrus set-default-cli <claude|codex> [--non-interactive]",
		);
		process.exit(1);
	}

	const runnerType = target as RunnerType;
	const app = new EdgeApp(CYRUS_HOME);
	const config = app.loadEdgeConfig();
	ensureCliDefaultsStructure(config);
	const { previous, changed } = applyDefaultCli(config, runnerType);
	if (runnerType === "claude") {
		copyLegacyModelDefaultsToCli(config);
	}

	if (!changed) {
		console.log(
			`Default CLI already set to ${runnerType}. No changes were made.`,
		);
		return;
	}

	app.saveEdgeConfig(config);

	if (!nonInteractive) {
		console.log(`\n✅ Default CLI updated to ${runnerType}.`);
		console.log(
			"Repositories with explicit runner settings or label routing will continue using their overrides.",
		);
		if (runnerType !== "claude") {
			console.log(
				"Run 'cyrus connect-openai' to configure credentials for Codex.",
			);
		}
	} else {
		console.log(`${previous ?? "(unset)"} -> ${runnerType}`);
	}
}

async function setDefaultModelCommand() {
	const commandArgs = args.slice(1);
	const positional = commandArgs.filter((arg) => !arg.startsWith("--"));
	const cli = positional[0]?.toLowerCase();
	const model = positional[1];

	if (!cli || !model) {
		console.error("Usage: cyrus set-default-model <claude|codex> <model>");
		process.exit(1);
	}

	if (!["claude", "codex"].includes(cli)) {
		console.error("Unknown CLI. Expected claude or codex.");
		process.exit(1);
	}

	const runnerType = cli as RunnerType;
	const app = new EdgeApp(CYRUS_HOME);
	const config = app.loadEdgeConfig();
	ensureCliDefaultsStructure(config);

	const defaultsMap = config.cliDefaults!;
	const defaults = defaultsMap[runnerType] as Record<string, any>;
	const previousModel = defaults?.model;

	const { changed } = applyDefaultModel(config, runnerType, model);

	if (!changed) {
		console.log(
			"No changes were made; defaults already match the requested values.",
		);
		return;
	}

	app.saveEdgeConfig(config);

	console.log("\n✅ Default model updated.");
	console.log(`Previous: model=${previousModel ?? "(unset)"}`);
	const updated = defaultsMap[runnerType] as Record<string, any>;
	console.log(`Current: model=${updated.model ?? "(unset)"}`);
	console.log(
		"Repositories with runnerModels overrides will continue using their repository-specific models.",
	);
}

async function migrateConfigCommand() {
	const commandArgs = args.slice(1);
	const interactive = hasFlag(commandArgs, "interactive");
	const backupDirFlag = getFlagValue(commandArgs, "backup-dir");
	const backupRoot = backupDirFlag
		? resolve(backupDirFlag)
		: resolve(CYRUS_HOME, "backup");
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = resolve(backupRoot, `config.${timestamp}.json`);

	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();
	if (!existsSync(configPath)) {
		console.error(
			"No configuration found. Run 'cyrus' to create one before migrating.",
		);
		process.exit(1);
	}

	const config = app.loadEdgeConfig();

	mkdirSync(dirname(backupPath), { recursive: true });
	copyFileSync(configPath, backupPath);

	const changes: string[] = [];

	if (!config.defaultCli) {
		config.defaultCli = "claude";
		changes.push("defaultCli");
	}

	ensureCliDefaultsStructure(config);
	ensureCredentialsStructure(config);

	if (config.cliDefaults?.claude === undefined) {
		config.cliDefaults!.claude = {};
		changes.push("cliDefaults.claude");
	}
	if (config.cliDefaults?.codex === undefined) {
		config.cliDefaults!.codex = {};
		changes.push("cliDefaults.codex");
	}

	if (!config.credentials) {
		config.credentials = {};
		changes.push("credentials");
	}

	config.repositories = config.repositories || [];
	config.repositories.forEach((repo, index) => {
		const before = JSON.stringify(repo);
		ensureRepositoryScaffold(repo);
		const after = JSON.stringify(repo);
		if (before !== after) {
			changes.push(`repositories[${index}].runner-scaffold`);
		}
	});

	if (changes.length === 0) {
		console.log(
			"Configuration already contains multi-CLI fields. No changes made.",
		);
		console.log(`Backup created at ${backupPath}`);
		return;
	}

	if (interactive) {
		const answer = await app.askQuestion(
			"Apply the configuration updates listed above? (Y/n): ",
		);
		if (answer.toLowerCase().startsWith("n")) {
			console.log("Migration cancelled.");
			console.log(`Backup remains at ${backupPath}`);
			return;
		}
	}

	app.saveEdgeConfig(config);

	console.log("\n✅ Configuration migrated for multi-CLI support.");
	console.log(`Backup saved to ${backupPath}`);
	console.log("Applied updates:");
	changes.forEach((change) => console.log(`  • ${change}`));
}

async function validateCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();
	if (!existsSync(configPath)) {
		console.error(
			"No configuration found. Run 'cyrus' to create one before validating.",
		);
		process.exit(1);
	}

	const config = app.loadEdgeConfig();
	let hasErrors = false;

	console.log("\n🔍 Checking Linear connectivity...");
	for (const repo of config.repositories) {
		const start = Date.now();
		const result = await checkLinearToken(repo.linearToken);
		const latency = Date.now() - start;
		if (result.valid) {
			console.log(`  ✅ ${repo.name}: token valid (${latency}ms)`);
		} else {
			hasErrors = true;
			console.log(
				`  ❌ ${repo.name}: ${result.error ?? "Unknown error"} (${latency}ms)`,
			);
		}
	}

	if (config.repositories.length === 0) {
		console.log("  ℹ️  No repositories configured.");
	}

	if (configRequiresCodex(config)) {
		console.log("\n🔍 Checking Codex CLI availability...");
		let codexDetected = false;
		try {
			const version = spawnSync("codex", ["--version"], {
				encoding: "utf-8",
			});
			if (version.error) {
				hasErrors = true;
				console.log(
					"  ❌ Codex CLI not found. Install it before routing issues to Codex.",
				);
			} else if (version.status !== 0) {
				hasErrors = true;
				console.log(`  ❌ Codex CLI returned exit code ${version.status}.`);
			} else {
				const output = version.stdout.trim();
				console.log(
					`  ✅ Codex CLI detected (${output || "version unknown"}).`,
				);
				codexDetected = true;
			}
		} catch (error) {
			hasErrors = true;
			console.log(
				"  ❌ Failed to execute Codex CLI:",
				(error as Error).message,
			);
		}

		if (codexDetected) {
			const codexAuthArgs = [
				"exec",
				"--skip-git-repo-check",
				"--cd",
				"/tmp",
				"echo Codex health check",
			];
			const codexAuth = spawnSync("codex", codexAuthArgs, {
				encoding: "utf-8",
			});
			const combinedOutput = [codexAuth.stdout, codexAuth.stderr]
				.filter(Boolean)
				.map((text) => text.trim())
				.filter((text) => text.length > 0)
				.join("\n");
			const unauthorizedPattern =
				/(401|unauthoriz|invalid (api|token)|forbidden)/i;
			const trustedDirWarning = /Not inside a trusted directory/i.test(
				combinedOutput,
			);
			const isUnauthorized = unauthorizedPattern.test(combinedOutput);
			if (codexAuth.error) {
				hasErrors = true;
				console.log(
					"  ❌ Codex authentication check failed to run:",
					codexAuth.error.message,
				);
			} else if (isUnauthorized) {
				hasErrors = true;
				console.log(
					`  ❌ Codex authentication failed${
						combinedOutput ? `: ${combinedOutput}` : "."
					}`,
				);
			} else if (codexAuth.status === 0 || trustedDirWarning) {
				console.log("  ✅ Codex authentication verified.");
				if (trustedDirWarning) {
					console.log(
						"    ℹ️  Codex reported 'Not inside a trusted directory', which is expected for this health check.",
					);
				}
			} else {
				hasErrors = true;
				const failureDetail = combinedOutput || `exit code ${codexAuth.status}`;
				console.log(`  ❌ Codex authentication check failed: ${failureDetail}`);
			}
		}
	} else {
		console.log("\nℹ️  Codex CLI not required based on current configuration.");
	}

	if (hasErrors) {
		console.error("\nValidation completed with errors.");
		process.exit(1);
	}

	console.log("\n✅ Validation complete. All checks passed.");
}

// Parse command
const command = args[0] || "start";

// Execute appropriate command
switch (command) {
	case "check-tokens":
		checkTokensCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "refresh-token":
		refreshTokenCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "add-repository":
		addRepositoryCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "billing":
		billingCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "connect-openai":
		connectOpenAiCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "set-default-cli":
		setDefaultCliCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "set-default-model":
		setDefaultModelCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "migrate-config":
		migrateConfigCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "validate":
		validateCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "set-customer-id":
		setCustomerIdCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "prompts":
		promptsCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	default: {
		// Create and start the app
		const app = new EdgeApp(CYRUS_HOME);
		app.start().catch((error) => {
			console.error("Fatal error:", error);
			process.exit(1);
		});
		break;
	}
}
