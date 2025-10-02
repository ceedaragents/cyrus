import { spawnSync } from "node:child_process";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
	applyPromptPlan,
	type PromptCommandResult,
} from "./prompt-executor.js";
import type {
	PromptDefinitionSummary,
	PromptInventory,
	PromptSummary,
} from "./prompt-list.js";
import {
	buildCreatePromptPlan,
	buildDeletePromptPlan,
	buildEditPromptPlan,
	type LabelConflict,
	type PromptAwareConfig,
	type PromptPlan,
	type PromptScope,
} from "./prompt-mutators.js";
import { ensurePromptsDirectory } from "./prompt-paths.js";

function writeTempPromptFile(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "cyrus-prompt-"));
	const filePath = join(dir, "prompt.md");
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function openInPager(content: string, notify: (message: string) => void): void {
	if (!content) {
		notify("No prompt content available to open in pager.");
		return;
	}
	try {
		const pager = process.env.PAGER || "less";
		const filePath = writeTempPromptFile(content);
		const { status, error } = spawnSync(pager, [filePath], {
			stdio: "inherit",
		});
		if (status !== 0) {
			notify(`Pager exited with status ${status ?? "unknown"}.`);
		}
		if (error) {
			notify(`Failed to launch pager: ${error.message}`);
		}
	} catch (error) {
		notify(`Failed to open pager: ${(error as Error).message}`);
	}
}

function parseLabelInput(value: string): string[] {
	return value
		.split(",")
		.map((label) => label.trim())
		.filter((label) => label.length > 0);
}

function formatConflictSummary(conflicts: LabelConflict[]): string {
	return conflicts
		.map((conflict) => {
			if (conflict.scope === "repository") {
				return `${conflict.label} → ${conflict.prompt} (repo ${conflict.repositoryId})`;
			}
			return `${conflict.label} → ${conflict.prompt} (global)`;
		})
		.join(", ");
}

function describeResultScope(result: PromptCommandResult): string {
	if (result.scope === "global") {
		return "global";
	}
	const repoLabel = result.prompt.repositoryName
		? `${result.prompt.repositoryName} (${result.prompt.repositoryId})`
		: (result.prompt.repositoryId ?? "repository");
	return `repository ${repoLabel}`;
}

function formatResultMessage(result: PromptCommandResult): string {
	const scopeLabel = describeResultScope(result);
	switch (result.action) {
		case "create":
			return `✅ Created prompt "${result.prompt.name}" for ${scopeLabel}.`;
		case "edit":
			return `✅ Updated prompt "${result.prompt.name}" for ${scopeLabel}.`;
		case "delete":
			return `✅ Deleted prompt "${result.prompt.name}" from ${scopeLabel}.`;
		default:
			return `✅ Prompt operation completed for "${result.prompt.name}".`;
	}
}

const MAX_STATUS_DURATION_MS = 4000;
const PREVIEW_VISIBLE_LINES = 10;

type ViewMode = "selection" | "repo-select" | "global" | "repo";

interface RepoOption {
	repositoryId: string;
	repositoryName?: string;
}

type ModalState =
	| { type: "create"; scope: PromptScope; repoId?: string; repoName?: string }
	| {
			type: "edit-labels";
			scope: PromptScope;
			repoId?: string;
			repoName?: string;
			prompt: PromptSummary;
	  }
	| {
			type: "edit-content";
			scope: PromptScope;
			repoId?: string;
			repoName?: string;
			prompt: PromptSummary;
	  }
	| {
			type: "delete";
			scope: PromptScope;
			repoId?: string;
			repoName?: string;
			prompt: PromptSummary;
	  };

interface PromptTuiOptions {
	loadInventory: () => PromptInventory;
	loadConfig: () => PromptAwareConfig;
	saveConfig: (config: PromptAwareConfig) => void;
	configPath: string;
}

interface PromptTuiProps extends PromptTuiOptions {
	initialInventory: PromptInventory;
}

export async function runPromptTui(options: PromptTuiOptions): Promise<void> {
	const initialInventory = options.loadInventory();
	const inkApp = render(
		<PromptTuiApp
			loadInventory={options.loadInventory}
			loadConfig={options.loadConfig}
			saveConfig={options.saveConfig}
			configPath={options.configPath}
			initialInventory={initialInventory}
		/>,
	);
	await inkApp.waitUntilExit();
}

const PromptTuiApp: React.FC<PromptTuiProps> = ({
	loadInventory,
	loadConfig,
	saveConfig,
	configPath,
	initialInventory,
}) => {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const stdoutWidth = stdout?.columns ?? 120;
	const stdoutHeight = stdout?.rows ?? 32;

	const [inventory, setInventory] = useState(initialInventory);
	const [viewMode, setViewMode] = useState<ViewMode>("selection");
	const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
	const [promptIndex, setPromptIndex] = useState(0);
	const [showSearch, setShowSearch] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [previewOffset, setPreviewOffset] = useState(0);
	const [fullView, setFullView] = useState(false);
	const [modal, setModal] = useState<ModalState | null>(null);

	const definitionsById = useMemo(
		() =>
			new Map(
				inventory.definitions.map((definition) => [definition.id, definition]),
			),
		[inventory],
	);

	const aggregatedLabels = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const repo of inventory.repositories) {
			for (const prompt of repo.prompts) {
				let set = map.get(prompt.definitionId);
				if (!set) {
					set = new Set<string>();
					map.set(prompt.definitionId, set);
				}
				for (const label of prompt.labels) {
					set.add(label);
				}
			}
		}
		for (const definition of inventory.definitions) {
			if (!map.has(definition.id) && definition.labels?.length) {
				map.set(definition.id, new Set(definition.labels));
			}
		}
		return map;
	}, [inventory.definitions, inventory.repositories]);

	const repositoryOptions = useMemo<RepoOption[]>(() => {
		return inventory.repositories.map((repo) => ({
			repositoryId: repo.repositoryId,
			repositoryName: repo.repositoryName ?? repo.repositoryId,
		}));
	}, [inventory.repositories]);

	const globalPrompts = useMemo(() => {
		return inventory.definitions
			.filter((definition) => definition.scope === "global")
			.map((definition) => {
				const labelSet = aggregatedLabels.get(definition.id);
				const labels = labelSet
					? Array.from(labelSet)
					: (definition.labels ?? []);
				return {
					prompt: definition.prompt,
					source: definition.source,
					labels,
					definitionId: definition.id,
				};
			})
			.sort((a, b) => a.prompt.localeCompare(b.prompt));
	}, [aggregatedLabels, inventory.definitions]);

	const customRepoChoices = useMemo(() => {
		return inventory.repositories
			.filter((repo) =>
				repo.prompts.some((prompt) => prompt.source === "custom"),
			)
			.map((repo) => ({
				repositoryId: repo.repositoryId,
				repositoryName: repo.repositoryName ?? repo.repositoryId,
			}));
	}, [inventory.repositories]);

	useEffect(() => {
		if (viewMode !== "selection") {
			return;
		}
		const hasGlobal = globalPrompts.length > 0;
		const hasCustomRepos = customRepoChoices.length > 0;

		if (!hasGlobal && hasCustomRepos) {
			const soleRepo = customRepoChoices[0];
			if (soleRepo) {
				setSelectedRepoId(soleRepo.repositoryId);
				setViewMode("repo");
			}
			return;
		}

		if (hasGlobal && !hasCustomRepos) {
			setViewMode("global");
		}
	}, [viewMode, globalPrompts.length, customRepoChoices]);

	useEffect(() => {
		setPromptIndex(0);
		setPreviewOffset(0);
		setFullView(false);
	}, []);

	useEffect(() => {
		if (!statusMessage) {
			return;
		}
		const timer = setTimeout(() => {
			setStatusMessage(null);
		}, MAX_STATUS_DURATION_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [statusMessage]);

	const notify = (message: string) => {
		setStatusMessage(message);
	};

	const reloadInventory = () => {
		try {
			const data = loadInventory();
			setInventory(data);
		} catch (error) {
			notify(`Failed to reload prompts: ${(error as Error).message}`);
		}
	};

	const refreshInventory = () => {
		reloadInventory();
		setViewMode("selection");
		setSelectedRepoId(null);
		setSearchTerm("");
		setPromptIndex(0);
		setPreviewOffset(0);
		setFullView(false);
		notify("Prompt inventory refreshed.");
	};

	const executePlan = async (
		plan: PromptPlan,
	): Promise<PromptCommandResult> => {
		return applyPromptPlan(plan, {
			configPath,
			saveConfig: (config: PromptAwareConfig) => saveConfig(config),
			ensurePromptsDirectory,
		});
	};

	const handleResult = (result: PromptCommandResult) => {
		reloadInventory();
		setModal(null);
		let message = formatResultMessage(result);
		if (result.warnings.length > 0) {
			message = `${message} ⚠ ${result.warnings.join("; ")}`;
		}
		if (result.conflicts.length > 0) {
			message = `${message} ⚠ Conflicts: ${formatConflictSummary(result.conflicts)}`;
		}
		notify(message);
	};

	const currentRepo = useMemo(() => {
		if (viewMode !== "repo" || !selectedRepoId) {
			return undefined;
		}
		return inventory.repositories.find(
			(repo) => repo.repositoryId === selectedRepoId,
		);
	}, [inventory.repositories, selectedRepoId, viewMode]);

	const promptList: PromptSummary[] = useMemo(() => {
		if (viewMode === "global") {
			return globalPrompts;
		}
		if (viewMode === "repo" && currentRepo) {
			return currentRepo.prompts;
		}
		return [];
	}, [viewMode, globalPrompts, currentRepo]);

	const filteredPrompts = useMemo(() => {
		if (!searchTerm.trim()) {
			return promptList;
		}
		const lower = searchTerm.toLowerCase();
		return promptList.filter((prompt) => {
			if (prompt.prompt.toLowerCase().includes(lower)) {
				return true;
			}
			return prompt.labels.some((label) => label.toLowerCase().includes(lower));
		});
	}, [promptList, searchTerm]);

	useEffect(() => {
		if (promptIndex >= filteredPrompts.length) {
			setPromptIndex(
				filteredPrompts.length > 0 ? filteredPrompts.length - 1 : 0,
			);
		}
	}, [filteredPrompts.length, promptIndex]);

	useEffect(() => {
		setPreviewOffset(0);
		setFullView(false);
	}, []);

	const selectedPrompt = filteredPrompts[promptIndex];
	const selectedDefinition = selectedPrompt
		? definitionsById.get(selectedPrompt.definitionId)
		: undefined;

	useInput(
		(input, key) => {
			if (modal) {
				return;
			}
			if (viewMode === "selection" || viewMode === "repo-select") {
				if (input === "q" || (key.ctrl && input === "c")) {
					exit();
					return;
				}
				if (viewMode === "repo-select" && key.escape) {
					setViewMode("selection");
					return;
				}
				return;
			}

			if (fullView) {
				if (key.escape || input === "q" || input === "b") {
					setFullView(false);
					return;
				}
				if (input === "o") {
					if (selectedDefinition?.content) {
						openInPager(selectedDefinition.content, notify);
					} else {
						notify("No prompt content available for this selection.");
					}
					return;
				}
				if (input === "w") {
					if (selectedDefinition?.content) {
						const filePath = writeTempPromptFile(selectedDefinition.content);
						notify(`Prompt written to ${filePath}`);
					} else {
						notify("No prompt content available for this selection.");
					}
					return;
				}
				return;
			}

			if (showSearch) {
				if (key.escape) {
					setShowSearch(false);
					setSearchTerm("");
				}
				return;
			}

			if (input === "q" || (key.ctrl && input === "c")) {
				exit();
				return;
			}

			if (input === "b") {
				setViewMode("selection");
				setSelectedRepoId(null);
				setSearchTerm("");
				setPromptIndex(0);
				setPreviewOffset(0);
				return;
			}

			if (input === "?" || input === "h") {
				notify(
					"Keys: arrows navigate prompts, Enter full view, / search prompts, b back, o open in pager, w write file, r reload, q quit.",
				);
				return;
			}

			if (input === "r") {
				refreshInventory();
				return;
			}

			if (input === "/") {
				setShowSearch(true);
				return;
			}

			if (input === "c") {
				const scope: PromptScope =
					viewMode === "repo" && currentRepo ? "repository" : "global";
				const repoId =
					scope === "repository"
						? (currentRepo?.repositoryId ?? customRepoChoices[0]?.repositoryId)
						: undefined;
				const repoOption = repoId
					? repositoryOptions.find((option) => option.repositoryId === repoId)
					: undefined;
				if (scope === "repository" && !repoId) {
					notify("No repository available for custom prompts.");
					return;
				}
				setModal({
					type: "create",
					scope,
					repoId: repoId ?? undefined,
					repoName: repoOption?.repositoryName,
				});
				return;
			}

			if (input === "e") {
				if (!selectedPrompt) {
					notify("Select a prompt to edit labels.");
					return;
				}
				const scope: PromptScope =
					viewMode === "repo" && currentRepo ? "repository" : "global";
				const repoId =
					scope === "repository" ? currentRepo?.repositoryId : undefined;
				const repoName =
					currentRepo?.repositoryName ?? currentRepo?.repositoryId;
				if (scope === "repository" && !repoId) {
					notify("Select a repository first.");
					return;
				}
				setModal({
					type: "edit-labels",
					scope,
					repoId,
					repoName,
					prompt: selectedPrompt,
				});
				return;
			}

			if (input === "E") {
				if (!selectedPrompt) {
					notify("Select a prompt to edit content.");
					return;
				}
				if (selectedPrompt.source !== "custom") {
					notify("Only custom prompts support content editing.");
					return;
				}
				const scope: PromptScope =
					viewMode === "repo" && currentRepo ? "repository" : "global";
				const repoId =
					scope === "repository" ? currentRepo?.repositoryId : undefined;
				const repoName =
					currentRepo?.repositoryName ?? currentRepo?.repositoryId;
				setModal({
					type: "edit-content",
					scope,
					repoId,
					repoName,
					prompt: selectedPrompt,
				});
				return;
			}

			if (input === "d") {
				if (!selectedPrompt) {
					notify("Select a prompt to delete.");
					return;
				}
				if (selectedPrompt.source !== "custom") {
					notify("Built-in prompts cannot be deleted.");
					return;
				}
				const scope: PromptScope =
					viewMode === "repo" && currentRepo ? "repository" : "global";
				const repoId =
					scope === "repository" ? currentRepo?.repositoryId : undefined;
				const repoName =
					currentRepo?.repositoryName ?? currentRepo?.repositoryId;
				setModal({
					type: "delete",
					scope,
					repoId,
					repoName,
					prompt: selectedPrompt,
				});
				return;
			}

			if (input === "o") {
				if (selectedDefinition?.content) {
					openInPager(selectedDefinition.content, notify);
				} else {
					notify("No prompt content available for this selection.");
				}
				return;
			}

			if (input === "w") {
				if (selectedDefinition?.content) {
					const filePath = writeTempPromptFile(selectedDefinition.content);
					notify(`Prompt written to ${filePath}`);
				} else {
					notify("No prompt content available for this selection.");
				}
				return;
			}

			if (key.return || input === "v") {
				if (selectedDefinition?.content) {
					setFullView(true);
				} else {
					notify("Select a prompt with content to view.");
				}
				return;
			}

			if (key.pageDown || input === "]") {
				const totalLines = selectedDefinition?.content?.split(/\r?\n/) ?? [];
				if (totalLines.length === 0) {
					return;
				}
				const chunk = Math.max(visibleLineCount, 1);
				setPreviewOffset((prev) =>
					Math.min(totalLines.length - chunk, Math.max(0, prev + chunk)),
				);
				return;
			}

			if (key.pageUp || input === "[") {
				const chunk = Math.max(visibleLineCount, 1);
				setPreviewOffset((prev) => Math.max(0, prev - chunk));
				return;
			}

			if (key.downArrow) {
				setPromptIndex((prev) =>
					Math.min(filteredPrompts.length - 1, prev + 1),
				);
				return;
			}
			if (key.upArrow) {
				setPromptIndex((prev) => Math.max(0, prev - 1));
				return;
			}
		},
		{ isActive: true },
	);

	const promptListWidth = Math.max(Math.floor(stdoutWidth * 0.34), 24);
	const previewWidth = Math.max(stdoutWidth - promptListWidth - 4, 30);
	const availablePreviewHeight = Math.max(stdoutHeight - 9, 5);
	const visibleLineCount = Math.min(
		PREVIEW_VISIBLE_LINES,
		availablePreviewHeight,
	);
	const previewLines = selectedDefinition?.content?.split(/\r?\n/) ?? [
		"No prompt content available.",
	];
	const maxOffset = Math.max(0, previewLines.length - visibleLineCount);
	const effectiveOffset = Math.min(previewOffset, maxOffset);
	const visibleLines = previewLines.slice(
		effectiveOffset,
		effectiveOffset + visibleLineCount,
	);

	const renderSelectionMenu = () => {
		const menuItems: { label: string; value: ViewMode }[] = [];
		if (globalPrompts.length > 0) {
			menuItems.push({ label: "Global prompt definitions", value: "global" });
		}
		if (customRepoChoices.length > 0) {
			menuItems.push({
				label: "Repository-specific prompts",
				value: "repo-select",
			});
		}

		if (menuItems.length === 0) {
			return (
				<Box flexDirection="column">
					<Text>No prompts available.</Text>
					<Text color="gray">Press q to exit.</Text>
				</Box>
			);
		}

		const handleSelect = (item: { label: string; value: ViewMode }) => {
			if (item.value === "global") {
				setViewMode("global");
				return;
			}
			if (item.value === "repo-select") {
				const soleRepo = customRepoChoices[0];
				if (customRepoChoices.length === 1 && soleRepo) {
					setSelectedRepoId(soleRepo.repositoryId);
					setViewMode("repo");
				} else {
					setViewMode("repo-select");
				}
			}
		};

		return (
			<Box flexDirection="column">
				<Text color="cyan" bold>
					Cyrus Prompt Manager
				</Text>
				<Text color="gray">Select a prompt group to view.</Text>
				<Box marginTop={1}>
					<SelectInput items={menuItems} onSelect={handleSelect} />
				</Box>
				<Box marginTop={1}>
					<Text color="gray">Press q to quit at any time.</Text>
				</Box>
			</Box>
		);
	};

	const renderRepoSelector = () => {
		if (customRepoChoices.length === 0) {
			setViewMode("selection");
			return null;
		}
		return (
			<Box flexDirection="column">
				<Text color="cyan" bold>
					Choose a repository with custom prompts
				</Text>
				<Text color="gray">Press Esc to go back.</Text>
				<Box marginTop={1}>
					<SelectInput
						items={customRepoChoices.map((repo) => ({
							label: repo.repositoryName,
							value: repo.repositoryId,
						}))}
						onSelect={(item) => {
							setSelectedRepoId(item.value);
							setViewMode("repo");
						}}
					/>
				</Box>
			</Box>
		);
	};

	if (viewMode === "selection") {
		return renderSelectionMenu();
	}

	if (viewMode === "repo-select") {
		return renderRepoSelector();
	}

	if (fullView && selectedDefinition) {
		const fullContentLines = selectedDefinition.content?.split(/\r?\n/) ?? [
			"No prompt content available.",
		];
		const title = selectedPrompt?.prompt ?? selectedDefinition.prompt;
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text color="cyan" bold>
						Full Prompt View — {title}
					</Text>
				</Box>
				<Text color="gray">
					Press Esc/b to return · o open in pager · w write to temp file
				</Text>
				<Box marginTop={1} flexDirection="column">
					{fullContentLines.map((line, index) => (
						<Text key={`${index}-${line.slice(0, 40)}`}>{line || " "}</Text>
					))}
				</Box>
				{statusMessage ? (
					<Box marginTop={1}>
						<Text color="yellow">{statusMessage}</Text>
					</Box>
				) : null}
			</Box>
		);
	}

	const contextTitle =
		viewMode === "global"
			? "Global prompts"
			: (currentRepo?.repositoryName ?? selectedRepoId ?? "Repository prompts");

	const definitionForModal =
		modal && "prompt" in modal
			? definitionsById.get(modal.prompt.definitionId)
			: undefined;

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color="cyan" bold>
					{contextTitle}
				</Text>
				<Text color="gray">
					Press / to search, Enter for full view, b to go back.
				</Text>
			</Box>
			{showSearch ? (
				<Box marginBottom={1}>
					<Text color="yellow">Search prompts: </Text>
					<TextInput
						value={searchTerm}
						onChange={setSearchTerm}
						onSubmit={() => setShowSearch(false)}
					/>
					<Text color="gray"> (Esc to clear)</Text>
				</Box>
			) : null}
			<Box flexDirection="row" gap={1}>
				<Box
					borderStyle="round"
					borderColor="gray"
					flexDirection="column"
					width={promptListWidth}
				>
					<Box marginBottom={1}>
						<Text bold>Prompts</Text>
					</Box>
					{filteredPrompts.length === 0 ? (
						<Text color="gray">No prompts match your search.</Text>
					) : (
						filteredPrompts.map((prompt, index) => {
							const isSelected = index === promptIndex;
							const badges = prompt.source === "built-in" ? "[B]" : "[C]";
							return (
								<Text
									key={`${prompt.definitionId}-${index}`}
									color={isSelected ? "green" : undefined}
								>
									{isSelected ? "➤ " : "  "}
									{`${badges} ${prompt.prompt}`}
									<Text color="gray">
										{` (${prompt.labels.length} labels)`}
									</Text>
								</Text>
							);
						})
					)}
				</Box>
				<Box
					borderStyle="round"
					borderColor="gray"
					flexGrow={1}
					width={previewWidth}
					flexDirection="column"
				>
					<Box marginBottom={1}>
						<Text bold>Prompt Preview</Text>
						{selectedPrompt ? (
							<Text color="gray"> {`(${selectedPrompt.prompt})`}</Text>
						) : null}
					</Box>
					<Box flexDirection="column">
						{visibleLines.map((line, index) => (
							<Text key={`${line.slice(0, 50)}-${index}`}>{line || " "}</Text>
						))}
					</Box>
					<Box marginTop={1}>
						<Text color="gray">
							Lines {visibleLines.length === 0 ? 0 : effectiveOffset + 1}-
							{Math.min(
								effectiveOffset + visibleLines.length,
								previewLines.length,
							)}{" "}
							of {previewLines.length}
						</Text>
					</Box>
				</Box>
			</Box>
			<Box marginTop={1}>
				<Text color="cyan">
					[c] Create [e] Edit labels [E] Edit content [d] Delete [Enter] Full
					view [o] Pager [w] Write file [r] Reload [/] Search [b] Back [q] Quit
					[?] Help
				</Text>
			</Box>
			<Box marginTop={0}>
				{statusMessage ? (
					<Text color="yellow">{statusMessage}</Text>
				) : (
					<Text color="gray">
						Prompts: {filteredPrompts.length} · View:{" "}
						{viewMode === "global" ? "Global" : "Repository"}
					</Text>
				)}
			</Box>
			{modal ? (
				<Box marginTop={1}>
					{modal.type === "create" ? (
						<CreatePromptModal
							scope={modal.scope}
							initialRepoId={modal.repoId}
							repositories={repositoryOptions}
							loadConfig={loadConfig}
							executePlan={executePlan}
							onComplete={handleResult}
							onCancel={() => setModal(null)}
						/>
					) : null}
					{modal.type === "edit-labels" ? (
						<EditPromptLabelsModal
							scope={modal.scope}
							repoId={modal.repoId}
							repoName={modal.repoName}
							prompt={modal.prompt}
							loadConfig={loadConfig}
							executePlan={executePlan}
							onComplete={handleResult}
							onCancel={() => setModal(null)}
						/>
					) : null}
					{modal.type === "edit-content" ? (
						<EditPromptContentModal
							scope={modal.scope}
							repoId={modal.repoId}
							repoName={modal.repoName}
							prompt={modal.prompt}
							definition={definitionForModal}
							loadConfig={loadConfig}
							executePlan={executePlan}
							onComplete={handleResult}
							onCancel={() => setModal(null)}
						/>
					) : null}
					{modal.type === "delete" ? (
						<DeletePromptModal
							scope={modal.scope}
							repoId={modal.repoId}
							repoName={modal.repoName}
							prompt={modal.prompt}
							loadConfig={loadConfig}
							executePlan={executePlan}
							onComplete={handleResult}
							onCancel={() => setModal(null)}
						/>
					) : null}
				</Box>
			) : null}
		</Box>
	);
};

interface ModalContainerProps {
	title: string;
	children: React.ReactNode;
}

const ModalContainer: React.FC<ModalContainerProps> = ({ title, children }) => (
	<Box
		flexDirection="column"
		borderStyle="round"
		borderColor="cyan"
		padding={1}
		width={80}
	>
		<Text color="cyan" bold>
			{title}
		</Text>
		<Box flexDirection="column" marginTop={1}>
			{children}
		</Box>
	</Box>
);

interface CreatePromptModalProps {
	scope: PromptScope;
	initialRepoId?: string;
	repositories: RepoOption[];
	loadConfig: () => PromptAwareConfig;
	executePlan: (plan: PromptPlan) => Promise<PromptCommandResult>;
	onComplete: (result: PromptCommandResult) => void;
	onCancel: () => void;
}

const CreatePromptModal: React.FC<CreatePromptModalProps> = ({
	scope: initialScope,
	initialRepoId,
	repositories,
	loadConfig,
	executePlan,
	onComplete,
	onCancel,
}) => {
	const hasRepositories = repositories.length > 0;
	const startingScope =
		initialScope === "repository" && hasRepositories ? "repository" : "global";
	const initialRepoIndex = (() => {
		if (!hasRepositories) {
			return -1;
		}
		if (initialRepoId) {
			const idx = repositories.findIndex(
				(repo) => repo.repositoryId === initialRepoId,
			);
			if (idx >= 0) {
				return idx;
			}
		}
		return 0;
	})();

	const [scope, setScope] = useState<PromptScope>(startingScope);
	const [repoIndex, setRepoIndex] = useState(initialRepoIndex);
	const [name, setName] = useState("");
	const [labels, setLabels] = useState("");
	const [fromFile, setFromFile] = useState("");
	type CreateField = "scope" | "name" | "labels" | "fromFile";
	const fieldOrder: CreateField[] = ["scope", "name", "labels", "fromFile"];
	const [focusedField, setFocusedField] = useState<CreateField>("scope");
	const [error, setError] = useState<string | undefined>();
	const [conflicts, setConflicts] = useState<LabelConflict[] | undefined>();
	const [pendingPlan, setPendingPlan] = useState<PromptPlan | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const selectedRepo =
		scope === "repository" && repoIndex >= 0
			? repositories[repoIndex]
			: undefined;

	const scopeItems = useMemo(() => {
		const items: Array<{
			label: string;
			value: {
				scope: PromptScope;
				repoId?: string;
				repoName?: string;
				index: number;
			};
		}> = [
			{
				label: "Global prompt",
				value: { scope: "global", index: 0 },
			},
		];
		repositories.forEach((repo, index) => {
			items.push({
				label: repo.repositoryName ?? repo.repositoryId,
				value: {
					scope: "repository",
					repoId: repo.repositoryId,
					repoName: repo.repositoryName ?? repo.repositoryId,
					index: index + 1,
				},
			});
		});
		return items;
	}, [repositories]);

	const [selectedScopeIndex, setSelectedScopeIndex] = useState(() =>
		startingScope === "repository" && initialRepoIndex >= 0
			? initialRepoIndex + 1
			: 0,
	);

	useEffect(() => {
		const nextIndex =
			scope === "global"
				? 0
				: repoIndex >= 0
					? repoIndex + 1
					: repositories.length > 0
						? 1
						: 0;
		setSelectedScopeIndex(nextIndex);
	}, [scope, repoIndex, repositories.length]);

	const handleScopeSelection = (value: {
		scope: PromptScope;
		repoId?: string;
		repoName?: string;
		index: number;
	}) => {
		setSelectedScopeIndex(value.index);
		if (value.scope === "global") {
			if (scope !== "global") {
				setScope("global");
				setRepoIndex(-1);
				resetPendingState();
			}
			return;
		}

		if (scope !== "repository") {
			setScope("repository");
		}
		const nextRepoIndex = repositories.findIndex(
			(repo) => repo.repositoryId === value.repoId,
		);
		if (nextRepoIndex >= 0) {
			setRepoIndex(nextRepoIndex);
		} else if (repositories.length > 0) {
			setRepoIndex(0);
		}
		resetPendingState();
	};

	const resetPendingState = () => {
		setPendingPlan(null);
		setConflicts(undefined);
		setError(undefined);
	};

	useInput(
		(_unused, key) => {
			if (submitting) {
				return;
			}
			if (key.escape) {
				onCancel();
				return;
			}
			if (key.tab) {
				setFocusedField((prev) => {
					const currentIndex = fieldOrder.indexOf(prev);
					const safeIndex = currentIndex === -1 ? 0 : currentIndex;
					const offset = key.shift ? -1 : 1;
					const nextIndex =
						(safeIndex + offset + fieldOrder.length) % fieldOrder.length;
					const nextField = fieldOrder[nextIndex] ?? "scope";
					return nextField;
				});
				return;
			}
		},
		{ isActive: true },
	);

	const handleSubmit = async () => {
		if (submitting) {
			return;
		}
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Prompt name is required.");
			return;
		}
		const parsedLabels = parseLabelInput(labels);
		if (parsedLabels.length === 0) {
			setError("At least one label is required.");
			return;
		}
		if (scope === "repository" && !selectedRepo) {
			setError("Select a repository for this prompt.");
			return;
		}

		try {
			let plan = pendingPlan;
			if (!plan) {
				const config = loadConfig();
				plan = buildCreatePromptPlan(config, {
					name: trimmedName,
					labels: parsedLabels,
					repoId:
						scope === "repository" ? selectedRepo?.repositoryId : undefined,
					fromFilePath: fromFile.trim() || undefined,
				});
				if (plan.conflicts.length > 0) {
					setPendingPlan(plan);
					setConflicts(plan.conflicts);
					setError(undefined);
					return;
				}
			}
			setSubmitting(true);
			const result = await executePlan(plan);
			setSubmitting(false);
			onComplete(result);
		} catch (err) {
			setSubmitting(false);
			setError((err as Error).message);
			setPendingPlan(null);
			setConflicts(undefined);
		}
	};

	return (
		<ModalContainer title="Create Prompt">
			<Text>
				Choose where this prompt should live (use ↑/↓, Enter to confirm):
			</Text>
			<Box marginTop={1}>
				<SelectInput
					key={`scope-${selectedScopeIndex}-${scopeItems.length}`}
					items={scopeItems}
					isFocused={focusedField === "scope"}
					initialIndex={selectedScopeIndex}
					onHighlight={(item) => handleScopeSelection(item.value)}
					onSelect={(item) => {
						handleScopeSelection(item.value);
						setFocusedField("name");
					}}
				/>
			</Box>
			{scope === "repository" ? (
				<Text color={selectedRepo ? "white" : "red"}>
					Repository: {selectedRepo?.repositoryName ?? "None"}{" "}
					{repositories.length > 0
						? "(↑/↓ to change, Enter to continue)"
						: "(no repositories available)"}
				</Text>
			) : (
				<Text color="gray">Global prompts apply to every repository.</Text>
			)}
			<Box flexDirection="column" marginTop={1} gap={1}>
				<Box>
					<Text color="gray">Prompt name: </Text>
					<TextInput
						value={name}
						onChange={(value) => {
							setName(value);
							resetPendingState();
						}}
						onSubmit={() => setFocusedField("labels")}
						focus={focusedField === "name"}
					/>
				</Box>
				<Box>
					<Text color="gray">Labels (comma separated): </Text>
					<TextInput
						value={labels}
						onChange={(value) => {
							setLabels(value);
							resetPendingState();
						}}
						onSubmit={() => setFocusedField("fromFile")}
						focus={focusedField === "labels"}
					/>
				</Box>
				<Box>
					<Text color="gray">From file (optional): </Text>
					<TextInput
						value={fromFile}
						onChange={(value) => {
							setFromFile(value);
							resetPendingState();
						}}
						onSubmit={handleSubmit}
						focus={focusedField === "fromFile"}
					/>
				</Box>
			</Box>
			<Box marginTop={1} flexDirection="column" gap={1}>
				<Text color="gray">
					Enter to create · Tab / Shift+Tab to move between fields · Esc to
					cancel
				</Text>
				{conflicts ? (
					<Text color="yellow">
						Conflicts detected: {formatConflictSummary(conflicts)}. Press Enter
						again to override.
					</Text>
				) : null}
				{submitting ? <Text color="green">Applying changes...</Text> : null}
				{error ? <Text color="red">{error}</Text> : null}
			</Box>
		</ModalContainer>
	);
};

interface EditPromptLabelsModalProps {
	scope: PromptScope;
	repoId?: string;
	repoName?: string;
	prompt: PromptSummary;
	loadConfig: () => PromptAwareConfig;
	executePlan: (plan: PromptPlan) => Promise<PromptCommandResult>;
	onComplete: (result: PromptCommandResult) => void;
	onCancel: () => void;
}

const EditPromptLabelsModal: React.FC<EditPromptLabelsModalProps> = ({
	scope,
	repoId,
	repoName,
	prompt,
	loadConfig,
	executePlan,
	onComplete,
	onCancel,
}) => {
	const [labels, setLabels] = useState(prompt.labels.join(", "));
	const [error, setError] = useState<string | undefined>();
	const [conflicts, setConflicts] = useState<LabelConflict[] | undefined>();
	const [pendingPlan, setPendingPlan] = useState<PromptPlan | null>(null);
	const [submitting, setSubmitting] = useState(false);

	useInput(
		(_input, key) => {
			if (submitting) {
				return;
			}
			if (key.escape) {
				onCancel();
			}
		},
		{ isActive: true },
	);

	const handleSubmit = async () => {
		if (submitting) {
			return;
		}
		const parsedLabels = parseLabelInput(labels);
		if (parsedLabels.length === 0) {
			setError("At least one label is required.");
			return;
		}
		try {
			let plan = pendingPlan;
			if (!plan) {
				const config = loadConfig();
				plan = buildEditPromptPlan(config, {
					name: prompt.prompt,
					labels: parsedLabels,
					repoId,
				});
				if (plan.conflicts.length > 0) {
					setPendingPlan(plan);
					setConflicts(plan.conflicts);
					setError(undefined);
					return;
				}
			}
			setSubmitting(true);
			const result = await executePlan(plan);
			setSubmitting(false);
			onComplete(result);
		} catch (err) {
			setSubmitting(false);
			setError((err as Error).message);
			setPendingPlan(null);
			setConflicts(undefined);
		}
	};

	return (
		<ModalContainer title={`Edit Labels — ${prompt.prompt}`}>
			<Box flexDirection="column" gap={1}>
				<Text color="gray">
					Context:{" "}
					{scope === "global"
						? "Global prompt"
						: `Repository ${repoName ?? repoId ?? ""}`}
				</Text>
				<Text color="gray">Labels (comma separated):</Text>
				<TextInput
					value={labels}
					onChange={(value) => {
						setLabels(value);
						setPendingPlan(null);
						setConflicts(undefined);
						setError(undefined);
					}}
					onSubmit={handleSubmit}
					focus
				/>
				<Text color="gray">Enter to save · Esc to cancel</Text>
				{conflicts ? (
					<Text color="yellow">
						Conflicts detected: {formatConflictSummary(conflicts)}. Press Enter
						again to override.
					</Text>
				) : null}
				{submitting ? <Text color="green">Updating prompt...</Text> : null}
				{error ? <Text color="red">{error}</Text> : null}
			</Box>
		</ModalContainer>
	);
};

interface EditPromptContentModalProps {
	scope: PromptScope;
	repoId?: string;
	repoName?: string;
	prompt: PromptSummary;
	definition?: PromptDefinitionSummary;
	loadConfig: () => PromptAwareConfig;
	executePlan: (plan: PromptPlan) => Promise<PromptCommandResult>;
	onComplete: (result: PromptCommandResult) => void;
	onCancel: () => void;
}

const EditPromptContentModal: React.FC<EditPromptContentModalProps> = ({
	scope,
	repoId,
	repoName,
	prompt,
	definition,
	loadConfig,
	executePlan,
	onComplete,
	onCancel,
}) => {
	const [message, setMessage] = useState<string | undefined>(
		`Press Enter to edit ${prompt.prompt} in your editor (${
			process.env.EDITOR || "vi"
		}).`,
	);
	const [error, setError] = useState<string | undefined>();
	const [submitting, setSubmitting] = useState(false);

	useInput(
		(_input, key) => {
			if (submitting) {
				return;
			}
			if (key.escape) {
				onCancel();
				return;
			}
			if (key.return) {
				void (async () => {
					try {
						setError(undefined);
						setMessage("Opening editor...");
						const dir = mkdtempSync(join(tmpdir(), "cyrus-edit-"));
						const tempPath = join(dir, `prompt-${prompt.prompt}.md`);
						writeFileSync(tempPath, definition?.content ?? "", "utf-8");

						const editor = process.env.EDITOR || "vi";
						const result = spawnSync(editor, [tempPath], {
							stdio: "inherit",
						});
						if (result.error) {
							throw result.error;
						}
						if (typeof result.status === "number" && result.status !== 0) {
							throw new Error(`${editor} exited with status ${result.status}`);
						}

						setSubmitting(true);
						const config = loadConfig();
						const plan = buildEditPromptPlan(config, {
							name: prompt.prompt,
							repoId,
							promptFilePath: tempPath,
						});
						const resultPlan = await executePlan(plan);
						setSubmitting(false);
						onComplete(resultPlan);
						unlinkSync(tempPath);
					} catch (err) {
						setSubmitting(false);
						setError((err as Error).message);
						setMessage("Editing cancelled. Press Esc to close.");
					}
				})();
			}
		},
		{ isActive: true },
	);

	return (
		<ModalContainer title={`Edit Content — ${prompt.prompt}`}>
			<Text>{message ?? "Press Enter to edit this prompt."}</Text>
			<Text color="gray">
				Context:{" "}
				{scope === "global"
					? "Global prompt"
					: `Repository ${repoName ?? repoId ?? ""}`}
			</Text>
			<Text color="gray">Esc to cancel</Text>
			{submitting ? <Text color="green">Updating prompt...</Text> : null}
			{error ? <Text color="red">{error}</Text> : null}
		</ModalContainer>
	);
};

interface DeletePromptModalProps {
	scope: PromptScope;
	repoId?: string;
	repoName?: string;
	prompt: PromptSummary;
	loadConfig: () => PromptAwareConfig;
	executePlan: (plan: PromptPlan) => Promise<PromptCommandResult>;
	onComplete: (result: PromptCommandResult) => void;
	onCancel: () => void;
}

const DeletePromptModal: React.FC<DeletePromptModalProps> = ({
	scope,
	repoId,
	repoName,
	prompt,
	loadConfig,
	executePlan,
	onComplete,
	onCancel,
}) => {
	const [error, setError] = useState<string | undefined>();
	const [submitting, setSubmitting] = useState(false);

	useInput(
		(input, key) => {
			if (submitting) {
				return;
			}
			if (key.escape || input === "n" || input === "N") {
				onCancel();
				return;
			}
			if (input === "y" || input === "Y") {
				void (async () => {
					try {
						setSubmitting(true);
						const config = loadConfig();
						const plan = buildDeletePromptPlan(config, {
							name: prompt.prompt,
							repoId,
						});
						const resultPlan = await executePlan(plan);
						setSubmitting(false);
						onComplete(resultPlan);
					} catch (err) {
						setSubmitting(false);
						setError((err as Error).message);
					}
				})();
			}
		},
		{ isActive: true },
	);

	return (
		<ModalContainer title={`Delete Prompt — ${prompt.prompt}`}>
			<Text color="yellow">
				This will remove the custom prompt and its markdown file. Are you sure?
				(y/N)
			</Text>
			<Text color="gray">
				Context:{" "}
				{scope === "global"
					? "Global prompt"
					: `Repository ${repoName ?? repoId ?? ""}`}
			</Text>
			{submitting ? <Text color="green">Deleting prompt...</Text> : null}
			{error ? <Text color="red">{error}</Text> : null}
		</ModalContainer>
	);
};

export default PromptTuiApp;
export {
	CreatePromptModal,
	EditPromptLabelsModal,
	EditPromptContentModal,
	DeletePromptModal,
	parseLabelInput,
	formatConflictSummary,
	formatResultMessage,
};
