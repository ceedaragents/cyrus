import { execSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";
import { BaseCommand } from "./ICommand.js";

// ─────────────────────────────────────────────────────────────
// ANSI color helpers
// ─────────────────────────────────────────────────────────────

const c = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	italic: "\x1b[3m",
	underline: "\x1b[4m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
	bgCyan: "\x1b[46m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgRed: "\x1b[41m",
} as const;

// ─────────────────────────────────────────────────────────────
// Box-drawing constants
// ─────────────────────────────────────────────────────────────

const BOX = {
	topLeft: "\u256d",
	topRight: "\u256e",
	bottomLeft: "\u2570",
	bottomRight: "\u256f",
	horizontal: "\u2500",
	vertical: "\u2502",
	teeRight: "\u251c",
	teeLeft: "\u2524",
} as const;

const ICONS = {
	check: "\u2714",
	cross: "\u2718",
	arrow: "\u25b8",
	dot: "\u25cf",
	circle: "\u25cb",
	star: "\u2605",
	info: "\u2139",
	warn: "\u26a0",
	skip: "\u2013",
} as const;

const TOTAL_STEPS = 6;
const BOX_WIDTH = 62;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface EnvVars {
	[key: string]: string;
}

type StepStatus = "configured" | "skipped" | "already-configured";

interface StepResult {
	name: string;
	status: StepStatus;
}

// ─────────────────────────────────────────────────────────────
// SetupCommand
// ─────────────────────────────────────────────────────────────

/**
 * Interactive onboarding command for Cyrus.
 *
 * Guides users through initial setup: Claude Code access, endpoint
 * configuration, Linear/GitHub/Slack integrations, and repository setup.
 *
 * Usage:
 *   cyrus setup              # Interactive onboarding
 *   cyrus setup --yes        # Skip optional steps (non-interactive)
 */
export class SetupCommand extends BaseCommand {
	public nonInteractive = false;

	private rl: readline.Interface | null = null;
	private results: StepResult[] = [];

	// ─── readline helpers ────────────────────────────────────

	private getReadline(): readline.Interface {
		if (!this.rl) {
			this.rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});

			// Handle Ctrl+C gracefully
			this.rl.on("close", () => {
				this.printAbort();
				process.exit(0);
			});
		}
		return this.rl;
	}

	private prompt(question: string, defaultValue?: string): Promise<string> {
		const suffix = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : "";
		return new Promise((resolve) => {
			this.getReadline().question(
				`  ${c.cyan}${ICONS.arrow}${c.reset} ${question}${suffix}: `,
				(answer) => {
					const trimmed = answer.trim();
					resolve(trimmed || defaultValue || "");
				},
			);
		});
	}

	private promptSecret(question: string): Promise<string> {
		return new Promise((resolve) => {
			// Ensure readline is initialized (for Ctrl+C handling)
			this.getReadline();
			process.stdout.write(`  ${c.cyan}${ICONS.arrow}${c.reset} ${question}: `);

			// Disable echo for secret input
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(true);
			}

			let secret = "";
			const onData = (char: Buffer): void => {
				const str = char.toString();
				if (str === "\n" || str === "\r") {
					// Enter pressed
					if (process.stdin.isTTY) {
						process.stdin.setRawMode(false);
					}
					process.stdin.removeListener("data", onData);
					process.stdout.write("\n");
					resolve(secret.trim());
				} else if (str === "\x03") {
					// Ctrl+C
					if (process.stdin.isTTY) {
						process.stdin.setRawMode(false);
					}
					process.stdin.removeListener("data", onData);
					this.printAbort();
					process.exit(0);
				} else if (str === "\x7f" || str === "\b") {
					// Backspace
					if (secret.length > 0) {
						secret = secret.slice(0, -1);
						process.stdout.write("\b \b");
					}
				} else {
					secret += str;
					process.stdout.write("*");
				}
			};

			process.stdin.on("data", onData);
		});
	}

	private async promptChoice(
		question: string,
		choices: string[],
	): Promise<number> {
		this.print("");
		this.print(`  ${c.white}${question}${c.reset}`);
		this.print("");
		for (let i = 0; i < choices.length; i++) {
			this.print(
				`    ${c.cyan}${i + 1}${c.reset}${c.dim})${c.reset} ${choices[i]}`,
			);
		}
		this.print("");

		while (true) {
			const answer = await this.prompt(
				`Choose ${c.dim}[1-${choices.length}]${c.reset}`,
			);
			const idx = parseInt(answer, 10);
			if (idx >= 1 && idx <= choices.length) {
				return idx;
			}
			this.print(
				`  ${c.red}${ICONS.cross}${c.reset} Please enter a number between 1 and ${choices.length}`,
			);
		}
	}

	private async promptYesNo(
		question: string,
		defaultYes = true,
	): Promise<boolean> {
		const hint = defaultYes ? "Y/n" : "y/N";
		const answer = await this.prompt(`${question} ${c.dim}[${hint}]${c.reset}`);
		if (!answer) return defaultYes;
		return answer.toLowerCase().startsWith("y");
	}

	private cleanup(): void {
		if (this.rl) {
			this.rl.removeAllListeners("close");
			this.rl.close();
			this.rl = null;
		}
	}

	// ─── output helpers ──────────────────────────────────────

	private print(line: string): void {
		console.log(line);
	}

	private blank(): void {
		console.log();
	}

	private printAbort(): void {
		this.blank();
		this.print(
			`  ${c.yellow}${ICONS.warn}${c.reset}  Setup interrupted. Run ${c.cyan}cyrus setup${c.reset} to resume anytime.`,
		);
		this.blank();
	}

	// ─── banner ──────────────────────────────────────────────

	private printBanner(): void {
		const banner = [
			"",
			`${c.cyan}${c.bold}     ██████╗██╗   ██╗██████╗ ██╗   ██╗███████╗${c.reset}`,
			`${c.cyan}${c.bold}    ██╔════╝╚██╗ ██╔╝██╔══██╗██║   ██║██╔════╝${c.reset}`,
			`${c.cyan}${c.bold}    ██║      ╚████╔╝ ██████╔╝██║   ██║███████╗${c.reset}`,
			`${c.cyan}${c.bold}    ██║       ╚██╔╝  ██╔══██╗██║   ██║╚════██║${c.reset}`,
			`${c.cyan}${c.bold}    ╚██████╗   ██║   ██║  ██║╚██████╔╝███████║${c.reset}`,
			`${c.cyan}${c.bold}     ╚═════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝${c.reset}`,
			"",
			`    ${c.dim}Run Claude Code as a background agent from any surface${c.reset}`,
			"",
		];
		for (const line of banner) {
			this.print(line);
		}
	}

	// ─── box drawing ─────────────────────────────────────────

	private printBox(lines: string[]): void {
		const w = BOX_WIDTH;
		this.print(
			`  ${c.dim}${BOX.topLeft}${BOX.horizontal.repeat(w)}${BOX.topRight}${c.reset}`,
		);
		for (const line of lines) {
			// Strip ANSI codes to get visible length for padding
			const visibleLength = line.replace(
				// biome-ignore lint/suspicious/noControlCharactersInRegex: needed for ANSI code stripping
				/\x1b\[[0-9;]*m/g,
				"",
			).length;
			const padding = Math.max(0, w - 2 - visibleLength);
			this.print(
				`  ${c.dim}${BOX.vertical}${c.reset} ${line}${" ".repeat(padding)} ${c.dim}${BOX.vertical}${c.reset}`,
			);
		}
		this.print(
			`  ${c.dim}${BOX.bottomLeft}${BOX.horizontal.repeat(w)}${BOX.bottomRight}${c.reset}`,
		);
	}

	private printDivider(): void {
		this.print(`  ${c.dim}${BOX.horizontal.repeat(BOX_WIDTH + 2)}${c.reset}`);
	}

	// ─── step header ─────────────────────────────────────────

	private printStepHeader(step: number, title: string): void {
		this.blank();
		this.printDivider();
		this.blank();
		const progress = `${c.dim}[${step}/${TOTAL_STEPS}]${c.reset}`;
		const bar = this.progressBar(step);
		this.print(`  ${progress} ${c.bold}${c.white}${title}${c.reset}`);
		this.print(`  ${bar}`);
		this.blank();
	}

	private progressBar(current: number): string {
		const filled = current;
		const empty = TOTAL_STEPS - current;
		const filledStr = `${c.green}${"█".repeat(filled)}${c.reset}`;
		const emptyStr = `${c.dim}${"░".repeat(empty)}${c.reset}`;
		return `${filledStr}${emptyStr}`;
	}

	// ─── status line helpers ─────────────────────────────────

	private printSuccess(msg: string): void {
		this.print(`  ${c.green}${ICONS.check}${c.reset} ${msg}`);
	}

	private printWarning(msg: string): void {
		this.print(`  ${c.yellow}${ICONS.warn}${c.reset}  ${msg}`);
	}

	private printInfo(msg: string): void {
		this.print(`  ${c.cyan}${ICONS.info}${c.reset}  ${msg}`);
	}

	private printError(msg: string): void {
		this.print(`  ${c.red}${ICONS.cross}${c.reset} ${msg}`);
	}

	private printAlreadyConfigured(label: string): void {
		this.print(
			`  ${c.green}${ICONS.check}${c.reset} ${label} ${c.dim}(already configured)${c.reset}`,
		);
	}

	private printSkipped(label: string): void {
		this.print(
			`  ${c.yellow}${ICONS.skip}${c.reset} ${label} ${c.dim}(skipped)${c.reset}`,
		);
	}

	// ─── .env file management ────────────────────────────────

	private getEnvPath(): string {
		return join(this.app.cyrusHome, ".env");
	}

	private readEnvFile(): EnvVars {
		const envPath = this.getEnvPath();
		const vars: EnvVars = {};
		if (!existsSync(envPath)) return vars;

		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIndex = trimmed.indexOf("=");
			if (eqIndex === -1) continue;
			const key = trimmed.slice(0, eqIndex).trim();
			let value = trimmed.slice(eqIndex + 1).trim();
			// Strip surrounding quotes
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			vars[key] = value;
		}
		return vars;
	}

	private writeEnvVar(key: string, value: string): void {
		const envPath = this.getEnvPath();

		// Ensure the directory exists
		const dir = join(this.app.cyrusHome);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		if (!existsSync(envPath)) {
			writeFileSync(envPath, `${key}=${value}\n`, "utf-8");
			return;
		}

		const content = readFileSync(envPath, "utf-8");
		const lines = content.split("\n");
		let found = false;

		const updatedLines = lines.map((line) => {
			const trimmed = line.trim();
			if (trimmed.startsWith(`${key}=`)) {
				found = true;
				return `${key}=${value}`;
			}
			return line;
		});

		if (found) {
			writeFileSync(envPath, updatedLines.join("\n"), "utf-8");
		} else {
			// Append to file, ensure a trailing newline before the new entry
			const needs_newline = content.length > 0 && !content.endsWith("\n");
			appendFileSync(
				envPath,
				`${needs_newline ? "\n" : ""}${key}=${value}\n`,
				"utf-8",
			);
		}
	}

	// ─── prerequisite checks ─────────────────────────────────

	private checkCommand(command: string): boolean {
		try {
			execSync(`which ${command}`, { stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}

	private getNodeVersion(): string | null {
		try {
			return execSync("node --version", { stdio: "pipe" })
				.toString()
				.trim()
				.replace(/^v/, "");
		} catch {
			return null;
		}
	}

	private isNodeVersionSufficient(version: string): boolean {
		const major = parseInt(version.split(".")[0] || "0", 10);
		return major >= 20;
	}

	// ─── main execute ────────────────────────────────────────

	async execute(_args: string[]): Promise<void> {
		try {
			this.printBanner();

			this.printBox([
				`${c.bold}Welcome to Cyrus Setup${c.reset}`,
				"",
				"This wizard will guide you through configuring",
				"Cyrus to run as a background agent on your machine.",
				"",
				`${c.dim}Press Ctrl+C at any time to exit.${c.reset}`,
				`${c.dim}You can re-run this command to resume.${c.reset}`,
			]);

			this.blank();

			// ── Prerequisites ─────────────────────────────────
			await this.checkPrerequisites();

			// ── Ensure cyrus home exists ──────────────────────
			if (!existsSync(this.app.cyrusHome)) {
				mkdirSync(this.app.cyrusHome, { recursive: true });
			}

			// ── Steps ─────────────────────────────────────────
			await this.stepClaudeAccess();
			await this.stepEndpointConfig();
			await this.stepLinearIntegration();
			await this.stepGitHubIntegration();
			await this.stepSlackIntegration();
			await this.stepAddRepository();

			// ── Summary ───────────────────────────────────────
			this.printSummary();
		} finally {
			this.cleanup();
		}
	}

	// ─── Prerequisites ───────────────────────────────────────

	private async checkPrerequisites(): Promise<void> {
		this.print(`  ${c.bold}${c.white}Checking prerequisites...${c.reset}`);
		this.blank();

		let allPassed = true;

		// Node.js
		const nodeVersion = this.getNodeVersion();
		if (nodeVersion && this.isNodeVersionSufficient(nodeVersion)) {
			this.printSuccess(`Node.js ${c.dim}v${nodeVersion}${c.reset}`);
		} else if (nodeVersion) {
			this.printError(
				`Node.js v${nodeVersion} ${c.red}(v20+ required)${c.reset}`,
			);
			allPassed = false;
		} else {
			this.printError(`Node.js ${c.red}(not found - v20+ required)${c.reset}`);
			allPassed = false;
		}

		// Git
		if (this.checkCommand("git")) {
			const gitVersion = execSync("git --version", { stdio: "pipe" })
				.toString()
				.trim()
				.replace("git version ", "");
			this.printSuccess(`Git ${c.dim}v${gitVersion}${c.reset}`);
		} else {
			this.printError(`Git ${c.red}(not found)${c.reset}`);
			allPassed = false;
		}

		// Claude Code
		if (this.checkCommand("claude")) {
			this.printSuccess(`Claude Code CLI ${c.dim}(found)${c.reset}`);
		} else {
			this.printWarning(
				`Claude Code CLI ${c.yellow}(not found - install from https://docs.anthropic.com/en/docs/claude-code)${c.reset}`,
			);
		}

		this.blank();

		if (!allPassed) {
			this.printError(
				"Some required prerequisites are missing. Please install them and re-run setup.",
			);
			this.blank();
			process.exit(1);
		}
	}

	// ─── Step 1: Claude Code Access ──────────────────────────

	private async stepClaudeAccess(): Promise<void> {
		this.printStepHeader(1, "Claude Code Access");

		const env = this.readEnvFile();
		const hasApiKey =
			!!env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_API_KEY;
		const hasOAuthToken =
			!!env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

		if (hasApiKey || hasOAuthToken) {
			const method = hasOAuthToken
				? "CLAUDE_CODE_OAUTH_TOKEN"
				: "ANTHROPIC_API_KEY";
			this.printAlreadyConfigured(
				`Claude Code access via ${c.cyan}${method}${c.reset}`,
			);
			this.results.push({
				name: "Claude Code Access",
				status: "already-configured",
			});
			return;
		}

		this.printInfo("Cyrus needs access to Claude Code to run AI sessions.");
		this.print(
			`  ${c.dim}You can provide an Anthropic API key or configure OAuth later.${c.reset}`,
		);
		this.blank();

		if (this.nonInteractive) {
			this.printSkipped("Claude Code Access");
			this.results.push({ name: "Claude Code Access", status: "skipped" });
			return;
		}

		const apiKey = await this.promptSecret("Anthropic API key");

		if (!apiKey) {
			this.printSkipped("Claude Code Access");
			this.printWarning(
				"You will need to set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN before running Cyrus.",
			);
			this.results.push({ name: "Claude Code Access", status: "skipped" });
			return;
		}

		if (!apiKey.startsWith("sk-ant-")) {
			this.printWarning(
				"This does not look like a standard Anthropic API key (expected sk-ant-... prefix).",
			);
			const proceed = await this.promptYesNo("Save anyway?", false);
			if (!proceed) {
				this.printSkipped("Claude Code Access");
				this.results.push({ name: "Claude Code Access", status: "skipped" });
				return;
			}
		}

		this.writeEnvVar("ANTHROPIC_API_KEY", apiKey);
		this.printSuccess("Saved ANTHROPIC_API_KEY to .env");
		this.results.push({ name: "Claude Code Access", status: "configured" });
	}

	// ─── Step 2: Endpoint Configuration ──────────────────────

	private async stepEndpointConfig(): Promise<void> {
		this.printStepHeader(2, "Endpoint Configuration");

		const env = this.readEnvFile();
		const hasCloudflare =
			!!env.CLOUDFLARE_TOKEN || !!process.env.CLOUDFLARE_TOKEN;
		const hasBaseUrl = !!env.CYRUS_BASE_URL || !!process.env.CYRUS_BASE_URL;

		if (hasCloudflare || hasBaseUrl) {
			const method = hasCloudflare ? "Cloudflare Tunnel" : "Custom URL";
			this.printAlreadyConfigured(`Endpoint via ${c.cyan}${method}${c.reset}`);
			this.results.push({
				name: "Endpoint Configuration",
				status: "already-configured",
			});
			return;
		}

		this.printInfo(
			"Cyrus needs a public URL to receive webhooks from Linear and other services.",
		);
		this.blank();

		if (this.nonInteractive) {
			this.printSkipped("Endpoint Configuration");
			this.results.push({
				name: "Endpoint Configuration",
				status: "skipped",
			});
			return;
		}

		const choice = await this.promptChoice(
			"How would you like to expose Cyrus to the internet?",
			[
				`${c.green}Cloudflare Tunnel${c.reset} ${c.dim}(recommended - automatic HTTPS)${c.reset}`,
				`${c.white}Custom URL${c.reset} ${c.dim}(you manage your own domain/proxy)${c.reset}`,
				`${c.yellow}Skip for now${c.reset} ${c.dim}(webhooks will not work until configured)${c.reset}`,
			],
		);

		if (choice === 1) {
			// Cloudflare Tunnel
			this.blank();
			this.printInfo(
				`Get your Cloudflare Tunnel token from ${c.underline}https://dash.cloudflare.com${c.reset}`,
			);
			this.blank();

			const token = await this.promptSecret("Cloudflare Tunnel token");
			if (!token) {
				this.printSkipped("Endpoint Configuration");
				this.results.push({
					name: "Endpoint Configuration",
					status: "skipped",
				});
				return;
			}

			this.writeEnvVar("CLOUDFLARE_TOKEN", token);
			this.printSuccess("Saved CLOUDFLARE_TOKEN to .env");
			this.printInfo("Cyrus will automatically create a tunnel when started.");
			this.results.push({
				name: "Endpoint Configuration",
				status: "configured",
			});
		} else if (choice === 2) {
			// Custom URL
			this.blank();
			this.printInfo(
				"Enter your public base URL (e.g., https://cyrus.example.com)",
			);
			this.blank();

			const url = await this.prompt("Base URL");
			if (!url) {
				this.printSkipped("Endpoint Configuration");
				this.results.push({
					name: "Endpoint Configuration",
					status: "skipped",
				});
				return;
			}

			if (!url.startsWith("https://") && !url.startsWith("http://")) {
				this.printWarning("URL should start with https:// for production use.");
			}

			this.writeEnvVar("CYRUS_BASE_URL", url);
			this.printSuccess("Saved CYRUS_BASE_URL to .env");
			this.results.push({
				name: "Endpoint Configuration",
				status: "configured",
			});
		} else {
			this.printSkipped("Endpoint Configuration");
			this.printWarning(
				"Webhooks will not work until you configure an endpoint.",
			);
			this.results.push({
				name: "Endpoint Configuration",
				status: "skipped",
			});
		}
	}

	// ─── Step 3: Linear Integration ──────────────────────────

	private async stepLinearIntegration(): Promise<void> {
		this.printStepHeader(3, "Linear Integration");

		const env = this.readEnvFile();
		const hasClientId =
			!!env.LINEAR_CLIENT_ID || !!process.env.LINEAR_CLIENT_ID;
		const hasClientSecret =
			!!env.LINEAR_CLIENT_SECRET || !!process.env.LINEAR_CLIENT_SECRET;
		const hasWebhookSecret =
			!!env.LINEAR_WEBHOOK_SECRET || !!process.env.LINEAR_WEBHOOK_SECRET;

		if (hasClientId && hasClientSecret) {
			this.printAlreadyConfigured("Linear OAuth credentials");
			if (hasWebhookSecret) {
				this.printAlreadyConfigured("Linear webhook secret");
			}
			this.results.push({
				name: "Linear Integration",
				status: "already-configured",
			});
			return;
		}

		this.printInfo(
			"Connect Cyrus to Linear so it can receive and respond to issues.",
		);
		this.blank();

		if (this.nonInteractive) {
			this.printSkipped("Linear Integration");
			this.results.push({ name: "Linear Integration", status: "skipped" });
			return;
		}

		const wantLinear = await this.promptYesNo(
			"Configure Linear integration?",
			true,
		);

		if (!wantLinear) {
			this.printSkipped("Linear Integration");
			this.results.push({ name: "Linear Integration", status: "skipped" });
			return;
		}

		// Determine callback/webhook URLs
		const updatedEnv = this.readEnvFile();
		const baseUrl =
			updatedEnv.CYRUS_BASE_URL ||
			process.env.CYRUS_BASE_URL ||
			"<YOUR_BASE_URL>";
		const callbackUrl = `${baseUrl}/callback`;
		const webhookUrl = `${baseUrl}/webhook`;

		this.blank();
		this.printBox([
			`${c.bold}Create a Linear OAuth Application${c.reset}`,
			"",
			`1. Go to: ${c.cyan}${c.underline}https://linear.app/settings/api/applications/new${c.reset}`,
			"",
			`2. Fill in the following:`,
			`   ${c.white}Name:${c.reset}          Cyrus`,
			`   ${c.white}Description:${c.reset}   AI-powered issue automation`,
			`   ${c.white}Callback URL:${c.reset}  ${c.cyan}${callbackUrl}${c.reset}`,
			`   ${c.white}Webhook URL:${c.reset}   ${c.cyan}${webhookUrl}${c.reset}`,
			"",
			`3. Under ${c.white}Webhook events${c.reset}, enable:`,
			`   ${ICONS.check} Issues  ${ICONS.check} Comments  ${ICONS.check} Labels`,
			"",
			`4. Copy the credentials shown after creation.`,
		]);
		this.blank();

		const clientId = await this.prompt("LINEAR_CLIENT_ID");
		if (!clientId) {
			this.printSkipped("Linear Integration");
			this.results.push({ name: "Linear Integration", status: "skipped" });
			return;
		}

		const clientSecret = await this.promptSecret("LINEAR_CLIENT_SECRET");
		if (!clientSecret) {
			this.printSkipped("Linear Integration");
			this.results.push({ name: "Linear Integration", status: "skipped" });
			return;
		}

		const webhookSecret = await this.promptSecret(
			"LINEAR_WEBHOOK_SECRET (press Enter to skip)",
		);

		this.writeEnvVar("LINEAR_CLIENT_ID", clientId);
		this.writeEnvVar("LINEAR_CLIENT_SECRET", clientSecret);
		if (webhookSecret) {
			this.writeEnvVar("LINEAR_WEBHOOK_SECRET", webhookSecret);
		}

		this.printSuccess("Saved Linear credentials to .env");

		// Offer to run OAuth flow
		const hasEndpoint =
			updatedEnv.CYRUS_BASE_URL ||
			process.env.CYRUS_BASE_URL ||
			updatedEnv.CLOUDFLARE_TOKEN ||
			process.env.CLOUDFLARE_TOKEN;

		if (hasEndpoint) {
			this.blank();
			const runAuth = await this.promptYesNo(
				"Run Linear OAuth flow now to connect a workspace?",
				true,
			);
			if (runAuth) {
				this.printInfo(
					`Run ${c.cyan}cyrus self-auth${c.reset} after setup to complete the OAuth flow.`,
				);
			}
		} else {
			this.blank();
			this.printInfo(
				`Run ${c.cyan}cyrus self-auth${c.reset} after configuring your endpoint to connect a Linear workspace.`,
			);
		}

		this.results.push({ name: "Linear Integration", status: "configured" });
	}

	// ─── Step 4: GitHub Integration ──────────────────────────

	private async stepGitHubIntegration(): Promise<void> {
		this.printStepHeader(4, "GitHub Integration");

		const env = this.readEnvFile();
		const hasToken = !!env.GITHUB_TOKEN || !!process.env.GITHUB_TOKEN;

		if (hasToken) {
			this.printAlreadyConfigured("GitHub token");
			this.results.push({
				name: "GitHub Integration",
				status: "already-configured",
			});
			return;
		}

		this.printInfo(
			"A GitHub token allows Cyrus to create pull requests and interact with repositories.",
		);
		this.blank();

		if (this.nonInteractive) {
			this.printSkipped("GitHub Integration");
			this.results.push({ name: "GitHub Integration", status: "skipped" });
			return;
		}

		const wantGH = await this.promptYesNo(
			"Configure GitHub integration?",
			true,
		);

		if (!wantGH) {
			this.printSkipped("GitHub Integration");
			this.results.push({ name: "GitHub Integration", status: "skipped" });
			return;
		}

		this.blank();
		this.printInfo(
			`Create a token at ${c.underline}https://github.com/settings/tokens${c.reset}`,
		);
		this.printInfo(
			`Required scopes: ${c.white}repo${c.reset}, ${c.white}workflow${c.reset}`,
		);
		this.blank();

		const token = await this.promptSecret("GitHub personal access token");

		if (!token) {
			this.printSkipped("GitHub Integration");
			this.results.push({ name: "GitHub Integration", status: "skipped" });
			return;
		}

		if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
			this.printWarning(
				"This does not look like a standard GitHub token (expected ghp_... or github_pat_... prefix).",
			);
			const proceed = await this.promptYesNo("Save anyway?", false);
			if (!proceed) {
				this.printSkipped("GitHub Integration");
				this.results.push({
					name: "GitHub Integration",
					status: "skipped",
				});
				return;
			}
		}

		this.writeEnvVar("GITHUB_TOKEN", token);
		this.printSuccess("Saved GITHUB_TOKEN to .env");
		this.results.push({ name: "GitHub Integration", status: "configured" });
	}

	// ─── Step 5: Slack Integration ───────────────────────────

	private async stepSlackIntegration(): Promise<void> {
		this.printStepHeader(5, "Slack Integration");

		const env = this.readEnvFile();
		const hasBotToken = !!env.SLACK_BOT_TOKEN || !!process.env.SLACK_BOT_TOKEN;
		const hasSigningSecret =
			!!env.SLACK_SIGNING_SECRET || !!process.env.SLACK_SIGNING_SECRET;

		if (hasBotToken && hasSigningSecret) {
			this.printAlreadyConfigured("Slack bot token and signing secret");
			this.results.push({
				name: "Slack Integration",
				status: "already-configured",
			});
			return;
		}

		this.printInfo("Connect Cyrus to Slack to interact with it via chat.");
		this.blank();

		if (this.nonInteractive) {
			this.printSkipped("Slack Integration");
			this.results.push({ name: "Slack Integration", status: "skipped" });
			return;
		}

		const wantSlack = await this.promptYesNo(
			"Configure Slack integration?",
			false,
		);

		if (!wantSlack) {
			this.printSkipped("Slack Integration");
			this.results.push({ name: "Slack Integration", status: "skipped" });
			return;
		}

		this.blank();
		this.printInfo(
			`Create a Slack app at ${c.underline}https://api.slack.com/apps${c.reset}`,
		);
		this.blank();

		const botToken = await this.promptSecret("SLACK_BOT_TOKEN (xoxb-...)");
		if (!botToken) {
			this.printSkipped("Slack Integration");
			this.results.push({ name: "Slack Integration", status: "skipped" });
			return;
		}

		if (!botToken.startsWith("xoxb-")) {
			this.printWarning(
				"This does not look like a standard Slack bot token (expected xoxb-... prefix).",
			);
		}

		const signingSecret = await this.promptSecret("SLACK_SIGNING_SECRET");
		if (!signingSecret) {
			this.printSkipped("Slack Integration");
			this.results.push({ name: "Slack Integration", status: "skipped" });
			return;
		}

		this.writeEnvVar("SLACK_BOT_TOKEN", botToken);
		this.writeEnvVar("SLACK_SIGNING_SECRET", signingSecret);
		this.printSuccess("Saved Slack credentials to .env");
		this.results.push({ name: "Slack Integration", status: "configured" });
	}

	// ─── Step 6: Add Repository ──────────────────────────────

	private async stepAddRepository(): Promise<void> {
		this.printStepHeader(6, "Add a Repository");

		this.printInfo("Add a git repository for Cyrus to manage.");
		this.blank();

		if (this.nonInteractive) {
			this.printSkipped("Add Repository");
			this.printInfo(
				`Run ${c.cyan}cyrus self-add-repo <url>${c.reset} to add one later.`,
			);
			this.results.push({ name: "Add Repository", status: "skipped" });
			return;
		}

		const wantRepo = await this.promptYesNo("Add a repository now?", true);

		if (!wantRepo) {
			this.printSkipped("Add Repository");
			this.printInfo(
				`Run ${c.cyan}cyrus self-add-repo <url>${c.reset} to add one later.`,
			);
			this.results.push({ name: "Add Repository", status: "skipped" });
			return;
		}

		this.blank();
		const url = await this.prompt(
			"Git repository URL (e.g., https://github.com/org/repo.git)",
		);

		if (!url) {
			this.printSkipped("Add Repository");
			this.results.push({ name: "Add Repository", status: "skipped" });
			return;
		}

		this.blank();
		this.printInfo(`To finish adding this repository, run:`);
		this.blank();
		this.print(`    ${c.cyan}cyrus self-add-repo ${url}${c.reset}`);
		this.blank();
		this.printInfo(
			"This will clone the repo and associate it with a Linear workspace.",
		);

		this.results.push({ name: "Add Repository", status: "configured" });
	}

	// ─── Summary ─────────────────────────────────────────────

	private printSummary(): void {
		this.blank();
		this.printDivider();
		this.blank();
		this.print(`  ${c.bold}${c.green}${ICONS.star} Setup Complete${c.reset}`);
		this.blank();

		const configured = this.results.filter(
			(r) => r.status === "configured" || r.status === "already-configured",
		);
		const skipped = this.results.filter((r) => r.status === "skipped");

		if (configured.length > 0) {
			this.print(`  ${c.bold}Configured:${c.reset}`);
			for (const r of configured) {
				const suffix =
					r.status === "already-configured"
						? ` ${c.dim}(previously)${c.reset}`
						: "";
				this.print(`    ${c.green}${ICONS.check}${c.reset} ${r.name}${suffix}`);
			}
			this.blank();
		}

		if (skipped.length > 0) {
			this.print(`  ${c.bold}Skipped:${c.reset}`);
			for (const r of skipped) {
				this.print(`    ${c.yellow}${ICONS.skip}${c.reset} ${r.name}`);
			}
			this.blank();
		}

		// File paths
		this.print(`  ${c.bold}Files:${c.reset}`);
		this.print(
			`    ${c.dim}${ICONS.dot}${c.reset} Environment: ${c.cyan}${this.getEnvPath()}${c.reset}`,
		);
		this.print(
			`    ${c.dim}${ICONS.dot}${c.reset} Config:      ${c.cyan}${join(this.app.cyrusHome, "config.json")}${c.reset}`,
		);
		this.blank();

		// Next steps
		this.printBox([
			`${c.bold}Next Steps${c.reset}`,
			"",
			...this.getNextSteps(),
		]);

		this.blank();
		this.print(
			`  ${c.dim}Need help? Visit ${c.underline}https://atcyrus.com/docs${c.reset}`,
		);
		this.blank();
	}

	private getNextSteps(): string[] {
		const steps: string[] = [];
		const skippedNames = new Set(
			this.results.filter((r) => r.status === "skipped").map((r) => r.name),
		);

		const hasLinear = !skippedNames.has("Linear Integration");
		const hasEndpoint = !skippedNames.has("Endpoint Configuration");
		const hasClaude = !skippedNames.has("Claude Code Access");

		if (!hasClaude) {
			steps.push(
				`${c.yellow}1.${c.reset} Set ${c.cyan}ANTHROPIC_API_KEY${c.reset} in ${c.dim}~/.cyrus/.env${c.reset}`,
			);
		}

		if (!hasEndpoint) {
			steps.push(
				`${c.yellow}${steps.length + 1}.${c.reset} Configure an endpoint (run ${c.cyan}cyrus setup${c.reset} again)`,
			);
		}

		if (hasLinear && hasEndpoint) {
			steps.push(
				`${c.yellow}${steps.length + 1}.${c.reset} Run ${c.cyan}cyrus self-auth${c.reset} to connect a Linear workspace`,
			);
		}

		if (skippedNames.has("Add Repository")) {
			steps.push(
				`${c.yellow}${steps.length + 1}.${c.reset} Run ${c.cyan}cyrus self-add-repo <url>${c.reset} to add a repository`,
			);
		}

		steps.push(
			`${c.yellow}${steps.length + 1}.${c.reset} Start Cyrus with ${c.cyan}cyrus${c.reset} or ${c.cyan}cyrus start${c.reset}`,
		);

		return steps;
	}
}
