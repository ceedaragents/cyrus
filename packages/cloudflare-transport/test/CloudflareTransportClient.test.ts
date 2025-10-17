import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CloudflareTransportClient } from "../src/CloudflareTransportClient.js";
import { ConfigManager } from "../src/ConfigManager.js";

describe("CloudflareTransportClient", () => {
	let tempDir: string;
	let client: CloudflareTransportClient;

	beforeEach(async () => {
		// Create temporary directory for test configuration
		tempDir = await mkdtemp(join(tmpdir(), "cyrus-test-"));
	});

	afterEach(async () => {
		// Clean up
		if (client) {
			await client.stop();
		}
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	describe("Constructor", () => {
		it("should initialize with provided configuration", () => {
			client = new CloudflareTransportClient({
				cyrusHome: tempDir,
				customerId: "test-customer",
				authKey: "test-auth-key",
				port: 4567,
			});

			expect(client).toBeDefined();
			expect(client.getConfig().customerId).toBe("test-customer");
		});

		it("should generate auth key if not provided", () => {
			client = new CloudflareTransportClient({
				cyrusHome: tempDir,
			});

			const config = client.getConfig();
			expect(config.authKey).toBeDefined();
			expect(config.authKey?.length).toBeGreaterThan(0);
		});
	});

	describe("Configuration Management", () => {
		it("should persist customer ID", () => {
			client = new CloudflareTransportClient({
				cyrusHome: tempDir,
				customerId: "test-customer-123",
			});

			// Create new client with same home directory
			const newClient = new CloudflareTransportClient({
				cyrusHome: tempDir,
			});

			expect(newClient.getConfig().customerId).toBe("test-customer-123");
		});

		it("should update customer ID", () => {
			client = new CloudflareTransportClient({
				cyrusHome: tempDir,
			});

			client.setCustomerId("new-customer-456");
			expect(client.getConfig().customerId).toBe("new-customer-456");
		});
	});

	describe("Tunnel Status", () => {
		it("should return inactive status when not started", () => {
			client = new CloudflareTransportClient({
				cyrusHome: tempDir,
			});

			const status = client.getTunnelStatus();
			expect(status.active).toBe(false);
		});

		it("should not be connected when not started", () => {
			client = new CloudflareTransportClient({
				cyrusHome: tempDir,
			});

			expect(client.isConnected()).toBe(false);
		});
	});
});

describe("ConfigManager", () => {
	let tempDir: string;
	let configManager: ConfigManager;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "cyrus-config-test-"));
		configManager = new ConfigManager(tempDir);
	});

	afterEach(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("should save and load configuration", () => {
		configManager.setCustomerId("test-123");
		configManager.setAuthKey("auth-key-456");

		const newManager = new ConfigManager(tempDir);
		const config = newManager.get();

		expect(config.customerId).toBe("test-123");
		expect(config.authKey).toBe("auth-key-456");
	});

	it("should validate configuration", () => {
		expect(configManager.isValid()).toBe(false);

		configManager.setCustomerId("test-123");
		expect(configManager.isValid()).toBe(false);

		configManager.setAuthKey("auth-key");
		expect(configManager.isValid()).toBe(true);
	});

	it("should report missing fields", () => {
		const missing = configManager.getMissingFields();
		expect(missing).toContain("customerId");
		expect(missing).toContain("authKey");

		configManager.setCustomerId("test");
		const afterCustomer = configManager.getMissingFields();
		expect(afterCustomer).not.toContain("customerId");
		expect(afterCustomer).toContain("authKey");
	});
});
