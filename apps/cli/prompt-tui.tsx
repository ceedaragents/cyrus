import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
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
	const [focus, setFocus] = useState<"repo" | "prompt">("repo");
	const [repoIndex, setRepoIndex] = useState(0);
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

	const globalRepository = useMemo(() => {
		const prompts: PromptSummary[] = inventory.definitions
			.filter((definition) => definition.scope === "global")
			.map((definition) => ({
				prompt: definition.prompt,
				source: definition.source,
				labels: Array.from(aggregatedLabels.get(definition.id) ?? []),
				definitionId: definition.id,
			}))
			.sort((a, b) => a.prompt.localeCompare(b.prompt));

		if (prompts.length === 0) {
			return undefined;
		}

		return {
			repositoryId: "__global__",
			repositoryName: "Global prompts",
			prompts,
		};
	}, [aggregatedLabels, inventory.definitions]);

	const tuiRepositories = useMemo(() => {
		const repos = inventory.repositories.map((repo) => ({
			repositoryId: repo.repositoryId,
			repositoryName: repo.repositoryName,
			prompts: repo.prompts.map((prompt) => ({ ...prompt })),
		}));
		return globalRepository ? [globalRepository, ...repos] : repos;
	}, [inventory.repositories, globalRepository]);

	const filteredRepositories = useMemo(() => {
		if (!searchTerm.trim()) {
			return tuiRepositories;
		}
		const lower = searchTerm.toLowerCase();
		return tuiRepositories.filter((repo) => {
			const name = repo.repositoryName?.toLowerCase() ?? "";
			return (
				name.includes(lower) || repo.repositoryId.toLowerCase().includes(lower)
			);
		});
	}, [tuiRepositories, searchTerm]);

	const selectedRepository = filteredRepositories[repoIndex];
	const selectedPrompt = selectedRepository?.prompts[promptIndex];
	const selectedDefinition = selectedPrompt
		? definitionsById.get(selectedPrompt.definitionId)
		: undefined;

	useEffect(() => {
		if (repoIndex >= filteredRepositories.length) {
			setRepoIndex(
				filteredRepositories.length > 0 ? filteredRepositories.length - 1 : 0,
			);
		}
	}, [filteredRepositories, repoIndex]);

	useEffect(() => {
		setPromptIndex(0);
	}, []);

	useEffect(() => {
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
			setRepoIndex(0);
			setPromptIndex(0);
			setPreviewOffset(0);
			setFullView(false);
			notify("Prompt inventory refreshed.");
		} catch (error) {
			notify(`Failed to reload prompts: ${(error as Error).message}`);
		}
	};

	useInput(
		(input, key) => {
			if (fullView) {
				if (key.escape || input === "q") {
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

			if (key.tab) {
				setFocus((prev) => (prev === "repo" ? "prompt" : "repo"));
				return;
			}

			if (input === "q" || (key.ctrl && input === "c")) {
				exit();
				return;
			}

			if (input === "?" || input === "h") {
				notify(
					"Keys: arrows navigate, Tab switches panes, / search repos, Enter full view, o open in pager, w write file, r reload, q quit.",
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
				const chunk = Math.max(stdoutHeight - 12, 5);
				setPreviewOffset((prev) =>
					Math.min(totalLines.length - chunk, Math.max(0, prev + chunk)),
				);
				return;
			}

			if (key.pageUp || input === "[") {
				const chunk = Math.max(stdoutHeight - 12, 5);
				setPreviewOffset((prev) => Math.max(0, prev - chunk));
				return;
			}

			if (focus === "repo") {
				if (key.downArrow) {
					setRepoIndex((prev) =>
						Math.min(filteredRepositories.length - 1, prev + 1),
					);
					return;
				}
				if (key.upArrow) {
					setRepoIndex((prev) => Math.max(0, prev - 1));
					return;
				}
			}

			if (focus === "prompt" && selectedRepository) {
				const promptCount = selectedRepository.prompts.length;
				if (promptCount === 0) {
					return;
				}
				if (key.downArrow) {
					setPromptIndex((prev) => Math.min(promptCount - 1, prev + 1));
					return;
				}
				if (key.upArrow) {
					setPromptIndex((prev) => Math.max(0, prev - 1));
					return;
				}
			}
		},
		{ isActive: true },
	);

	if (tuiRepositories.length === 0) {
		return (
			<Box flexDirection="column">
				<Text>
					No repositories configured. Run `cyrus add-repository` first.
				</Text>
				<Text color="gray">Press q to exit.</Text>
			</Box>
		);
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
					Press Esc to return · o open in pager · w write to temp file
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

	const repositoryPaneWidth = Math.max(Math.floor(stdoutWidth * 0.32), 24);
	const promptPaneWidth = Math.max(Math.floor(stdoutWidth * 0.28), 24);
	const previewWidth = Math.max(
		stdoutWidth - repositoryPaneWidth - promptPaneWidth - 4,
		20,
	);
	const availablePreviewHeight = Math.max(stdoutHeight - 10, 8);
	const previewLines = selectedDefinition?.content?.split(/\r?\n/) ?? [
		"No prompt content available.",
	];
	const maxOffset = Math.max(0, previewLines.length - availablePreviewHeight);
	const effectiveOffset = Math.min(previewOffset, maxOffset);
	const visibleLines = previewLines.slice(
		effectiveOffset,
		effectiveOffset + availablePreviewHeight,
	);

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color="cyan" bold>
					Cyrus Prompt Manager (TUI)
				</Text>
			</Box>
			{showSearch ? (
				<Box marginBottom={1}>
					<Text color="yellow">Search repositories: </Text>
					<TextInput
						value={searchTerm}
						onChange={setSearchTerm}
						onSubmit={() => setShowSearch(false)}
					/>
					<Text color="gray"> (Esc to clear)</Text>
				</Box>
			) : (
				<Box marginBottom={1}>
					<Text color="gray">
						Press / to search, Enter for full view, Tab to change focus between
						panes.
					</Text>
				</Box>
			)}
			<Box flexDirection="row" gap={1}>
				<Box
					borderStyle="round"
					borderColor={focus === "repo" ? "green" : "gray"}
					flexDirection="column"
					width={repositoryPaneWidth}
				>
					<Box marginBottom={1}>
						<Text bold>Repositories</Text>
					</Box>
					{filteredRepositories.length === 0 ? (
						<Text color="gray">No matching repositories.</Text>
					) : (
						filteredRepositories.map((repo, index) => {
							const isSelected = index === repoIndex;
							const displayName = repo.repositoryName ?? repo.repositoryId;
							return (
								<Text
									key={repo.repositoryId}
									color={isSelected ? "green" : undefined}
								>
									{isSelected ? "➤ " : "  "}
									{displayName}
								</Text>
							);
						})
					)}
				</Box>
				<Box
					borderStyle="round"
					borderColor={focus === "prompt" ? "green" : "gray"}
					flexDirection="column"
					width={promptPaneWidth}
				>
					<Box marginBottom={1}>
						<Text bold>Prompts</Text>
					</Box>
					{selectedRepository ? (
						selectedRepository.prompts.map((prompt, index) => {
							const isSelected = index === promptIndex;
							const badges = prompt.source === "built-in" ? "[B]" : "[C]";
							return (
								<Text
									key={`${prompt.prompt}-${index}`}
									color={isSelected ? "green" : undefined}
								>
									{isSelected ? "➤ " : "  "}
									{`${badges} ${prompt.prompt}`}
									<Text color="gray">
										{" "}
										{`(${prompt.labels.length} labels)`}
									</Text>
								</Text>
							);
						})
					) : (
						<Text color="gray">Select a repository.</Text>
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
					view [o] Pager [w] Write file [r] Reload [/] Search [q] Quit [?] Help
				</Text>
			</Box>
			<Box marginTop={0}>
				{statusMessage ? (
					<Text color="yellow">{statusMessage}</Text>
				) : (
					<Text color="gray">
						Focus: {focus === "repo" ? "Repositories" : "Prompts"}
					</Text>
				)}
			</Box>
		</Box>
	);
};

export default PromptTuiApp;
