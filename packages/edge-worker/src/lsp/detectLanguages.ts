import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Supported language server identifiers and their detection config.
 *
 * Each entry maps a human-readable language key to:
 * - `lspCommand`: the language server binary invoked by mcp-language-server
 * - `lspArgs`: extra arguments passed *after* `--` to the language server
 * - `markers`: file/directory names whose presence in the workspace root signals the language
 */
export interface LspLanguageConfig {
	lspCommand: string;
	lspArgs?: string[];
	markers: string[];
}

export const SUPPORTED_LANGUAGES: Record<string, LspLanguageConfig> = {
	typescript: {
		lspCommand: "typescript-language-server",
		lspArgs: ["--stdio"],
		markers: ["tsconfig.json", "tsconfig.base.json"],
	},
	go: {
		lspCommand: "gopls",
		lspArgs: [],
		markers: ["go.mod"],
	},
	rust: {
		lspCommand: "rust-analyzer",
		lspArgs: [],
		markers: ["Cargo.toml"],
	},
	python: {
		lspCommand: "pyright-langserver",
		lspArgs: ["--stdio"],
		markers: ["pyproject.toml", "setup.py", "requirements.txt"],
	},
};

/**
 * Detect which languages are present in a workspace by checking for marker files.
 *
 * Returns an array of language keys (e.g. `["typescript", "go"]`) that have at
 * least one marker file present in `workspacePath`.
 */
export function detectLanguages(workspacePath: string): string[] {
	const detected: string[] = [];

	for (const [language, config] of Object.entries(SUPPORTED_LANGUAGES)) {
		const hasMarker = config.markers.some((marker) =>
			existsSync(join(workspacePath, marker)),
		);
		if (hasMarker) {
			detected.push(language);
		}
	}

	return detected;
}
