import { describe, expect, it } from "vitest";
import {
	isIssueStateChangeWebhook,
	isIssueTitleOrDescriptionUpdateWebhook,
	type Webhook,
} from "../src/issue-tracker/types.js";

describe("isIssueStateChangeWebhook", () => {
	it("should return true for Issue update with stateId in updatedFrom", () => {
		const webhook = {
			type: "Issue",
			action: "update",
			organizationId: "org-123",
			createdAt: "2025-01-27T12:00:00Z",
			data: {
				id: "issue-123",
				identifier: "DEF-123",
				state: {
					id: "state-1",
					type: "completed",
					name: "Done",
					color: "#5e6ad2",
				},
				stateId: "state-1",
			},
			updatedFrom: {
				stateId: "state-old",
			},
		} as unknown as Webhook;

		expect(isIssueStateChangeWebhook(webhook)).toBe(true);
	});

	it("should return false for Issue update without stateId in updatedFrom", () => {
		const webhook = {
			type: "Issue",
			action: "update",
			organizationId: "org-123",
			createdAt: "2025-01-27T12:00:00Z",
			data: {
				id: "issue-123",
				identifier: "DEF-123",
				title: "New Title",
			},
			updatedFrom: {
				title: "Old Title",
			},
		} as unknown as Webhook;

		expect(isIssueStateChangeWebhook(webhook)).toBe(false);
	});

	it("should return false for Issue update without updatedFrom", () => {
		const webhook = {
			type: "Issue",
			action: "update",
			organizationId: "org-123",
			data: {
				id: "issue-123",
			},
		} as unknown as Webhook;

		expect(isIssueStateChangeWebhook(webhook)).toBe(false);
	});

	it("should return false for non-Issue webhook types", () => {
		const webhook = {
			type: "AgentSessionEvent",
			action: "created",
			organizationId: "org-123",
		} as unknown as Webhook;

		expect(isIssueStateChangeWebhook(webhook)).toBe(false);
	});

	it("should return false for Issue create action", () => {
		const webhook = {
			type: "Issue",
			action: "create",
			organizationId: "org-123",
			data: {
				id: "issue-123",
				stateId: "state-1",
			},
		} as unknown as Webhook;

		expect(isIssueStateChangeWebhook(webhook)).toBe(false);
	});

	it("should not conflict with title/description update type guard", () => {
		// A webhook with only title change should NOT match state change
		const titleOnlyWebhook = {
			type: "Issue",
			action: "update",
			organizationId: "org-123",
			data: { id: "issue-123", identifier: "DEF-123", title: "New" },
			updatedFrom: { title: "Old" },
		} as unknown as Webhook;

		expect(isIssueStateChangeWebhook(titleOnlyWebhook)).toBe(false);
		expect(isIssueTitleOrDescriptionUpdateWebhook(titleOnlyWebhook)).toBe(true);

		// A webhook with only stateId change should match state change but NOT title/desc
		const stateOnlyWebhook = {
			type: "Issue",
			action: "update",
			organizationId: "org-123",
			data: {
				id: "issue-123",
				identifier: "DEF-123",
				state: { id: "s1", type: "completed", name: "Done", color: "#000" },
				stateId: "s1",
			},
			updatedFrom: { stateId: "s0" },
		} as unknown as Webhook;

		expect(isIssueStateChangeWebhook(stateOnlyWebhook)).toBe(true);
		expect(isIssueTitleOrDescriptionUpdateWebhook(stateOnlyWebhook)).toBe(
			false,
		);
	});
});
