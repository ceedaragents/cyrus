import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { install, bin } from "cloudflared";
import type { TunnelStatus } from "./types.js";

export interface CloudflareTunnelConfig {
  token: string;
  port: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Manages Cloudflare tunnel lifecycle
 */
export class CloudflareTunnel extends EventEmitter {
  private config: CloudflareTunnelConfig;
  private tunnelProcess?: ChildProcess;
  private tunnelUrl?: string;
  private status: TunnelStatus;
  private retryCount: number = 0;
  private isShuttingDown: boolean = false;

  constructor(config: CloudflareTunnelConfig) {
    super();
    this.config = {
      retryAttempts: 3,
      retryDelay: 5000,
      ...config,
    };
    this.status = {
      active: false,
    };
  }

  /**
   * Start the Cloudflare tunnel
   */
  async start(): Promise<void> {
    if (this.status.active) {
      throw new Error("Tunnel is already active");
    }

    this.isShuttingDown = false;

    try {
      // Ensure cloudflared binary is installed
      console.log("[CloudflareTunnel] Installing cloudflared binary...");
      await install(bin);

      console.log("[CloudflareTunnel] Starting tunnel...");
      await this.startTunnelProcess();

      // Wait for tunnel URL to be available
      await this.waitForTunnelUrl();

      this.status.active = true;
      this.status.connectedAt = new Date();
      this.emit("connected", this.tunnelUrl);

      console.log(`[CloudflareTunnel] Tunnel established: ${this.tunnelUrl}`);
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : String(error);

      if (this.retryCount < this.config.retryAttempts!) {
        this.retryCount++;
        console.log(`[CloudflareTunnel] Retrying connection (${this.retryCount}/${this.config.retryAttempts})...`);

        await this.delay(this.config.retryDelay!);
        return this.start();
      }

      throw new Error(`Failed to start tunnel after ${this.config.retryAttempts} attempts: ${this.status.lastError}`);
    }
  }

  /**
   * Start the cloudflared process
   */
  private async startTunnelProcess(): Promise<void> {
    const args = [
      "tunnel",
      "--no-autoupdate",
      "run",
      "--token",
      this.config.token,
      "--url",
      `http://localhost:${this.config.port}`,
    ];

    return new Promise((resolve, reject) => {
      this.tunnelProcess = spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";

      this.tunnelProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        stdoutBuffer += output;

        // Look for tunnel URL in output
        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !this.tunnelUrl) {
          this.tunnelUrl = urlMatch[0];
          console.log(`[CloudflareTunnel] Detected tunnel URL: ${this.tunnelUrl}`);
        }

        // Check for successful connection
        if (output.includes("Connection registered") || output.includes("Tunnel started")) {
          resolve();
        }
      });

      this.tunnelProcess.stderr?.on("data", (data) => {
        const error = data.toString();
        stderrBuffer += error;

        // Log non-critical errors
        if (!error.includes("INFO")) {
          console.error("[CloudflareTunnel] Error:", error);
        }

        // Check for fatal errors
        if (error.includes("failed to authenticate") || error.includes("Invalid token")) {
          reject(new Error("Invalid Cloudflare token"));
        }
      });

      this.tunnelProcess.on("error", (error) => {
        console.error("[CloudflareTunnel] Process error:", error);
        reject(error);
      });

      this.tunnelProcess.on("exit", (code, signal) => {
        if (!this.isShuttingDown) {
          const message = `Tunnel process exited unexpectedly (code: ${code}, signal: ${signal})`;
          console.error(`[CloudflareTunnel] ${message}`);
          this.status.active = false;
          this.emit("disconnected", message);

          // Attempt to restart if not shutting down
          if (this.retryCount < this.config.retryAttempts!) {
            this.retryCount++;
            console.log(`[CloudflareTunnel] Auto-restarting tunnel (${this.retryCount}/${this.config.retryAttempts})...`);
            setTimeout(() => this.start(), this.config.retryDelay);
          }
        }
      });

      // Set a timeout for initial connection
      setTimeout(() => {
        if (!this.tunnelUrl) {
          reject(new Error("Timeout waiting for tunnel to establish"));
        }
      }, 30000);
    });
  }

  /**
   * Wait for tunnel URL to be available
   */
  private async waitForTunnelUrl(timeout: number = 30000): Promise<void> {
    const startTime = Date.now();

    while (!this.tunnelUrl) {
      if (Date.now() - startTime > timeout) {
        throw new Error("Timeout waiting for tunnel URL");
      }

      await this.delay(100);
    }
  }

  /**
   * Stop the Cloudflare tunnel
   */
  async stop(): Promise<void> {
    if (!this.status.active || !this.tunnelProcess) {
      return;
    }

    this.isShuttingDown = true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log("[CloudflareTunnel] Force killing tunnel process...");
        this.tunnelProcess?.kill("SIGKILL");
        resolve();
      }, 5000);

      this.tunnelProcess.once("exit", () => {
        clearTimeout(timeout);
        this.status.active = false;
        this.tunnelUrl = undefined;
        this.emit("disconnected", "Tunnel stopped");
        resolve();
      });

      console.log("[CloudflareTunnel] Stopping tunnel...");
      this.tunnelProcess.kill("SIGTERM");
    });
  }

  /**
   * Get the tunnel URL
   */
  getUrl(): string | undefined {
    return this.tunnelUrl;
  }

  /**
   * Get tunnel status
   */
  getStatus(): TunnelStatus {
    return { ...this.status, url: this.tunnelUrl };
  }

  /**
   * Check if tunnel is active
   */
  isActive(): boolean {
    return this.status.active && !!this.tunnelUrl;
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}