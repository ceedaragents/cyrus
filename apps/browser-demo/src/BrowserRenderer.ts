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
import type { WebSocket } from "ws";

/**
 * Activity item to send to browser
 */
interface ActivityItem {
	id: string;
	type: string;
	content: string;
	timestamp: string;
	icon: string;
}

/**
 * Session state for browser display
 */
interface SessionState {
	session: {
		id: string;
		issueId: string;
		issueTitle: string;
		startedAt: string;
	};
	activities: ActivityItem[];
	status: "running" | "complete" | "error";
	error?: string;
}

/**
 * WebSocket message types
 */
type WSMessage =
	| { type: "session:update"; data: SessionState }
	| { type: "session:start"; sessionId: string; session: RenderableSession }
	| { type: "user:message"; sessionId: string; message: string }
	| { type: "user:stop"; sessionId: string; reason?: string };

/**
 * BrowserRenderer - Renders agent activity to browser via WebSocket
 *
 * Unlike CLIRenderer which uses React/Ink for terminal UI,
 * this renderer sends JSON messages to a browser client via WebSocket.
 */
export class BrowserRenderer implements Renderer {
	private sessions: Map<string, SessionState> = new Map();
	private clients: Set<WebSocket> = new Set();
	private inputQueues: Map<string, UserInput[]> = new Map();
	private eventEmitter = new EventEmitter();

	/**
	 * Add a WebSocket client
	 */
	addClient(ws: WebSocket): void {
		this.clients.add(ws);

		// Send current state to new client
		for (const state of this.sessions.values()) {
			this.sendToClient(ws, {
				type: "session:update",
				data: state,
			});
		}

		// Listen for messages from client
		ws.on("message", (data: Buffer) => {
			try {
				const message = JSON.parse(data.toString()) as WSMessage;
				this.handleClientMessage(message);
			} catch (error) {
				console.error("Failed to parse client message:", error);
			}
		});

		// Remove client on close
		ws.on("close", () => {
			this.clients.delete(ws);
		});
	}

	/**
	 * Handle message from browser client
	 */
	private handleClientMessage(message: WSMessage): void {
		switch (message.type) {
			case "user:message": {
				const input: MessageInput = {
					type: "message",
					content: message.message,
					timestamp: new Date(),
				};
				this.enqueueInput(message.sessionId, input);
				break;
			}
			case "user:stop": {
				const input: SignalInput = {
					type: "signal",
					signal: {
						type: "stop",
						reason: message.reason,
					},
				};
				this.enqueueInput(message.sessionId, input);
				break;
			}
		}
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
	 * Send message to a specific client
	 */
	private sendToClient(ws: WebSocket, message: WSMessage): void {
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify(message));
		}
	}

	/**
	 * Broadcast message to all connected clients
	 */
	private broadcast(message: WSMessage): void {
		for (const client of this.clients) {
			this.sendToClient(client, message);
		}
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

		// Handle different content types
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
			thought: "💭",
			action: "🔧",
			response: "💬",
			error: "❌",
			elicitation: "❓",
			prompt: "📝",
			"tool-use": "🛠️",
			complete: "✅",
			"session-start": "●",
		};

		return iconMap[type] || "●";
	}

	/**
	 * Add activity to session and broadcast
	 */
	private addActivity(
		sessionId: string,
		type: string,
		content: string,
		icon?: string,
	): void {
		const state = this.sessions.get(sessionId);
		if (!state) {
			console.error(`Session ${sessionId} not found`);
			return;
		}

		const activity: ActivityItem = {
			id: this.generateActivityId(),
			type,
			content,
			timestamp: new Date().toISOString(),
			icon: icon || this.getActivityIcon(type),
		};

		state.activities.push(activity);

		// Broadcast update to all clients
		this.broadcast({
			type: "session:update",
			data: state,
		});
	}

	// Renderer interface implementation

	async renderSessionStart(session: RenderableSession): Promise<void> {
		const state: SessionState = {
			session: {
				id: session.id,
				issueId: session.issueId,
				issueTitle: session.issueTitle,
				startedAt: session.startedAt.toISOString(),
			},
			activities: [],
			status: "running",
		};

		this.sessions.set(session.id, state);
		this.inputQueues.set(session.id, []);

		this.addActivity(
			session.id,
			"session-start",
			`Session started for issue: ${session.issueTitle}`,
			"●",
		);
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
		this.addActivity(sessionId, "text", text, "💬");
	}

	async renderToolUse(
		sessionId: string,
		tool: string,
		input: unknown,
	): Promise<void> {
		const content = `Tool: ${tool}\nInput: ${JSON.stringify(input, null, 2)}`;
		this.addActivity(sessionId, "tool-use", content, "🛠️");
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

		this.addActivity(sessionId, "complete", summaryText, "✅");
	}

	async renderError(sessionId: string, error: Error): Promise<void> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Session ${sessionId} not found`);
		}

		state.status = "error";
		state.error = error.message;

		this.addActivity(
			sessionId,
			"error",
			`Error: ${error.message}\n${error.stack || ""}`,
			"❌",
		);
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
}
