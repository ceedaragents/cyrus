/**
 * Types for Linear event transport
 */
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
export interface StatusUpdate {
    eventId: string;
    status: "processing" | "completed" | "failed";
    error?: string;
    metadata?: Record<string, any>;
}
/**
 * Verification method for webhook requests
 */
export type VerificationMethod = "hmac" | "bearer";
/**
 * Configuration for Linear event transport
 */
export interface LinearEventTransportConfig {
    /**
     * Verification method to use for webhook requests
     * - "hmac": Verify using LINEAR_WEBHOOK_SECRET with HMAC signature
     * - "bearer": Verify using CYRUS_API_KEY as Bearer token
     */
    verificationMethod: VerificationMethod;
    /**
     * Webhook secret for HMAC verification (LINEAR_DIRECT_WEBHOOKS mode)
     * Required when verificationMethod is "hmac"
     */
    webhookSecret?: string;
    /**
     * API key for Bearer token verification (proxy mode)
     * Required when verificationMethod is "bearer"
     */
    apiKey?: string;
    /**
     * Proxy URL for status updates
     */
    proxyUrl?: string;
    /**
     * Token for authenticating with proxy
     */
    token?: string;
    /**
     * Port for webhook server (defaults to 3000)
     */
    webhookPort?: number;
    /**
     * Path for webhook endpoint (defaults to "/webhook")
     */
    webhookPath?: string;
    /**
     * Host for webhook server (defaults to "localhost")
     */
    webhookHost?: string;
    /**
     * Base URL for webhook registration
     */
    webhookBaseUrl?: string;
    /**
     * Client name for identification
     */
    name?: string;
    /**
     * External webhook server instance (like Express app or HTTP server)
     */
    externalWebhookServer?: any;
    /**
     * Whether to use external server instead of creating own
     */
    useExternalWebhookServer?: boolean;
    /**
     * Callback when webhook is received
     */
    onWebhook?: (payload: LinearWebhookPayload) => void;
    /**
     * Callback when connected
     */
    onConnect?: () => void;
    /**
     * Callback when disconnected
     */
    onDisconnect?: (reason?: string) => void;
    /**
     * Callback when error occurs
     */
    onError?: (error: Error) => void;
}
/**
 * Event types emitted by LinearEventTransport
 */
export interface LinearEventTransportEvents {
    connect: () => void;
    disconnect: (reason?: string) => void;
    webhook: (payload: LinearWebhookPayload) => void;
    error: (error: Error) => void;
}
//# sourceMappingURL=types.d.ts.map