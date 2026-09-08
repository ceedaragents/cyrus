import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const CODEX_NPM_NAME = "@openai/codex";
/** The `codex app-server` subcommand + transport flags shared by both launch modes. */
const APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"] as const;

/** How to launch a `codex app-server` process: a command + its full argv. */
export interface CodexAppServerLaunch {
	command: string;
	args: string[];
}

/**
 * Resolve how to launch `codex app-server`.
 *
 * The `@openai/codex-sdk` only exposes the high-level `Codex`/`Thread` API (no
 * app-server transport, no `turn/steer`), and no getter for its bundled binary,
 * so we drive the CLI ourselves. Rather than re-derive the platform→vendor
 * binary path (a fragile coupling to the SDK's internal layout), we invoke the
 * `@openai/codex` package's **public** `bin` launcher (`bin/codex.js`) via Node:
 * that launcher owns the platform-package/vendor resolution and forwards stdio
 * + termination signals to the native binary. We read its location from the
 * package's own `package.json` `bin` entry, so a future vendor-layout change
 * upstream costs us nothing.
 *
 * @param override Explicit Codex binary path (from config). When set, that
 * binary is launched directly (no Node launcher) — mirrors the SDK's
 * `codexPathOverride`.
 */
export function resolveCodexAppServerLaunch(
	override?: string,
): CodexAppServerLaunch {
	if (override) {
		return { command: override, args: [...APP_SERVER_ARGS] };
	}

	const require = createRequire(import.meta.url);
	let packageJsonPath: string;
	try {
		packageJsonPath = require.resolve(`${CODEX_NPM_NAME}/package.json`);
	} catch {
		throw new Error(
			`Unable to locate ${CODEX_NPM_NAME}. Ensure it is installed as a dependency.`,
		);
	}

	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
		bin?: string | Record<string, string>;
	};
	const binRelative = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.codex;
	if (!binRelative) {
		throw new Error(
			`${CODEX_NPM_NAME} has no \`codex\` bin entry; cannot locate the CLI launcher.`,
		);
	}

	const launcher = path.join(path.dirname(packageJsonPath), binRelative);
	return { command: process.execPath, args: [launcher, ...APP_SERVER_ARGS] };
}
