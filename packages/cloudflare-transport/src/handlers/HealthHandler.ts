import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
export class HealthHandler {
  private config: HealthHandlerConfig;
  private version: string;

  constructor(config: HealthHandlerConfig) {
    this.config = config;

    // Get package version
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const packageJsonPath = join(__dirname, "..", "..", "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      this.version = packageJson.version;
    } catch (error) {
      this.version = "unknown";
    }
  }

  /**
   * Handle health check request
   */
  async handleHealth(req: IncomingMessage, body: string): Promise<HandlerResult> {
    return {
      status: 200,
      body: {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: this.version,
      },
    };
  }

  /**
   * Handle status request with detailed information
   */
  async handleStatus(req: IncomingMessage, body: string): Promise<HandlerResult> {
    const config = this.config.configManager.get();
    const tunnelStatus = this.config.tunnel?.getStatus();

    return {
      status: 200,
      body: {
        success: true,
        status: "running",
        version: this.version,
        timestamp: new Date().toISOString(),
        tunnel: tunnelStatus || { active: false },
        configuration: {
          hasCustomerId: !!config.customerId,
          hasCloudflareToken: !!config.cloudflareToken,
          hasAuthKey: !!config.authKey,
          hasGitHubCredentials: !!config.githubCredentials,
          hasLinearCredentials: !!config.linearCredentials,
          hasClaudeApiKey: !!config.claudeApiKey,
          paths: config.paths || {},
          repositoryCount: config.repositories?.length || 0,
          lastUpdated: config.lastUpdated,
        },
        missingFields: this.config.configManager.getMissingFields(),
      },
    };
  }
}