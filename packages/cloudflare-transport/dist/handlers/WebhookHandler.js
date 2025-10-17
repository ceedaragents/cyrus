import { EventEmitter } from "node:events";
/**
 * Handles Linear webhook payloads
 */
export class WebhookHandler extends EventEmitter {
    config;
    constructor(config) {
        super();
        this.config = config;
    }
    /**
     * Handle incoming webhook request
     */
    async handle(req, body) {
        try {
            // Validate Linear webhook signature if secret is configured
            if (this.config.webhookSecret) {
                const signature = req.headers["linear-webhook-signature"];
                if (!this.config.authManager.validateWebhookSignature(body, signature, this.config.webhookSecret)) {
                    console.warn("[WebhookHandler] Invalid webhook signature");
                    return {
                        status: 401,
                        body: { error: "Invalid webhook signature" },
                    };
                }
            }
            // Parse webhook payload
            let webhook;
            try {
                webhook = JSON.parse(body);
            }
            catch (error) {
                console.error("[WebhookHandler] Failed to parse webhook body:", error);
                return {
                    status: 400,
                    body: { error: "Invalid JSON payload" },
                };
            }
            // Log webhook type and action
            const action = webhook.action || "unknown";
            const type = webhook.type || "unknown";
            console.log(`[WebhookHandler] Received webhook - Type: ${type}, Action: ${action}`);
            // Emit webhook event for processing
            this.emit("webhook", webhook);
            // Return success response
            return {
                status: 200,
                body: {
                    success: true,
                    message: "Webhook received",
                    type,
                    action,
                },
            };
        }
        catch (error) {
            console.error("[WebhookHandler] Unexpected error:", error);
            return {
                status: 500,
                body: {
                    error: "Internal server error",
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }
    /**
     * Validate webhook payload structure
     */
    validateWebhookPayload(payload) {
        return (payload &&
            typeof payload === "object" &&
            typeof payload.type === "string" &&
            typeof payload.data === "object");
    }
}
