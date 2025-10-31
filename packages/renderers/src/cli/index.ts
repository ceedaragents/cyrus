/**
 * CLI Renderer - Interactive terminal UI for Cyrus agent sessions
 *
 * Provides a Linear activity panel-like experience in the CLI with:
 * - Real-time activity updates
 * - Scrollable activity history
 * - Interactive message input
 * - Stop command (Ctrl+S)
 * - Status indicators
 */

export type {
	ActivityItem,
	CLIRendererConfig,
	StatusIcons,
} from "./CLIRenderer.js";
export { CLIRenderer } from "./CLIRenderer.js";
