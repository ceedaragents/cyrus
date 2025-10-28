import { EventEmitter } from "node:events";
import type { LinearEventTransportConfig, LinearEventTransportEvents, StatusUpdate } from "./types.js";
export declare interface LinearEventTransport {
    on<K extends keyof LinearEventTransportEvents>(event: K, listener: LinearEventTransportEvents[K]): this;
    emit<K extends keyof LinearEventTransportEvents>(event: K, ...args: Parameters<LinearEventTransportEvents[K]>): boolean;
}
/**
 * Linear event transport for delivering Linear webhook payloads to handlers
 *
 * Supports two verification methods:
 * - LINEAR_DIRECT_WEBHOOKS mode: Uses LINEAR_WEBHOOK_SECRET for HMAC verification
 * - Proxy mode: Uses CYRUS_API_KEY for Authorization Bearer token verification
 */
export declare class LinearEventTransport extends EventEmitter {
    private transport;
    constructor(config: LinearEventTransportConfig);
    /**
     * Connect to the webhook server and start receiving events
     */
    connect(): Promise<void>;
    /**
     * Send status update to proxy
     */
    sendStatus(update: StatusUpdate): Promise<void>;
    /**
     * Disconnect from the webhook server
     */
    disconnect(): void;
    /**
     * Check if client is connected
     */
    isConnected(): boolean;
}
//# sourceMappingURL=LinearEventTransport.d.ts.map