import type { McpServerConfig } from "cyrus-claude-runner";
import {
	detectLanguages,
	type LspLanguageConfig,
	SUPPORTED_LANGUAGES,
} from "./detectLanguages.js";

/**
 * Build MCP server configurations for detected languages in a workspace.
 *
 * Uses `mcp-language-server` (https://github.com/isaacphi/mcp-language-server)
 * to wrap language-specific LSP servers and expose them as MCP tools:
 * - `definition` – retrieve source code of symbol definitions
 * - `references` – find all usages of a symbol
 * - `diagnostics` – get warnings/errors for a file
 * - `hover` – show documentation and type info
 * - `rename_symbol` – rename across the project
 * - `edit_file` – apply text edits by line number
 *
 * @param workspacePath Absolute path to the project root / worktree
 * @returns Record of MCP server configs keyed as `lsp-<language>`
 */
export function buildLspMcpConfig(
	workspacePath: string,
): Record<string, McpServerConfig> {
	if (!workspacePath) return {};

	const languages = detectLanguages(workspacePath);
	const config: Record<string, McpServerConfig> = {};

	for (const language of languages) {
		const langConfig: LspLanguageConfig = SUPPORTED_LANGUAGES[language];

		const args = ["--workspace", workspacePath, "--lsp", langConfig.lspCommand];

		// Append language-server-specific arguments after the `--` separator
		if (langConfig.lspArgs && langConfig.lspArgs.length > 0) {
			args.push("--", ...langConfig.lspArgs);
		}

		config[`lsp-${language}`] = {
			command: "mcp-language-server",
			args,
		};
	}

	return config;
}
