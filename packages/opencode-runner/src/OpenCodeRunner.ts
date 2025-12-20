/**
 * OpenCode Runner
 *
 * Main runner implementation for the OpenCode SDK.
 * Implements IAgentRunner interface with streaming input support.
 *
 * Key features:
 * - SDK server lifecycle management via createOpencode()
 * - SSE event subscription for real-time updates
 * - True streaming input support (supportsStreamingInput = true)
 * - Logging to ~/.cyrus/logs/
 * - Message type conversion to Claude SDK format
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createOpencode,
	type Config as OpenCodeSDKConfig,
	type Message as OpenCodeSDKMessage,
	type Session as OpenCodeSDKSession,
	type OpencodeClient,
	type Part,
	type TextPart,
	type ToolPart,
} from "@opencode-ai/sdk";
import type {
	AgentMessage,
	AgentSessionInfo,
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import { StreamingPrompt } from "cyrus-core";

import { OpenCodeConfigBuilder } from "./configBuilder.js";
import { OpenCodeMessageFormatter } from "./formatter.js";
import { allocateOpenCodePort } from "./portAllocator.js";
import type { OpenCodeRunnerConfig, OpenCodeSessionInfo } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const LOG_PREFIX = "[OpenCodeRunner]";

// ============================================================================
// Helper Functions for SDK Message Creation
// ============================================================================

/**
 * Create an SDK user message in the proper format.
 */
function createSDKUserMessage(
	content: string,
	sessionId: string | null,
): SDKUserMessage {
	return {
		type: "user",
		message: {
			role: "user",
			content: content,
		},
		parent_tool_use_id: null,
		session_id: sessionId || "pending",
	};
}

/**
 * Create a minimal BetaMessage structure for SDK compatibility.
 *
 * Since we're adapting from OpenCode SDK to Claude SDK format, we create
 * a minimal valid BetaMessage structure with placeholder values for fields
 * that OpenCode doesn't provide.
 */
function createBetaMessage(
	content: Array<{
		type: string;
		text?: string;
		id?: string;
		name?: string;
		input?: unknown;
	}>,
): SDKAssistantMessage["message"] {
	// Type assertion needed because we're constructing content blocks from OpenCode format
	// which has the same structure but TypeScript can't verify the runtime types
	const contentBlocks =
		content as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: `msg_${randomUUID()}`,
		type: "message" as const,
		role: "assistant" as const,
		content: contentBlocks,
		model: "opencode" as const,
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
			server_tool_use: null,
			service_tier: null,
		},
		container: null,
		context_management: null,
	};
}

/**
 * Create an SDK assistant message in the proper format.
 */
function createSDKAssistantMessage(
	content: Array<{
		type: string;
		text?: string;
		id?: string;
		name?: string;
		input?: unknown;
	}>,
	sessionId: string | null,
): SDKAssistantMessage {
	return {
		type: "assistant",
		message: createBetaMessage(content),
		parent_tool_use_id: null,
		uuid: randomUUID(),
		session_id: sessionId || "pending",
	};
}

/**
 * Create an SDK result message in the proper format.
 */
function createSDKResultMessage(
	sessionId: string | null,
	durationMs: number,
	numTurns: number,
	result: string,
	isError: boolean = false,
): SDKResultMessage {
	// Common usage object with all required fields
	const usage = {
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
		service_tier: "standard" as const,
	};

	if (isError) {
		return {
			type: "result",
			subtype: "error_during_execution",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: true,
			num_turns: numTurns,
			errors: [result],
			usage,
			modelUsage: {},
			permission_denials: [],
			uuid: randomUUID(),
			session_id: sessionId || "pending",
			total_cost_usd: 0,
		};
	}

	return {
		type: "result",
		subtype: "success",
		duration_ms: durationMs,
		duration_api_ms: 0,
		is_error: false,
		num_turns: numTurns,
		result: result,
		usage,
		modelUsage: {},
		permission_denials: [],
		uuid: randomUUID(),
		session_id: sessionId || "pending",
		total_cost_usd: 0,
	};
}

// ============================================================================
// OpenCodeRunner Class
// ============================================================================

/**
 * OpenCode Runner implementation.
 *
 * Manages the OpenCode SDK server lifecycle and provides an IAgentRunner
 * interface for Cyrus integration.
 *
 * @example
 * ```typescript
 * const runner = new OpenCodeRunner({
 *   cyrusHome: "~/.cyrus",
 *   workingDirectory: "/path/to/repo",
 *   workspaceName: "CYPACK-123",
 * });
 *
 * const session = await runner.startStreaming("Implement feature X");
 * runner.addStreamMessage("Also add tests");
 * runner.completeStream();
 *
 * // Wait for completion via events
 * runner.on("complete", (messages) => {
 *   console.log(`Session completed with ${messages.length} messages`);
 * });
 * ```
 */
export class OpenCodeRunner extends EventEmitter implements IAgentRunner {
	// ========================================================================
	// IAgentRunner Properties
	// ========================================================================

	/**
	 * OpenCode supports streaming input via promptAsync().
	 */
	readonly supportsStreamingInput = true;

	// ========================================================================
	// Private State
	// ========================================================================

	private readonly config: OpenCodeRunnerConfig;
	private readonly formatter: OpenCodeMessageFormatter;
	private readonly configBuilder: OpenCodeConfigBuilder;

	// SDK instances
	private client: OpencodeClient | null = null;
	private server: { url: string; close: () => void } | null = null;

	// Session state
	private sessionInfo: OpenCodeSessionInfo | null = null;
	private messages: AgentMessage[] = [];
	private streamingPrompt: StreamingPrompt | null = null;
	private configCleanup: (() => Promise<void>) | null = null;

	// Text accumulation state (to avoid emitting deltas as separate messages)
	private accumulatingTextPartId: string | null = null;
	private accumulatedText: string = "";

	// Model configuration (parsed provider/modelID for prompt requests)
	private modelConfig: { providerID: string; modelID: string } | null = null;

	// Logging
	private logStream: WriteStream | null = null;
	private readableLogStream: WriteStream | null = null;

	// ========================================================================
	// Constructor
	// ========================================================================

	/**
	 * Create a new OpenCodeRunner instance.
	 *
	 * @param config - Runner configuration
	 */
	constructor(config: OpenCodeRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new OpenCodeMessageFormatter();
		this.configBuilder = new OpenCodeConfigBuilder();

		// Forward config callbacks to event emitter
		if (config.onMessage) {
			this.on("message", config.onMessage);
		}
		if (config.onError) {
			this.on("error", config.onError);
		}
		if (config.onComplete) {
			this.on("complete", config.onComplete);
		}
	}

	// ========================================================================
	// IAgentRunner Methods
	// ========================================================================

	/**
	 * Start a session with a string prompt (simple mode).
	 */
	async start(prompt: string): Promise<AgentSessionInfo> {
		return this.startWithPrompt(prompt, undefined);
	}

	/**
	 * Start a session with streaming input support.
	 */
	async startStreaming(initialPrompt?: string): Promise<AgentSessionInfo> {
		return this.startWithPrompt(null, initialPrompt);
	}

	/**
	 * Add a message to the streaming prompt.
	 */
	addStreamMessage(content: string): void {
		if (!this.streamingPrompt) {
			throw new Error("Cannot add stream message when not in streaming mode");
		}
		this.streamingPrompt.addMessage(content);

		// Send message via SDK
		this.sendPromptAsync(content).catch((error) => {
			console.error(`${LOG_PREFIX} Failed to send stream message:`, error);
			this.emit("error", error);
		});
	}

	/**
	 * Complete the streaming prompt.
	 */
	completeStream(): void {
		if (this.streamingPrompt) {
			this.streamingPrompt.complete();
		}
	}

	/**
	 * Stop the current session.
	 */
	stop(): void {
		if (!this.sessionInfo?.isRunning) {
			return;
		}

		console.log(`${LOG_PREFIX} Stopping session...`);

		// Abort the session via SDK
		if (this.client && this.sessionInfo?.openCodeSessionId) {
			this.client.session
				.abort({
					path: { id: this.sessionInfo.openCodeSessionId },
				})
				.catch((error) => {
					console.warn(`${LOG_PREFIX} Error aborting session:`, error);
				});
		}

		// Mark as not running
		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}

		// Cleanup
		this.cleanup();
	}

	/**
	 * Check if the session is running.
	 */
	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	/**
	 * Get all messages from the session.
	 */
	getMessages(): AgentMessage[] {
		return [...this.messages];
	}

	/**
	 * Get the message formatter.
	 */
	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	// ========================================================================
	// Core Implementation
	// ========================================================================

	/**
	 * Unified entry point for starting sessions.
	 *
	 * @param stringPrompt - For simple mode (non-streaming)
	 * @param streamingInitialPrompt - For streaming mode
	 */
	private async startWithPrompt(
		stringPrompt: string | null,
		streamingInitialPrompt?: string,
	): Promise<OpenCodeSessionInfo> {
		const workspaceName = this.config.workspaceName || `opencode-${Date.now()}`;

		// Initialize session info
		this.sessionInfo = {
			sessionId: null,
			openCodeSessionId: null,
			serverPort: null,
			startedAt: new Date(),
			isRunning: true,
		};

		this.messages = [];

		// Setup logging
		await this.setupLogging(workspaceName);

		// Determine mode
		let promptForSession: string | undefined;
		if (stringPrompt !== null && stringPrompt !== undefined) {
			// Simple string mode
			promptForSession = stringPrompt;
		} else {
			// Streaming mode
			this.streamingPrompt = new StreamingPrompt(null, streamingInitialPrompt);
			promptForSession = streamingInitialPrompt;
		}

		try {
			// Build OpenCode configuration
			const configResult = await this.configBuilder.build({
				runnerConfig: this.config,
				systemPrompt: this.config.appendSystemPrompt,
				workspaceName,
			});
			this.configCleanup = configResult.cleanup;

			// Parse and store model config for prompt requests
			// The model is in "provider/model" format (e.g., "anthropic/claude-sonnet-4-20250514")
			if (configResult.config.model) {
				const modelParts = configResult.config.model.split("/");
				if (
					modelParts.length === 2 &&
					modelParts[0] !== undefined &&
					modelParts[1] !== undefined
				) {
					this.modelConfig = {
						providerID: modelParts[0],
						modelID: modelParts[1],
					};
					console.log(
						`${LOG_PREFIX} Model config: ${this.modelConfig.providerID}/${this.modelConfig.modelID}`,
					);
				}
			}

			// Allocate port
			const portResult = await allocateOpenCodePort({
				preferredPort: this.config.serverConfig?.port,
			});
			console.log(
				`${LOG_PREFIX} Allocated port ${portResult.port} (preferred: ${portResult.isPreferred})`,
			);

			// Create OpenCode server and client
			// Cast config to SDK type (our config is a superset)
			const { client, server } = await createOpencode({
				port: portResult.port,
				config: configResult.config as OpenCodeSDKConfig,
			});

			this.client = client;
			this.server = server;
			this.sessionInfo.serverPort = portResult.port;

			console.log(`${LOG_PREFIX} Server started at ${server.url}`);
			if (this.config.workingDirectory) {
				console.log(
					`${LOG_PREFIX} Working directory: ${this.config.workingDirectory}`,
				);
			}
			this.emit("serverStart", portResult.port);

			// Subscribe to events (starts background event loop)
			console.log(`${LOG_PREFIX} Setting up event subscription...`);
			await this.subscribeToEvents();

			// Create session with working directory
			// Pass the working directory to OpenCode so it operates in the correct repository
			console.log(`${LOG_PREFIX} Creating session...`);
			const sessionResponse = await client.session.create({
				query: this.config.workingDirectory
					? { directory: this.config.workingDirectory }
					: undefined,
			});
			if (sessionResponse.error) {
				throw new Error(`Failed to create session: ${sessionResponse.error}`);
			}

			const session = sessionResponse.data;
			if (!session?.id) {
				throw new Error("Session created but no ID returned");
			}

			this.sessionInfo.openCodeSessionId = session.id;
			this.sessionInfo.sessionId = session.id;
			this.sessionInfo.title = session.title;
			this.sessionInfo.version = session.version;

			console.log(`${LOG_PREFIX} Session created successfully: ${session.id}`);

			// NOTE: We intentionally skip session.init() here.
			// The OpenCode SDK v1.0.167 hangs indefinitely when session.init() is called.
			// Testing confirms that promptAsync() works correctly without initialization -
			// sessions process prompts immediately after creation.

			// Update logs with real session ID
			await this.setupLogging(workspaceName);

			// Emit system init message with model info (for AgentSessionManager)
			// This allows AgentSessionManager to post "Using model: X" thought to Linear
			if (this.config.model) {
				const systemInitMessage = {
					type: "system" as const,
					subtype: "init" as const,
					session_id: session.id,
					model: this.config.model,
					tools: [], // OpenCode manages tools internally
					permissionMode: "auto_approve" as const,
					apiKeySource: "opencode" as const,
				};
				this.messages.push(systemInitMessage as any);
				this.logMessage(systemInitMessage as any);
				this.emit("message", systemInitMessage as any);
			}

			// Send initial prompt if provided
			if (promptForSession) {
				await this.sendPromptAsync(promptForSession);
			}

			// Update streaming prompt with session ID
			if (this.streamingPrompt) {
				this.streamingPrompt.updateSessionId(session.id);
			}

			return this.sessionInfo;
		} catch (error) {
			console.error(`${LOG_PREFIX} Failed to start session:`, error);
			this.sessionInfo.isRunning = false;
			this.emit("error", error);
			this.cleanup();
			throw error;
		}
	}

	/**
	 * Send a prompt via the SDK's synchronous prompt endpoint.
	 *
	 * NOTE: We use the synchronous `prompt` method (POST /session/{id}/message)
	 * instead of `promptAsync` (POST /session/{id}/prompt_async) because
	 * promptAsync hangs indefinitely in OpenCode SDK v1.0.167.
	 *
	 * The synchronous prompt blocks until complete, but we still receive
	 * real-time updates via the SSE event stream.
	 */
	private async sendPromptAsync(content: string): Promise<void> {
		if (!this.client || !this.sessionInfo?.openCodeSessionId) {
			throw new Error("Cannot send prompt: session not started");
		}

		// Guard against sending prompts to stopped sessions
		if (!this.sessionInfo.isRunning) {
			console.warn(`${LOG_PREFIX} Ignoring prompt - session not running`);
			return;
		}

		console.log(
			`${LOG_PREFIX} Sending prompt to session ${this.sessionInfo.openCodeSessionId}`,
		);

		try {
			// Build prompt body with model if available
			const promptBody: {
				parts: Array<{ type: "text"; text: string }>;
				model?: { providerID: string; modelID: string };
			} = {
				parts: [{ type: "text", text: content }],
			};

			// Include model in prompt request - this is critical for OpenCode to know which model to use
			if (this.modelConfig) {
				promptBody.model = this.modelConfig;
				console.log(
					`${LOG_PREFIX} Including model in prompt: ${this.modelConfig.providerID}/${this.modelConfig.modelID}`,
				);
			}

			// Use synchronous prompt endpoint - promptAsync hangs in OpenCode SDK v1.0.167
			// This call blocks until the prompt is processed, but we receive real-time
			// updates via the SSE event stream subscribed in subscribeToEvents()
			const response = await this.client.session.prompt({
				path: { id: this.sessionInfo.openCodeSessionId },
				body: promptBody,
			});

			if (response.error) {
				throw new Error(
					`Failed to send prompt: ${JSON.stringify(response.error)}`,
				);
			}

			console.log(`${LOG_PREFIX} Prompt completed successfully`);
		} catch (error) {
			console.error(`${LOG_PREFIX} Error sending prompt:`, error);
			throw error;
		}

		// Record user message
		const userMessage = createSDKUserMessage(
			content,
			this.sessionInfo.sessionId,
		);
		this.messages.push(userMessage);
		this.logMessage(userMessage);
		// Note: Do not emit user messages as events - they are inputs, not outputs
	}

	/**
	 * Subscribe to SSE events from the SDK.
	 */
	private async subscribeToEvents(): Promise<void> {
		if (!this.client) {
			throw new Error("Cannot subscribe to events: client not initialized");
		}

		console.log(`${LOG_PREFIX} Subscribing to events...`);

		const { stream } = await this.client.event.subscribe();

		if (!stream) {
			throw new Error("Event subscription returned no stream");
		}

		console.log(`${LOG_PREFIX} Event subscription established`);

		// Process events in background - cast to expected format
		this.processEventStream(
			stream as unknown as AsyncIterable<{
				type: string;
				properties: Record<string, unknown>;
			}>,
		);
	}

	/**
	 * Process the event stream from the SDK.
	 */
	private async processEventStream(
		stream: AsyncIterable<{
			type: string;
			properties: Record<string, unknown>;
		}>,
	): Promise<void> {
		let eventCount = 0;
		const startTime = Date.now();

		console.log(`${LOG_PREFIX} Starting event stream processing loop`);

		try {
			for await (const event of stream) {
				eventCount++;
				const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

				if (this.config.debug || eventCount <= 5) {
					console.log(
						`${LOG_PREFIX} [Event #${eventCount} @ ${elapsedSec}s] ${event.type}`,
					);
				}

				if (!this.sessionInfo?.isRunning) {
					console.log(
						`${LOG_PREFIX} Session stopped - breaking event loop after ${eventCount} events`,
					);
					break;
				}

				await this.handleEvent(event);
			}

			console.log(
				`${LOG_PREFIX} Event stream ended normally after ${eventCount} events`,
			);
		} catch (error) {
			if (this.sessionInfo?.isRunning) {
				console.error(
					`${LOG_PREFIX} Event stream error after ${eventCount} events:`,
					error,
				);
				this.emit("error", error);
			}
		} finally {
			console.log(
				`${LOG_PREFIX} Event loop finished - processed ${eventCount} total events`,
			);
			this.handleSessionComplete();
		}
	}

	/**
	 * Handle an SSE event from the SDK.
	 */
	private async handleEvent(event: {
		type: string;
		properties: Record<string, unknown>;
	}): Promise<void> {
		const eventType = event.type;
		const data = event.properties;

		// Emit raw event for debugging
		this.emit("streamEvent", { type: eventType, properties: data });

		switch (eventType) {
			case "message.updated": {
				await this.handleMessageUpdated(data);
				break;
			}
			case "message.part.updated": {
				await this.handleMessagePartUpdated(data);
				break;
			}
			case "session.updated": {
				this.handleSessionUpdated(data);
				break;
			}
			case "session.error": {
				// Session errored - log and mark as complete
				const errorInfo = data.error as { message?: string } | undefined;
				console.error(
					`${LOG_PREFIX} Session error:`,
					errorInfo?.message || data,
				);
				// Mark session as not running to break the event loop
				if (this.sessionInfo) {
					this.sessionInfo.isRunning = false;
				}
				break;
			}
			case "session.idle": {
				// Session completed - OpenCode signals it's done processing
				console.log(`${LOG_PREFIX} Session idle - completing session`);
				// Flush any accumulated text before completing
				this.flushAccumulatedText();
				// Mark session as not running to break the event loop
				if (this.sessionInfo) {
					this.sessionInfo.isRunning = false;
				}
				break;
			}
			default:
				// Log but don't fail on unknown events
				if (this.config.debug) {
					console.log(`${LOG_PREFIX} Unknown event type: ${eventType}`);
				}
		}
	}

	/**
	 * Handle message.updated event.
	 */
	private async handleMessageUpdated(
		data: Record<string, unknown>,
	): Promise<void> {
		const info = data.info as OpenCodeSDKMessage | undefined;
		if (!info) return;

		// Check if this is for our session
		if (info.sessionID !== this.sessionInfo?.openCodeSessionId) {
			return;
		}

		// Convert and emit based on message role
		if (info.role === "assistant") {
			// Assistant messages are handled via parts
			// We track the message but don't emit until we have content
		} else if (info.role === "user") {
			// User messages are already tracked when we send them
		}
	}

	/**
	 * Handle message.part.updated event.
	 *
	 * For text parts, we accumulate deltas instead of emitting each one
	 * as a separate message. Text is flushed when:
	 * - A different part type is received (e.g., tool use)
	 * - A different text part ID is received
	 * - The session completes
	 */
	private async handleMessagePartUpdated(
		data: Record<string, unknown>,
	): Promise<void> {
		const part = data.part as Part | undefined;
		if (!part) return;

		// Check if this is for our session
		if (part.sessionID !== this.sessionInfo?.openCodeSessionId) {
			return;
		}

		// Handle text parts with accumulation
		if (part.type === "text") {
			const textPart = part as TextPart;
			if (textPart.synthetic || textPart.ignored) {
				return;
			}

			// If this is a new text part, flush the old one first
			if (
				this.accumulatingTextPartId !== null &&
				this.accumulatingTextPartId !== textPart.id
			) {
				this.flushAccumulatedText();
			}

			// Accumulate text (the SDK sends cumulative text, not deltas)
			this.accumulatingTextPartId = textPart.id;
			this.accumulatedText = textPart.text;
			return;
		}

		// For non-text parts, flush any accumulated text first
		if (this.accumulatingTextPartId !== null) {
			this.flushAccumulatedText();
		}

		// Convert non-text part to message and emit
		const message = this.convertPartToMessage(part);
		if (message) {
			this.messages.push(message);
			this.logMessage(message);
			this.emit("message", message);
		}
	}

	/**
	 * Flush accumulated text as a single message.
	 */
	private flushAccumulatedText(): void {
		if (this.accumulatingTextPartId === null || !this.accumulatedText) {
			return;
		}

		const message = createSDKAssistantMessage(
			[{ type: "text", text: this.accumulatedText }],
			this.sessionInfo?.sessionId ?? null,
		);

		this.messages.push(message);
		this.logMessage(message);
		this.emit("message", message);

		// Reset accumulation state
		this.accumulatingTextPartId = null;
		this.accumulatedText = "";
	}

	/**
	 * Handle session.updated event.
	 */
	private handleSessionUpdated(data: Record<string, unknown>): void {
		const info = data.info as OpenCodeSDKSession | undefined;
		if (!info) return;

		// Check if this is our session
		if (info.id !== this.sessionInfo?.openCodeSessionId) {
			return;
		}

		// Update session info
		if (this.sessionInfo) {
			this.sessionInfo.title = info.title;
			this.sessionInfo.version = info.version;
		}
	}

	/**
	 * Handle session completion.
	 */
	private handleSessionComplete(): void {
		if (!this.sessionInfo) return;

		// Flush any accumulated text before completing
		this.flushAccumulatedText();

		// Mark as not running BEFORE emitting events (prevents race conditions)
		this.sessionInfo.isRunning = false;

		// Complete streaming prompt
		if (this.streamingPrompt) {
			this.streamingPrompt.complete();
		}

		// Create result message
		const durationMs = Date.now() - this.sessionInfo.startedAt.getTime();
		const numTurns = this.messages.filter((m) => m.type === "assistant").length;
		const resultMessage = createSDKResultMessage(
			this.sessionInfo.sessionId,
			durationMs,
			numTurns,
			"Session completed",
		);
		this.messages.push(resultMessage);
		this.logMessage(resultMessage);

		// Emit result message as event (required for AgentSessionManager to post 'response' activity)
		// This must happen AFTER isRunning is set to false, matching ClaudeRunner/GeminiRunner pattern
		this.emit("message", resultMessage);

		// Emit complete event
		this.emit("complete", this.getMessages());

		// Cleanup
		this.cleanup();
	}

	// ========================================================================
	// Message Conversion
	// ========================================================================

	/**
	 * Convert an OpenCode part to an SDK message.
	 */
	private convertPartToMessage(part: Part): AgentMessage | null {
		switch (part.type) {
			case "text": {
				const textPart = part as TextPart;
				if (textPart.synthetic || textPart.ignored) {
					return null;
				}
				return createSDKAssistantMessage(
					[{ type: "text", text: textPart.text }],
					this.sessionInfo?.sessionId ?? null,
				);
			}
			case "tool": {
				const toolPart = part as ToolPart;
				return this.convertToolPartToMessage(toolPart);
			}
			case "reasoning": {
				// Reasoning parts are internal, don't emit
				return null;
			}
			case "step-start":
			case "step-finish":
			case "snapshot":
			case "patch":
			case "agent":
			case "retry":
			case "compaction": {
				// Internal parts, don't emit
				return null;
			}
			default:
				return null;
		}
	}

	/**
	 * Convert a tool part to an assistant message with tool use.
	 */
	private convertToolPartToMessage(toolPart: ToolPart): AgentMessage | null {
		const state = toolPart.state;
		const sessionId = this.sessionInfo?.sessionId ?? null;

		if (state.status === "completed") {
			// Tool completed - emit tool result as user message (per SDK convention)
			return {
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: toolPart.callID,
							content: state.output || "",
							is_error: false,
						},
					],
				},
				parent_tool_use_id: null,
				session_id: sessionId || "pending",
			} as SDKUserMessage;
		} else if (state.status === "error") {
			// Tool errored - emit tool result as user message
			return {
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: toolPart.callID,
							content: state.error || "Unknown error",
							is_error: true,
						},
					],
				},
				parent_tool_use_id: null,
				session_id: sessionId || "pending",
			} as SDKUserMessage;
		} else if (state.status === "running" || state.status === "pending") {
			// Tool starting - emit tool use as assistant message
			return createSDKAssistantMessage(
				[
					{
						type: "tool_use",
						id: toolPart.callID,
						name: toolPart.tool,
						input: state.input || {},
					},
				],
				sessionId,
			);
		}

		return null;
	}

	// ========================================================================
	// Logging
	// ========================================================================

	/**
	 * Setup logging streams.
	 */
	private async setupLogging(workspaceName: string): Promise<void> {
		const cyrusHome = this.resolveTildePath(this.config.cyrusHome);
		const logDir = join(cyrusHome, "logs", workspaceName);

		await mkdir(logDir, { recursive: true });

		const sessionId = this.sessionInfo?.sessionId || "pending";
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

		// Close existing streams
		if (this.logStream) {
			this.logStream.end();
		}
		if (this.readableLogStream) {
			this.readableLogStream.end();
		}

		// Detailed JSON log
		const jsonLogPath = join(logDir, `session-${sessionId}-${timestamp}.jsonl`);
		this.logStream = createWriteStream(jsonLogPath, { flags: "a" });

		// Human-readable log
		const readableLogPath = join(
			logDir,
			`session-${sessionId}-${timestamp}.md`,
		);
		this.readableLogStream = createWriteStream(readableLogPath, { flags: "a" });

		// Write session metadata
		const metadata = {
			sessionId,
			workspaceName,
			startedAt: this.sessionInfo?.startedAt.toISOString(),
			workingDirectory: this.config.workingDirectory,
			model: this.config.model,
		};

		this.logStream.write(
			`${JSON.stringify({ type: "metadata", ...metadata })}\n`,
		);
		this.readableLogStream.write(`# OpenCode Session: ${sessionId}\n\n`);
		this.readableLogStream.write(`- **Workspace**: ${workspaceName}\n`);
		this.readableLogStream.write(
			`- **Started**: ${this.sessionInfo?.startedAt.toISOString()}\n`,
		);
		this.readableLogStream.write(
			`- **Working Directory**: ${this.config.workingDirectory}\n\n`,
		);
		this.readableLogStream.write("---\n\n");

		console.log(`${LOG_PREFIX} Logging to ${logDir}`);
	}

	/**
	 * Log a message to the log streams.
	 */
	private logMessage(message: AgentMessage): void {
		const timestamp = new Date().toISOString();

		// JSON log
		if (this.logStream) {
			this.logStream.write(`${JSON.stringify({ timestamp, message })}\n`);
		}

		// Readable log
		if (this.readableLogStream) {
			this.writeReadableLogEntry(message, timestamp);
		}
	}

	/**
	 * Write a human-readable log entry.
	 */
	private writeReadableLogEntry(
		message: AgentMessage,
		timestamp: string,
	): void {
		if (!this.readableLogStream) return;

		const time = timestamp.split("T")[1]?.split(".")[0] || timestamp;

		switch (message.type) {
			case "user": {
				// Handle user messages - content is in message.message.content
				const userMsg = message as SDKUserMessage;
				const content = userMsg.message?.content;
				let textContent = "";
				if (typeof content === "string") {
					textContent = content;
				} else if (Array.isArray(content)) {
					// Could be tool_result array
					for (const item of content) {
						if (typeof item === "object" && item.type === "tool_result") {
							const resultItem = item as {
								tool_use_id: string;
								content: string;
								is_error: boolean;
							};
							const truncated =
								resultItem.content.length > 1000
									? `${resultItem.content.slice(0, 1000)}...(truncated)`
									: resultItem.content;
							this.readableLogStream.write(
								`### [${time}] Tool Result\n\n\`\`\`\n${truncated}\n\`\`\`\n\n`,
							);
						}
					}
					return;
				}
				if (textContent) {
					this.readableLogStream.write(
						`## [${time}] User\n\n${textContent}\n\n`,
					);
				}
				break;
			}
			case "assistant": {
				// Handle assistant messages - content is in message.message.content
				const assistantMsg = message as SDKAssistantMessage;
				const content = assistantMsg.message?.content;
				if (Array.isArray(content)) {
					for (const item of content) {
						if (typeof item === "object" && "type" in item) {
							if (item.type === "text" && "text" in item) {
								this.readableLogStream.write(
									`## [${time}] Assistant\n\n${(item as { text: string }).text}\n\n`,
								);
							} else if (item.type === "tool_use" && "name" in item) {
								const toolItem = item as { name: string; input: unknown };
								this.readableLogStream.write(
									`### [${time}] Tool: ${toolItem.name}\n\n\`\`\`json\n${JSON.stringify(toolItem.input, null, 2)}\n\`\`\`\n\n`,
								);
							}
						}
					}
				}
				break;
			}
			case "result": {
				const resultMsg = message as SDKResultMessage;
				this.readableLogStream.write(
					`## [${time}] Session Complete\n\n- Duration: ${resultMsg.duration_ms}ms\n- Turns: ${resultMsg.num_turns}\n\n`,
				);
				break;
			}
		}
	}

	// ========================================================================
	// Cleanup
	// ========================================================================

	/**
	 * Clean up resources.
	 */
	private cleanup(): void {
		// Reset text accumulation state
		this.accumulatingTextPartId = null;
		this.accumulatedText = "";

		// Close server
		if (this.server) {
			console.log(`${LOG_PREFIX} Closing server...`);
			this.server.close();
			this.server = null;
			this.emit("serverStop");
		}

		// Clear client
		this.client = null;

		// Close log streams
		if (this.logStream) {
			this.logStream.end();
			this.logStream = null;
		}
		if (this.readableLogStream) {
			this.readableLogStream.end();
			this.readableLogStream = null;
		}

		// Complete streaming prompt
		if (this.streamingPrompt) {
			this.streamingPrompt.complete();
			this.streamingPrompt = null;
		}

		// Cleanup config files
		if (this.configCleanup) {
			this.configCleanup().catch((error) => {
				console.warn(`${LOG_PREFIX} Config cleanup error:`, error);
			});
			this.configCleanup = null;
		}
	}

	// ========================================================================
	// Utilities
	// ========================================================================

	/**
	 * Resolve tilde (~) in paths.
	 */
	private resolveTildePath(path: string): string {
		if (path.startsWith("~/")) {
			return join(homedir(), path.slice(2));
		}
		return path;
	}
}
