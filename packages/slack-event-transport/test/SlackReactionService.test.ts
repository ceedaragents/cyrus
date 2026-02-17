import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackReactionService } from "../src/SlackReactionService.js";

describe("SlackReactionService", () => {
	let service: SlackReactionService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new SlackReactionService();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("adds a reaction to a Slack message", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ ok: true }),
		});
		vi.stubGlobal("fetch", mockFetch);

		await service.addReaction({
			token: "xoxb-test-token",
			channel: "C123",
			timestamp: "1704110400.000100",
			name: "eyes",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"https://slack.com/api/reactions.add",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer xoxb-test-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel: "C123",
					timestamp: "1704110400.000100",
					name: "eyes",
				}),
			},
		);
	});

	it("does not throw for already_reacted Slack API response", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ ok: false, error: "already_reacted" }),
		});
		vi.stubGlobal("fetch", mockFetch);

		await expect(
			service.addReaction({
				token: "xoxb-test-token",
				channel: "C123",
				timestamp: "1704110400.000100",
				name: "eyes",
			}),
		).resolves.toBeUndefined();
	});

	it("throws on HTTP error", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: vi.fn().mockResolvedValue("invalid_auth"),
		});
		vi.stubGlobal("fetch", mockFetch);

		await expect(
			service.addReaction({
				token: "bad-token",
				channel: "C123",
				timestamp: "1704110400.000100",
				name: "eyes",
			}),
		).rejects.toThrow(
			"[SlackReactionService] Failed to add reaction: 401 Unauthorized",
		);
	});

	it("throws on Slack API logical errors other than already_reacted", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi
				.fn()
				.mockResolvedValue({ ok: false, error: "channel_not_found" }),
		});
		vi.stubGlobal("fetch", mockFetch);

		await expect(
			service.addReaction({
				token: "xoxb-test-token",
				channel: "C123",
				timestamp: "1704110400.000100",
				name: "eyes",
			}),
		).rejects.toThrow(
			"[SlackReactionService] Slack API error: channel_not_found",
		);
	});
});
