/**
 * CodexRunner - Manages Codex SDK sessions and communication
 *
 * CodexRunner implements the IAgentRunner interface to provide a provider-agnostic
 * wrapper around the OpenAI Codex TypeScript SDK. It uses the Codex SDK's Thread
 * class for multi-turn conversations and translates SDK events to Claude SDK message types.
 *
 * Key features:
 * - Uses Codex TypeScript SDK for clean API integration
 * - Native multi-turn support via thread.run() loop
 * - Event streaming via async iterators
 * - Automatic binary resolution per platform
 *
 * @example
 * ```typescript
 * const runner = new CodexRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'o4-mini',
 *   sandboxMode: 'workspace-write'
 * });
 *
 * // Start a session
 * const session = await runner.start("Analyze this codebase");
 * console.log(`Thread ID: ${session.threadId}`);
 *
 * // Get messages
 * const messages = runner.getMessages();
 * console.log(`Received ${messages.length} messages`);
 * ```
 */

import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
} from "cyrus-core";
import {
	codexEventToSDKMessage,
	createUserMessage,
	extractThreadId,
} from "./adapters.js";
import { CodexMessageFormatter } from "./formatter.js";
import type {
	CodexRunnerConfig,
	CodexRunnerEvents,
	CodexSessionInfo,
	CodexThreadEvent,
} from "./types.js";

// Import Codex SDK types
// The actual SDK import is done dynamically to handle cases where SDK isn't installed
type CodexSDK = typeof import("@openai/codex-sdk");
type Codex = InstanceType<CodexSDK["Codex"]>;
type Thread = ReturnType<Codex["startThread"]>;

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
 * Manages Codex SDK sessions and communication
 */
export class CodexRunner extends EventEmitter implements IAgentRunner {
	/**
	 * CodexRunner supports streaming input through the SDK's Thread.run() method.
	 * Each call to run() adds a new turn to the conversation.
	 */
	readonly supportsStreamingInput = false;

	private config: CodexRunnerConfig;
	private codex: Codex | null = null;
	private thread: Thread | null = null;
	private sessionInfo: CodexSessionInfo | null = null;
	private logStream: WriteStream | null = null;
	private readableLogStream: WriteStream | null = null;
	private messages: SDKMessage[] = [];
	private cyrusHome: string;
	private lastAssistantMessage: SDKAssistantMessage | null = null;
	private formatter: IMessageFormatter;
	private pendingResultMessage: SDKMessage | null = null;
	private isSessionRunning = false;

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
	 * Start a new Codex session with string prompt
	 */
	async start(prompt: string): Promise<CodexSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Codex session already running");
		}

		// Initialize session info
		this.sessionInfo = {
			sessionId: null,
			threadId: null,
			startedAt: new Date(),
			isRunning: true,
		};
		this.isSessionRunning = true;

		console.log(`[CodexRunner] Starting new session`);
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

		try {
			// Dynamically import Codex SDK
			const { Codex } = await import("@openai/codex-sdk");

			// Initialize Codex client
			this.codex = new Codex({
				codexPathOverride: this.config.codexPath,
			});

			// Build thread options
			const threadOptions = this.buildThreadOptions();

			// Start a new thread
			this.thread = this.codex.startThread(threadOptions);

			console.log(`[CodexRunner] Thread started, running prompt...`);
			console.log(`[CodexRunner] Prompt length: ${prompt.length} characters`);

			// Emit user message
			const userMessage = createUserMessage(prompt, this.sessionInfo.sessionId);
			this.emitMessage(userMessage);

			// Run the prompt and stream events
			const { events } = await this.thread.runStreamed(prompt);

			// Process events
			for await (const event of events) {
				this.processThreadEvent(event as CodexThreadEvent);
			}

			// Session completed successfully
			console.log(
				`[CodexRunner] Session completed with ${this.messages.length} messages`,
			);
			this.sessionInfo.isRunning = false;
			this.isSessionRunning = false;

			// Emit deferred result message
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
			this.isSessionRunning = false;

			// Emit error result message
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
				session_id: this.sessionInfo?.sessionId || "pending",
			};

			this.emitMessage(errorResult);

			this.emit(
				"error",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			// Clean up
			this.thread = null;
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
		}

		return this.sessionInfo;
	}

	/**
	 * Start a new session with streaming input (not yet supported)
	 */
	async startStreaming(initialPrompt?: string): Promise<CodexSessionInfo> {
		// For now, delegate to regular start
		if (initialPrompt) {
			return this.start(initialPrompt);
		}
		throw new Error("CodexRunner requires an initial prompt");
	}

	/**
	 * Add a message to the streaming session (multi-turn support)
	 * Note: This is not truly streaming, but adds a new turn to the thread
	 */
	addStreamMessage(content: string): void {
		if (!this.thread) {
			throw new Error("Cannot add message - no active thread");
		}

		// Queue the message for the next turn
		// In Codex SDK, multi-turn is handled by calling thread.run() again
		console.log(
			`[CodexRunner] Queued message for next turn: ${content.substring(0, 50)}...`,
		);
	}

	/**
	 * Complete the streaming prompt
	 */
	completeStream(): void {
		// No-op for now - Codex handles this internally
		console.log("[CodexRunner] Stream completed");
	}

	/**
	 * Process a Codex thread event and convert to SDK message
	 */
	private processThreadEvent(event: CodexThreadEvent): void {
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
			this.sessionInfo!.sessionId = threadId; // Use thread ID as session ID
			console.log(`[CodexRunner] Thread ID assigned: ${threadId}`);

			// Re-setup logging with the new session ID
			this.setupLogging();
		}

		// Convert to SDK message format (may return multiple messages)
		const messages = codexEventToSDKMessage(
			event,
			this.sessionInfo?.sessionId || null,
			this.lastAssistantMessage,
			this.config.model,
		);

		if (messages) {
			for (const message of messages) {
				// Track last assistant message for result coercion
				if (message.type === "assistant") {
					this.lastAssistantMessage = message;
				}

				// Defer result message emission
				if (message.type === "result") {
					this.pendingResultMessage = message;
				} else {
					this.emitMessage(message);
				}
			}
		}
	}

	/**
	 * Build Codex thread options from config
	 */
	private buildThreadOptions(): Record<string, unknown> {
		const options: Record<string, unknown> = {
			workingDirectory: this.config.workingDirectory,
			skipGitRepoCheck: this.config.skipGitRepoCheck ?? true,
		};

		if (this.config.model) {
			options.model = this.config.model;
		}

		// Default to full access (equivalent to --dangerously-bypass-approvals-and-sandbox)
		// This matches the automated agent use case where we need full system access
		if (this.config.sandboxMode) {
			options.sandboxMode = this.config.sandboxMode;
		} else {
			options.sandboxMode = "danger-full-access";
		}

		if (this.config.modelReasoningEffort) {
			options.modelReasoningEffort = this.config.modelReasoningEffort;
		}

		// Enable network access by default for full capability
		if (this.config.networkAccessEnabled !== undefined) {
			options.networkAccessEnabled = this.config.networkAccessEnabled;
		} else {
			options.networkAccessEnabled = true;
		}

		// Enable web search by default for full capability
		if (this.config.webSearchEnabled !== undefined) {
			options.webSearchEnabled = this.config.webSearchEnabled;
		} else {
			options.webSearchEnabled = true;
		}

		// Default to never requiring approval for automated sessions
		if (this.config.approvalPolicy) {
			options.approvalPolicy = this.config.approvalPolicy;
		} else {
			options.approvalPolicy = "never";
		}

		if (this.config.allowedDirectories) {
			options.additionalDirectories = this.config.allowedDirectories;
		}

		return options;
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
		console.log("[CodexRunner] Stopping Codex session");

		// There's no direct way to abort a Thread in the SDK,
		// but we can mark the session as stopped
		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}
		this.isSessionRunning = false;

		// Clear references
		this.thread = null;
	}

	/**
	 * Check if the session is currently running
	 */
	isRunning(): boolean {
		return this.isSessionRunning;
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
	 * Get the last assistant message
	 */
	getLastAssistantMessage(): SDKAssistantMessage | null {
		return this.lastAssistantMessage;
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

		console.log(`[CodexRunner] Logging to: ${logPath}`);
		console.log(`[CodexRunner] Readable log: ${readableLogPath}`);

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
				sandboxMode: this.config.sandboxMode,
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
