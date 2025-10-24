/**
 * AnthropicAgentRunner - Adapter that wraps ClaudeRunner behind the IAgentRunner interface.
 *
 * This adapter allows the Cyrus core to interact with Anthropic's Claude through
 * a generic interface, enabling future AI tool swapping while keeping core logic unchanged.
 */
import { ClaudeRunner } from "cyrus-claude-runner";
import {
	createAgentResult,
	translateConfig,
	translateSDKMessage,
} from "./translators.js";
/**
 * Adapter that wraps ClaudeRunner to implement IAgentRunner interface
 */
export class AnthropicAgentRunner {
	config;
	claudeRunner;
	messageHandlers = [];
	completeHandlers = [];
	errorHandlers = [];
	initialized = false;
	// Bound event handlers for proper cleanup
	boundMessageHandler;
	boundErrorHandler;
	boundCompleteHandler;
	constructor(config) {
		this.config = config;
		const claudeConfig = translateConfig(config);
		this.claudeRunner = new ClaudeRunner(claudeConfig);
		// Wire up ClaudeRunner events to our handlers
		this.setupEventHandlers();
	}
	/**
	 * Setup event handlers to bridge ClaudeRunner events to IAgentRunner handlers
	 */
	setupEventHandlers() {
		// Create bound handlers that can be removed later
		this.boundMessageHandler = (sdkMessage) => {
			const agentMessage = translateSDKMessage(sdkMessage);
			this.emitMessage(agentMessage).catch((error) => {
				console.error(
					"AnthropicAgentRunner: Error in message emission:",
					error,
				);
			});
		};
		this.boundErrorHandler = (error) => {
			this.emitError(error).catch((emitError) => {
				console.error(
					"AnthropicAgentRunner: Error in error emission:",
					emitError,
				);
			});
		};
		this.boundCompleteHandler = (messages) => {
			const sessionInfo = this.claudeRunner.getSessionInfo();
			const result = createAgentResult(
				sessionInfo?.sessionId || "unknown",
				messages,
				undefined,
				{
					startedAt: sessionInfo?.startedAt,
					isRunning: sessionInfo?.isRunning,
				},
			);
			this.emitComplete(result).catch((error) => {
				console.error(
					"AnthropicAgentRunner: Error in complete emission:",
					error,
				);
			});
		};
		// Register event listeners
		this.claudeRunner.on("message", this.boundMessageHandler);
		this.claudeRunner.on("error", this.boundErrorHandler);
		this.claudeRunner.on("complete", this.boundCompleteHandler);
	}
	/**
	 * Emit message to all registered handlers (supports async)
	 */
	async emitMessage(message) {
		for (const handler of this.messageHandlers) {
			try {
				await handler(message);
			} catch (error) {
				console.error("Error in message handler:", error);
			}
		}
	}
	/**
	 * Emit complete event to all registered handlers (supports async)
	 */
	async emitComplete(result) {
		for (const handler of this.completeHandlers) {
			try {
				await handler(result);
			} catch (error) {
				console.error("Error in complete handler:", error);
			}
		}
	}
	/**
	 * Emit error to all registered handlers (supports async)
	 */
	async emitError(error) {
		for (const handler of this.errorHandlers) {
			try {
				await handler(error);
			} catch (error) {
				console.error("Error in error handler:", error);
			}
		}
	}
	/**
	 * Initialize the agent runner
	 */
	async initialize() {
		if (this.initialized) {
			return;
		}
		// ClaudeRunner doesn't require explicit initialization
		// It's ready to use after construction
		this.initialized = true;
	}
	/**
	 * Clean up resources
	 */
	async cleanup() {
		if (!this.initialized) {
			return;
		}
		// Stop any running session
		if (this.claudeRunner.isRunning()) {
			await this.claudeRunner.stop();
		}
		// Remove ClaudeRunner event listeners to prevent memory leaks
		if (this.boundMessageHandler) {
			this.claudeRunner.off("message", this.boundMessageHandler);
		}
		if (this.boundErrorHandler) {
			this.claudeRunner.off("error", this.boundErrorHandler);
		}
		if (this.boundCompleteHandler) {
			this.claudeRunner.off("complete", this.boundCompleteHandler);
		}
		// Clear all handlers
		this.messageHandlers = [];
		this.completeHandlers = [];
		this.errorHandlers = [];
		this.initialized = false;
	}
	/**
	 * Execute an agent session with the given prompt
	 */
	async execute(prompt) {
		if (!this.initialized) {
			throw new Error(
				"AnthropicAgentRunner must be initialized before execute()",
			);
		}
		if (this.claudeRunner.isRunning()) {
			throw new Error(
				"AnthropicAgentRunner: Cannot execute - session already running",
			);
		}
		// Handle prompt context
		if (prompt.context) {
			// Apply context overrides to config
			if (prompt.context.workingDirectory) {
				this.claudeRunner.config.workingDirectory =
					prompt.context.workingDirectory;
			}
			if (prompt.context.environment) {
				this.claudeRunner.config.environment = prompt.context.environment;
			}
			if (prompt.context.systemPrompt) {
				this.claudeRunner.config.systemPrompt = prompt.context.systemPrompt;
			}
		}
		// Create session wrapper
		const session = this.createSession(prompt);
		// Start ClaudeRunner
		if (typeof prompt.content === "string") {
			// Simple string prompt
			this.claudeRunner.start(prompt.content).catch((error) => {
				this.emitError(error).catch((emitError) => {
					console.error(
						"AnthropicAgentRunner: Error in error emission:",
						emitError,
					);
				});
			});
		} else {
			// Streaming prompt with AsyncIterable - handle errors
			this.startStreamingSession(prompt.content).catch((error) => {
				this.emitError(error).catch((emitError) => {
					console.error(
						"AnthropicAgentRunner: Error in error emission:",
						emitError,
					);
				});
			});
		}
		return session;
	}
	/**
	 * Start a streaming session with AsyncIterable input
	 */
	async startStreamingSession(messages) {
		// Start streaming mode
		await this.claudeRunner.startStreaming();
		// Feed messages into the stream
		for await (const message of messages) {
			if (message.role === "user" && message.content.type === "text") {
				this.claudeRunner.addStreamMessage(message.content.text);
			}
		}
		// Complete the stream
		this.claudeRunner.completeStream();
	}
	/**
	 * Create an AgentSession wrapper around the ClaudeRunner session
	 */
	createSession(_prompt) {
		const sessionId = `session-${Date.now()}`;
		const messages = [];
		let resultResolver;
		let resultRejecter;
		// Create result promise
		const resultPromise = new Promise((resolve, reject) => {
			resultResolver = resolve;
			resultRejecter = reject;
		});
		// Track messages
		const messageHandler = (msg) => {
			messages.push(msg);
		};
		// Handle completion
		const completeHandler = (result) => {
			this.messageHandlers = this.messageHandlers.filter(
				(h) => h !== messageHandler,
			);
			this.completeHandlers = this.completeHandlers.filter(
				(h) => h !== completeHandler,
			);
			this.errorHandlers = this.errorHandlers.filter((h) => h !== errorHandler);
			resultResolver(result);
		};
		// Handle errors
		const errorHandler = (error) => {
			this.messageHandlers = this.messageHandlers.filter(
				(h) => h !== messageHandler,
			);
			this.completeHandlers = this.completeHandlers.filter(
				(h) => h !== completeHandler,
			);
			this.errorHandlers = this.errorHandlers.filter((h) => h !== errorHandler);
			resultRejecter(error);
		};
		// Register handlers for this session
		this.messageHandlers.push(messageHandler);
		this.completeHandlers.push(completeHandler);
		this.errorHandlers.push(errorHandler);
		// Create async iterable for messages
		const messageIterable = {
			[Symbol.asyncIterator]: () => {
				let index = 0;
				return {
					next: async () => {
						// Wait for next message or completion
						while (index >= messages.length && this.claudeRunner.isRunning()) {
							await new Promise((resolve) => setTimeout(resolve, 100));
						}
						if (index < messages.length) {
							return { value: messages[index++], done: false };
						} else {
							return { value: undefined, done: true };
						}
					},
				};
			},
		};
		return {
			id: sessionId,
			messages: messageIterable,
			result: resultPromise,
			cancel: async () => {
				await this.claudeRunner.stop();
			},
			addMessage: (content) => {
				if (this.claudeRunner.isStreaming()) {
					this.claudeRunner.addStreamMessage(content);
				} else {
					throw new Error(
						"AnthropicAgentRunner: Cannot add message - not in streaming mode",
					);
				}
			},
		};
	}
	/**
	 * Register a handler for agent messages
	 */
	onMessage(handler) {
		this.messageHandlers.push(handler);
	}
	/**
	 * Register a handler for session completion
	 */
	onComplete(handler) {
		this.completeHandlers.push(handler);
	}
	/**
	 * Register a handler for errors
	 */
	onError(handler) {
		this.errorHandlers.push(handler);
	}
	/**
	 * Check if a session is currently running
	 */
	isRunning() {
		return this.claudeRunner.isRunning();
	}
	/**
	 * Get current session information
	 */
	getSessionInfo() {
		return this.claudeRunner.getSessionInfo();
	}
}
//# sourceMappingURL=AnthropicAgentRunner.js.map
