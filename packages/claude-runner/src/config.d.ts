/**
 * Claude CLI configuration helpers
 */
/**
 * List of all available tools in Claude Code
 */
export declare const availableTools: readonly [
	"Read(**)",
	"Edit(**)",
	"Bash",
	"Task",
	"WebFetch",
	"WebSearch",
	"TodoRead",
	"TodoWrite",
	"NotebookRead",
	"NotebookEdit",
	"Batch",
];
export type ToolName = (typeof availableTools)[number];
/**
 * Default read-only tools that are safe to enable
 * Note: TodoWrite is included as it only modifies task tracking, not actual code files
 */
export declare const readOnlyTools: ToolName[];
/**
 * Tools that can modify the file system or state
 * Note: TodoWrite modifies task state but not actual files
 */
export declare const writeTools: ToolName[];
/**
 * Get a safe set of tools for read-only operations
 */
export declare function getReadOnlyTools(): string[];
/**
 * Get all available tools
 */
export declare function getAllTools(): string[];
/**
 * Get all tools except Bash (safer default for repository configuration)
 */
export declare function getSafeTools(): string[];
/**
 * Get coordinator tools - all tools except those that can edit files
 * Includes: Read, Bash (for running tests/builds), Task, WebFetch, WebSearch, TodoRead, TodoWrite, NotebookRead, Batch
 * Excludes: Edit, NotebookEdit (no file/content modification)
 * Used by orchestrator role for coordination without direct file modification
 * Note: TodoWrite is included for task tracking during coordination
 */
export declare function getCoordinatorTools(): string[];
//# sourceMappingURL=config.d.ts.map
