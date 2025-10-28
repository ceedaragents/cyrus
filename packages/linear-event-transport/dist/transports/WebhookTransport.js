import { createServer, } from "node:http";
import { LinearWebhookClient, } from "@linear/sdk/webhooks";
import { BaseTransport } from "./BaseTransport.js";
/**
 * Webhook transport for receiving events via HTTP webhooks
 * Supports two verification methods:
 * 1. HMAC signature verification (LINEAR_DIRECT_WEBHOOKS mode)
 * 2. Bearer token verification (proxy mode)
 */
export class WebhookTransport extends BaseTransport {
    server = null;
    webhookClient = null;
    webhookUrl;
    constructor(config) {
        super(config);
        // Build webhook URL using webhookBaseUrl if provided, otherwise construct from parts
        if (config.webhookBaseUrl) {
            const baseUrl = config.webhookBaseUrl.replace(/\/$/, ""); // Remove trailing slash
            const path = (config.webhookPath || "/webhook").replace(/^\//, ""); // Remove leading slash
            this.webhookUrl = `${baseUrl}/${path}`;
        }
        else {
            const host = config.webhookHost || "localhost";
            const port = config.webhookPort || 3000;
            const path = config.webhookPath || "/webhook";
            this.webhookUrl = `http://${host}:${port}${path}`;
        }
    }
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // Validate configuration based on verification method
                if (this.config.verificationMethod === "hmac") {
                    if (!this.config.webhookSecret) {
                        throw new Error("webhookSecret is required for HMAC verification method");
                    }
                    // Create Linear webhook client for HMAC verification
                    this.webhookClient = new LinearWebhookClient(this.config.webhookSecret);
                }
                else if (this.config.verificationMethod === "bearer") {
                    if (!this.config.apiKey) {
                        throw new Error("apiKey is required for Bearer token verification");
                    }
                    // Bearer token verification doesn't need Linear SDK client
                    this.webhookClient = null;
                }
                else {
                    throw new Error(`Unsupported verification method: ${this.config.verificationMethod}`);
                }
                if (this.config.useExternalWebhookServer &&
                    this.config.externalWebhookServer) {
                    // Use external webhook server
                    this.connected = true;
                    this.emit("connect");
                    // Register with external server
                    this.registerWithExternalServer()
                        .then(() => resolve())
                        .catch(reject);
                }
                else {
                    // Create HTTP server to receive webhooks
                    this.server = createServer(async (req, res) => {
                        try {
                            await this.handleWebhookRequest(req, res);
                        }
                        catch (error) {
                            console.error("Error handling webhook:", error);
                            res.writeHead(500, { "Content-Type": "text/plain" });
                            res.end("Internal Server Error");
                        }
                    });
                    const port = this.config.webhookPort || 3000;
                    const host = this.config.webhookHost || "localhost";
                    this.server.listen(port, host, () => {
                        this.connected = true;
                        this.emit("connect");
                        console.log(`📡 Webhook server listening on ${this.webhookUrl}`);
                        console.log(`   Verification method: ${this.config.verificationMethod}`);
                        resolve();
                    });
                    this.server.on("error", (error) => {
                        this.connected = false;
                        this.emit("error", error);
                        reject(error);
                    });
                }
            }
            catch (error) {
                this.connected = false;
                this.emit("error", error);
                reject(error);
            }
        });
    }
    /**
     * Handle incoming webhook request with appropriate verification
     */
    async handleWebhookRequest(req, res) {
        if (this.config.verificationMethod === "hmac") {
            // Use Linear SDK webhook handler for HMAC verification
            if (!this.webhookClient) {
                throw new Error("Webhook client not initialized for HMAC verification");
            }
            const webhookHandler = this.webhookClient.createHandler();
            // Register handler for all webhook events
            webhookHandler.on("*", (payload) => {
                this.handleWebhook(payload);
            });
            // Let Linear SDK handle the request (includes verification)
            await webhookHandler(req, res);
        }
        else if (this.config.verificationMethod === "bearer") {
            // Bearer token verification
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                res.writeHead(401, { "Content-Type": "text/plain" });
                res.end("Unauthorized: Missing or invalid Authorization header");
                return;
            }
            const token = authHeader.substring(7); // Remove "Bearer " prefix
            if (token !== this.config.apiKey) {
                res.writeHead(401, { "Content-Type": "text/plain" });
                res.end("Unauthorized: Invalid API key");
                return;
            }
            // Read and parse the request body
            const body = await this.readRequestBody(req);
            try {
                const payload = JSON.parse(body);
                this.handleWebhook(payload);
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("OK");
            }
            catch (_error) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Bad Request: Invalid JSON payload");
            }
        }
    }
    /**
     * Read request body as string
     */
    async readRequestBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
            req.on("error", reject);
        });
    }
    disconnect() {
        if (this.server) {
            this.server.removeAllListeners();
            this.server.close();
            this.server = null;
        }
        this.webhookClient = null;
        this.connected = false;
        this.emit("disconnect", "Transport disconnected");
    }
    async sendStatus(update) {
        if (!this.config.proxyUrl || !this.config.token) {
            // Status updates are optional - silently skip if not configured
            return;
        }
        try {
            const response = await fetch(`${this.config.proxyUrl}/events/status`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.config.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(update),
            });
            if (!response.ok) {
                throw new Error(`Failed to send status: ${response.status}`);
            }
        }
        catch (error) {
            this.emit("error", error);
        }
    }
    /**
     * Register with external webhook server for shared webhook handling
     */
    async registerWithExternalServer() {
        if (!this.config.externalWebhookServer) {
            throw new Error("External webhook server not available");
        }
        // Register this transport instance with the external server
        if (typeof this.config.externalWebhookServer.registerWebhookHandler ===
            "function") {
            // Pass a handler function that will be called for webhook requests
            const handler = async (req, res) => {
                await this.handleWebhookRequest(req, res);
            };
            // Register with token or identifier
            const identifier = this.config.token || this.config.name || "default";
            this.config.externalWebhookServer.registerWebhookHandler(identifier, handler);
        }
    }
    /**
     * Get webhook URL for external registration
     */
    getWebhookUrl() {
        if (this.config.useExternalWebhookServer &&
            this.config.externalWebhookServer &&
            typeof this.config.externalWebhookServer.getWebhookUrl === "function") {
            return this.config.externalWebhookServer.getWebhookUrl();
        }
        return this.webhookUrl;
    }
}
//# sourceMappingURL=WebhookTransport.js.map