/**
 * Version command - Display version information
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { error, success } from "../utils/colors.js";
import { formatKeyValue } from "../utils/output.js";
import { printRpcUrl, rpcCall } from "../utils/rpc.js";

interface VersionResult {
	server: string;
	api: string;
	platform: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createVersionCommand(): Command {
	const cmd = new Command("version");

	cmd
		.description("Display version information for CLI and server")
		.action(async () => {
			// Get CLI version from package.json
			// From src/commands/, need to go up 2 levels to reach package.json
			const packageJsonPath = resolve(__dirname, "..", "..", "package.json");
			const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
			const cliVersion = packageJson.version as string;

			printRpcUrl();

			try {
				const result = await rpcCall<VersionResult>("version");

				console.log(success("Version Information"));
				console.log(`  ${formatKeyValue("CLI Version", cliVersion)}`);
				console.log(`  ${formatKeyValue("Server Version", result.server)}`);
				console.log(`  ${formatKeyValue("API Version", result.api)}`);
				console.log(`  ${formatKeyValue("Platform", result.platform)}`);
			} catch (err) {
				if (err instanceof Error) {
					console.error(error(`Version check failed: ${err.message}`));
					process.exit(1);
				}
				throw err;
			}
		});

	return cmd;
}
