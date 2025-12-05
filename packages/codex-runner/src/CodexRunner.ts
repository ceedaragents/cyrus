import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { IAgentRunner, IMessageFormatter, SDKMessage } from "cyrus-core";
import { codexEventToSDKMessage } from "./adapters.js";
import {
	autoDetectMcpConfig,
	convertToCodexMcpConfig,
	loadMcpConfigFromPaths,
	setupCodexConfig,
} from "./configGenerator.js";
import { CodexMessageFormatter } from "./formatter.js";
import { safeParseCodexEvent, type ThreadEvent } from "./schemas.js";
import type {
	CodexMcpServerConfig,
	CodexRunnerConfig,
	CodexRunnerEvents,
	CodexSessionInfo,
} from "./types.js";

export declare interface CodexRunner {
	on<K extends keyof CodexRunnerEvents>(
		event: K,
		listener: CodexRunnerEvents[K],
	): this;
	emit<K extends keyof CodexRunnerEvents>(
		event: K,
		...args: Parameters<CodexRunnerEvents[K]>
	): boolean;
}

/**
 * Manages Codex CLI sessions and communication
 *
 * CodexRunner implements the IAgentRunner interface to provide a provider-agnostic
 * wrapper around the Codex CLI. It spawns the Codex CLI process and translates
 * between the CLI's JSONL format and Claude SDK message types.
 *
 * @example
 * ```typescript
 * const runner = new CodexRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'gpt-4o',
 *   autoApprove: true
 * });
 *
 * await runner.start("Implement a new feature");
 * const messages = runner.getMessages();
 * ```
 */
export class CodexRunner extends EventEmitter implements IAgentRunner {
	/**
	 * CodexRunner does not support streaming input.
	 * The session starts with a single prompt and runs to completion.
	 */
	readonly supportsStreamingInput = false;

	private config: CodexRunnerConfig;
	private process: ChildProcess | null = null;
	private sessionInfo: CodexSessionInfo | null = null;
	private logStream: WriteStream | null = null;
	private readableLogStream: WriteStream | null = null;
	private messages: SDKMessage[] = [];
	private cyrusHome: string;
	private configCleanup: (() => void) | null = null;
	private formatter: IMessageFormatter;
	private readlineInterface: ReturnType<typeof createInterface> | null = null;

	constructor(config: CodexRunnerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		this.formatter = new CodexMessageFormatter();

		// Forward config callbacks to events
		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	/**
	 * Start a new Codex session with the given prompt
	 */
	async start(prompt: string): Promise<CodexSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Codex session already running");
		}

		// Initialize session info without session ID (will be set from thread.started event)
		this.sessionInfo = {
			sessionId: null,
			startedAt: new Date(),
			isRunning: true,
		};

		console.log(
			`[CodexRunner] Starting new session (thread ID will be assigned by Codex)`,
		);
		console.log(
			"[CodexRunner] Working directory:",
			this.config.workingDirectory,
		);

		// Ensure working directory exists
		if (this.config.workingDirectory) {
			try {
				mkdirSync(this.config.workingDirectory, { recursive: true });
				console.log("[CodexRunner] Created working directory");
			} catch (err) {
				console.error("[CodexRunner] Failed to create working directory:", err);
			}
		}

		// Set up logging
		this.setupLogging();

		// Reset messages array
		this.messages = [];

		// Build MCP servers configuration
		const mcpServers = this.buildMcpServers();

		// Setup Codex config.toml with MCP servers
		// Only setup config if we have something to configure
		if (Object.keys(mcpServers).length > 0) {
			this.configCleanup = setupCodexConfig(mcpServers);
		}

		try {
			// Build Codex CLI command
			const args = this.buildArgs(prompt);

			// Spawn Codex CLI process
			const codexPath = this.config.codexPath || "codex";
			console.log(`[CodexRunner] Spawning: ${codexPath} ${args.join(" ")}`);
			this.process = spawn(codexPath, args, {
				cwd: this.config.workingDirectory,
				stdio: ["ignore", "pipe", "pipe"],
				env: process.env,
			});

			// Set up stdout line reader for JSONL events
			this.readlineInterface = createInterface({
				input: this.process.stdout!,
				crlfDelay: Infinity,
			});

			// Process each line as a JSONL event with Zod validation
			this.readlineInterface.on("line", (line: string) => {
				try {
					// Parse JSON first, then validate with Zod schema
					const parsed = JSON.parse(line);
					const result = safeParseCodexEvent(parsed);
					if (result.success) {
						this.processEvent(result.data);
					} else {
						console.error(
							"[CodexRunner] Failed to validate JSONL event:",
							line,
							result.error.message,
						);
					}
				} catch (error) {
					console.error(
						"[CodexRunner] Failed to parse JSONL:",
						line,
						error instanceof Error ? error.message : String(error),
					);
				}
			});

			// Handle stderr
			this.process.stderr?.on("data", (data: Buffer) => {
				const stderrText = data.toString();
				console.error("[CodexRunner] stderr:", stderrText);
			});

			// Wait for process to complete
			await new Promise<void>((resolve, reject) => {
				if (!this.process) {
					reject(new Error("Process not started"));
					return;
				}

				this.process.on("close", (code: number | null) => {
					// Close readline interface first to prevent hang
					if (this.readlineInterface) {
						this.readlineInterface.close();
						this.readlineInterface = null;
					}

					console.log(`[CodexRunner] Process exited with code ${code}`);
					if (this.sessionInfo) {
						this.sessionInfo.isRunning = false;
					}

					// Emit complete event
					this.emit("complete", this.messages);

					// Close log streams
					if (this.logStream) {
						this.logStream.end();
						this.logStream = null;
					}
					if (this.readableLogStream) {
						this.readableLogStream.end();
						this.readableLogStream = null;
					}

					// Cleanup config
					if (this.configCleanup) {
						this.configCleanup();
						this.configCleanup = null;
					}

					if (code !== 0 && code !== null) {
						reject(new Error(`Codex process exited with code ${code}`));
					} else {
						resolve();
					}
				});

				this.process.on("error", (error: Error) => {
					console.error("[CodexRunner] Process error:", error);
					this.emit("error", error);
					reject(error);
				});
			});

			return this.sessionInfo;
		} catch (error) {
			console.error("[CodexRunner] Failed to start session:", error);
			if (this.sessionInfo) {
				this.sessionInfo.isRunning = false;
			}

			// Cleanup config on error
			if (this.configCleanup) {
				this.configCleanup();
				this.configCleanup = null;
			}

			throw error;
		}
	}

	/**
	 * Stop the running Codex session
	 */
	stop(): void {
		if (this.process) {
			console.log("[CodexRunner] Stopping process");
			// Close readline before killing to prevent hang
			if (this.readlineInterface) {
				this.readlineInterface.close();
				this.readlineInterface = null;
			}
			this.process.kill();
			this.process = null;
		}
		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}

		// Cleanup config
		if (this.configCleanup) {
			this.configCleanup();
			this.configCleanup = null;
		}
	}

	/**
	 * Check if a session is currently running
	 */
	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	/**
	 * Get all messages from the current session
	 */
	getMessages(): SDKMessage[] {
		return [...this.messages];
	}

	/**
	 * Get the message formatter for this runner
	 */
	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	/**
	 * Build CLI arguments for Codex
	 */
	private buildArgs(prompt: string): string[] {
		const args: string[] = ["exec", "--json"];

		// Add auto-approve flag (bypasses approvals and sandbox)
		if (this.config.autoApprove) {
			args.push("--dangerously-bypass-approvals-and-sandbox");
		}

		// Add full-auto flag
		if (this.config.fullAuto) {
			args.push("--full-auto");
		}

		// Add working directory
		if (this.config.workingDirectory) {
			args.push("--cd", this.config.workingDirectory);
		}

		// Add skip git repo check
		if (this.config.skipGitRepoCheck) {
			args.push("--skip-git-repo-check");
		}

		// Add web search
		if (this.config.webSearchEnabled) {
			args.push("--search");
		}

		// Add model
		if (this.config.model) {
			args.push("--model", this.config.model);
		}

		// Add additional directories
		if (
			this.config.additionalDirectories &&
			this.config.additionalDirectories.length > 0
		) {
			for (const dir of this.config.additionalDirectories) {
				args.push("--add-dir", dir);
			}
		}

		// Add the prompt as the last argument
		args.push(prompt);

		return args;
	}

	/**
	 * Build MCP servers configuration from various sources
	 */
	private buildMcpServers(): Record<string, CodexMcpServerConfig> {
		const mcpServers: Record<string, CodexMcpServerConfig> = {};

		// 1. Load from auto-detected .mcp.json in working directory
		const autoDetectedPath = autoDetectMcpConfig(this.config.workingDirectory);
		if (autoDetectedPath) {
			console.log(
				`[CodexRunner] Auto-detected MCP config: ${autoDetectedPath}`,
			);
			const autoServers = loadMcpConfigFromPaths([autoDetectedPath]);
			for (const [name, config] of Object.entries(autoServers)) {
				const codexConfig = convertToCodexMcpConfig(name, config);
				if (codexConfig) {
					mcpServers[name] = codexConfig;
				}
			}
		}

		// 2. Load from explicitly configured mcpConfigPath
		if (this.config.mcpConfigPath) {
			const paths = Array.isArray(this.config.mcpConfigPath)
				? this.config.mcpConfigPath
				: [this.config.mcpConfigPath];
			const explicitServers = loadMcpConfigFromPaths(paths);
			for (const [name, config] of Object.entries(explicitServers)) {
				const codexConfig = convertToCodexMcpConfig(name, config);
				if (codexConfig) {
					mcpServers[name] = codexConfig;
				}
			}
		}

		// 3. Add inline mcpConfig servers (highest priority, can override)
		if (this.config.mcpConfig) {
			for (const [name, config] of Object.entries(this.config.mcpConfig)) {
				const codexConfig = convertToCodexMcpConfig(name, config);
				if (codexConfig) {
					mcpServers[name] = codexConfig;
				}
			}
		}

		// Filter by allowMCPServers/excludeMCPServers
		let filteredServers = mcpServers;
		if (this.config.allowMCPServers) {
			filteredServers = Object.fromEntries(
				Object.entries(filteredServers).filter(([name]) =>
					this.config.allowMCPServers?.includes(name),
				),
			);
		}
		if (this.config.excludeMCPServers) {
			filteredServers = Object.fromEntries(
				Object.entries(filteredServers).filter(
					([name]) => !this.config.excludeMCPServers?.includes(name),
				),
			);
		}

		return filteredServers;
	}

	/**
	 * Process a single Codex event
	 */
	private processEvent(event: ThreadEvent): void {
		console.log(`[CodexRunner] Processing event: ${event.type}`);

		// Extract thread_id from thread.started event
		if (event.type === "thread.started") {
			const threadId = event.thread_id;
			if (this.sessionInfo) {
				this.sessionInfo.sessionId = threadId;
			}
			console.log(`[CodexRunner] Thread started with ID: ${threadId}`);
			// Re-setup logging with session ID
			this.setupLogging();
		}

		// Emit raw event for debugging
		this.emit("event", event);

		// Convert to SDK message
		const sessionId = this.sessionInfo?.sessionId || "unknown";
		const sdkMessage = codexEventToSDKMessage(event, sessionId);

		if (sdkMessage) {
			// Add to messages array and emit
			this.emitMessage(sdkMessage);
		}
	}

	/**
	 * Emit a message and add it to the messages array
	 */
	private emitMessage(message: SDKMessage): void {
		this.messages.push(message);

		// Write to logs
		if (this.logStream) {
			this.logStream.write(`${JSON.stringify(message)}\n`);
		}
		if (this.readableLogStream) {
			this.readableLogStream.write(
				`[${message.type}] ${JSON.stringify(message, null, 2)}\n\n`,
			);
		}

		// Emit message event
		this.emit("message", message);
	}

	/**
	 * Set up logging streams
	 */
	private setupLogging(): void {
		const workspaceName = this.config.workspaceName || "default";
		const sessionId = this.sessionInfo?.sessionId || "pending";
		const logsDir = join(this.cyrusHome, "logs", workspaceName);

		// Create logs directory
		mkdirSync(logsDir, { recursive: true });

		// Close existing log streams if re-setting up
		if (this.logStream) {
			this.logStream.end();
		}
		if (this.readableLogStream) {
			this.readableLogStream.end();
		}

		// Create log streams
		this.logStream = createWriteStream(join(logsDir, `${sessionId}.ndjson`), {
			flags: "a",
		});
		this.readableLogStream = createWriteStream(
			join(logsDir, `${sessionId}.log`),
			{ flags: "a" },
		);

		// Write session start entry
		const startEntry = {
			type: "session_start",
			sessionId,
			workingDirectory: this.config.workingDirectory,
			model: this.config.model,
			timestamp: new Date().toISOString(),
		};
		this.logStream.write(`${JSON.stringify(startEntry)}\n`);
		this.readableLogStream.write(
			`=== Session Start ===\n${JSON.stringify(startEntry, null, 2)}\n\n`,
		);

		console.log(`[CodexRunner] Logging to: ${join(logsDir, sessionId)}.*`);
	}
}
