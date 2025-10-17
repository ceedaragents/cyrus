// Main client
export { CloudflareTransportClient } from "./CloudflareTransportClient.js";

// Managers
export { ConfigManager } from "./ConfigManager.js";
export { AuthManager } from "./AuthManager.js";
export { CloudflareTunnel } from "./CloudflareTunnel.js";
export { HttpServer } from "./HttpServer.js";

// Handlers
export { WebhookHandler } from "./handlers/WebhookHandler.js";
export { ConfigUpdateHandler } from "./handlers/ConfigUpdateHandler.js";
export { HealthHandler } from "./handlers/HealthHandler.js";

// Types
export type {
  CloudflareTransportConfig,
  CloudflareTransportEvents,
  StoredTransportConfig,
  CustomerValidationRequest,
  CustomerValidationResponse,
  ConfigUpdateRequest,
  PathUpdateRequest,
  GitHubCredentialsUpdate,
  LinearCredentialsUpdate,
  HandlerResult,
  TunnelStatus,
} from "./types.js";

// Re-export handler types
export type { RequestHandler } from "./HttpServer.js";
export type { WebhookHandlerConfig } from "./handlers/WebhookHandler.js";
export type { ConfigUpdateHandlerConfig } from "./handlers/ConfigUpdateHandler.js";
export type { HealthHandlerConfig } from "./handlers/HealthHandler.js";