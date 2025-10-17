import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { AuthManager } from "../AuthManager.js";
import type { HandlerResult } from "../types.js";
import type { LinearWebhook } from "cyrus-core";

export interface WebhookHandlerConfig {
  authManager: AuthManager;
  webhookSecret?: string;
}

/**
 * Handles Linear webhook payloads
 */
export class WebhookHandler extends EventEmitter {
  private config: WebhookHandlerConfig;

  constructor(config: WebhookHandlerConfig) {
    super();
    this.config = config;
  }

  /**
   * Handle incoming webhook request
   */
  async handle(req: IncomingMessage, body: string): Promise<HandlerResult> {
    try {
      // Validate Linear webhook signature if secret is configured
      if (this.config.webhookSecret) {
        const signature = req.headers["linear-webhook-signature"] as string;

        if (!this.config.authManager.validateWebhookSignature(
          body,
          signature,
          this.config.webhookSecret
        )) {
          console.warn("[WebhookHandler] Invalid webhook signature");
          return {
            status: 401,
            body: { error: "Invalid webhook signature" },
          };
        }
      }

      // Parse webhook payload
      let webhook: LinearWebhook;
      try {
        webhook = JSON.parse(body);
      } catch (error) {
        console.error("[WebhookHandler] Failed to parse webhook body:", error);
        return {
          status: 400,
          body: { error: "Invalid JSON payload" },
        };
      }

      // Log webhook type and action
      const action = (webhook as any).action || "unknown";
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

    } catch (error) {
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
  private validateWebhookPayload(payload: any): payload is LinearWebhook {
    return (
      payload &&
      typeof payload === "object" &&
      typeof payload.type === "string" &&
      typeof payload.data === "object"
    );
  }
}