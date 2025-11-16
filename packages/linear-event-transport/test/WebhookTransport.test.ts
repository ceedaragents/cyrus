import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookTransport } from "../src/transports/WebhookTransport";
import type { LinearWebhookClientConfig } from "../src/types";

// Mock fetch globally
global.fetch = vi.fn();

describe("WebhookTransport", () => {
	let transport: WebhookTransport;
	let config: LinearWebhookClientConfig;

	beforeEach(() => {
		vi.clearAllMocks();

		config = {
			proxyUrl: "https://proxy.test",
			token: "test-token-123",
			transport: "webhook",
			webhookPort: 3000,
			webhookPath: "/webhook",
			webhookHost: "localhost",
		};
	});

	afterEach(() => {
		if (transport) {
			transport.disconnect();
		}
	});

	describe("constructor", () => {
		it("should initialize with config", () => {
			transport = new WebhookTransport(config);
			expect(transport).toBeDefined();
			expect(transport.isConnected()).toBe(false);
		});

		it("should use webhookBaseUrl when provided", () => {
			const configWithBaseUrl = {
				...config,
				webhookBaseUrl: "https://abc123.ngrok.io",
			};
			transport = new WebhookTransport(configWithBaseUrl);
			expect(transport).toBeDefined();
		});
	});

	describe("webhook URL construction", () => {
		it("should construct URL from parts when no webhookBaseUrl", () => {
			transport = new WebhookTransport(config);
			// We can't directly test the private webhookUrl property,
			// but we can test that the transport initializes correctly
			expect(transport.isConnected()).toBe(false);
		});

		it("should use webhookBaseUrl when provided", () => {
			const configWithBaseUrl = {
				...config,
				webhookBaseUrl: "https://abc123.ngrok.io",
				webhookPath: "/custom-webhook",
			};
			transport = new WebhookTransport(configWithBaseUrl);
			expect(transport.isConnected()).toBe(false);
		});
	});

	describe("sendStatus", () => {
		it("should send status update successfully", async () => {
			const mockFetch = global.fetch as any;
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
			});

			transport = new WebhookTransport(config);

			await transport.sendStatus({
				eventId: "test-event-123",
				status: "completed",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"https://proxy.test/events/status",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer test-token-123",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						eventId: "test-event-123",
						status: "completed",
					}),
				}),
			);
		});

		it("should handle status update failure", async () => {
			const mockFetch = global.fetch as any;
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
			});

			transport = new WebhookTransport(config);
			const errorListener = vi.fn();
			transport.on("error", errorListener);

			await transport.sendStatus({
				eventId: "test-event-123",
				status: "failed",
			});

			expect(errorListener).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Failed to send status: 500",
				}),
			);
		});
	});
});
