import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
/**
 * Module handler that processes HTTP requests for a specific path
 */
export interface ApplicationModule {
    initialize?(server: any): Promise<void>;
    handleRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
    destroy?(): Promise<void>;
}
/**
 * API response structure
 */
export interface ApiResponse {
    success: boolean;
    message?: string;
    error?: string;
    details?: string;
    data?: any;
}
/**
 * Configuration update payload types
 */
export interface CyrusConfigPayload {
    version: string;
    data: any;
    force?: boolean;
}
export interface CyrusEnvPayload {
    envVars: Record<string, string>;
    force?: boolean;
}
export interface RepositoryPayload {
    id: string;
    name: string;
    url: string;
    branch?: string;
}
export interface TestMcpPayload {
    mcpConfig: any;
}
export interface ConfigureMcpPayload {
    mcpConfigs: Record<string, any>;
}
/**
 * Events emitted by ConfigUpdater
 */
export interface ConfigUpdaterEvents {
    webhook: (payload: LinearWebhookPayload) => void;
    configUpdate: () => void;
    restart: (reason: string) => void;
    error: (error: Error) => void;
}
/**
 * Config updater module for handling configuration updates and webhooks
 * Implements the ApplicationModule interface for registration with SharedApplicationServer
 */
export declare class ConfigUpdater extends EventEmitter implements ApplicationModule {
    private cyrusHome;
    private paths;
    constructor(cyrusHome?: string);
    /**
     * Handle incoming requests
     */
    handleRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
    /**
     * Verify authentication header
     */
    private verifyAuth;
    /**
     * Read request body
     */
    private readBody;
    /**
     * Check if a path should be handled by this module
     */
    shouldHandle(pathname: string): boolean;
}
//# sourceMappingURL=ConfigUpdater.d.ts.map