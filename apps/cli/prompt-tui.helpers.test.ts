import { describe, expect, it } from "vitest";
import type { PromptCommandResult } from "./prompt-executor.js";
import {
	formatConflictSummary,
	formatResultMessage,
	parseLabelInput,
} from "./prompt-tui.js";

describe("prompt TUI helpers", () => {
	it("normalises and filters label input", () => {
		expect(parseLabelInput(" bug , feature , ")).toEqual(["bug", "feature"]);
		expect(parseLabelInput("")).toEqual([]);
	});

	it("formats conflict summaries across scopes", () => {
		const summary = formatConflictSummary([
			{ label: "bug", prompt: "debugger", scope: "global" },
			{
				label: "feature",
				prompt: "builder",
				scope: "repository",
				repositoryId: "repo-1",
			},
		]);
		expect(summary).toContain("bug → debugger (global)");
		expect(summary).toContain("feature → builder (repo repo-1)");
	});

	it("describes prompt command results for status messaging", () => {
		const result: PromptCommandResult = {
			status: "success",
			action: "create",
			scope: "repository",
			prompt: {
				name: "builder",
				displayName: "Builder",
				labels: ["feature"],
				repositoryId: "repo-1",
				repositoryName: "Repo One",
				previousLabels: undefined,
				promptPath: "/tmp/custom-builder.md",
				previousPromptPath: undefined,
			},
			warnings: ["Duplicate labels removed"],
			conflicts: [],
			dryRun: false,
			backupPath: "/tmp/config.json.202403041200",
			fileOperation: "create",
		};

		const message = formatResultMessage(result);
		expect(message).toContain(
			'Created prompt "builder" for repository Repo One',
		);
	});
});
