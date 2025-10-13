import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROMPTS_DIRECTORY = resolve(
	fileURLToPath(new URL("../packages/edge-worker/prompts", import.meta.url)),
);

export function ensurePromptsDirectory(): void {
	if (!existsSync(PROMPTS_DIRECTORY)) {
		mkdirSync(PROMPTS_DIRECTORY, { recursive: true });
	}
}
