import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger, type ILogger } from "cyrus-core";

/**
 * Surgically updates the sandbox.network section of ~/.claude/settings.json
 * to route Claude Code's sandboxed subprocess network traffic through the
 * Cyrus egress proxy.
 *
 * Only touches the `sandbox.network` key — all other settings are preserved.
 */
export class ClaudeSettingsWriter {
	private settingsPath: string;
	private logger: ILogger;

	constructor(logger?: ILogger) {
		this.settingsPath = join(homedir(), ".claude", "settings.json");
		this.logger = logger ?? createLogger({ component: "ClaudeSettingsWriter" });
	}

	/**
	 * Write the sandbox network proxy ports to ~/.claude/settings.json.
	 * Creates the file/directory if they don't exist.
	 * Preserves all existing settings — only updates sandbox.network.
	 */
	writeSandboxPorts(httpProxyPort: number, socksProxyPort: number): void {
		const claudeDir = join(homedir(), ".claude");
		if (!existsSync(claudeDir)) {
			mkdirSync(claudeDir, { recursive: true });
		}

		let settings: Record<string, unknown> = {};

		if (existsSync(this.settingsPath)) {
			try {
				const content = readFileSync(this.settingsPath, "utf8");
				settings = JSON.parse(content);
			} catch (err) {
				this.logger.warn(
					"Failed to parse existing settings.json, creating new one:",
					err,
				);
				settings = {};
			}
		}

		// Preserve existing sandbox settings, only update network
		const existingSandbox =
			typeof settings.sandbox === "object" && settings.sandbox !== null
				? (settings.sandbox as Record<string, unknown>)
				: {};

		settings.sandbox = {
			...existingSandbox,
			network: {
				httpProxyPort,
				socksProxyPort,
			},
		};

		writeFileSync(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		this.logger.info(
			`Updated ${this.settingsPath} sandbox.network (HTTP: ${httpProxyPort}, SOCKS: ${socksProxyPort})`,
		);
	}

	/**
	 * Remove sandbox.network from ~/.claude/settings.json.
	 * Called on shutdown to restore clean state.
	 */
	removeSandboxPorts(): void {
		if (!existsSync(this.settingsPath)) return;

		try {
			const content = readFileSync(this.settingsPath, "utf8");
			const settings = JSON.parse(content);

			if (typeof settings.sandbox === "object" && settings.sandbox !== null) {
				delete settings.sandbox.network;

				// Clean up empty sandbox object
				if (Object.keys(settings.sandbox).length === 0) {
					delete settings.sandbox;
				}
			}

			writeFileSync(
				this.settingsPath,
				`${JSON.stringify(settings, null, 2)}\n`,
			);
			this.logger.info(`Removed sandbox.network from ${this.settingsPath}`);
		} catch (err) {
			this.logger.warn("Failed to clean up settings.json:", err);
		}
	}
}
