/**
 * Claude CLI configuration helpers
 */

/**
 * List of all available tools in Claude Code
 */
export const availableTools = [
	// File system tools
	"Read(**)",
	"Edit(**)",

	// Execution tools
	"Bash",
	"Task",

	// Web tools
	"WebFetch",
	"WebSearch",

	// Task management
	"TodoRead",
	"TodoWrite",

	// Notebook tools
	"NotebookRead",
	"NotebookEdit",

	// Utility tools
	"Batch",
] as const;

export type ToolName = (typeof availableTools)[number];

/**
 * Default read-only tools that are safe to enable
 */
export const readOnlyTools: ToolName[] = [
	"Read(**)",
	"WebFetch",
	"WebSearch",
	"TodoRead",
	"NotebookRead",
	"Task",
	"Batch",
];

/**
 * Tools that can modify the file system
 */
export const writeTools: ToolName[] = [
	"Edit(**)",
	"Bash",
	"TodoWrite",
	"NotebookEdit",
];

/**
 * Get a safe set of tools for read-only operations
 */
export function getReadOnlyTools(): string[] {
	return [...readOnlyTools];
}

/**
 * Get all available tools
 */
export function getAllTools(): string[] {
	return [...availableTools];
}

/**
 * Get all tools except Bash (safer default for repository configuration)
 */
export function getSafeTools(): string[] {
	return [
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
	];
}

/**
 * Get orchestrator tools - all tools except those that can edit files
 * Includes: Read, Bash (for running tests/builds), Task, WebFetch, WebSearch, TodoRead, NotebookRead, Batch
 * Excludes: Edit, TodoWrite, NotebookEdit (no file/content modification)
 */
export function getOrchestratorTools(): string[] {
	return [
		"Read(**)",
		"Bash", // Included for running tests, builds, git commands
		"Task",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"NotebookRead",
		"Batch",
	];
}
