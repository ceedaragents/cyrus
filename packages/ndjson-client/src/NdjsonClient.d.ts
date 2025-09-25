import { EventEmitter } from "node:events";
import type {
	NdjsonClientConfig,
	NdjsonClientEvents,
	StatusUpdate,
} from "./types.js";
export declare interface NdjsonClient {
	on<K extends keyof NdjsonClientEvents>(
		event: K,
		listener: NdjsonClientEvents[K],
	): this;
	emit<K extends keyof NdjsonClientEvents>(
		event: K,
		...args: Parameters<NdjsonClientEvents[K]>
	): boolean;
}
/**
 * NDJSON streaming client for proxy communication
 */
export declare class NdjsonClient extends EventEmitter {
	private transport;
	constructor(config: NdjsonClientConfig);
	/**
	 * Connect to the proxy and start receiving events
	 */
	connect(): Promise<void>;
	/**
	 * Send status update to proxy
	 */
	sendStatus(update: StatusUpdate): Promise<void>;
	/**
	 * Disconnect from the proxy
	 */
	disconnect(): void;
	/**
	 * Check if client is connected
	 */
	isConnected(): boolean;
}
//# sourceMappingURL=NdjsonClient.d.ts.map
