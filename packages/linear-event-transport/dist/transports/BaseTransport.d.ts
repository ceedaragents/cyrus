import { EventEmitter } from "node:events";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
import type { LinearEventTransportConfig, StatusUpdate } from "../types.js";
/**
 * Base transport class for Linear event transport communication
 */
export declare abstract class BaseTransport extends EventEmitter {
    protected config: LinearEventTransportConfig;
    protected connected: boolean;
    constructor(config: LinearEventTransportConfig);
    /**
     * Connect to the webhook server and start receiving events
     */
    abstract connect(): Promise<void>;
    /**
     * Disconnect from the webhook server
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
     * Handle webhook payload from Linear
     */
    protected handleWebhook(payload: LinearWebhookPayload): void;
}
//# sourceMappingURL=BaseTransport.d.ts.map