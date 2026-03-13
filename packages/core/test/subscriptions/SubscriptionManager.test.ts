import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionManager } from "../../src/subscriptions/SubscriptionManager.js";
import type { SubscriptionEvent } from "../../src/subscriptions/types.js";

describe("SubscriptionManager", () => {
	let manager: SubscriptionManager;

	beforeEach(() => {
		manager = new SubscriptionManager();
	});

	describe("createSubscription", () => {
		it("should create a subscription with correct fields", () => {
			const sub = manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
				filter: { issueId: "abc" },
				prompt: "Issue was updated",
			});

			expect(sub.id).toBeDefined();
			expect(sub.sessionId).toBe("session-1");
			expect(sub.eventType).toBe("issue_updated");
			expect(sub.filter).toEqual({ issueId: "abc" });
			expect(sub.prompt).toBe("Issue was updated");
			expect(sub.createdAt).toBeGreaterThan(0);
		});

		it("should default eventType to custom", () => {
			const sub = manager.createSubscription({
				sessionId: "session-1",
			});

			expect(sub.eventType).toBe("custom");
		});
	});

	describe("unsubscribe", () => {
		it("should remove a subscription by ID", () => {
			const sub = manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
			});

			expect(manager.unsubscribe(sub.id)).toBe(true);
			expect(manager.getSessionSubscriptions("session-1")).toHaveLength(0);
		});

		it("should return false for non-existent subscription", () => {
			expect(manager.unsubscribe("nonexistent")).toBe(false);
		});
	});

	describe("removeSessionSubscriptions", () => {
		it("should remove all subscriptions for a session", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
			});
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "prompted",
			});

			manager.removeSessionSubscriptions("session-1");
			expect(manager.getSessionSubscriptions("session-1")).toHaveLength(0);
		});
	});

	describe("matchEvent", () => {
		it("should match event by type", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "issue_updated",
				source: "linear",
				payload: {},
				filterableProperties: {},
			};

			const matches = manager.matchEvent(event);
			expect(matches).toHaveLength(1);
			expect(matches[0]!.subscription.sessionId).toBe("session-1");
		});

		it("should not match event with different type", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "prompted",
				source: "linear",
				payload: {},
				filterableProperties: {},
			};

			expect(manager.matchEvent(event)).toHaveLength(0);
		});

		it("should match with filter conditions", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
				filter: { issueId: "abc", field: "title" },
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "issue_updated",
				source: "linear",
				payload: {},
				filterableProperties: { issueId: "abc", field: "title" },
			};

			expect(manager.matchEvent(event)).toHaveLength(1);
		});

		it("should not match when filter conditions fail", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
				filter: { issueId: "abc" },
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "issue_updated",
				source: "linear",
				payload: {},
				filterableProperties: { issueId: "xyz" },
			};

			expect(manager.matchEvent(event)).toHaveLength(0);
		});

		it("should match with array filter values", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
				filter: { field: ["title", "description"] },
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "issue_updated",
				source: "linear",
				payload: {},
				filterableProperties: { field: "title" },
			};

			expect(manager.matchEvent(event)).toHaveLength(1);
		});

		it("should apply compress map to payload", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
				compress: { newTitle: "data.title", author: "data.actor.name" },
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "issue_updated",
				source: "linear",
				payload: {
					data: {
						title: "New Title",
						actor: { name: "Alice" },
					},
				},
				filterableProperties: {},
			};

			const matches = manager.matchEvent(event);
			expect(matches).toHaveLength(1);
			expect(matches[0]!.compressedPayload).toEqual({
				newTitle: "New Title",
				author: "Alice",
			});
		});
	});

	describe("processEvent", () => {
		it("should emit deliver events for matches", () => {
			const deliverSpy = vi.fn();
			manager.on("deliver", deliverSpy);

			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "issue_updated",
				source: "linear",
				payload: {},
				filterableProperties: {},
			};

			const results = manager.processEvent(event, () => true);
			expect(results).toHaveLength(1);
			expect(results[0]!.delivered).toBe(true);
			expect(deliverSpy).toHaveBeenCalledTimes(1);
		});

		it("should skip whileStreamingOnly subscriptions when not streaming", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
				whileStreamingOnly: true,
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "issue_updated",
				source: "linear",
				payload: {},
				filterableProperties: {},
			};

			const results = manager.processEvent(event, () => false);
			expect(results).toHaveLength(1);
			expect(results[0]!.delivered).toBe(false);
			expect(results[0]!.reason).toBe("session_not_streaming");
		});

		it("should remove oneShot subscriptions after delivery", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "ci_completed",
				oneShot: true,
			});

			const event: SubscriptionEvent = {
				id: "event-1",
				eventType: "ci_completed",
				source: "github",
				payload: {},
				filterableProperties: {},
			};

			manager.processEvent(event, () => true);
			expect(manager.getSessionSubscriptions("session-1")).toHaveLength(0);
		});
	});

	describe("autoSubscribe", () => {
		it("should auto-subscribe to prompted events", () => {
			const subs = manager.autoSubscribe("session-1", {});

			expect(subs.length).toBeGreaterThanOrEqual(1);
			const prompted = subs.find((s) => s.eventType === "prompted");
			expect(prompted).toBeDefined();
			expect(prompted!.filter).toEqual({ sessionId: "session-1" });
		});

		it("should auto-subscribe to issue_updated when enabled", () => {
			const subs = manager.autoSubscribe("session-1", {
				issueId: "issue-123",
				issueUpdateEnabled: true,
			});

			const issueUpdated = subs.find((s) => s.eventType === "issue_updated");
			expect(issueUpdated).toBeDefined();
			expect(issueUpdated!.whileStreamingOnly).toBe(true);
			expect(issueUpdated!.filter).toEqual({
				issueId: "issue-123",
				field: ["title", "description", "attachments"],
			});
		});

		it("should not auto-subscribe to issue_updated when disabled", () => {
			const subs = manager.autoSubscribe("session-1", {
				issueId: "issue-123",
				issueUpdateEnabled: false,
			});

			const issueUpdated = subs.find((s) => s.eventType === "issue_updated");
			expect(issueUpdated).toBeUndefined();
		});

		it("should auto-subscribe to base branch updates", () => {
			const subs = manager.autoSubscribe("session-1", {
				baseBranches: [
					{ repositoryId: "repo-1", branch: "main" },
					{ repositoryId: "repo-2", branch: "develop" },
				],
			});

			const branchSubs = subs.filter(
				(s) => s.eventType === "base_branch_updated",
			);
			expect(branchSubs).toHaveLength(2);
			expect(branchSubs[0]!.filter).toEqual({
				repositoryId: "repo-1",
				branch: "main",
			});
		});
	});

	describe("serialization", () => {
		it("should serialize and restore state", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
				filter: { issueId: "abc" },
			});
			manager.createSubscription({
				sessionId: "session-2",
				eventType: "prompted",
			});

			const state = manager.serializeState();
			expect(Object.keys(state.subscriptions)).toHaveLength(2);

			const restored = new SubscriptionManager();
			restored.restoreState(state);

			expect(restored.getSessionSubscriptions("session-1")).toHaveLength(1);
			expect(restored.getSessionSubscriptions("session-2")).toHaveLength(1);
		});
	});

	describe("totalSubscriptionCount", () => {
		it("should count all subscriptions", () => {
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "issue_updated",
			});
			manager.createSubscription({
				sessionId: "session-1",
				eventType: "prompted",
			});
			manager.createSubscription({
				sessionId: "session-2",
				eventType: "ci_completed",
			});

			expect(manager.totalSubscriptionCount).toBe(3);
		});
	});
});
