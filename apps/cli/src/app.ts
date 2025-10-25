#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application } from "./Application.js";
import { AuthCommand } from "./commands/AuthCommand.js";
import { BillingCommand } from "./commands/BillingCommand.js";
import { CheckTokensCommand } from "./commands/CheckTokensCommand.js";
import { RefreshTokenCommand } from "./commands/RefreshTokenCommand.js";
import { SetCustomerIdCommand } from "./commands/SetCustomerIdCommand.js";
import { StartCommand } from "./commands/StartCommand.js";

// Parse command line arguments
const args = process.argv.slice(2);
const cyrusHomeArg = args.find((arg) => arg.startsWith("--cyrus-home="));

// Determine the Cyrus home directory once at startup
let CYRUS_HOME: string;
if (cyrusHomeArg) {
	const customPath = cyrusHomeArg.split("=")[1];
	if (customPath) {
		CYRUS_HOME = resolve(customPath);
	} else {
		console.error("Error: --cyrus-home flag requires a directory path");
		process.exit(1);
	}
} else {
	CYRUS_HOME = resolve(homedir(), ".cyrus");
}

// Get the directory of the current module for reading package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the actual version
// When compiled, this is in dist/src/, so we need to go up two levels
const packageJsonPath = resolve(__dirname, "..", "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

// Handle --version argument
if (args.includes("--version")) {
	console.log(packageJson.version);
	process.exit(0);
}

// Handle --help argument
if (args.includes("--help") || args.includes("-h")) {
	console.log(`
cyrus - AI-powered Linear issue automation using Claude

Usage: cyrus [command] [options]

Commands:
  start              Start the edge worker (default)
  auth <auth-key>    Authenticate with Cyrus Pro plan using auth key
  check-tokens       Check the status of all Linear tokens
  refresh-token      Refresh a specific Linear token
  billing            Open Stripe billing portal (Pro plan only)
  set-customer-id    Set your Stripe customer ID

Options:
  --version          Show version number
  --help, -h         Show help
  --cyrus-home=<dir> Specify custom Cyrus config directory (default: ~/.cyrus)

Examples:
  cyrus                          Start the edge worker
  cyrus auth <your-auth-key>     Authenticate and start using Pro plan
  cyrus check-tokens             Check all Linear token statuses
  cyrus refresh-token            Interactive token refresh
  cyrus --cyrus-home=/tmp/cyrus  Use custom config directory
`);
	process.exit(0);
}

// Initialize application
const app = new Application(CYRUS_HOME);

// Parse command (remove flags from command name)
const commandArgs = args.filter((arg) => !arg.startsWith("--"));
const commandName = commandArgs[0] || "start";
const commandParams = commandArgs.slice(1);

// Execute command
(async () => {
	try {
		switch (commandName) {
			case "start":
				await new StartCommand(app).execute(commandParams);
				break;

			case "auth":
				await new AuthCommand(app).execute(commandParams);
				break;

			case "check-tokens":
				await new CheckTokensCommand(app).execute(commandParams);
				break;

			case "refresh-token":
				await new RefreshTokenCommand(app).execute(commandParams);
				break;

			case "billing":
				await new BillingCommand(app).execute(commandParams);
				break;

			case "set-customer-id":
				await new SetCustomerIdCommand(app).execute(commandParams);
				break;

			default:
				console.error(`Unknown command: ${commandName}`);
				console.log('Run "cyrus --help" for usage information');
				process.exit(1);
		}
	} catch (error) {
		console.error("Fatal error:", error);
		process.exit(1);
	}
})();
