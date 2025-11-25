import {
	copyFileSync,
	existsSync,
	mkdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GEMINI_DIR = join(homedir(), ".gemini");
const SETTINGS_PATH = join(GEMINI_DIR, "settings.json");
const BACKUP_PATH = join(GEMINI_DIR, "settings.json.backup");

/**
 * Generates settings.json structure with maxSessionTurns
 * Reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/configuration.md
 *
 * Based on investigation of Gemini CLI source code, maxSessionTurns is a top-level
 * setting under "model", not a per-alias configuration. Aliases can only configure
 * generateContentConfig parameters (temperature, topP, etc).
 */
function generateSettings(maxSessionTurns: number): object {
	return {
		general: {
			previewFeatures: true,
		},
		model: {
			maxSessionTurns: maxSessionTurns,
		},
	};
}

/**
 * Backup existing settings.json if it exists
 * Returns true if backup was created, false if no file to backup
 */
export function backupGeminiSettings(): boolean {
	if (!existsSync(SETTINGS_PATH)) {
		return false;
	}

	// Create backup
	copyFileSync(SETTINGS_PATH, BACKUP_PATH);
	console.log(`[GeminiRunner] Backed up settings.json to ${BACKUP_PATH}`);
	return true;
}

/**
 * Restore settings.json from backup
 * Returns true if restored, false if no backup exists
 */
export function restoreGeminiSettings(): boolean {
	if (!existsSync(BACKUP_PATH)) {
		return false;
	}

	// Restore from backup
	copyFileSync(BACKUP_PATH, SETTINGS_PATH);
	unlinkSync(BACKUP_PATH);
	console.log(`[GeminiRunner] Restored settings.json from backup`);
	return true;
}

/**
 * Delete settings.json (used when no backup existed)
 */
export function deleteGeminiSettings(): void {
	if (existsSync(SETTINGS_PATH)) {
		unlinkSync(SETTINGS_PATH);
		console.log(`[GeminiRunner] Deleted temporary settings.json`);
	}
}

/**
 * Write settings.json with specified maxSessionTurns
 * Creates ~/.gemini directory if it doesn't exist
 */
export function writeGeminiSettings(maxSessionTurns: number): void {
	// Create ~/.gemini directory if it doesn't exist
	if (!existsSync(GEMINI_DIR)) {
		mkdirSync(GEMINI_DIR, { recursive: true });
	}

	// Generate and write settings
	const settings = generateSettings(maxSessionTurns);
	writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
	console.log(
		`[GeminiRunner] Wrote settings.json with maxSessionTurns=${maxSessionTurns}`,
	);
}

/**
 * Setup Gemini settings for a session based on singleTurn mode
 * Returns cleanup function to call when session ends
 */
export function setupGeminiSettings(maxSessionTurns: number): () => void {
	const hadBackup = backupGeminiSettings();

	// Write settings with appropriate maxSessionTurns
	writeGeminiSettings(maxSessionTurns);

	// Return cleanup function
	return () => {
		if (hadBackup) {
			restoreGeminiSettings();
		} else {
			deleteGeminiSettings();
		}
	};
}
