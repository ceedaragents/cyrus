import type { McpServerConfig } from "cyrus-claude-runner";
import {
	detectLanguages,
	isBinaryAvailable,
	type LspLanguageConfig,
	SUPPORTED_LANGUAGES,
} from "./detectLanguages.js";

/** Go module path for mcp-language-server, used with `go run`. */
const MCP_LANGUAGE_SERVER_MODULE =
	"github.com/isaacphi/mcp-language-server@latest";

/**
 * Resolve the command + prefix args needed to invoke `mcp-language-server`.
 *
 * 1. If the `mcp-language-server` binary is on PATH → use it directly.
 * 2. Else if `go` is on PATH → use `go run <module>` (auto-downloads & caches).
 * 3. Otherwise → return `null` (LSP MCP cannot be started).
 */
function resolveMcpLanguageServerCommand(): {
	command: string;
	prefixArgs: string[];
} | null {
	if (isBinaryAvailable("mcp-language-server")) {
		return { command: "mcp-language-server", prefixArgs: [] };
	}
	if (isBinaryAvailable("go")) {
		return {
			command: "go",
			prefixArgs: ["run", MCP_LANGUAGE_SERVER_MODULE],
		};
	}
	return null;
}

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
 * The function checks binary availability before injecting configs:
 * - Requires `mcp-language-server` on PATH, or `go` (for `go run` fallback)
 * - Requires the language-specific LSP binary (e.g. `typescript-language-server`)
 * - Skips languages whose LSP binary is not installed
 *
 * @param workspacePath Absolute path to the project root / worktree
 * @returns Record of MCP server configs keyed as `lsp-<language>`
 */
export function buildLspMcpConfig(
	workspacePath: string,
): Record<string, McpServerConfig> {
	if (!workspacePath) return {};

	// Ensure mcp-language-server (or Go toolchain) is available
	const resolved = resolveMcpLanguageServerCommand();
	if (!resolved) return {};

	const languages = detectLanguages(workspacePath);
	const config: Record<string, McpServerConfig> = {};

	for (const language of languages) {
		const langConfig: LspLanguageConfig = SUPPORTED_LANGUAGES[language];

		// Skip if the language server binary is not installed
		if (!isBinaryAvailable(langConfig.lspCommand)) continue;

		const args = [
			...resolved.prefixArgs,
			"--workspace",
			workspacePath,
			"--lsp",
			langConfig.lspCommand,
		];

		// Append language-server-specific arguments after the `--` separator
		if (langConfig.lspArgs && langConfig.lspArgs.length > 0) {
			args.push("--", ...langConfig.lspArgs);
		}

		config[`lsp-${language}`] = {
			command: resolved.command,
			args,
		};
	}

	return config;
}
