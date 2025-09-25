import { EventEmitter } from "node:events";
import type { EdgeEvent, NdjsonClientConfig, StatusUpdate } from "../types.js";
/**
 * Base transport class for NDJSON client communication
 */
export declare abstract class BaseTransport extends EventEmitter {
	protected config: NdjsonClientConfig;
	protected connected: boolean;
	constructor(config: NdjsonClientConfig);
	/**
	 * Connect to the proxy and start receiving events
	 */
	abstract connect(): Promise<void>;
	/**
	 * Disconnect from the proxy
	 */
	abstract disconnect(): void;
	/**
	 * Send status update to proxy
	 */
	abstract sendStatus(update: StatusUpdate): Promise<void>;
	/**
	 * Check if transport is connected
	 */
	isConnected(): boolean;
	/**
	 * Handle events from the transport
	 */
	protected handleEvent(event: EdgeEvent): void;
}
//# sourceMappingURL=BaseTransport.d.ts.map
