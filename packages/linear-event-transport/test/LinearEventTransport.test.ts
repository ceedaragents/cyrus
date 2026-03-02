import {
	LinearWebhookClient,
	type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearEventTransport } from "../src/LinearEventTransport.js";
import type { LinearEventTransportConfig } from "../src/types.js";

type MockReply = {
	code: ReturnType<typeof vi.fn>;
	send: ReturnType<typeof vi.fn>;
};

function createMockFastify() {
	const routes: Record<
		string,
		(request: unknown, reply: unknown) => Promise<void>
	> = {};
	return {
		post: vi.fn(
			(
				path: string,
				handler: (request: unknown, reply: unknown) => Promise<void>,
			) => {
				routes[path] = handler;
			},
		),
		routes,
	};
}

function createMockRequest(
	body: unknown,
	headers: Record<string, string> = {},
) {
	return {
		body,
		headers,
	};
}

function createMockReply(): MockReply {
	return {
		code: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
	};
}

const sampleLinearPayload = {
	type: "AgentSessionEvent",
	action: "created",
	organizationId: "org-123",
	createdAt: "2025-01-27T12:00:00Z",
	agentSession: {
		id: "session-123",
		status: "processing",
		type: "delegation",
		issue: {
			id: "issue-123",
			identifier: "DEF-123",
			title: "Test Issue",
			description: "Test description",
			url: "https://linear.app/test/DEF-123",
			team: {
				id: "team-123",
				name: "Test Team",
				key: "TEST",
			},
		},
		comment: {
			id: "comment-123",
			body: "Please work on this",
			user: {
				id: "user-123",
				name: "Test User",
			},
		},
	},
	guidance: [],
} as unknown as LinearWebhookPayload;

describe("LinearEventTransport", () => {
	let mockFastify: ReturnType<typeof createMockFastify>;
	const testSecret = "test-webhook-secret-123";

	beforeEach(() => {
		vi.clearAllMocks();
		mockFastify = createMockFastify();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("register", () => {
		it("registers POST /webhook endpoint in proxy mode", () => {
			const config: LinearEventTransportConfig = {
				fastifyServer:
					mockFastify as unknown as LinearEventTransportConfig["fastifyServer"],
				verificationMode: "proxy",
				secret: testSecret,
			};

			const transport = new LinearEventTransport(config);
			transport.register();

			expect(mockFastify.post).toHaveBeenCalledWith(
				"/webhook",
				expect.any(Function),
			);
		});

		it("registers POST /webhook endpoint in direct mode", () => {
			const config: LinearEventTransportConfig = {
				fastifyServer:
					mockFastify as unknown as LinearEventTransportConfig["fastifyServer"],
				verificationMode: "direct",
				secret: testSecret,
			};

			const transport = new LinearEventTransport(config);
			transport.register();

			expect(mockFastify.post).toHaveBeenCalledWith(
				"/webhook",
				expect.any(Function),
			);
		});
	});

	describe("proxy mode verification", () => {
		let transport: LinearEventTransport;

		beforeEach(() => {
			const config: LinearEventTransportConfig = {
				fastifyServer:
					mockFastify as unknown as LinearEventTransportConfig["fastifyServer"],
				verificationMode: "proxy",
				secret: testSecret,
			};
			transport = new LinearEventTransport(config);
			transport.register();
		});

		it("accepts valid Bearer token and emits event", async () => {
			const eventListener = vi.fn();
			const messageListener = vi.fn();
			transport.on("event", eventListener);
			transport.on("message", messageListener);

			const request = createMockRequest(sampleLinearPayload, {
				authorization: `Bearer ${testSecret}`,
			});
			const reply = createMockReply();

			const handler = mockFastify.routes["/webhook"]!;
			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(200);
			expect(reply.send).toHaveBeenCalledWith({ success: true });
			expect(eventListener).toHaveBeenCalledWith(sampleLinearPayload);
			expect(messageListener).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "session_start",
					source: "linear",
					workItemId: "issue-123",
				}),
			);
		});
	});

	describe("direct mode verification", () => {
		let transport: LinearEventTransport;
		let verifySpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			const config: LinearEventTransportConfig = {
				fastifyServer:
					mockFastify as unknown as LinearEventTransportConfig["fastifyServer"],
				verificationMode: "direct",
				secret: testSecret,
			};
			transport = new LinearEventTransport(config);
			transport.register();
			verifySpy = vi
				.spyOn(LinearWebhookClient.prototype, "verify")
				.mockReturnValue(true);
		});

		it("accepts proxied linear signature header in direct mode", async () => {
			const eventListener = vi.fn();
			transport.on("event", eventListener);

			const request = createMockRequest(sampleLinearPayload, {
				"x-cyrus-linear-signature": "sha256=proxied-signature-789",
			});
			const reply = createMockReply();

			const handler = mockFastify.routes["/webhook"]!;
			await handler(request, reply);

			expect(verifySpy).toHaveBeenCalledTimes(1);
			expect(reply.code).toHaveBeenCalledWith(200);
			expect(reply.send).toHaveBeenCalledWith({ success: true });
			expect(eventListener).toHaveBeenCalledWith(sampleLinearPayload);
		});
	});
});
