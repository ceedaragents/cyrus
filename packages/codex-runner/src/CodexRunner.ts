/**
 * CodexRunner - OpenAI Codex CLI process manager
 *
 * Manages OpenAI Codex CLI sessions and communication. Implements the IAgentRunner
 * interface to provide a provider-agnostic wrapper around the Codex CLI.
 *
 * Key differences from GeminiRunner:
 * - Uses TOML configuration (config.toml) instead of JSON (settings.json)
 * - Uses `codex exec --json` for non-interactive execution
 * - No delta message accumulation needed (complete items emitted)
 * - No result coercion needed (agent_message contains final text)
 * - Uses thread_id instead of session_id
 *
 * @example
 * ```typescript
 * const runner = new CodexRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'gpt-5.1-codex-max',
 *   sandboxMode: 'workspace-write'
 * });
 *
 * // Start session
 * await runner.start("Analyze this codebase");
 *
 * // Get results
 * const messages = runner.getMessages();
 * ```
 */

import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKMessage,
	SDKResultMessage,
} from "cyrus-core";
import { codexEventToSDKMessages } from "./adapters.js";
import {
	autoDetectMcpConfig,
	type CodexConfigOptions,
	convertToCodexMcpConfig,
	loadMcpConfigFromPaths,
	setupCodexConfig,
} from "./configGenerator.js";
import { CodexMessageFormatter } from "./formatter.js";
import {
	extractThreadId,
	isAgentMessageItem,
	isItemCompletedEvent,
	safeParseCodexEvent,
	type ThreadEvent,
} from "./schemas.js";
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
 * wrapper around the Codex CLI. It spawns the Codex CLI process with `--json` flag
 * and translates between the CLI's JSONL output and Claude SDK message types.
 */
export class CodexRunner extends EventEmitter implements IAgentRunner {
	/**
	 * CodexRunner does not support streaming input.
	 * Use start() with a complete prompt.
	 */
	readonly supportsStreamingInput = false;

	private config: CodexRunnerConfig;
	private process: ChildProcess | null = null;
	private sessionInfo: CodexSessionInfo | null = null;
	private logStream: WriteStream | null = null;
	private readableLogStream: WriteStream | null = null;
	private messages: SDKMessage[] = [];
	private cyrusHome: string;
	// Track last agent message text for result messages
	private lastAgentMessageText: string | null = null;
	// Config cleanup function
	private configCleanup: (() => void) | null = null;
	// Message formatter
	private formatter: IMessageFormatter;
	// Readline interface for stdout processing
	private readlineInterface: ReturnType<typeof createInterface> | null = null;
	// Deferred result message to emit after loop completes
	private pendingResultMessage: SDKMessage | null = null;

	constructor(config: CodexRunnerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		// Use CodexMessageFormatter for Codex-specific tool names
		this.formatter = new CodexMessageFormatter();

		// Forward config callbacks to events
		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	/**
	 * Start a new Codex session with string prompt
	 */
	async start(prompt: string): Promise<CodexSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Codex session already running");
		}

		// Initialize session info without thread ID (will be set from thread.started event)
		this.sessionInfo = {
			sessionId: null,
			threadId: null,
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

		// Set up logging (initial setup without thread ID)
		this.setupLogging();

		// Reset messages array
		this.messages = [];
		this.lastAgentMessageText = null;

		// Build MCP servers configuration
		const mcpServers = this.buildMcpServers();

		// Setup Codex config with MCP servers and other options
		const configOptions: CodexConfigOptions = {};

		if (this.config.model) {
			configOptions.model = this.config.model;
		}

		if (this.config.sandboxMode) {
			configOptions.sandboxMode = this.config.sandboxMode;
		}

		if (this.config.reasoningEffort) {
			configOptions.reasoningEffort = this.config.reasoningEffort;
		}

		if (this.config.reasoningSummary) {
			configOptions.reasoningSummary = this.config.reasoningSummary;
		}

		if (this.config.approvalPolicy) {
			configOptions.approvalPolicy = this.config.approvalPolicy;
		}

		if (Object.keys(mcpServers).length > 0) {
			configOptions.mcpServers = mcpServers;
		}

		// Only setup config if we have something to configure
		if (Object.keys(configOptions).length > 0) {
			this.configCleanup = setupCodexConfig(configOptions);
		}

		try {
			// Build Codex CLI command
			const codexPath = this.config.codexPath || "codex";
			const args: string[] = ["exec", "--json"];

			// Add dangerously-bypass-approvals-and-sandbox for automation
			args.push("--dangerously-bypass-approvals-and-sandbox");

			// Add working directory
			if (this.config.workingDirectory) {
				args.push("--cd", this.config.workingDirectory);
			}

			// Add skip-git-repo-check if configured
			if (this.config.skipGitRepoCheck) {
				args.push("--skip-git-repo-check");
			}

			// Add model if specified
			if (this.config.model) {
				args.push("--model", this.config.model);
			}

			// Add resume session if provided
			if (this.config.resumeSessionId) {
				// Use `codex exec resume` subcommand format
				args[0] = "exec";
				args.splice(1, 0, "resume", this.config.resumeSessionId);
				console.log(
					`[CodexRunner] Resuming thread: ${this.config.resumeSessionId}`,
				);
			}

			// Add the prompt as the last argument
			args.push(prompt);

			// Prepare environment variables for Codex CLI
			const codexEnv = { ...process.env };

			// Handle system prompt by prepending to user prompt
			// (Codex doesn't have a separate system prompt mechanism like Gemini's GEMINI_SYSTEM_MD)
			let fullPrompt = prompt;
			if (this.config.appendSystemPrompt) {
				fullPrompt = `${this.config.appendSystemPrompt}\n\n---\n\n${prompt}`;
				// Update the last argument with the full prompt
				args[args.length - 1] = fullPrompt;
				console.log(
					`[CodexRunner] Prepended system prompt (${this.config.appendSystemPrompt.length} chars)`,
				);
			}

			// Spawn Codex CLI process
			console.log(
				`[CodexRunner] Spawning: ${codexPath} ${args.slice(0, 5).join(" ")}...`,
			);
			this.process = spawn(codexPath, args, {
				cwd: this.config.workingDirectory,
				stdio: ["ignore", "pipe", "pipe"],
				env: codexEnv,
			});

			// Set up stdout line reader for JSONL events
			this.readlineInterface = createInterface({
				input: this.process.stdout!,
				crlfDelay: Infinity,
			});

			// Process each line as a JSONL event with Zod validation
			this.readlineInterface.on("line", (line: string) => {
				const event = safeParseCodexEvent(line);
				if (event) {
					this.processThreadEvent(event);
				} else {
					console.error(
						"[CodexRunner] Failed to parse/validate JSONL event:",
						line,
					);
				}
			});

			// Handle stderr
			this.process.stderr?.on("data", (data: Buffer) => {
				console.error("[CodexRunner] stderr:", data.toString());
			});

			// Wait for process to complete
			await new Promise<void>((resolve, reject) => {
				if (!this.process) {
					reject(new Error("Process not started"));
					return;
				}

				this.process.on("close", (code: number) => {
					console.log(`[CodexRunner] Process exited with code ${code}`);
					if (code === 0) {
						resolve();
					} else {
						reject(new Error(`Codex CLI exited with code ${code}`));
					}
				});

				this.process.on("error", (err: Error) => {
					console.error("[CodexRunner] Process error:", err);
					reject(err);
				});
			});

			// Session completed successfully - mark as not running BEFORE emitting result
			console.log(
				`[CodexRunner] Session completed with ${this.messages.length} messages`,
			);
			this.sessionInfo.isRunning = false;

			// Emit deferred result message after marking isRunning = false
			if (this.pendingResultMessage) {
				this.emitMessage(this.pendingResultMessage);
				this.pendingResultMessage = null;
			}

			this.emit("complete", this.messages);
		} catch (error) {
			console.error("[CodexRunner] Session error:", error);

			if (this.sessionInfo) {
				this.sessionInfo.isRunning = false;
			}

			// Emit error result message to maintain consistent message flow
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const errorResult: SDKResultMessage = {
				type: "result",
				subtype: "error_during_execution",
				duration_ms: Date.now() - this.sessionInfo!.startedAt.getTime(),
				duration_api_ms: 0,
				is_error: true,
				num_turns: 0,
				errors: [errorMessage],
				total_cost_usd: 0,
				usage: {
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation: {
						ephemeral_1h_input_tokens: 0,
						ephemeral_5m_input_tokens: 0,
					},
					server_tool_use: {
						web_fetch_requests: 0,
						web_search_requests: 0,
					},
					service_tier: "standard",
				},
				modelUsage: {},
				permission_denials: [],
				uuid: crypto.randomUUID(),
				session_id: this.sessionInfo?.threadId || "pending",
			};

			this.emitMessage(errorResult);

			this.emit(
				"error",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			// Clean up
			this.process = null;
			this.pendingResultMessage = null;

			// Close log streams
			if (this.logStream) {
				this.logStream.end();
				this.logStream = null;
			}
			if (this.readableLogStream) {
				this.readableLogStream.end();
				this.readableLogStream = null;
			}

			// Restore Codex config
			if (this.configCleanup) {
				this.configCleanup();
				this.configCleanup = null;
			}
		}

		return this.sessionInfo;
	}

	/**
	 * Process a Codex thread event and convert to SDK messages
	 */
	private processThreadEvent(event: ThreadEvent): void {
		console.log(
			`[CodexRunner] Thread event: ${event.type}`,
			JSON.stringify(event).substring(0, 200),
		);

		// Emit raw thread event
		this.emit("threadEvent", event);

		// Extract thread ID from thread.started event
		const threadId = extractThreadId(event);
		if (threadId && !this.sessionInfo?.threadId) {
			this.sessionInfo!.threadId = threadId;
			this.sessionInfo!.sessionId = threadId; // Also set sessionId for compatibility
			console.log(`[CodexRunner] Thread ID assigned: ${threadId}`);

			// Re-setup logging now that we have the thread ID
			this.setupLogging();
		}

		// Track last agent message text for result messages
		if (isItemCompletedEvent(event) && isAgentMessageItem(event.item)) {
			this.lastAgentMessageText = event.item.text;
		}

		// Convert to SDK messages
		const sdkMessages = codexEventToSDKMessages(
			event,
			this.sessionInfo?.threadId || null,
			this.config.model,
			this.lastAgentMessageText || undefined,
		);

		for (const message of sdkMessages) {
			// Defer result message emission until after loop completes
			if (message.type === "result") {
				this.pendingResultMessage = message;
			} else {
				this.emitMessage(message);
			}
		}
	}

	/**
	 * Emit a message (add to messages array, log, and emit event)
	 */
	private emitMessage(message: SDKMessage): void {
		this.messages.push(message);

		// Log to detailed JSON log
		if (this.logStream) {
			const logEntry = {
				type: "sdk-message",
				message,
				timestamp: new Date().toISOString(),
			};
			this.logStream.write(`${JSON.stringify(logEntry)}\n`);
		}

		// Log to human-readable log
		if (this.readableLogStream) {
			this.writeReadableLogEntry(message);
		}

		// Emit message event
		this.emit("message", message);
	}

	/**
	 * Stop the current Codex session
	 */
	stop(): void {
		// Close readline interface first to stop processing stdout
		if (this.readlineInterface) {
			if (typeof this.readlineInterface.close === "function") {
				this.readlineInterface.close();
			}
			this.readlineInterface.removeAllListeners();
			this.readlineInterface = null;
		}

		if (this.process) {
			console.log("[CodexRunner] Stopping Codex process");
			this.process.kill("SIGTERM");
			this.process = null;
		}

		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}

		// Restore Codex config
		if (this.configCleanup) {
			this.configCleanup();
			this.configCleanup = null;
		}
	}

	/**
	 * Check if the session is currently running
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
	 * Get the last agent message text
	 */
	getLastAgentMessage(): string | null {
		return this.lastAgentMessageText;
	}

	/**
	 * Build MCP servers configuration from config paths and inline config
	 *
	 * MCP configuration loading follows a layered approach:
	 * 1. Auto-detect .mcp.json in working directory (base config)
	 * 2. Load from explicitly configured paths via mcpConfigPath (extends/overrides)
	 * 3. Merge inline mcpConfig (highest priority, overrides file configs)
	 *
	 * @returns Record of MCP server name to CodexMcpServerConfig
	 */
	private buildMcpServers(): Record<string, CodexMcpServerConfig> {
		const codexMcpServers: Record<string, CodexMcpServerConfig> = {};

		// Build config paths list, starting with auto-detected .mcp.json
		const configPaths: string[] = [];

		// 1. Auto-detect .mcp.json in working directory
		const autoDetectedPath = autoDetectMcpConfig(this.config.workingDirectory);
		if (autoDetectedPath) {
			configPaths.push(autoDetectedPath);
		}

		// 2. Add explicitly configured paths
		if (this.config.mcpConfigPath) {
			const explicitPaths = Array.isArray(this.config.mcpConfigPath)
				? this.config.mcpConfigPath
				: [this.config.mcpConfigPath];
			configPaths.push(...explicitPaths);
		}

		// Load from all config paths
		const fileBasedServers = loadMcpConfigFromPaths(
			configPaths.length > 0 ? configPaths : undefined,
		);

		// 3. Merge inline config (overrides file-based config)
		const allServers = this.config.mcpConfig
			? { ...fileBasedServers, ...this.config.mcpConfig }
			: fileBasedServers;

		// Convert each server to Codex format
		for (const [serverName, serverConfig] of Object.entries(allServers)) {
			const codexConfig = convertToCodexMcpConfig(serverName, serverConfig);
			if (codexConfig) {
				codexMcpServers[serverName] = codexConfig;
			}
		}

		if (Object.keys(codexMcpServers).length > 0) {
			console.log(
				`[CodexRunner] Configured ${Object.keys(codexMcpServers).length} MCP server(s): ${Object.keys(codexMcpServers).join(", ")}`,
			);
		}

		return codexMcpServers;
	}

	/**
	 * Set up logging streams for this session
	 */
	private setupLogging(): void {
		const logsDir = join(this.cyrusHome, "logs");
		const workspaceName =
			this.config.workspaceName ||
			(this.config.workingDirectory
				? this.config.workingDirectory.split("/").pop()
				: "default") ||
			"default";
		const workspaceLogsDir = join(logsDir, workspaceName);
		const threadId = this.sessionInfo?.threadId || "pending";

		// Close existing streams if they exist
		if (this.logStream) {
			this.logStream.end();
		}
		if (this.readableLogStream) {
			this.readableLogStream.end();
		}

		// Ensure logs directory exists
		mkdirSync(workspaceLogsDir, { recursive: true });

		// Create log streams
		const logPath = join(workspaceLogsDir, `${threadId}.ndjson`);
		const readableLogPath = join(workspaceLogsDir, `${threadId}.log`);

		console.log(`[CodexRunner] Logging to: ${logPath}`);
		console.log(`[CodexRunner] Readable log: ${readableLogPath}`);

		this.logStream = createWriteStream(logPath, { flags: "a" });
		this.readableLogStream = createWriteStream(readableLogPath, { flags: "a" });

		// Log session start
		const startEntry = {
			type: "session-start",
			threadId,
			timestamp: new Date().toISOString(),
			config: {
				model: this.config.model,
				workingDirectory: this.config.workingDirectory,
			},
		};
		this.logStream.write(`${JSON.stringify(startEntry)}\n`);
		this.readableLogStream.write(
			`=== Thread ${threadId} started at ${new Date().toISOString()} ===\n\n`,
		);
	}

	/**
	 * Write a human-readable log entry for a message
	 */
	private writeReadableLogEntry(message: SDKMessage): void {
		if (!this.readableLogStream) return;

		const timestamp = new Date().toISOString();
		this.readableLogStream.write(`[${timestamp}] ${message.type}\n`);

		if (message.type === "user" || message.type === "assistant") {
			const content =
				typeof message.message.content === "string"
					? message.message.content
					: JSON.stringify(message.message.content, null, 2);
			this.readableLogStream.write(`${content}\n\n`);
		} else {
			// Other message types (system, result, etc.)
			this.readableLogStream.write(`${JSON.stringify(message, null, 2)}\n\n`);
		}
	}
}
