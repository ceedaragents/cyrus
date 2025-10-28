import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
/**
 * Linear event transport module for handling Linear webhooks
 * Implements the ApplicationModule interface for registration with SharedApplicationServer
 */
export class LinearEventTransport extends EventEmitter {
    webhookPath;
    verificationMethod;
    constructor(config = {}) {
        super();
        this.webhookPath = config.path || config.webhookPath || "/webhook";
        // Determine verification method based on environment variables
        const isDirectWebhooks = process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase().trim() === "true";
        if (isDirectWebhooks && process.env.LINEAR_WEBHOOK_SECRET) {
            this.verificationMethod = "linear";
        }
        else if (process.env.CYRUS_API_KEY) {
            this.verificationMethod = "api-key";
        }
        else {
            this.verificationMethod = "api-key"; // Default to api-key verification
        }
        console.log(`🔐 Linear event transport initialized with ${this.verificationMethod} verification`);
    }
    /**
     * Handle incoming webhook requests
     */
    async handleRequest(req, res, _url) {
        // Only handle POST requests
        if (req.method !== "POST") {
            res.writeHead(405, { "Content-Type": "text/plain" });
            res.end("Method Not Allowed");
            return;
        }
        try {
            // Read request body
            let body = "";
            await new Promise((resolve, reject) => {
                req.on("data", (chunk) => {
                    body += chunk.toString();
                });
                req.on("end", () => {
                    resolve();
                });
                req.on("error", reject);
            });
            // Verify webhook signature based on verification method
            const isValid = await this.verifyWebhookSignature(body, req.headers);
            if (!isValid) {
                console.log(`🔐 Webhook signature verification failed`);
                res.writeHead(401, { "Content-Type": "text/plain" });
                res.end("Unauthorized");
                return;
            }
            // Parse payload
            let payload;
            try {
                payload = JSON.parse(body);
            }
            catch (error) {
                console.error(`🔐 Failed to parse webhook payload:`, error);
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Bad Request");
                return;
            }
            // Emit webhook event
            this.emit("webhook", payload);
            // Send success response
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
            console.log(`🔐 Linear webhook received and processed`);
        }
        catch (error) {
            console.error(`🔐 Error handling webhook request:`, error);
            this.emit("error", error);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal Server Error");
        }
    }
    /**
     * Verify webhook signature based on the configured verification method
     */
    async verifyWebhookSignature(body, headers) {
        if (this.verificationMethod === "linear") {
            return this.verifyLinearSignature(body, headers);
        }
        else {
            return this.verifyApiKeySignature(headers);
        }
    }
    /**
     * Verify Linear webhook signature using LINEAR_WEBHOOK_SECRET
     */
    verifyLinearSignature(body, headers) {
        const secret = process.env.LINEAR_WEBHOOK_SECRET;
        if (!secret) {
            console.error("LINEAR_WEBHOOK_SECRET is not set");
            return false;
        }
        const signature = headers["linear-signature"];
        if (!signature) {
            console.log("Missing linear-signature header");
            return false;
        }
        // Create HMAC
        const hmac = createHmac("sha256", secret);
        hmac.update(body);
        const computedSignature = hmac.digest("hex");
        // Compare signatures (constant-time comparison)
        return computedSignature === signature;
    }
    /**
     * Verify API key from Authorization header
     */
    verifyApiKeySignature(headers) {
        const apiKey = process.env.CYRUS_API_KEY;
        if (!apiKey) {
            console.error("CYRUS_API_KEY is not set");
            return false;
        }
        const authHeader = headers.authorization;
        if (!authHeader) {
            console.log("Missing authorization header");
            return false;
        }
        // Expect "Bearer <api-key>" format
        const [scheme, token] = authHeader.split(" ");
        if (scheme !== "Bearer") {
            console.log("Invalid authorization scheme");
            return false;
        }
        // Compare tokens (constant-time comparison)
        return token === apiKey;
    }
    /**
     * Get the webhook path
     */
    getWebhookPath() {
        return this.webhookPath;
    }
    /**
     * Get the verification method
     */
    getVerificationMethod() {
        return this.verificationMethod;
    }
}
//# sourceMappingURL=LinearEventTransport.js.map