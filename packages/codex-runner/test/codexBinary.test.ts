import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveCodexAppServerLaunch } from "../src/backend/codexBinary.js";

const APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"];

describe("resolveCodexAppServerLaunch", () => {
	it("launches an explicit override binary directly", () => {
		expect(resolveCodexAppServerLaunch("/opt/codex")).toEqual({
			command: "/opt/codex",
			args: APP_SERVER_ARGS,
		});
	});

	it("launches the @openai/codex bin launcher via Node by default", () => {
		const { command, args } = resolveCodexAppServerLaunch();
		// Runs through the current Node so the launcher resolves its own native binary.
		expect(command).toBe(process.execPath);
		// args = [<launcher.js>, app-server, --listen, stdio://]
		expect(args.slice(1)).toEqual(APP_SERVER_ARGS);
		const launcher = args[0];
		expect(launcher.endsWith(".js")).toBe(true);
		expect(existsSync(launcher)).toBe(true);
	});
});
