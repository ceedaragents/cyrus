import type { IAgentRunner } from "../agent/IAgentRunner.js";
import type { IInputEvent, IInputSource } from "../input/index.js";
import type { IOutputRenderer, IRendererSession } from "../output/index.js";
import type { IAgentRunnerFactory } from "./IAgentRunnerFactory.js";

/**
 * Events emitted by the orchestrator
 */
export interface IOrchestratorEvents {
	/**
	 * Emitted when a session is created
	 */
	"session:created": (session: IOrchestratorSession) => void;

	/**
	 * Emitted when a session starts processing
	 */
	"session:started": (session: IOrchestratorSession) => void;

	/**
	 * Emitted when a session completes successfully
	 */
	"session:completed": (session: IOrchestratorSession) => void;

	/**
	 * Emitted when a session fails
	 */
	"session:failed": (session: IOrchestratorSession, error: Error) => void;

	/**
	 * Emitted when an input event is received
	 */
	"event:received": (event: IInputEvent, source: string) => void;

	/**
	 * Emitted when an error occurs
	 */
	error: (error: Error, context?: Record<string, unknown>) => void;

	/**
	 * Emitted when the orchestrator starts
	 */
	started: () => void;

	/**
	 * Emitted when the orchestrator stops
	 */
	stopped: () => void;
}

/**
 * Orchestrator session
 *
 * Combines the input event, agent runner, and renderer session
 */
export interface IOrchestratorSession {
	/**
	 * Unique session ID
	 */
	id: string;

	/**
	 * The input event that triggered this session
	 */
	inputEvent: IInputEvent;

	/**
	 * The agent runner processing this session
	 */
	agentRunner: IAgentRunner;

	/**
	 * The renderer session for output
	 */
	rendererSession: IRendererSession;

	/**
	 * Session start time
	 */
	startedAt: Date;

	/**
	 * Session end time (if completed)
	 */
	endedAt?: Date;

	/**
	 * Current session status
	 */
	status: "created" | "running" | "completed" | "failed";

	/**
	 * Error (if failed)
	 */
	error?: Error;

	/**
	 * Additional metadata
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Routing configuration for the orchestrator
 *
 * Determines which renderer to use for which input events
 */
export interface IRoutingConfig {
	/**
	 * Default renderer to use if no specific route matches
	 */
	defaultRenderer?: string;

	/**
	 * Routing rules
	 * Maps event types/patterns to renderer names
	 */
	routes?: Array<{
		/**
		 * Event type pattern (supports wildcards)
		 */
		eventType: string;

		/**
		 * Event source pattern (supports wildcards)
		 */
		eventSource?: string;

		/**
		 * Renderer name to use for matching events
		 */
		renderer: string;

		/**
		 * Optional condition function for complex routing
		 */
		condition?: (event: IInputEvent) => boolean;
	}>;
}

/**
 * Core orchestrator interface
 *
 * The orchestrator is the central component that coordinates:
 * 1. Input sources (where events come from)
 * 2. Agent runners (how to process events)
 * 3. Output renderers (where to display results)
 *
 * It handles routing, lifecycle management, and error handling.
 *
 * Key design principles:
 * 1. Pluggable components: All inputs/outputs/agents are pluggable
 * 2. Event-driven: Uses events for coordination
 * 3. Configuration-driven: Routing and behavior configured externally
 * 4. Resilient: Handles errors gracefully
 *
 * Example usage:
 * ```typescript
 * const orchestrator = new Orchestrator({
 *   routing: {
 *     defaultRenderer: 'cli',
 *     routes: [
 *       { eventType: 'linear:*', renderer: 'linear' },
 *       { eventType: 'github:*', renderer: 'github' }
 *     ]
 *   }
 * });
 *
 * // Register components
 * orchestrator.addInputSource('linear-webhooks', linearInput);
 * orchestrator.addOutputRenderer('linear', linearRenderer);
 * orchestrator.addOutputRenderer('cli', cliRenderer);
 * orchestrator.setAgentRunnerFactory(factory);
 *
 * // Start processing
 * await orchestrator.start();
 * ```
 */
export interface IOrchestrator {
	/**
	 * Add an input source
	 *
	 * Input sources generate events that the orchestrator processes
	 *
	 * @param name Unique name for this input source
	 * @param source The input source implementation
	 */
	addInputSource(name: string, source: IInputSource<IInputEvent>): void;

	/**
	 * Remove an input source
	 *
	 * @param name Name of the input source to remove
	 */
	removeInputSource(name: string): void;

	/**
	 * Get an input source by name
	 *
	 * @param name Name of the input source
	 * @returns The input source, or undefined if not found
	 */
	getInputSource(name: string): IInputSource<IInputEvent> | undefined;

	/**
	 * Add an output renderer
	 *
	 * Output renderers display agent results
	 *
	 * @param name Unique name for this renderer
	 * @param renderer The renderer implementation
	 */
	addOutputRenderer(name: string, renderer: IOutputRenderer): void;

	/**
	 * Remove an output renderer
	 *
	 * @param name Name of the renderer to remove
	 */
	removeOutputRenderer(name: string): void;

	/**
	 * Get an output renderer by name
	 *
	 * @param name Name of the renderer
	 * @returns The renderer, or undefined if not found
	 */
	getOutputRenderer(name: string): IOutputRenderer | undefined;

	/**
	 * Set the agent runner factory
	 *
	 * The factory creates agent runners for processing events
	 *
	 * @param factory The agent runner factory
	 */
	setAgentRunnerFactory(factory: IAgentRunnerFactory): void;

	/**
	 * Get the agent runner factory
	 *
	 * @returns The agent runner factory, or undefined if not set
	 */
	getAgentRunnerFactory(): IAgentRunnerFactory | undefined;

	/**
	 * Set routing configuration
	 *
	 * @param config Routing configuration
	 */
	setRoutingConfig(config: IRoutingConfig): void;

	/**
	 * Get routing configuration
	 *
	 * @returns Current routing configuration
	 */
	getRoutingConfig(): IRoutingConfig;

	/**
	 * Start the orchestrator
	 *
	 * Connects all input sources and starts processing events
	 *
	 * @throws Error if no agent runner factory is set
	 */
	start(): Promise<void>;

	/**
	 * Stop the orchestrator
	 *
	 * Disconnects all input sources and shuts down renderers
	 */
	stop(): Promise<void>;

	/**
	 * Check if the orchestrator is running
	 *
	 * @returns true if running, false otherwise
	 */
	isRunning(): boolean;

	/**
	 * Get active session by ID
	 *
	 * @param sessionId Session ID
	 * @returns The session, or undefined if not found
	 */
	getSession(sessionId: string): IOrchestratorSession | undefined;

	/**
	 * Get all active sessions
	 *
	 * @returns Array of active sessions
	 */
	getAllSessions(): IOrchestratorSession[];

	/**
	 * Register an event handler
	 *
	 * @param event Event name to listen for
	 * @param handler Callback function for the event
	 */
	on<K extends keyof IOrchestratorEvents>(
		event: K,
		handler: IOrchestratorEvents[K],
	): void;

	/**
	 * Unregister an event handler
	 *
	 * @param event Event name to stop listening for
	 * @param handler Callback function to remove
	 */
	off<K extends keyof IOrchestratorEvents>(
		event: K,
		handler: IOrchestratorEvents[K],
	): void;

	/**
	 * Register a one-time event handler
	 *
	 * @param event Event name to listen for
	 * @param handler Callback function for the event
	 */
	once?<K extends keyof IOrchestratorEvents>(
		event: K,
		handler: IOrchestratorEvents[K],
	): void;
}

/**
 * Type guard to check if an object implements IOrchestrator
 */
export function isOrchestrator(obj: unknown): obj is IOrchestrator {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"addInputSource" in obj &&
		"addOutputRenderer" in obj &&
		"setAgentRunnerFactory" in obj &&
		"start" in obj &&
		"stop" in obj &&
		"isRunning" in obj &&
		"on" in obj &&
		"off" in obj &&
		typeof (obj as any).start === "function" &&
		typeof (obj as any).stop === "function"
	);
}
