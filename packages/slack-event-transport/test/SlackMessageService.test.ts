import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackMessageService } from "../src/SlackMessageService.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("SlackMessageService", () => {
	let service: SlackMessageService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new SlackMessageService();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("postMessage", () => {
		it("posts a message to a Slack channel with thread_ts", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ ok: true }),
			});

			await service.postMessage({
				token: "xoxb-test-token",
				channel: "C9876543210",
				text: "Hello from Cyrus!",
				thread_ts: "1704110400.000100",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"https://slack.com/api/chat.postMessage",
				{
					method: "POST",
					headers: {
						Authorization: "Bearer xoxb-test-token",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						channel: "C9876543210",
						text: "Hello from Cyrus!",
						thread_ts: "1704110400.000100",
					}),
				},
			);
		});

		it("posts a message without thread_ts", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ ok: true }),
			});

			await service.postMessage({
				token: "xoxb-test-token",
				channel: "C9876543210",
				text: "Hello from Cyrus!",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"https://slack.com/api/chat.postMessage",
				{
					method: "POST",
					headers: {
						Authorization: "Bearer xoxb-test-token",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						channel: "C9876543210",
						text: "Hello from Cyrus!",
					}),
				},
			);
		});

		it("throws on non-OK HTTP response", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
				text: async () => '{"ok":false,"error":"invalid_auth"}',
			});

			await expect(
				service.postMessage({
					token: "xoxb-bad-token",
					channel: "C9876543210",
					text: "Hello",
				}),
			).rejects.toThrow(
				"[SlackMessageService] Failed to post message: 401 Unauthorized",
			);
		});

		it("throws on Slack API error (HTTP 200 with ok: false)", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ ok: false, error: "channel_not_found" }),
			});

			await expect(
				service.postMessage({
					token: "xoxb-test-token",
					channel: "C9876543210",
					text: "Hello",
				}),
			).rejects.toThrow(
				"[SlackMessageService] Slack API error: channel_not_found",
			);
		});

		it("respects custom base URL", async () => {
			const customService = new SlackMessageService(
				"https://slack.example.com/api",
			);

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ ok: true }),
			});

			await customService.postMessage({
				token: "xoxb-test-token",
				channel: "C9876543210",
				text: "Hello",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"https://slack.example.com/api/chat.postMessage",
				expect.any(Object),
			);
		});
	});
});
