import { EventEmitter } from "node:events";
import { AuthManager } from "./AuthManager.js";
import { CloudflareTunnel } from "./CloudflareTunnel.js";
import { ConfigManager } from "./ConfigManager.js";
import { HttpServer } from "./HttpServer.js";
import { ConfigUpdateHandler } from "./handlers/ConfigUpdateHandler.js";
import { HealthHandler } from "./handlers/HealthHandler.js";
import { WebhookHandler } from "./handlers/WebhookHandler.js";
/**
 * Cloudflare tunnel-based transport client for Cyrus
 * Receives webhook payloads and configuration updates from cyrus-hosted
 */
export class CloudflareTransportClient extends EventEmitter {
    config;
    configManager;
    authManager;
    tunnel;
    httpServer;
    isRunning = false;
    constructor(config) {
        super();
        this.config = {
            port: 3457,
            hostedUrl: process.env.CYRUS_HOSTED_URL || "https://cyrus-hosted.vercel.app",
            autoStart: true,
            ...config,
        };
        // Initialize managers
        this.configManager = new ConfigManager(this.config.cyrusHome);
        // Load auth key from config or use provided one
        const storedConfig = this.configManager.get();
        const authKey = this.config.authKey || storedConfig.authKey;
        this.authManager = new AuthManager(authKey);
        // Update auth key in config if it was generated
        if (!storedConfig.authKey) {
            this.configManager.setAuthKey(this.authManager.getKey());
        }
        // Set customer ID if provided
        if (this.config.customerId && this.config.customerId !== storedConfig.customerId) {
            this.configManager.setCustomerId(this.config.customerId);
        }
    }
    /**
     * Start the transport client
     */
    async start() {
        if (this.isRunning) {
            console.log("[CloudflareTransportClient] Already running");
            return;
        }
        console.log("[CloudflareTransportClient] Starting transport client...");
        try {
            // Load configuration
            const config = this.configManager.get();
            // Check if we have minimum required configuration
            if (!config.customerId) {
                throw new Error("Customer ID is required. Please run 'cyrus set-customer-id' or provide it during initialization.");
            }
            // Start HTTP server first (needed before tunnel)
            await this.startHttpServer();
            // Check if we need to validate customer and get Cloudflare token
            if (!config.cloudflareToken) {
                console.log("[CloudflareTransportClient] No Cloudflare token found, validating customer...");
                const validation = await this.validateCustomer(config.customerId);
                if (!validation.success || !validation.cloudflareToken) {
                    throw new Error(`Customer validation failed: ${validation.message || "No token received"}`);
                }
                // Store the received token and auth key
                this.configManager.setCloudflareToken(validation.cloudflareToken);
                if (validation.authKey) {
                    this.configManager.setAuthKey(validation.authKey);
                    this.authManager.setKey(validation.authKey);
                }
                config.cloudflareToken = validation.cloudflareToken;
            }
            // Start Cloudflare tunnel
            await this.startTunnel(config.cloudflareToken);
            // Register tunnel URL with cyrus-hosted
            const tunnelUrl = this.tunnel.getUrl();
            if (tunnelUrl) {
                await this.registerTunnelUrl(tunnelUrl);
                this.configManager.setTunnelUrl(tunnelUrl);
            }
            this.isRunning = true;
            this.emit("connected");
            console.log("[CloudflareTransportClient] Transport client started successfully");
            console.log(`[CloudflareTransportClient] Tunnel URL: ${tunnelUrl}`);
        }
        catch (error) {
            console.error("[CloudflareTransportClient] Failed to start:", error);
            // Clean up on failure
            await this.stop();
            throw error;
        }
    }
    /**
     * Start the HTTP server
     */
    async startHttpServer() {
        this.httpServer = new HttpServer({
            port: this.config.port,
            authManager: this.authManager,
        });
        // Create handlers
        const healthHandler = new HealthHandler({
            configManager: this.configManager,
            tunnel: this.tunnel,
        });
        const webhookHandler = new WebhookHandler({
            authManager: this.authManager,
            webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
        });
        const configHandler = new ConfigUpdateHandler({
            configManager: this.configManager,
        });
        // Register webhook event forwarding
        webhookHandler.on("webhook", (webhook) => {
            this.emit("webhook", webhook);
        });
        // Register config update event forwarding
        configHandler.on("config:updated", (type) => {
            this.emit("config:updated", type);
        });
        // Register HTTP handlers
        this.httpServer.registerHandler("/health", healthHandler.handleHealth.bind(healthHandler));
        this.httpServer.registerHandler("/status", healthHandler.handleStatus.bind(healthHandler));
        this.httpServer.registerHandler("/webhook", webhookHandler.handle.bind(webhookHandler));
        this.httpServer.registerHandler("/config", configHandler.handleGetConfig.bind(configHandler));
        this.httpServer.registerHandler("/config/paths", configHandler.handlePaths.bind(configHandler));
        this.httpServer.registerHandler("/config/github-credentials", configHandler.handleGitHubCredentials.bind(configHandler));
        this.httpServer.registerHandler("/config/linear-credentials", configHandler.handleLinearCredentials.bind(configHandler));
        this.httpServer.registerHandler("/config/claude-api-key", configHandler.handleClaudeApiKey.bind(configHandler));
        this.httpServer.registerHandler("/config/repositories", configHandler.handleRepositories.bind(configHandler));
        await this.httpServer.start();
    }
    /**
     * Start the Cloudflare tunnel
     */
    async startTunnel(token) {
        this.tunnel = new CloudflareTunnel({
            token,
            port: this.config.port,
            retryAttempts: 3,
            retryDelay: 5000,
        });
        // Forward tunnel events
        this.tunnel.on("connected", (url) => {
            this.emit("tunnel:ready", url);
        });
        this.tunnel.on("disconnected", (reason) => {
            this.emit("disconnected", reason);
        });
        await this.tunnel.start();
    }
    /**
     * Validate customer ID with cyrus-hosted
     */
    async validateCustomer(customerId) {
        try {
            const request = {
                customerId,
                version: "0.1.0", // TODO: Get from package.json
                environment: process.env.NODE_ENV || "production",
            };
            const response = await fetch(`${this.config.hostedUrl}/api/validate-customer`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": this.authManager.createAuthHeader(),
                },
                body: JSON.stringify(request),
            });
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Validation failed: ${error}`);
            }
            const result = await response.json();
            return result;
        }
        catch (error) {
            console.error("[CloudflareTransportClient] Customer validation error:", error);
            throw error;
        }
    }
    /**
     * Register tunnel URL with cyrus-hosted
     */
    async registerTunnelUrl(tunnelUrl) {
        try {
            const config = this.configManager.get();
            const response = await fetch(`${this.config.hostedUrl}/api/register-tunnel`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": this.authManager.createAuthHeader(),
                },
                body: JSON.stringify({
                    customerId: config.customerId,
                    tunnelUrl,
                    timestamp: new Date().toISOString(),
                }),
            });
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Failed to register tunnel: ${error}`);
            }
            console.log("[CloudflareTransportClient] Tunnel URL registered with cyrus-hosted");
        }
        catch (error) {
            console.error("[CloudflareTransportClient] Failed to register tunnel URL:", error);
            // Don't throw - tunnel can still work without registration
        }
    }
    /**
     * Stop the transport client
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        console.log("[CloudflareTransportClient] Stopping transport client...");
        // Stop tunnel
        if (this.tunnel) {
            await this.tunnel.stop();
            this.tunnel = undefined;
        }
        // Stop HTTP server
        if (this.httpServer) {
            await this.httpServer.stop();
            this.httpServer = undefined;
        }
        this.isRunning = false;
        this.emit("disconnected", "Client stopped");
        console.log("[CloudflareTransportClient] Transport client stopped");
    }
    /**
     * Check if transport is running
     */
    isConnected() {
        return this.isRunning && !!this.tunnel?.isActive();
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return this.configManager.get();
    }
    /**
     * Get tunnel status
     */
    getTunnelStatus() {
        return this.tunnel?.getStatus() || { active: false };
    }
    /**
     * Update customer ID
     */
    setCustomerId(customerId) {
        this.configManager.setCustomerId(customerId);
    }
}
