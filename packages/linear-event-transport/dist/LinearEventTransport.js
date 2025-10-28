import { EventEmitter } from "node:events";
import { WebhookTransport } from "./transports/WebhookTransport.js";
/**
 * Linear event transport for delivering Linear webhook payloads to handlers
 *
 * Supports two verification methods:
 * - LINEAR_DIRECT_WEBHOOKS mode: Uses LINEAR_WEBHOOK_SECRET for HMAC verification
 * - Proxy mode: Uses CYRUS_API_KEY for Authorization Bearer token verification
 */
export class LinearEventTransport extends EventEmitter {
    transport;
    constructor(config) {
        super();
        // Validate configuration
        if (!config.verificationMethod) {
            throw new Error("verificationMethod is required in config");
        }
        // Create webhook transport (currently the only supported transport)
        this.transport = new WebhookTransport(config);
        // Forward transport events
        this.transport.on("connect", () => this.emit("connect"));
        this.transport.on("disconnect", (reason) => this.emit("disconnect", reason));
        this.transport.on("webhook", (payload) => this.emit("webhook", payload));
        this.transport.on("error", (error) => this.emit("error", error));
        // Forward config callbacks to events
        if (config.onWebhook)
            this.on("webhook", config.onWebhook);
        if (config.onConnect)
            this.on("connect", config.onConnect);
        if (config.onDisconnect)
            this.on("disconnect", config.onDisconnect);
        if (config.onError)
            this.on("error", config.onError);
    }
    /**
     * Connect to the webhook server and start receiving events
     */
    async connect() {
        return this.transport.connect();
    }
    /**
     * Send status update to proxy
     */
    async sendStatus(update) {
        return this.transport.sendStatus(update);
    }
    /**
     * Disconnect from the webhook server
     */
    disconnect() {
        this.transport.disconnect();
    }
    /**
     * Check if client is connected
     */
    isConnected() {
        return this.transport.isConnected();
    }
}
//# sourceMappingURL=LinearEventTransport.js.map