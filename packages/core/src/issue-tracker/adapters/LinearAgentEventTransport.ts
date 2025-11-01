/**
 * LinearAgentEventTransport - Adapter for Linear event transport
 *
 * This adapter wraps LinearEventTransport from cyrus-linear-event-transport
 * and implements IAgentEventTransport to provide a platform-agnostic interface.
 */

import type { AgentEvent } from "../AgentEvent.js";
import type {
	AgentEventTransportConfig,
	IAgentEventTransport,
} from "../IAgentEventTransport.js";

/**
 * Adapter that wraps LinearEventTransport and implements IAgentEventTransport
 */
export class LinearAgentEventTransport implements IAgentEventTransport {
	private transport: any; // LinearEventTransport from cyrus-linear-event-transport
	private eventListeners: Map<string, Set<Function>> = new Map();

	constructor(config: AgentEventTransportConfig) {
		// Import and create LinearEventTransport
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { LinearEventTransport } = require("cyrus-linear-event-transport");
		this.transport = new LinearEventTransport(config);

		// Forward the "event" events from LinearEventTransport's "event" emission
		this.transport.on("event", (payload: any) => {
			this.emitEvent("event", payload);
		});

		// Forward error events
		this.transport.on("error", (error: Error) => {
			this.emitEvent("error", error);
		});
	}

	/**
	 * Register the /webhook endpoint with the Fastify server
	 */
	register(): void {
		this.transport.register();
	}

	/**
	 * Add an event listener
	 */
	on(event: "event", listener: (event: AgentEvent) => void): void;
	on(event: "error", listener: (error: Error) => void): void;
	on(event: string, listener: Function): void {
		if (!this.eventListeners.has(event)) {
			this.eventListeners.set(event, new Set());
		}
		this.eventListeners.get(event)!.add(listener);
	}

	/**
	 * Remove all event listeners
	 */
	removeAllListeners(): void {
		this.eventListeners.clear();
		this.transport.removeAllListeners();
	}

	/**
	 * Internal method to emit events to registered listeners
	 */
	private emitEvent(event: string, ...args: any[]): void {
		const listeners = this.eventListeners.get(event);
		if (listeners) {
			for (const listener of listeners) {
				listener(...args);
			}
		}
	}
}
