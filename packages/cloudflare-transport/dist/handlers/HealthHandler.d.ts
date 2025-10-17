import type { IncomingMessage } from "node:http";
import type { ConfigManager } from "../ConfigManager.js";
import type { CloudflareTunnel } from "../CloudflareTunnel.js";
import type { HandlerResult } from "../types.js";
export interface HealthHandlerConfig {
    configManager: ConfigManager;
    tunnel?: CloudflareTunnel;
}
/**
 * Handles health and status check requests
 */
export declare class HealthHandler {
    private config;
    private version;
    constructor(config: HealthHandlerConfig);
    /**
     * Handle health check request
     */
    handleHealth(req: IncomingMessage, body: string): Promise<HandlerResult>;
    /**
     * Handle status request with detailed information
     */
    handleStatus(req: IncomingMessage, body: string): Promise<HandlerResult>;
}
//# sourceMappingURL=HealthHandler.d.ts.map