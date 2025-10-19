import type { IRendererSession } from "./IRendererSession.js";
import type { ISessionContext, RendererCapability } from "./types.js";

/**
 * Events emitted by an output renderer
 */
export interface IOutputRendererEvents {
	/**
	 * Emitted when a session is created
	 */
	"session:created": (session: IRendererSession) => void;

	/**
	 * Emitted when a session is destroyed
	 */
	"session:destroyed": (sessionId: string) => void;

	/**
	 * Emitted when an error occurs
	 */
	error: (error: Error, context?: Record<string, unknown>) => void;

	/**
	 * Emitted when the renderer is initialized
	 */
	initialized: () => void;

	/**
	 * Emitted when the renderer is shut down
	 */
	shutdown: () => void;
}

/**
 * Abstract interface for rendering agent output
 *
 * An output renderer takes agent output (messages, activities, status updates)
 * and renders it to a specific target (Linear, CLI terminal, Slack, web UI, etc.)
 *
 * Key design principles:
 * 1. Session-based: Each task/issue gets its own session
 * 2. Capability-driven: Renderers declare what they can do
 * 3. Lifecycle management: Initialize/shutdown for resource management
 * 4. Event-driven: Emits events for monitoring
 *
 * Example usage:
 * ```typescript
 * const renderer = new LinearOutputRenderer(config);
 * await renderer.initialize();
 *
 * const session = await renderer.createSession({
 *   taskId: 'PROJ-123',
 *   title: 'Fix login bug'
 * });
 *
 * await session.writeMessage({
 *   type: 'assistant',
 *   content: 'Starting work...',
 *   timestamp: new Date()
 * });
 *
 * // Later...
 * await renderer.destroySession(session.id);
 * await renderer.shutdown();
 * ```
 */
export interface IOutputRenderer {
	/**
	 * Unique name for this renderer
	 */
	readonly name: string;

	/**
	 * Type of renderer (e.g., 'linear', 'cli', 'slack', 'web')
	 */
	readonly type: string;

	/**
	 * Capabilities this renderer supports
	 *
	 * Used to determine what operations are available.
	 * For example, a log file renderer might only support 'text-output',
	 * while a CLI renderer might support 'text-output' and 'interactive-input'.
	 */
	readonly capabilities: readonly RendererCapability[];

	/**
	 * Initialize the renderer
	 *
	 * Performs any necessary setup (e.g., connecting to APIs, opening files, etc.)
	 * Must be called before creating sessions.
	 *
	 * @throws Error if initialization fails
	 */
	initialize(): Promise<void>;

	/**
	 * Shut down the renderer
	 *
	 * Performs cleanup (e.g., closing connections, flushing buffers, etc.)
	 * After shutdown, the renderer should not be used.
	 */
	shutdown(): Promise<void>;

	/**
	 * Create a new session
	 *
	 * Creates a session for rendering output for a specific task.
	 * The context provides information about the task.
	 *
	 * @param context Context for the session
	 * @returns The created session
	 * @throws Error if session creation fails
	 */
	createSession(context: ISessionContext): Promise<IRendererSession>;

	/**
	 * Get an existing session
	 *
	 * @param sessionId ID of the session to retrieve
	 * @returns The session, or null if not found
	 */
	getSession(sessionId: string): IRendererSession | null;

	/**
	 * Get all active sessions
	 *
	 * @returns Array of all active sessions
	 */
	getAllSessions?(): IRendererSession[];

	/**
	 * Destroy a session
	 *
	 * Performs cleanup for the session (e.g., final status update, resource cleanup)
	 * After destruction, the session should not be used.
	 *
	 * @param sessionId ID of the session to destroy
	 */
	destroySession(sessionId: string): Promise<void>;

	/**
	 * Check if a capability is supported
	 *
	 * @param capability The capability to check
	 * @returns true if supported, false otherwise
	 */
	hasCapability(capability: RendererCapability): boolean;

	/**
	 * Register an event handler
	 *
	 * @param event Event name to listen for
	 * @param handler Callback function for the event
	 */
	on<K extends keyof IOutputRendererEvents>(
		event: K,
		handler: IOutputRendererEvents[K],
	): void;

	/**
	 * Unregister an event handler
	 *
	 * @param event Event name to stop listening for
	 * @param handler Callback function to remove
	 */
	off<K extends keyof IOutputRendererEvents>(
		event: K,
		handler: IOutputRendererEvents[K],
	): void;

	/**
	 * Register a one-time event handler
	 *
	 * @param event Event name to listen for
	 * @param handler Callback function for the event
	 */
	once?<K extends keyof IOutputRendererEvents>(
		event: K,
		handler: IOutputRendererEvents[K],
	): void;
}

/**
 * Type guard to check if an object implements IOutputRenderer
 */
export function isOutputRenderer(obj: unknown): obj is IOutputRenderer {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"name" in obj &&
		"type" in obj &&
		"capabilities" in obj &&
		"initialize" in obj &&
		"shutdown" in obj &&
		"createSession" in obj &&
		"getSession" in obj &&
		"destroySession" in obj &&
		"hasCapability" in obj &&
		"on" in obj &&
		"off" in obj &&
		typeof (obj as any).initialize === "function" &&
		typeof (obj as any).shutdown === "function" &&
		typeof (obj as any).createSession === "function"
	);
}
