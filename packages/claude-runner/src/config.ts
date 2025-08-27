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
 * Note: TodoWrite is included as it only modifies task tracking, not actual code files
 */
export const readOnlyTools: ToolName[] = [
	"Read(**)",
	"WebFetch",
	"WebSearch",
	"TodoRead",
	"TodoWrite",
	"NotebookRead",
	"Task",
	"Batch",
];

/**
 * Tools that can modify the file system or state
 * Note: TodoWrite modifies task state but not actual files
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
 * Get coordinator tools - all tools except those that can edit files
 * Includes: Read, Bash (for running tests/builds), Task, WebFetch, WebSearch, TodoRead, TodoWrite, NotebookRead, Batch
 * Excludes: Edit, NotebookEdit (no file/content modification)
 * Used by orchestrator role for coordination without direct file modification
 * Note: TodoWrite is included for task tracking during coordination
 */
export function getCoordinatorTools(): string[] {
	return [
		"Read(**)",
		"Bash", // Included for running tests, builds, git commands
		"Task",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"TodoWrite", // For task tracking during coordination
		"NotebookRead",
		"Batch",
	];
}
