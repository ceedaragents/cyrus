import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Manages system prompts for Gemini CLI by writing them to disk
 * and configuring the GEMINI_SYSTEM_MD environment variable.
 *
 * Unlike Claude runner which can accept system prompts directly,
 * Gemini CLI requires system prompts to be in a file on disk.
 */
export class SystemPromptManager {
	private cyrusHome: string;
	private systemPromptPath: string;

	constructor(cyrusHome: string) {
		this.cyrusHome = cyrusHome;
		// Use a dedicated path in ~/.cyrus/ for Gemini system prompts
		this.systemPromptPath = join(this.cyrusHome, "gemini-system-prompt.md");
	}

	/**
	 * Write system prompt to disk and return the path to be used with GEMINI_SYSTEM_MD
	 */
	async prepareSystemPrompt(systemPrompt: string): Promise<string> {
		try {
			// Ensure cyrus home directory exists
			await mkdir(this.cyrusHome, { recursive: true });

			// Write system prompt to file
			await writeFile(this.systemPromptPath, systemPrompt, "utf8");

			console.log(
				`[SystemPromptManager] Wrote system prompt to: ${this.systemPromptPath}`,
			);

			return this.systemPromptPath;
		} catch (error) {
			console.error(
				"[SystemPromptManager] Failed to write system prompt:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Get the path where system prompts are stored
	 */
	getSystemPromptPath(): string {
		return this.systemPromptPath;
	}

	/**
	 * Resolve tilde (~) in paths to absolute home directory path
	 */
	static resolveTildePath(path: string): string {
		if (path.startsWith("~/")) {
			return join(homedir(), path.slice(2));
		}
		return path;
	}
}
