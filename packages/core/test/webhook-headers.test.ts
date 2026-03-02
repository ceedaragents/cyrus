import { describe, expect, it } from "vitest";
import {
	ChatSDKWebhookHeaders,
	GitHubWebhookHeaders,
	LinearWebhookHeaders,
	SlackWebhookHeaders,
} from "../src/webhook-headers.js";

describe("webhook header parsers", () => {
	it("parses GitHub proxied headers through the shared alias map", () => {
		const headers = {
			authorization: "Bearer secret-token",
			"x-event-type": "issue_comment",
			"x-cyhost-delivery-id": "delivery-123",
			"x-cyhost-github-installation-token": "ghs_installation_proxy",
			"x-cyhost-github-signature": "sha256=abc",
		};

		const parser = new GitHubWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.authorization).toBe("Bearer secret-token");
		expect(parsed.authorizationToken).toBe("secret-token");
		expect(parsed.type).toBe("issue_comment");
		expect(parsed.eventType).toBe("issue_comment");
		expect(parsed.deliveryId).toBe("delivery-123");
		expect(parsed.installationToken).toBe("ghs_installation_proxy");
		expect(parsed.signature).toBe("sha256=abc");
		expect(parser.provider).toBe("github");
	});

	it("parses Slack envelope and workspace identifiers", () => {
		const headers = {
			authorization: "Bearer slack-token",
			"x-event-type": "event_callback",
			"x-event-id": "Ev-proxy-999",
			"x-slack-team-id": "T999",
		};

		const parser = new SlackWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.authorization).toBe("Bearer slack-token");
		expect(parsed.authorizationToken).toBe("slack-token");
		expect(parsed.type).toBe("event_callback");
		expect(parsed.envelopeEventId).toBe("Ev-proxy-999");
		expect(parsed.teamId).toBe("T999");
		expect(parser.provider).toBe("slack");
	});

	it("supports generic proxied type headers for Slack", () => {
		const headers = {
			authorization: "Bearer slack-token",
			"x-event-type": "event_callback",
			"x-event-id": "Ev-proxy-123",
			"x-team-id": "T999",
		};

		const parser = new SlackWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.type).toBe("event_callback");
		expect(parsed.envelopeType).toBe("event_callback");
		expect(parsed.envelopeEventId).toBe("Ev-proxy-123");
		expect(parsed.teamId).toBeUndefined();
		expect(parser.provider).toBe("slack");
	});

	it("extracts Slack bot token from proxied Slack headers", () => {
		const headers = {
			authorization: "Bearer slack-token",
			"x-slack-bot-token": "xoxb-proxy-bot-token",
		};

		const parser = new SlackWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.authorizationToken).toBe("slack-token");
		expect(parsed.slackBotToken).toBe("xoxb-proxy-bot-token");
	});

	it("supports direct and proxied Chat SDK style headers", () => {
		const headers = {
			"x-chat-authorization": "Bearer chat-sdk-token",
			"x-chat-event-type": "message.created",
			"x-chat-event-id": "chat-evt-1",
			"x-chat-team-id": "chat-team",
		};

		const parser = new ChatSDKWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.authorizationToken).toBe("chat-sdk-token");
		expect(parsed.eventType).toBe("message.created");
		expect(parsed.envelopeEventId).toBe("chat-evt-1");
		expect(parsed.teamId).toBe("chat-team");
		expect(parser.provider).toBe("chat-sdk");
	});

	it("parses linear signatures", () => {
		const headers = {
			"x-cyrus-linear-signature": "sha256=linear",
			authorization: "Bearer linear-token",
		};

		const parser = new LinearWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.signature).toBe("sha256=linear");
		expect(parsed.authorizationToken).toBe("linear-token");
		expect(parsed.type).toBeUndefined();
		expect(parser.provider).toBe("linear");
	});

	it("supports proxied linear event-type aliases as metadata", () => {
		const headers = {
			authorization: "Bearer linear-token",
			"x-event-type": "AgentSessionEvent",
		};

		const parser = new LinearWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.type).toBe("AgentSessionEvent");
		expect(parsed.eventType).toBe("AgentSessionEvent");
		expect(parsed.authorizationToken).toBe("linear-token");
		expect(parser.provider).toBe("linear");
	});

	it("extracts Linear API token from proxied Linear headers", () => {
		const headers = {
			"x-linear-api-token": "linear-api-token-123",
			"x-event-type": "AgentSessionEvent",
		};

		const parser = new LinearWebhookHeaders(headers);
		const parsed = parser.parse();

		expect(parsed.linearApiToken).toBe("linear-api-token-123");
		expect(parsed.eventType).toBe("AgentSessionEvent");
	});
});
