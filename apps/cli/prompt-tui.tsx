import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { PromptInventory, PromptSummary } from "./prompt-list.js";

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

const MAX_STATUS_DURATION_MS = 4000;

type ViewMode = "selection" | "repo-select" | "global" | "repo";

interface PromptTuiProps {
	loadInventory: () => PromptInventory;
}

export async function runPromptTui(
	loadInventory: () => PromptInventory,
): Promise<void> {
	const initialInventory = loadInventory();
	const inkApp = render(
		<PromptTuiApp
			loadInventory={loadInventory}
			initialInventory={initialInventory}
		/>,
	);
	await inkApp.waitUntilExit();
}

interface PromptTuiAppProps extends PromptTuiProps {
	initialInventory: PromptInventory;
}

const PromptTuiApp: React.FC<PromptTuiAppProps> = ({
	loadInventory,
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
		return map;
	}, [inventory.repositories]);

	const globalPrompts = useMemo(() => {
		return inventory.definitions
			.filter((definition) => definition.scope === "global")
			.map((definition) => ({
				prompt: definition.prompt,
				source: definition.source,
				labels: Array.from(aggregatedLabels.get(definition.id) ?? []),
				definitionId: definition.id,
			}))
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

	const refreshInventory = () => {
		try {
			const data = loadInventory();
			setInventory(data);
			setViewMode("selection");
			setSelectedRepoId(null);
			setSearchTerm("");
			setPromptIndex(0);
			setPreviewOffset(0);
			setFullView(false);
			notify("Prompt inventory refreshed.");
		} catch (error) {
			notify(`Failed to reload prompts: ${(error as Error).message}`);
		}
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

			if (input === "c" || input === "e" || input === "E" || input === "d") {
				notify("Editing workflows will arrive with the next milestone.");
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
				const chunk = Math.max(stdoutHeight - 10, 5);
				setPreviewOffset((prev) =>
					Math.min(totalLines.length - chunk, Math.max(0, prev + chunk)),
				);
				return;
			}

			if (key.pageUp || input === "[") {
				const chunk = Math.max(stdoutHeight - 10, 5);
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
	const availablePreviewHeight = Math.max(stdoutHeight - 9, 8);
	const previewLines = selectedDefinition?.content?.split(/\r?\n/) ?? [
		"No prompt content available.",
	];
	const maxOffset = Math.max(0, previewLines.length - availablePreviewHeight);
	const effectiveOffset = Math.min(previewOffset, maxOffset);
	const visibleLines = previewLines.slice(
		effectiveOffset,
		effectiveOffset + availablePreviewHeight,
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
		</Box>
	);
};

export default PromptTuiApp;
