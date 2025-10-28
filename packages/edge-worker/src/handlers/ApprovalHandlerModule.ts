import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type { HandlerModule, RouteRegistrationFunction } from "./types.js";

/**
 * Approval callback state for tracking approval workflows
 */
export interface ApprovalCallback {
	resolve: (approved: boolean, feedback?: string) => void;
	reject: (error: Error) => void;
	sessionId: string;
	createdAt: number;
}

/**
 * Approval handler module that manages approval workflow requests
 */
export class ApprovalHandlerModule implements HandlerModule {
	private pendingApprovals = new Map<string, ApprovalCallback>();
	private getBaseUrl: () => string;
	private host: string;
	private port: number;

	constructor(config: {
		getBaseUrl: () => string;
		host: string;
		port: number;
	}) {
		this.getBaseUrl = config.getBaseUrl;
		this.host = config.host;
		this.port = config.port;
	}

	/**
	 * Register approval routes with the server
	 */
	register(registerFn: RouteRegistrationFunction): void {
		registerFn("GET", "/approval", (req, res) =>
			this.handleApprovalRequest(req, res),
		);
		console.log("🔐 Registered approval handler module");
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		// Reject all pending approvals before shutdown
		for (const [sessionId, approval] of this.pendingApprovals) {
			approval.reject(new Error("Approval module shutting down"));
			console.log(
				`🔐 Rejected pending approval for session ${sessionId} due to shutdown`,
			);
		}
		this.pendingApprovals.clear();
	}

	/**
	 * Register an approval request and get approval URL
	 */
	registerApprovalRequest(sessionId: string): {
		promise: Promise<{ approved: boolean; feedback?: string }>;
		url: string;
	} {
		// Clean up expired approvals (older than 30 minutes)
		const now = Date.now();
		for (const [key, approval] of this.pendingApprovals) {
			if (now - approval.createdAt > 30 * 60 * 1000) {
				approval.reject(new Error("Approval request expired"));
				this.pendingApprovals.delete(key);
			}
		}

		// Create promise for this approval request
		const promise = new Promise<{ approved: boolean; feedback?: string }>(
			(resolve, reject) => {
				this.pendingApprovals.set(sessionId, {
					resolve: (approved, feedback) => resolve({ approved, feedback }),
					reject,
					sessionId,
					createdAt: now,
				});
			},
		);

		// Generate approval URL
		const url = `${this.getBaseUrl()}/approval?session=${encodeURIComponent(sessionId)}`;

		console.log(
			`🔐 Registered approval request for session ${sessionId}: ${url}`,
		);

		return { promise, url };
	}

	/**
	 * Handle approval requests
	 */
	private async handleApprovalRequest(
		_req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			const url = new URL(_req.url!, `http://${this.host}:${this.port}`);
			const sessionId = url.searchParams.get("session");
			const action = url.searchParams.get("action"); // "approve" or "reject"
			const feedback = url.searchParams.get("feedback");

			if (!sessionId) {
				res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Invalid Request</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>❌ Invalid Request</h1>
              <p>Missing session parameter.</p>
            </body>
          </html>
        `);
				return;
			}

			const approval = this.pendingApprovals.get(sessionId);

			// If no action specified, show approval UI
			if (!action) {
				const approvalExists = !!approval;
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Approval Required</title>
              <style>
                body {
                  font-family: system-ui, -apple-system, sans-serif;
                  max-width: 700px;
                  margin: 50px auto;
                  padding: 20px;
                  background: #f5f5f5;
                }
                .card {
                  background: white;
                  padding: 30px;
                  border-radius: 8px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                h1 {
                  margin-top: 0;
                  color: #333;
                }
                .status {
                  padding: 15px;
                  border-radius: 5px;
                  margin: 20px 0;
                }
                .status.pending {
                  background: #fff3cd;
                  border-left: 4px solid #ffc107;
                }
                .status.resolved {
                  background: #d4edda;
                  border-left: 4px solid #28a745;
                }
                .buttons {
                  display: flex;
                  gap: 10px;
                  margin-top: 20px;
                }
                button {
                  padding: 12px 24px;
                  font-size: 16px;
                  border: none;
                  border-radius: 5px;
                  cursor: pointer;
                  transition: opacity 0.2s;
                }
                button:hover:not(:disabled) {
                  opacity: 0.9;
                }
                button:disabled {
                  opacity: 0.5;
                  cursor: not-allowed;
                }
                .approve-btn {
                  background: #28a745;
                  color: white;
                  flex: 1;
                }
                .reject-btn {
                  background: #dc3545;
                  color: white;
                  flex: 1;
                }
                textarea {
                  width: 100%;
                  padding: 10px;
                  border: 1px solid #ddd;
                  border-radius: 5px;
                  font-family: inherit;
                  margin-top: 10px;
                  resize: vertical;
                }
                label {
                  display: block;
                  margin-top: 15px;
                  color: #666;
                  font-size: 14px;
                }
              </style>
            </head>
            <body>
              <div class="card">
                ${
									approvalExists
										? `
                  <h1>🔔 Approval Required</h1>
                  <div class="status pending">
                    <strong>Status:</strong> Waiting for your decision
                  </div>
                  <p>The agent is requesting your approval to proceed with the next step of the workflow.</p>

                  <label for="feedback">Optional feedback or instructions:</label>
                  <textarea id="feedback" rows="3" placeholder="Enter any feedback or additional instructions..."></textarea>

                  <div class="buttons">
                    <button class="approve-btn" onclick="handleAction('approve')">
                      ✅ Approve
                    </button>
                    <button class="reject-btn" onclick="handleAction('reject')">
                      ❌ Reject
                    </button>
                  </div>
                `
										: `
                  <h1>ℹ️ Approval Already Processed</h1>
                  <div class="status resolved">
                    This approval request has already been processed or has expired.
                  </div>
                  <p>You can close this window.</p>
                `
								}
              </div>

              <script>
                async function handleAction(action) {
                  const feedback = document.getElementById('feedback')?.value || '';
                  const url = new URL(window.location.href);
                  url.searchParams.set('action', action);
                  if (feedback) {
                    url.searchParams.set('feedback', feedback);
                  }

                  // Disable buttons
                  document.querySelectorAll('button').forEach(btn => btn.disabled = true);

                  // Navigate to confirmation
                  window.location.href = url.toString();
                }
              </script>
            </body>
          </html>
        `);
				return;
			}

			// Handle approval/rejection
			if (!approval) {
				res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Approval Expired</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>⏰ Approval Expired</h1>
              <p>This approval request has already been processed or has expired.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
				return;
			}

			// Process the approval/rejection
			const approved = action === "approve";
			approval.resolve(approved, feedback || undefined);
			this.pendingApprovals.delete(sessionId);

			console.log(
				`🔐 Approval ${approved ? "granted" : "rejected"} for session ${sessionId}${feedback ? ` with feedback: ${feedback}` : ""}`,
			);

			// Send success response
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Approval ${approved ? "Granted" : "Rejected"}</title>
          </head>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1>${approved ? "✅ Approval Granted" : "❌ Approval Rejected"}</h1>
            <p>Your decision has been recorded. The agent will ${approved ? "proceed with the next step" : "stop the current workflow"}.</p>
            ${feedback ? `<p><strong>Feedback provided:</strong> ${this.escapeHtml(feedback)}</p>` : ""}
            <p style="margin-top: 30px; color: #666;">You can close this window and return to Linear.</p>
            <script>setTimeout(() => window.close(), 5000)</script>
          </body>
        </html>
      `);
		} catch (error) {
			console.error("🔐 Approval request error:", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Escape HTML special characters to prevent XSS attacks
	 */
	private escapeHtml(unsafe: string): string {
		return unsafe
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}
}
