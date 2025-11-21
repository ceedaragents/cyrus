import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Gemini models that need -shortone aliases
 * Based on Connor's specification - only the 4 main models
 */
const GEMINI_MODELS = [
	"gemini-3-pro-preview",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
] as const;

/**
 * Generates settings.json structure with -shortone aliases for all models
 * Reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/configuration.md
 */
function generateSettings() {
	const aliases: Record<string, { name: string; maxSessionTurns: number }> = {};

	for (const model of GEMINI_MODELS) {
		aliases[`${model}-shortone`] = {
			name: model,
			maxSessionTurns: 1,
		};
	}

	return {
		general: {
			previewFeatures: true,
		},
		modelConfigs: {
			aliases,
		},
	};
}

/**
 * Ensures ~/.gemini/settings.json exists with -shortone aliases
 * If file already exists, leaves it untouched
 */
export function ensureGeminiSettings(): void {
	const geminiDir = join(homedir(), ".gemini");
	const settingsPath = join(geminiDir, "settings.json");

	// If settings.json already exists, don't touch it
	if (existsSync(settingsPath)) {
		return;
	}

	// Create ~/.gemini directory if it doesn't exist
	if (!existsSync(geminiDir)) {
		mkdirSync(geminiDir, { recursive: true });
	}

	// Write settings.json with -shortone aliases
	const settings = generateSettings();
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}
