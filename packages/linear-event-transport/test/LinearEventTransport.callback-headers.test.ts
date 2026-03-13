import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LinearEventTransport } from "../src/LinearEventTransport.js";

/**
 * Helper: create a transport, suppress event/error listeners (we only test header extraction),
 * and return the registered transport instance.
 */
function createTransport(fastify: ReturnType<typeof Fastify>) {
	const transport = new LinearEventTransport({
		fastifyServer: fastify,
		verificationMode: "proxy",
		secret: "test-api-key",
	});
	// Suppress unhandled EventEmitter errors from minimal test payloads
	transport.on("event", () => {});
	transport.on("error", () => {});
	transport.register();
	return transport;
}

/** Minimal valid AgentSessionEvent payload for testing */
const minimalPayload = {
	type: "AgentSessionEvent",
	action: "created",
	organizationId: "org-1",
	agentSession: {
		id: "session-1",
		issue: { id: "issue-1", identifier: "TEST-1" },
	},
};

describe("LinearEventTransport callback header extraction", () => {
	let fastify: ReturnType<typeof Fastify>;

	beforeEach(async () => {
		fastify = Fastify();
	});

	afterEach(async () => {
		await fastify.close();
	});

	it("extracts callback context from CYHOST headers in proxy mode", async () => {
		const transport = createTransport(fastify);
		await fastify.ready();

		const response = await fastify.inject({
			method: "POST",
			url: "/webhook",
			headers: {
				authorization: "Bearer test-api-key",
				"x-cyrus-callback-token": "cb-token-123",
				"x-cyrus-callback-url":
					"https://cyhost.example.com/api/telemetry/callback",
				"x-cyrus-team-id": "team-uuid-abc",
			},
			payload: minimalPayload,
		});

		expect(response.statusCode).toBe(200);
		expect(transport.callbackContext).toEqual({
			callbackToken: "cb-token-123",
			callbackUrl: "https://cyhost.example.com/api/telemetry/callback",
			teamId: "team-uuid-abc",
		});
	});

	it("returns null callbackContext when no callback headers present", async () => {
		const transport = createTransport(fastify);
		await fastify.ready();

		await fastify.inject({
			method: "POST",
			url: "/webhook",
			headers: {
				authorization: "Bearer test-api-key",
			},
			payload: minimalPayload,
		});

		expect(transport.callbackContext).toBeNull();
	});

	it("requires all three callback headers to set context", async () => {
		const transport = createTransport(fastify);
		await fastify.ready();

		// Only 2 of 3 headers present
		await fastify.inject({
			method: "POST",
			url: "/webhook",
			headers: {
				authorization: "Bearer test-api-key",
				"x-cyrus-callback-token": "cb-token-123",
				"x-cyrus-callback-url":
					"https://cyhost.example.com/api/telemetry/callback",
				// Missing x-cyrus-team-id
			},
			payload: minimalPayload,
		});

		expect(transport.callbackContext).toBeNull();
	});

	it("captures context only once (idempotent)", async () => {
		const transport = createTransport(fastify);
		await fastify.ready();

		const headers = {
			authorization: "Bearer test-api-key",
			"x-cyrus-callback-token": "first-token",
			"x-cyrus-callback-url": "https://first.example.com/callback",
			"x-cyrus-team-id": "team-1",
		};

		await fastify.inject({
			method: "POST",
			url: "/webhook",
			headers,
			payload: minimalPayload,
		});

		// Second webhook with different token
		await fastify.inject({
			method: "POST",
			url: "/webhook",
			headers: {
				...headers,
				"x-cyrus-callback-token": "second-token",
			},
			payload: minimalPayload,
		});

		// Should still have the first token
		expect(transport.callbackContext!.callbackToken).toBe("first-token");
	});
});
