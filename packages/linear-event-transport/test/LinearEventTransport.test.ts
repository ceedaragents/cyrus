import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearEventTransport } from "../src/LinearEventTransport";
import type { LinearEventTransportConfig, StatusUpdate } from "../src/types";

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

describe("LinearEventTransport", () => {
	let transport: LinearEventTransport;
	let config: LinearEventTransportConfig;

	beforeEach(() => {
		vi.clearAllMocks();

		config = {
			verificationMethod: "hmac",
			webhookSecret: "test-secret-123",
			proxyUrl: "https://proxy.test",
			token: "test-token-123",
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
		if (transport) {
			transport.removeAllListeners();
		}
	});

	describe("constructor", () => {
		it("should initialize with HMAC verification", () => {
			transport = new LinearEventTransport(config);
			expect(transport).toBeDefined();
			expect(transport.isConnected()).toBe(false);
		});

		it("should initialize with Bearer token verification", () => {
			const bearerConfig: LinearEventTransportConfig = {
				verificationMethod: "bearer",
				apiKey: "test-api-key-123",
				proxyUrl: "https://proxy.test",
				token: "test-token-123",
			};
			transport = new LinearEventTransport(bearerConfig);
			expect(transport).toBeDefined();
			expect(transport.isConnected()).toBe(false);
		});

		it("should throw error for missing verificationMethod", () => {
			expect(() => {
				new LinearEventTransport({
					webhookPort: 3000,
				} as any);
			}).toThrow("verificationMethod is required in config");
		});

		it("should register config callbacks as event listeners", () => {
			const onWebhook = vi.fn();
			const onConnect = vi.fn();
			const onDisconnect = vi.fn();
			const onError = vi.fn();

			transport = new LinearEventTransport({
				...config,
				onWebhook,
				onConnect,
				onDisconnect,
				onError,
			});

			// Emit events to test the listeners
			transport.emit("webhook", {
				type: "Issue",
				action: "create",
			} as any);
			transport.emit("connect");
			transport.emit("disconnect", "test");
			transport.emit("error", new Error("test"));

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

			transport = new LinearEventTransport(config);
			await transport.connect();

			expect(mockTransport.connect).toHaveBeenCalled();
			expect(transport.isConnected()).toBe(true);
		});

		it("should call transport connect method", async () => {
			mockTransport.connected = false;

			transport = new LinearEventTransport(config);
			await transport.connect();

			expect(mockTransport.connect).toHaveBeenCalled();
		});
	});

	describe("disconnect", () => {
		it("should disconnect through transport", async () => {
			mockTransport.connected = true;
			mockTransport.disconnect.mockImplementation(() => {
				mockTransport.connected = false;
			});

			transport = new LinearEventTransport(config);
			await transport.disconnect();

			expect(mockTransport.disconnect).toHaveBeenCalled();
			expect(transport.isConnected()).toBe(false);
		});
	});

	describe("sendStatus", () => {
		it("should send status through transport", async () => {
			const statusUpdate: StatusUpdate = {
				eventId: "test-event-1",
				status: "completed",
				metadata: { result: "success" },
			};

			transport = new LinearEventTransport(config);
			await transport.sendStatus(statusUpdate);

			expect(mockTransport.sendStatus).toHaveBeenCalledWith(statusUpdate);
		});
	});

	describe("isConnected", () => {
		it("should return transport connection status", () => {
			transport = new LinearEventTransport(config);

			mockTransport.connected = false;
			mockTransport.isConnected.mockReturnValue(false);
			expect(transport.isConnected()).toBe(false);

			mockTransport.connected = true;
			mockTransport.isConnected.mockReturnValue(true);
			expect(transport.isConnected()).toBe(true);
		});
	});

	describe("event forwarding", () => {
		it("should forward transport events to client", () => {
			const webhookListener = vi.fn();
			const connectListener = vi.fn();
			const disconnectListener = vi.fn();
			const errorListener = vi.fn();

			transport = new LinearEventTransport(config);
			transport.on("webhook", webhookListener);
			transport.on("connect", connectListener);
			transport.on("disconnect", disconnectListener);
			transport.on("error", errorListener);

			// Get the registered listeners from the mock
			const calls = mockTransport.on.mock.calls;
			const webhookCall = calls.find((call) => call[0] === "webhook");
			const connectCall = calls.find((call) => call[0] === "connect");
			const disconnectCall = calls.find((call) => call[0] === "disconnect");
			const errorCall = calls.find((call) => call[0] === "error");

			// Simulate transport events
			if (webhookCall) {
				const testPayload = {
					type: "Issue",
					action: "create",
					data: {},
				};
				webhookCall[1](testPayload);
				expect(webhookListener).toHaveBeenCalledWith(testPayload);
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
