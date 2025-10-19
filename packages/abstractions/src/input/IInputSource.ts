import type { IInputEvent, IStatusUpdate } from "./IInputEvent.js";

/**
 * Events emitted by an input source
 */
export interface IInputSourceEvents<TEvent extends IInputEvent = IInputEvent> {
	/**
	 * Emitted when an event is received from the source
	 */
	event: (event: TEvent) => void;

	/**
	 * Emitted when an error occurs
	 */
	error: (error: Error) => void;

	/**
	 * Emitted when successfully connected to the source
	 */
	connect: () => void;

	/**
	 * Emitted when disconnected from the source
	 */
	disconnect: (reason?: string) => void;
}

/**
 * Abstract interface for input sources
 *
 * An input source is anything that can generate events for the system to process.
 * Examples: webhook servers, HTTP APIs, CLI commands, file watchers, message queues, etc.
 *
 * Key design principles:
 * 1. Event-driven: Uses events to notify about incoming data
 * 2. Async lifecycle: Connect/disconnect are async operations
 * 3. Status reporting: Can report back processing status
 * 4. Error handling: Emits errors rather than throwing
 *
 * Example usage:
 * ```typescript
 * const source = new WebhookInputSource({ port: 3000 });
 * source.on('event', async (event) => {
 *   console.log('Received:', event);
 *   await source.sendStatus({ eventId: event.id, status: 'processing' });
 *   // Process event...
 *   await source.sendStatus({ eventId: event.id, status: 'completed' });
 * });
 * source.on('error', (err) => console.error(err));
 * await source.connect();
 * ```
 *
 * @template TEvent The specific event type this source produces
 */
export interface IInputSource<TEvent extends IInputEvent = IInputEvent> {
	/**
	 * Unique name for this input source
	 */
	readonly name: string;

	/**
	 * Type of input source (e.g., 'webhook', 'http', 'cli', 'file-watcher')
	 */
	readonly type: string;

	/**
	 * Connect to the input source and start receiving events
	 *
	 * This should establish any necessary connections (network, file system, etc.)
	 * and start emitting 'event' events when data is received.
	 *
	 * @throws Error if connection fails
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from the input source and stop receiving events
	 *
	 * This should clean up any resources (close connections, stop file watchers, etc.)
	 * After disconnecting, the source should not emit any more events.
	 */
	disconnect(): Promise<void>;

	/**
	 * Check if currently connected to the source
	 *
	 * @returns true if connected and receiving events, false otherwise
	 */
	isConnected(): boolean;

	/**
	 * Send a status update back to the source
	 *
	 * Optional method for sources that support status reporting.
	 * For example, a webhook source might POST status back to the sender.
	 *
	 * @param update Status update to send
	 */
	sendStatus?(update: IStatusUpdate): Promise<void>;

	/**
	 * Register an event handler
	 *
	 * @param event Event name to listen for
	 * @param handler Callback function for the event
	 */
	on<K extends keyof IInputSourceEvents<TEvent>>(
		event: K,
		handler: IInputSourceEvents<TEvent>[K],
	): void;

	/**
	 * Unregister an event handler
	 *
	 * @param event Event name to stop listening for
	 * @param handler Callback function to remove
	 */
	off<K extends keyof IInputSourceEvents<TEvent>>(
		event: K,
		handler: IInputSourceEvents<TEvent>[K],
	): void;

	/**
	 * Register a one-time event handler
	 *
	 * Handler is automatically removed after first invocation
	 *
	 * @param event Event name to listen for
	 * @param handler Callback function for the event
	 */
	once?<K extends keyof IInputSourceEvents<TEvent>>(
		event: K,
		handler: IInputSourceEvents<TEvent>[K],
	): void;
}

/**
 * Type guard to check if an object implements IInputSource
 */
export function isInputSource(obj: unknown): obj is IInputSource {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"name" in obj &&
		"type" in obj &&
		"connect" in obj &&
		"disconnect" in obj &&
		"isConnected" in obj &&
		"on" in obj &&
		"off" in obj &&
		typeof (obj as any).connect === "function" &&
		typeof (obj as any).disconnect === "function" &&
		typeof (obj as any).isConnected === "function"
	);
}
