import type { LinearEventTransportConfig, StatusUpdate } from "../types.js";
import { BaseTransport } from "./BaseTransport.js";
/**
 * Webhook transport for receiving events via HTTP webhooks
 * Supports two verification methods:
 * 1. HMAC signature verification (LINEAR_DIRECT_WEBHOOKS mode)
 * 2. Bearer token verification (proxy mode)
 */
export declare class WebhookTransport extends BaseTransport {
    private server;
    private webhookClient;
    private webhookUrl;
    constructor(config: LinearEventTransportConfig);
    connect(): Promise<void>;
    /**
     * Handle incoming webhook request with appropriate verification
     */
    private handleWebhookRequest;
    /**
     * Read request body as string
     */
    private readRequestBody;
    disconnect(): void;
    sendStatus(update: StatusUpdate): Promise<void>;
    /**
     * Register with external webhook server for shared webhook handling
     */
    registerWithExternalServer(): Promise<void>;
    /**
     * Get webhook URL for external registration
     */
    getWebhookUrl(): string;
}
//# sourceMappingURL=WebhookTransport.d.ts.map