/**
 * Platform-agnostic interface for agent event transport.
 *
 * This interface defines how webhook events from issue tracking platforms
 * are received, verified, and delivered to the application. It abstracts
 * away platform-specific details like HTTP endpoints, signature verification,
 * and payload structures.
 *
 * @module issue-tracker/IAgentEventTransport
 */

import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "./AgentEvent.js";

/**
 * Configuration for creating an agent event transport.
 */
export interface AgentEventTransportConfig {
	/**
	 * Fastify server instance to register webhook endpoints with.
	 */
	fastifyServer: FastifyInstance;

	/**
	 * Verification mode for incoming events.
	 * - "direct": Verify using platform's signature mechanism (e.g., Linear webhook signature)
	 * - "proxy": Verify using Bearer token authentication
	 */
	verificationMode: "direct" | "proxy";

	/**
	 * Secret key for verification.
	 * - In "direct" mode: Platform's webhook secret (e.g., LINEAR_WEBHOOK_SECRET)
	 * - In "proxy" mode: API key for Bearer token authentication (e.g., CYRUS_API_KEY)
	 */
	secret: string;
}

/**
 * Event handlers for agent event transport.
 */
export interface AgentEventTransportEvents {
	/**
	 * Emitted when a valid agent event is received.
	 * @param event - The verified agent event
	 */
	event: (event: AgentEvent) => void;

	/**
	 * Emitted when an error occurs during event processing.
	 * @param error - The error that occurred
	 */
	error: (error: Error) => void;
}

/**
 * Platform-agnostic transport for receiving and delivering agent events.
 *
 * This interface defines the contract for event transport implementations.
 * Each platform (Linear, GitHub, Jira) provides its own implementation that
 * handles platform-specific details like HTTP endpoints, authentication, and
 * payload structures.
 *
 * @example
 * ```typescript
 * // Create transport from issue tracker service
 * const transport = issueTracker.createEventTransport({
 *   fastifyServer: server.getFastifyInstance(),
 *   verificationMode: 'proxy',
 *   secret: process.env.CYRUS_API_KEY
 * });
 *
 * // Register HTTP endpoints
 * transport.register();
 *
 * // Listen for events
 * transport.on('event', (event: AgentEvent) => {
 *   console.log('Received event:', event.action);
 * });
 *
 * // Handle errors
 * transport.on('error', (error: Error) => {
 *   console.error('Transport error:', error);
 * });
 * ```
 */
export interface IAgentEventTransport {
	/**
	 * Register HTTP endpoints with the Fastify server.
	 *
	 * This method mounts the necessary routes to receive webhook events
	 * from the issue tracking platform.
	 *
	 * @example
	 * ```typescript
	 * transport.register();
	 * console.log('Webhook endpoints registered');
	 * ```
	 */
	register(): void;

	/**
	 * Register an event listener.
	 *
	 * @param event - Event name to listen for
	 * @param listener - Callback function to handle the event
	 *
	 * @example
	 * ```typescript
	 * transport.on('event', (event: AgentEvent) => {
	 *   if (isAgentSessionCreatedEvent(event)) {
	 *     console.log('Session created:', event.agentSession.id);
	 *   }
	 * });
	 * ```
	 */
	on<K extends keyof AgentEventTransportEvents>(
		event: K,
		listener: AgentEventTransportEvents[K],
	): void;

	/**
	 * Remove all event listeners.
	 *
	 * This is typically called during cleanup when shutting down the transport.
	 *
	 * @example
	 * ```typescript
	 * transport.removeAllListeners();
	 * ```
	 */
	removeAllListeners(): void;
}
