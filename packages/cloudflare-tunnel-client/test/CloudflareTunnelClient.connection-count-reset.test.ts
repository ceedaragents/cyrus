import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock cloudflared before any imports
vi.mock("cloudflared");
vi.mock("node:fs");

describe("CloudflareTunnelClient - Connection Count Reset", () => {
	let CloudflareTunnelClient: any;
	let mockTunnelInstance: EventEmitter;
	let mockTunnel: any;
	let consoleLogSpy: any;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Create a fresh mock tunnel instance
		mockTunnelInstance = new EventEmitter();

		// Mock the Tunnel class
		mockTunnel = {
			withToken: vi.fn(() => mockTunnelInstance),
		};

		// Setup cloudflared mock
		const cloudflared = await import("cloudflared");
		vi.mocked(cloudflared).Tunnel = mockTunnel;
		vi.mocked(cloudflared).bin = "/mock/path/to/cloudflared";
		vi.mocked(cloudflared).install = vi.fn().mockResolvedValue(undefined);

		// Setup fs mock
		const fs = await import("node:fs");
		vi.mocked(fs).existsSync = vi.fn().mockReturnValue(true);

		// Now import the class
		const module = await import("../src/CloudflareTunnelClient.js");
		CloudflareTunnelClient = module.CloudflareTunnelClient;

		// Setup console spy
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should reset connection count when tunnel disconnects and reconnects", async () => {
		// Create client
		const client = new CloudflareTunnelClient("test-token", 3000);

		// Start tunnel (don't await yet, we need to emit events)
		const startPromise = client.startTunnel();

		// Emit initial events to establish tunnel
		mockTunnelInstance.emit("url", "https://test-tunnel.trycloudflare.com");
		mockTunnelInstance.emit("connected", { id: "conn-1", ip: "198.41.200.1" });

		// Wait for tunnel to connect
		await startPromise;

		// Clear initial logs
		consoleLogSpy.mockClear();

		// Simulate 3 more connections (for total of 4)
		mockTunnelInstance.emit("connected", { id: "conn-2", ip: "198.41.200.2" });
		mockTunnelInstance.emit("connected", { id: "conn-3", ip: "198.41.200.3" });
		mockTunnelInstance.emit("connected", { id: "conn-4", ip: "198.41.200.4" });

		// Verify initial connections logged correctly
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 2/4 established"),
			expect.any(Object),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 3/4 established"),
			expect.any(Object),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 4/4 established"),
			expect.any(Object),
		);

		// Simulate tunnel disconnect
		mockTunnelInstance.emit("exit", 0);

		// Wait for disconnect to process
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Clear logs before reconnection
		consoleLogSpy.mockClear();

		// Simulate tunnel auto-reconnection with 4 new connections
		// BUG: Without a fix, these will show 5/4, 6/4, 7/4, 8/4
		// After fix, they should show 1/4, 2/4, 3/4, 4/4
		mockTunnelInstance.emit("connected", { id: "conn-5", ip: "198.41.200.5" });
		mockTunnelInstance.emit("connected", { id: "conn-6", ip: "198.41.200.6" });
		mockTunnelInstance.emit("connected", { id: "conn-7", ip: "198.41.200.7" });
		mockTunnelInstance.emit("connected", { id: "conn-8", ip: "198.41.200.8" });

		// These assertions will FAIL with current implementation
		// because connectionCount is never reset on disconnect
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 1/4 established"),
			expect.any(Object),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 2/4 established"),
			expect.any(Object),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 3/4 established"),
			expect.any(Object),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 4/4 established"),
			expect.any(Object),
		);

		// Should NOT see 5/4, 6/4, 7/4, 8/4
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("connection 5/4"),
			expect.any(Object),
		);
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("connection 6/4"),
			expect.any(Object),
		);
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("connection 7/4"),
			expect.any(Object),
		);
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("connection 8/4"),
			expect.any(Object),
		);
	});

	it("should track connection count correctly for initial connection", async () => {
		// Create client
		const client = new CloudflareTunnelClient("test-token", 3000);

		// Start tunnel
		const startPromise = client.startTunnel();

		// Emit initial events
		mockTunnelInstance.emit("url", "https://test-tunnel.trycloudflare.com");
		mockTunnelInstance.emit("connected", { id: "conn-1", ip: "198.41.200.1" });

		await startPromise;

		// Clear initial logs
		consoleLogSpy.mockClear();

		// Emit 3 more connections
		mockTunnelInstance.emit("connected", { id: "conn-2", ip: "198.41.200.2" });
		mockTunnelInstance.emit("connected", { id: "conn-3", ip: "198.41.200.3" });
		mockTunnelInstance.emit("connected", { id: "conn-4", ip: "198.41.200.4" });

		// Verify all connections logged correctly
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 2/4 established"),
			expect.any(Object),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 3/4 established"),
			expect.any(Object),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("connection 4/4 established"),
			expect.any(Object),
		);
	});
});
