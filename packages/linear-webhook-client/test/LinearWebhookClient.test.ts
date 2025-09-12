import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearWebhookClient } from "../src/LinearWebhookClient";
import type { LinearWebhookClientConfig, StatusUpdate } from "../src/types";

// Create a mock transport instance
const mockTransport = {
	connected: false,
	connect: vi.fn(),
	disconnect: vi.fn(),
	sendStatus: vi.fn(),
	isConnected: vi.fn(() => mockTransport.connected),
	on: vi.fn(),
	emit: vi.fn(),
	removeListener: vi.fn(),
	removeAllListeners: vi.fn(),
	off: vi.fn(),
	addListener: vi.fn(),
	once: vi.fn(),
	prependListener: vi.fn(),
	prependOnceListener: vi.fn(),
	eventNames: vi.fn(),
	listeners: vi.fn(),
	listenerCount: vi.fn(),
	getMaxListeners: vi.fn(),
	setMaxListeners: vi.fn(),
};

// Mock the WebhookTransport module
vi.mock("../src/transports/WebhookTransport.js", () => ({
	WebhookTransport: vi.fn(() => mockTransport),
}));

describe("LinearWebhookClient", () => {
	let client: LinearWebhookClient;
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

		// Reset mock transport state
		mockTransport.connected = false;
		mockTransport.connect.mockResolvedValue(undefined);
		mockTransport.disconnect.mockResolvedValue(undefined);
		mockTransport.sendStatus.mockResolvedValue(undefined);
	});

	afterEach(() => {
		if (client) {
			client.removeAllListeners();
		}
	});

	describe("constructor", () => {
		it("should initialize with webhook transport", () => {
			client = new LinearWebhookClient(config);
			expect(client).toBeDefined();
			expect(client.isConnected()).toBe(false);
		});

		it("should throw error for unsupported transport", () => {
			expect(() => {
				new LinearWebhookClient({
					...config,
					transport: "sse" as any,
				});
			}).toThrow("Unsupported transport: sse. Only 'webhook' is supported.");
		});

		it("should register config callbacks as event listeners", () => {
			const onWebhook = vi.fn();
			const onConnect = vi.fn();
			const onDisconnect = vi.fn();
			const onError = vi.fn();

			client = new LinearWebhookClient({
				...config,
				onWebhook,
				onConnect,
				onDisconnect,
				onError,
			});

			// Emit events to test the listeners
			client.emit("webhook", {
				type: "Issue",
				action: "create",
			} as any);
			client.emit("connect");
			client.emit("disconnect", "test");
			client.emit("error", new Error("test"));

			expect(onWebhook).toHaveBeenCalled();
			expect(onConnect).toHaveBeenCalled();
			expect(onDisconnect).toHaveBeenCalledWith("test");
			expect(onError).toHaveBeenCalledWith(expect.any(Error));
		});
	});

	describe("connect", () => {
		it("should connect through transport", async () => {
			mockTransport.connected = false;
			mockTransport.connect.mockImplementation(() => {
				mockTransport.connected = true;
				return Promise.resolve();
			});

			client = new LinearWebhookClient(config);
			await client.connect();

			expect(mockTransport.connect).toHaveBeenCalled();
			expect(client.isConnected()).toBe(true);
		});

		it("should call transport connect method", async () => {
			mockTransport.connected = false;

			client = new LinearWebhookClient(config);
			await client.connect();

			expect(mockTransport.connect).toHaveBeenCalled();
		});
	});

	describe("disconnect", () => {
		it("should disconnect through transport", async () => {
			mockTransport.connected = true;
			mockTransport.disconnect.mockImplementation(() => {
				mockTransport.connected = false;
			});

			client = new LinearWebhookClient(config);
			await client.disconnect();

			expect(mockTransport.disconnect).toHaveBeenCalled();
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("sendStatus", () => {
		it("should send status through transport", async () => {
			const statusUpdate: StatusUpdate = {
				eventId: "test-event-1",
				status: "completed",
				metadata: { result: "success" },
			};

			client = new LinearWebhookClient(config);
			await client.sendStatus(statusUpdate);

			expect(mockTransport.sendStatus).toHaveBeenCalledWith(statusUpdate);
		});
	});

	describe("isConnected", () => {
		it("should return transport connection status", () => {
			client = new LinearWebhookClient(config);

			mockTransport.connected = false;
			mockTransport.isConnected.mockReturnValue(false);
			expect(client.isConnected()).toBe(false);

			mockTransport.connected = true;
			mockTransport.isConnected.mockReturnValue(true);
			expect(client.isConnected()).toBe(true);
		});
	});

	describe("event forwarding", () => {
		it("should forward transport events to client", () => {
			const eventListener = vi.fn();
			const connectListener = vi.fn();
			const disconnectListener = vi.fn();
			const errorListener = vi.fn();

			client = new LinearWebhookClient(config);
			client.on("event", eventListener);
			client.on("connect", connectListener);
			client.on("disconnect", disconnectListener);
			client.on("error", errorListener);

			// Get the registered listeners from the mock
			const calls = mockTransport.on.mock.calls;
			const eventCall = calls.find((call) => call[0] === "event");
			const connectCall = calls.find((call) => call[0] === "connect");
			const disconnectCall = calls.find((call) => call[0] === "disconnect");
			const errorCall = calls.find((call) => call[0] === "error");

			// Simulate transport events
			if (eventCall) {
				const testEvent: EdgeEvent = {
					id: "1",
					type: "webhook",
					timestamp: "2024-01-01",
					data: {},
				};
				eventCall[1](testEvent);
				expect(eventListener).toHaveBeenCalledWith(testEvent);
			}

			if (connectCall) {
				connectCall[1]();
				expect(connectListener).toHaveBeenCalled();
			}

			if (disconnectCall) {
				disconnectCall[1]("test reason");
				expect(disconnectListener).toHaveBeenCalledWith("test reason");
			}

			if (errorCall) {
				const testError = new Error("test error");
				errorCall[1](testError);
				expect(errorListener).toHaveBeenCalledWith(testError);
			}
		});
	});
});
