import { EventEmitter } from "node:events";
import type {
	AgentActivity,
	MessageInput,
	RenderableSession,
	Renderer,
	SessionSummary,
	SignalInput,
	UserInput,
} from "cyrus-interfaces";
import { type Instance, render } from "ink";
import React from "react";
import { ActivityPanel } from "./components/ActivityPanel.js";

/**
 * Status icons configuration
 */
export interface StatusIcons {
	thought: string;
	action: string;
	response: string;
	error: string;
	elicitation: string;
	prompt: string;
	toolUse: string;
	complete: string;
	running: string;
}

/**
 * Configuration options for CLIRenderer
 */
export interface CLIRendererConfig {
	/**
	 * Enable/disable verbose formatting with emojis
	 * @default true
	 */
	verboseFormatting?: boolean;

	/**
	 * Maximum number of activities to display in scrollable view
	 * @default 100
	 */
	maxActivities?: number;

	/**
	 * Custom status icons
	 */
	statusIcons?: Partial<StatusIcons>;
}

/**
 * Activity item to display in the CLI
 */
export interface ActivityItem {
	id: string;
	type: string;
	content: string;
	timestamp: Date;
	icon: string;
}

/**
 * Session state tracked by the CLI renderer
 */
interface SessionState {
	session: RenderableSession;
	activities: ActivityItem[];
	status: "running" | "complete" | "error";
	error?: Error;
}

/**
 * CLIRenderer - Interactive terminal UI renderer implementing the Renderer interface
 *
 * Provides a Linear activity panel-like experience in the CLI with:
 * - Real-time activity updates
 * - Scrollable activity history
 * - Interactive message input
 * - Stop command (Ctrl+S)
 * - Status indicators
 */
/**
 * Internal configuration with all defaults applied
 */
interface InternalConfig {
	verboseFormatting: boolean;
	maxActivities: number;
	statusIcons: StatusIcons;
}

export class CLIRenderer implements Renderer {
	private sessions: Map<string, SessionState> = new Map();
	private config: InternalConfig;
	private inkInstance: Instance | null = null;
	private eventEmitter = new EventEmitter();
	private inputQueues: Map<string, UserInput[]> = new Map();
	private isRunning = false;
	private updateThrottleTimeout: NodeJS.Timeout | null = null;
	private pendingUpdate = false;

	constructor(config: CLIRendererConfig = {}) {
		this.config = {
			verboseFormatting: config.verboseFormatting ?? true,
			maxActivities: config.maxActivities ?? 100,
			statusIcons: {
				thought: config.statusIcons?.thought ?? "💭",
				action: config.statusIcons?.action ?? "🔧",
				response: config.statusIcons?.response ?? "💬",
				error: config.statusIcons?.error ?? "❌",
				elicitation: config.statusIcons?.elicitation ?? "❓",
				prompt: config.statusIcons?.prompt ?? "📝",
				toolUse: config.statusIcons?.toolUse ?? "🛠️",
				complete: config.statusIcons?.complete ?? "✅",
				running: config.statusIcons?.running ?? "●",
			},
		};
	}

	/**
	 * Start the interactive CLI interface
	 */
	start(): void {
		if (this.isRunning) {
			return;
		}

		this.isRunning = true;

		// Render the React component
		// Note: patchConsole defaults to true, allowing Ink to manage console output
		this.inkInstance = render(
			React.createElement(ActivityPanel, {
				sessions: Array.from(this.sessions.values()),
				config: this.config,
				eventEmitter: this.eventEmitter,
				onMessage: (sessionId: string, message: string) => {
					this.handleUserMessage(sessionId, message);
				},
				onStop: (sessionId: string, reason?: string) => {
					this.handleUserStop(sessionId, reason);
				},
			}),
		);
	}

	/**
	 * Stop the interactive CLI interface
	 */
	stop(): void {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		// Clean up throttle timeout
		if (this.updateThrottleTimeout) {
			clearTimeout(this.updateThrottleTimeout);
			this.updateThrottleTimeout = null;
		}

		if (this.inkInstance) {
			this.inkInstance.unmount();
			this.inkInstance = null;
		}

		this.eventEmitter.removeAllListeners();
	}

	/**
	 * Get the underlying Ink instance (for testing)
	 */
	getInkInstance(): Instance | null {
		return this.inkInstance;
	}

	/**
	 * Handle user message input
	 */
	private handleUserMessage(sessionId: string, message: string): void {
		const input: MessageInput = {
			type: "message",
			content: message,
			timestamp: new Date(),
		};

		this.enqueueInput(sessionId, input);
	}

	/**
	 * Handle user stop signal
	 */
	private handleUserStop(sessionId: string, reason?: string): void {
		const input: SignalInput = {
			type: "signal",
			signal: {
				type: "stop",
				reason,
			},
		};

		this.enqueueInput(sessionId, input);
	}

	/**
	 * Enqueue user input for a session
	 */
	private enqueueInput(sessionId: string, input: UserInput): void {
		let queue = this.inputQueues.get(sessionId);
		if (!queue) {
			queue = [];
			this.inputQueues.set(sessionId, queue);
		}
		queue.push(input);
		this.eventEmitter.emit("input", sessionId);
	}

	/**
	 * Emit state update to trigger re-render (throttled to reduce flickering)
	 */
	private emitUpdate(): void {
		// Mark that an update is pending
		this.pendingUpdate = true;

		// If already throttling, return and let the timeout handle it
		if (this.updateThrottleTimeout) {
			return;
		}

		// Emit immediately for the first update
		this.doEmitUpdate();

		// Set up throttle for subsequent updates (50ms throttle)
		this.updateThrottleTimeout = setTimeout(() => {
			this.updateThrottleTimeout = null;

			// If there's a pending update, emit it
			if (this.pendingUpdate) {
				this.doEmitUpdate();
			}
		}, 50);
	}

	/**
	 * Actually emit the update
	 */
	private doEmitUpdate(): void {
		this.pendingUpdate = false;
		this.eventEmitter.emit("update", Array.from(this.sessions.values()));
	}

	/**
	 * Generate activity ID
	 */
	private generateActivityId(): string {
		return `activity_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	}

	/**
	 * Format activity content for display
	 */
	private formatActivityContent(activity: AgentActivity): string {
		const content = activity.content;

		if (!content) {
			return "[No content]";
		}

		// Handle different content types based on Linear's AgentActivity structure
		if ("body" in content && typeof content.body === "string") {
			return content.body;
		}

		if ("action" in content) {
			const action = content as {
				action: string;
				parameter?: unknown;
				result?: unknown;
			};
			let text = `Action: ${action.action}`;
			if (action.parameter) {
				text += `\nParameter: ${JSON.stringify(action.parameter, null, 2)}`;
			}
			if (action.result) {
				text += `\nResult: ${JSON.stringify(action.result, null, 2)}`;
			}
			return text;
		}

		return JSON.stringify(content, null, 2);
	}

	/**
	 * Get icon for activity type
	 */
	private getActivityIcon(type: string): string {
		const iconMap: Record<string, string> = {
			thought: this.config.statusIcons.thought,
			action: this.config.statusIcons.action,
			response: this.config.statusIcons.response,
			error: this.config.statusIcons.error,
			elicitation: this.config.statusIcons.elicitation,
			prompt: this.config.statusIcons.prompt,
		};

		return iconMap[type] || this.config.statusIcons.running;
	}

	/**
	 * Add activity to session
	 */
	private addActivity(
		sessionId: string,
		type: string,
		content: string,
		icon?: string,
	): void {
		const state = this.sessions.get(sessionId);
		if (!state) {
			return;
		}

		const activity: ActivityItem = {
			id: this.generateActivityId(),
			type,
			content,
			timestamp: new Date(),
			icon: icon || this.getActivityIcon(type),
		};

		state.activities.push(activity);

		// Enforce max activities limit
		if (state.activities.length > this.config.maxActivities) {
			state.activities.shift();
		}

		this.emitUpdate();
	}

	// Renderer interface implementation

	async renderSessionStart(session: RenderableSession): Promise<void> {
		const state: SessionState = {
			session,
			activities: [],
			status: "running",
		};

		this.sessions.set(session.id, state);
		this.inputQueues.set(session.id, []);

		// Start the UI if not already running
		if (!this.isRunning) {
			this.start();
		}

		this.addActivity(
			session.id,
			"session-start",
			`Session started for issue: ${session.issueTitle}`,
			this.config.statusIcons.running,
		);

		this.emitUpdate();
	}

	async renderActivity(
		sessionId: string,
		activity: AgentActivity,
	): Promise<void> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Session ${sessionId} not found`);
		}

		const content = this.formatActivityContent(activity);
		const type = activity.content.type || "unknown";

		this.addActivity(sessionId, type, content);
	}

	async renderText(sessionId: string, text: string): Promise<void> {
		this.addActivity(sessionId, "text", text, this.config.statusIcons.response);
	}

	async renderToolUse(
		sessionId: string,
		tool: string,
		input: unknown,
	): Promise<void> {
		const content = `Tool: ${tool}\nInput: ${JSON.stringify(input, null, 2)}`;
		this.addActivity(
			sessionId,
			"tool-use",
			content,
			this.config.statusIcons.toolUse,
		);
	}

	async renderComplete(
		sessionId: string,
		summary: SessionSummary,
	): Promise<void> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Session ${sessionId} not found`);
		}

		state.status = "complete";

		const summaryText = [
			`Session completed`,
			`Turns: ${summary.turns}`,
			`Tools used: ${summary.toolsUsed}`,
			summary.filesModified.length > 0
				? `Files modified: ${summary.filesModified.join(", ")}`
				: null,
			summary.summary ? `Summary: ${summary.summary}` : null,
			`Exit code: ${summary.exitCode}`,
		]
			.filter(Boolean)
			.join("\n");

		this.addActivity(
			sessionId,
			"complete",
			summaryText,
			this.config.statusIcons.complete,
		);

		this.emitUpdate();
	}

	async renderError(sessionId: string, error: Error): Promise<void> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Session ${sessionId} not found`);
		}

		state.status = "error";
		state.error = error;

		this.addActivity(
			sessionId,
			"error",
			`Error: ${error.message}\n${error.stack || ""}`,
			this.config.statusIcons.error,
		);

		this.emitUpdate();
	}

	async *getUserInput(sessionId: string): AsyncIterable<UserInput> {
		const queue = this.inputQueues.get(sessionId);
		if (!queue) {
			throw new Error(`Session ${sessionId} not found`);
		}

		while (true) {
			// Check if there's input in the queue
			if (queue.length > 0) {
				const input = queue.shift();
				if (input) {
					yield input;
				}
			} else {
				// Wait for new input
				await new Promise<void>((resolve) => {
					const handler = (sid: string) => {
						if (sid === sessionId) {
							this.eventEmitter.off("input", handler);
							resolve();
						}
					};
					this.eventEmitter.on("input", handler);
				});
			}
		}
	}

	/**
	 * Get all sessions (for testing/debugging)
	 */
	getSessions(): Map<string, SessionState> {
		return this.sessions;
	}

	/**
	 * Get session state (for testing/debugging)
	 */
	getSessionState(sessionId: string): SessionState | undefined {
		return this.sessions.get(sessionId);
	}
}
