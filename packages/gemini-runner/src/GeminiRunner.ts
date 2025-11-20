import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	type IAgentRunner,
	type SDKMessage,
	type SDKUserMessage,
	StreamingPrompt,
} from "cyrus-core";
import { extractSessionId, geminiEventToSDKMessage } from "./adapters.js";
import type {
	GeminiRunnerConfig,
	GeminiRunnerEvents,
	GeminiSessionInfo,
	GeminiStreamEvent,
} from "./types.js";

export declare interface GeminiRunner {
	on<K extends keyof GeminiRunnerEvents>(
		event: K,
		listener: GeminiRunnerEvents[K],
	): this;
	emit<K extends keyof GeminiRunnerEvents>(
		event: K,
		...args: Parameters<GeminiRunnerEvents[K]>
	): boolean;
}

/**
 * Manages Gemini CLI sessions and communication
 *
 * GeminiRunner implements the IAgentRunner interface to provide a provider-agnostic
 * wrapper around the Gemini CLI. It spawns the Gemini CLI process in headless mode
 * and translates between the CLI's JSON streaming format and Claude SDK message types.
 *
 * @example
 * ```typescript
 * const runner = new GeminiRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'gemini-2.5-flash',
 *   autoApprove: true
 * });
 *
 * // String mode
 * await runner.start("Analyze this codebase");
 *
 * // Streaming mode
 * await runner.startStreaming("Initial task");
 * runner.addStreamMessage("Additional context");
 * runner.completeStream();
 * ```
 */
export class GeminiRunner extends EventEmitter implements IAgentRunner {
	private config: GeminiRunnerConfig;
	private process: ChildProcess | null = null;
	private sessionInfo: GeminiSessionInfo | null = null;
	private logStream: WriteStream | null = null;
	private readableLogStream: WriteStream | null = null;
	private messages: SDKMessage[] = [];
	private streamingPrompt: StreamingPrompt | null = null;
	private cyrusHome: string;
	// Delta message accumulation
	private accumulatingMessage: SDKMessage | null = null;
	private accumulatingRole: "user" | "assistant" | null = null;

	constructor(config: GeminiRunnerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;

		// Forward config callbacks to events
		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	/**
	 * Start a new Gemini session with string prompt (legacy mode)
	 */
	async start(prompt: string): Promise<GeminiSessionInfo> {
		return this.startWithPrompt(prompt);
	}

	/**
	 * Start a new Gemini session with streaming input
	 */
	async startStreaming(initialPrompt?: string): Promise<GeminiSessionInfo> {
		return this.startWithPrompt(null, initialPrompt);
	}

	/**
	 * Add a message to the streaming prompt (only works when in streaming mode)
	 */
	addStreamMessage(content: string): void {
		if (!this.streamingPrompt) {
			throw new Error("Cannot add stream message when not in streaming mode");
		}
		this.streamingPrompt.addMessage(content);

		// For Gemini CLI, we need to write to stdin if process is running
		if (this.process?.stdin) {
			this.process.stdin.write(`${content}\n`);
		}
	}

	/**
	 * Complete the streaming prompt (no more messages will be added)
	 */
	completeStream(): void {
		if (this.streamingPrompt) {
			this.streamingPrompt.complete();

			// Close stdin to signal completion to Gemini CLI
			if (this.process?.stdin) {
				this.process.stdin.end();
			}
		}
	}

	/**
	 * Internal method to start a Gemini session with either string or streaming prompt
	 */
	private async startWithPrompt(
		stringPrompt?: string | null,
		streamingInitialPrompt?: string,
	): Promise<GeminiSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Gemini session already running");
		}

		// Initialize session info without session ID (will be set from init event)
		this.sessionInfo = {
			sessionId: null,
			startedAt: new Date(),
			isRunning: true,
		};

		console.log(
			`[GeminiRunner] Starting new session (session ID will be assigned by Gemini)`,
		);
		console.log(
			"[GeminiRunner] Working directory:",
			this.config.workingDirectory,
		);

		// Ensure working directory exists
		if (this.config.workingDirectory) {
			try {
				mkdirSync(this.config.workingDirectory, { recursive: true });
				console.log("[GeminiRunner] Created working directory");
			} catch (err) {
				console.error(
					"[GeminiRunner] Failed to create working directory:",
					err,
				);
			}
		}

		// Set up logging (initial setup without session ID)
		this.setupLogging();

		// Reset messages array
		this.messages = [];

		try {
			// Build Gemini CLI command
			const geminiPath = this.config.geminiPath || "gemini";
			const args: string[] = ["--output-format", "stream-json"];

			// Add model if specified
			if (this.config.model) {
				args.push("--model", this.config.model);
			}

			// Add resume session flag if provided
			if (this.config.resumeSessionId) {
				args.push("-r", this.config.resumeSessionId);
				console.log(
					`[GeminiRunner] Resuming session: ${this.config.resumeSessionId}`,
				);
			}

			// Add auto-approve flags
			if (this.config.autoApprove) {
				args.push("--yolo");
			}

			if (this.config.approvalMode) {
				args.push("--approval-mode", this.config.approvalMode);
			}

			// Add debug flag
			if (this.config.debug) {
				args.push("--debug");
			}

			// Add include-directories flag if specified
			if (
				this.config.includeDirectories &&
				this.config.includeDirectories.length > 0
			) {
				args.push(
					"--include-directories",
					this.config.includeDirectories.join(","),
				);
			}

			// Handle prompt mode
			let useStdin = false;
			if (stringPrompt !== null && stringPrompt !== undefined) {
				// String mode - pass prompt via --prompt flag
				console.log(
					`[GeminiRunner] Starting with string prompt length: ${stringPrompt.length} characters`,
				);
				args.push("--prompt", stringPrompt);
			} else {
				// Streaming mode - use stdin
				console.log(`[GeminiRunner] Starting with streaming prompt`);
				this.streamingPrompt = new StreamingPrompt(
					null,
					streamingInitialPrompt,
				);
				useStdin = true;

				// Send initial prompt to stdin if provided
				if (streamingInitialPrompt) {
					// Will be written after process spawns
				}
			}

			// Spawn Gemini CLI process
			console.log(`[GeminiRunner] Spawning: ${geminiPath} ${args.join(" ")}`);
			this.process = spawn(geminiPath, args, {
				cwd: this.config.workingDirectory,
				stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
			});

			// Write initial streaming prompt to stdin if provided
			if (useStdin && streamingInitialPrompt && this.process.stdin) {
				this.process.stdin.write(`${streamingInitialPrompt}\n`);
			}

			// Set up stdout line reader for JSON events
			const rl = createInterface({
				input: this.process.stdout!,
				crlfDelay: Infinity,
			});

			// Process each line as a JSON event
			rl.on("line", (line: string) => {
				try {
					const event = JSON.parse(line) as GeminiStreamEvent;
					this.processStreamEvent(event);
				} catch (err) {
					console.error("[GeminiRunner] Failed to parse JSON event:", err);
					console.error("[GeminiRunner] Line:", line);
				}
			});

			// Handle stderr
			this.process.stderr?.on("data", (data: Buffer) => {
				console.error("[GeminiRunner] stderr:", data.toString());
			});

			// Wait for process to complete
			await new Promise<void>((resolve, reject) => {
				if (!this.process) {
					reject(new Error("Process not started"));
					return;
				}

				this.process.on("close", (code: number) => {
					console.log(`[GeminiRunner] Process exited with code ${code}`);
					if (code === 0) {
						resolve();
					} else {
						reject(new Error(`Gemini CLI exited with code ${code}`));
					}
				});

				this.process.on("error", (err: Error) => {
					console.error("[GeminiRunner] Process error:", err);
					reject(err);
				});
			});

			// Flush any remaining accumulated message
			this.flushAccumulatedMessage();

			// Session completed successfully
			console.log(
				`[GeminiRunner] Session completed with ${this.messages.length} messages`,
			);
			this.sessionInfo.isRunning = false;
			this.emit("complete", this.messages);
		} catch (error) {
			console.error("[GeminiRunner] Session error:", error);

			if (this.sessionInfo) {
				this.sessionInfo.isRunning = false;
			}

			this.emit(
				"error",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			// Clean up
			this.process = null;

			// Complete and clean up streaming prompt if it exists
			if (this.streamingPrompt) {
				this.streamingPrompt.complete();
				this.streamingPrompt = null;
			}

			// Close log streams
			if (this.logStream) {
				this.logStream.end();
				this.logStream = null;
			}
			if (this.readableLogStream) {
				this.readableLogStream.end();
				this.readableLogStream = null;
			}
		}

		return this.sessionInfo;
	}

	/**
	 * Process a Gemini stream event and convert to SDK message
	 */
	private processStreamEvent(event: GeminiStreamEvent): void {
		console.log(`[GeminiRunner] Stream event:`, event.type);

		// Emit raw stream event
		this.emit("streamEvent", event);

		// Extract session ID from init event
		const sessionId = extractSessionId(event);
		if (sessionId && !this.sessionInfo?.sessionId) {
			this.sessionInfo!.sessionId = sessionId;
			console.log(`[GeminiRunner] Session ID assigned: ${sessionId}`);

			// Update streaming prompt with session ID if it exists
			if (this.streamingPrompt) {
				this.streamingPrompt.updateSessionId(sessionId);
			}

			// Re-setup logging now that we have the session ID
			this.setupLogging();
		}

		// Handle delta message accumulation
		if (event.type === "message") {
			const messageEvent = event;

			// Check if this is a delta message
			if (messageEvent.delta === true) {
				// Accumulate delta message
				this.accumulateDeltaMessage(messageEvent);
				return; // Don't process further, just accumulate
			} else {
				// Not a delta message - flush any accumulated message first
				this.flushAccumulatedMessage();
			}
		} else {
			// Non-message event - flush any accumulated message
			this.flushAccumulatedMessage();
		}

		// Convert to SDK message format
		const message = geminiEventToSDKMessage(
			event,
			this.sessionInfo?.sessionId || null,
		);

		if (message) {
			this.emitMessage(message);
		}
	}

	/**
	 * Accumulate a delta message (message with delta: true)
	 */
	private accumulateDeltaMessage(
		event: GeminiStreamEvent & { type: "message" },
	): void {
		console.log(
			`[GeminiRunner] Accumulating delta message (role: ${event.role})`,
		);

		// If role changed or no accumulating message exists, start new accumulation
		if (!this.accumulatingMessage || this.accumulatingRole !== event.role) {
			// Flush previous accumulation if exists
			this.flushAccumulatedMessage();

			// Start new accumulation
			if (event.role === "user") {
				this.accumulatingMessage = {
					type: "user",
					message: {
						role: "user",
						content: event.content,
					},
					parent_tool_use_id: null,
					session_id: this.sessionInfo?.sessionId || "pending",
				} as SDKUserMessage;
			} else {
				// assistant role
				this.accumulatingMessage = {
					type: "assistant",
					message: {
						role: "assistant",
						content: event.content,
					},
					session_id: this.sessionInfo?.sessionId || "pending",
				} as unknown as SDKMessage;
			}
			this.accumulatingRole = event.role;
		} else {
			// Same role - append content
			if (
				this.accumulatingMessage.type === "user" ||
				this.accumulatingMessage.type === "assistant"
			) {
				const currentContent = this.accumulatingMessage.message.content;
				if (typeof currentContent === "string") {
					this.accumulatingMessage.message.content =
						currentContent + event.content;
				}
			}
		}
	}

	/**
	 * Flush the accumulated delta message
	 */
	private flushAccumulatedMessage(): void {
		if (this.accumulatingMessage) {
			console.log(
				`[GeminiRunner] Flushing accumulated message (role: ${this.accumulatingRole})`,
			);
			this.emitMessage(this.accumulatingMessage);
			this.accumulatingMessage = null;
			this.accumulatingRole = null;
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
	 * Stop the current Gemini session
	 */
	stop(): void {
		// Flush any accumulated message before stopping
		this.flushAccumulatedMessage();

		if (this.process) {
			console.log("[GeminiRunner] Stopping Gemini process");
			this.process.kill("SIGTERM");
			this.process = null;
		}

		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}

		// Complete streaming prompt if active
		if (this.streamingPrompt) {
			this.streamingPrompt.complete();
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
		const sessionId = this.sessionInfo?.sessionId || "pending";

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
		const logPath = join(workspaceLogsDir, `${sessionId}.ndjson`);
		const readableLogPath = join(workspaceLogsDir, `${sessionId}.log`);

		console.log(`[GeminiRunner] Logging to: ${logPath}`);
		console.log(`[GeminiRunner] Readable log: ${readableLogPath}`);

		this.logStream = createWriteStream(logPath, { flags: "a" });
		this.readableLogStream = createWriteStream(readableLogPath, { flags: "a" });

		// Log session start
		const startEntry = {
			type: "session-start",
			sessionId,
			timestamp: new Date().toISOString(),
			config: {
				model: this.config.model,
				workingDirectory: this.config.workingDirectory,
			},
		};
		this.logStream.write(`${JSON.stringify(startEntry)}\n`);
		this.readableLogStream.write(
			`=== Session ${sessionId} started at ${new Date().toISOString()} ===\n\n`,
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
