import { copyFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import type {
	LabelConflict,
	PromptAwareConfig,
	PromptPlan,
} from "./prompt-mutators.js";
import { ensurePromptsDirectory } from "./prompt-paths.js";

function formatBackupTimestamp(date: Date): string {
	const pad = (value: number) => value.toString().padStart(2, "0");
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	return `${year}${month}${day}${hours}${minutes}`;
}

function createConfigBackup(configPath: string): string | undefined {
	if (!existsSync(configPath)) {
		return undefined;
	}
	const timestamp = formatBackupTimestamp(new Date());
	const backupPath = `${configPath}.${timestamp}`;
	copyFileSync(configPath, backupPath);
	return backupPath;
}

export interface PromptCommandResult {
	status: "success";
	action: PromptPlan["action"];
	scope: PromptPlan["scope"];
	prompt: {
		name: string;
		displayName: string;
		labels?: string[];
		previousLabels?: string[];
		repositoryId?: string;
		repositoryName?: string;
		promptPath?: string;
		previousPromptPath?: string;
	};
	warnings: string[];
	conflicts: LabelConflict[];
	dryRun: boolean;
	backupPath?: string;
	fileOperation?: PromptPlan["fileOperation"] extends infer T
		? T extends { type: string }
			? T["type"]
			: undefined
		: undefined;
}

function buildPromptCommandResult(
	plan: PromptPlan,
	options: { dryRun: boolean; backupPath?: string },
): PromptCommandResult {
	return {
		status: "success",
		action: plan.action,
		scope: plan.scope,
		prompt: {
			name: plan.promptName,
			displayName: plan.displayName,
			labels: plan.labels,
			previousLabels: plan.previousLabels,
			repositoryId: plan.repositoryId,
			repositoryName: plan.repositoryName,
			promptPath: plan.promptPath,
			previousPromptPath: plan.previousPromptPath,
		},
		warnings: plan.warnings,
		conflicts: plan.conflicts,
		dryRun: options.dryRun,
		backupPath: options.backupPath,
		fileOperation: plan.fileOperation?.type,
	};
}

export interface PromptExecutionEnvironment {
	configPath: string;
	saveConfig: (config: PromptAwareConfig) => void;
	ensurePromptsDirectory?: () => void;
}

export function applyPromptPlan(
	plan: PromptPlan,
	env: PromptExecutionEnvironment,
	options: { dryRun?: boolean } = {},
): PromptCommandResult {
	if (options.dryRun) {
		return buildPromptCommandResult(plan, { dryRun: true });
	}

	(env.ensurePromptsDirectory ?? ensurePromptsDirectory)();

	const backupPath = createConfigBackup(env.configPath);
	const operation = plan.fileOperation;
	if (operation?.path) {
		switch (operation.type) {
			case "create":
				writeFileSync(operation.path, operation.nextContent ?? "", "utf-8");
				break;
			case "update":
				if (operation.nextContent !== undefined) {
					writeFileSync(operation.path, operation.nextContent, "utf-8");
				}
				break;
			case "delete":
				if (existsSync(operation.path)) {
					unlinkSync(operation.path);
				}
				break;
			default:
				break;
		}
	}

	env.saveConfig(plan.nextConfig);

	return buildPromptCommandResult(plan, {
		dryRun: false,
		backupPath,
	});
}
