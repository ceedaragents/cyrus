import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the cloudflared module
vi.mock("cloudflared", () => {
	// Need to import EventEmitter in the factory
	const { EventEmitter } = require("node:events");

	class MockTunnel extends EventEmitter {
		static withToken(_token: string) {
			return new MockTunnel();
		}
	}

	return {
		Tunnel: MockTunnel,
		bin: "/mock/path/to/cloudflared",
		install: vi.fn().mockResolvedValue(undefined),
	};
});

// Mock fs module
vi.mock("node:fs", () => ({
	existsSync: vi.fn().mockReturnValue(true),
}));

import { CloudflareTunnelClient } from "../src/CloudflareTunnelClient.js";

describe("CloudflareTunnelClient", () => {
	let client: CloudflareTunnelClient;
	const mockToken = "mock-cloudflare-token";
	const mockPort = 3456;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (client) {
			client.disconnect();
		}
	});

	describe("connection count tracking", () => {
		it("should reset connection count to 0 when tunnel exits and reconnects", async () => {
			client = new CloudflareTunnelClient(mockToken, mockPort);

			// Track connection logs
			const connectionLogs: string[] = [];
			const originalLog = console.log;
			console.log = vi.fn((...args: any[]) => {
				const message = args.join(" ");
				if (message.includes("Cloudflare tunnel connection")) {
					connectionLogs.push(message);
				}
			});

			// Import Tunnel to access the mock instance
			const { Tunnel } = await import("cloudflared");
			let tunnelInstance: EventEmitter;

			// Capture the tunnel instance when startTunnel is called
			const originalWithToken = Tunnel.withToken;
			Tunnel.withToken = vi.fn((token: string) => {
				tunnelInstance = originalWithToken(token);
				return tunnelInstance;
			});

			// Start the tunnel
			const startPromise = client.startTunnel();

			// Wait for tunnel instance to be created
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Simulate initial 4 connections
			tunnelInstance!.emit("url", "https://test.trycloudflare.com");
			for (let i = 0; i < 4; i++) {
				tunnelInstance!.emit("connected", {
					id: `connection-${i}`,
					ip: "198.41.200.193",
					location: "sea07",
				});
			}

			// Wait for client to be connected
			await startPromise;

			// Verify initial connections logged correctly
			expect(connectionLogs).toEqual([
				expect.stringContaining(
					"Cloudflare tunnel connection 1/4 established:",
				),
				expect.stringContaining(
					"Cloudflare tunnel connection 2/4 established:",
				),
				expect.stringContaining(
					"Cloudflare tunnel connection 3/4 established:",
				),
				expect.stringContaining(
					"Cloudflare tunnel connection 4/4 established:",
				),
			]);

			// Clear logs for next phase
			connectionLogs.length = 0;

			// Simulate tunnel exit (e.g., network interruption)
			tunnelInstance!.emit("exit", 0);

			// Verify client is no longer connected
			expect(client.isConnected()).toBe(false);

			// Simulate tunnel auto-reconnect with 4 new connections
			// This mimics Cloudflare's automatic reconnection behavior
			tunnelInstance!.emit("url", "https://test.trycloudflare.com");
			for (let i = 0; i < 4; i++) {
				tunnelInstance!.emit("connected", {
					id: `reconnection-${i}`,
					ip: "198.41.192.77",
					location: "yvr01",
				});
			}

			// THE BUG: Connection count should reset to 1-4, but instead shows 5-8
			// Expected behavior: ["1/4", "2/4", "3/4", "4/4"]
			// Actual behavior:   ["5/4", "6/4", "7/4", "8/4"]
			expect(connectionLogs).toEqual([
				expect.stringContaining(
					"Cloudflare tunnel connection 1/4 established:",
				),
				expect.stringContaining(
					"Cloudflare tunnel connection 2/4 established:",
				),
				expect.stringContaining(
					"Cloudflare tunnel connection 3/4 established:",
				),
				expect.stringContaining(
					"Cloudflare tunnel connection 4/4 established:",
				),
			]);

			// Restore console.log
			console.log = originalLog;
		});

		it("should emit correct number of connected events on reconnect", async () => {
			client = new CloudflareTunnelClient(mockToken, mockPort);

			// Track connected events
			let connectedEventCount = 0;
			client.on("connected", () => {
				connectedEventCount++;
			});

			// Import Tunnel to access the mock instance
			const { Tunnel } = await import("cloudflared");
			let tunnelInstance: EventEmitter;

			// Capture the tunnel instance
			const originalWithToken = Tunnel.withToken;
			Tunnel.withToken = vi.fn((token: string) => {
				tunnelInstance = originalWithToken(token);
				return tunnelInstance;
			});

			// Start the tunnel
			const startPromise = client.startTunnel();

			// Wait for tunnel instance to be created
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Simulate initial 4 connections
			tunnelInstance!.emit("url", "https://test.trycloudflare.com");
			for (let i = 0; i < 4; i++) {
				tunnelInstance!.emit("connected", { id: `connection-${i}` });
			}

			await startPromise;

			// Should have 4 connected events
			expect(connectedEventCount).toBe(4);

			// Simulate exit and reconnect
			tunnelInstance!.emit("exit", 0);
			connectedEventCount = 0; // Reset counter for reconnect phase

			// Reconnect with 4 new connections
			for (let i = 0; i < 4; i++) {
				tunnelInstance!.emit("connected", { id: `reconnection-${i}` });
			}

			// Should have exactly 4 new connected events (not accumulating)
			expect(connectedEventCount).toBe(4);
		});
	});

	describe("connection state management", () => {
		it("should set connected to false on tunnel exit", async () => {
			client = new CloudflareTunnelClient(mockToken, mockPort);

			const { Tunnel } = await import("cloudflared");
			let tunnelInstance: EventEmitter;

			const originalWithToken = Tunnel.withToken;
			Tunnel.withToken = vi.fn((token: string) => {
				tunnelInstance = originalWithToken(token);
				return tunnelInstance;
			});

			const startPromise = client.startTunnel();
			await new Promise((resolve) => setTimeout(resolve, 10));

			tunnelInstance!.emit("url", "https://test.trycloudflare.com");
			tunnelInstance!.emit("connected", { id: "connection-1" });

			await startPromise;

			expect(client.isConnected()).toBe(true);

			tunnelInstance!.emit("exit", 0);

			expect(client.isConnected()).toBe(false);
		});

		it("should emit disconnect event on tunnel exit", async () => {
			client = new CloudflareTunnelClient(mockToken, mockPort);

			let disconnectReason: string | null = null;
			client.on("disconnect", (reason: string) => {
				disconnectReason = reason;
			});

			const { Tunnel } = await import("cloudflared");
			let tunnelInstance: EventEmitter;

			const originalWithToken = Tunnel.withToken;
			Tunnel.withToken = vi.fn((token: string) => {
				tunnelInstance = originalWithToken(token);
				return tunnelInstance;
			});

			const startPromise = client.startTunnel();
			await new Promise((resolve) => setTimeout(resolve, 10));

			tunnelInstance!.emit("url", "https://test.trycloudflare.com");
			tunnelInstance!.emit("connected", { id: "connection-1" });

			await startPromise;

			tunnelInstance!.emit("exit", 42);

			expect(disconnectReason).toBe("Tunnel process exited with code 42");
		});
	});
});
