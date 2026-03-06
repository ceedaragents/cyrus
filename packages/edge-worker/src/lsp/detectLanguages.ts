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

export const SUPPORTED_LANGUAGES = {
	typescript: {
		lspCommand: "typescript-language-server",
		lspArgs: ["--stdio"],
		markers: ["tsconfig.json", "tsconfig.base.json"],
	},
	go: {
		lspCommand: "gopls",
		markers: ["go.mod"],
	},
	rust: {
		lspCommand: "rust-analyzer",
		markers: ["Cargo.toml"],
	},
	python: {
		lspCommand: "pyright-langserver",
		lspArgs: ["--stdio"],
		markers: ["pyproject.toml", "setup.py", "requirements.txt"],
	},
} satisfies Record<string, LspLanguageConfig>;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

/**
 * Detect which languages are present in a workspace by checking for marker files.
 *
 * Uses synchronous `existsSync` intentionally — the number of marker checks is
 * small (≤ 8 for 4 languages) so the blocking cost is negligible. If the
 * supported language set grows significantly, consider switching to async I/O.
 *
 * Returns an array of language keys (e.g. `["typescript", "go"]`) that have at
 * least one marker file present in `workspacePath`.
 */
export function detectLanguages(workspacePath: string): SupportedLanguage[] {
	const detected: SupportedLanguage[] = [];

	for (const language of Object.keys(
		SUPPORTED_LANGUAGES,
	) as SupportedLanguage[]) {
		const config = SUPPORTED_LANGUAGES[language];
		const hasMarker = config.markers.some((marker) =>
			existsSync(join(workspacePath, marker)),
		);
		if (hasMarker) {
			detected.push(language);
		}
	}

	return detected;
}
