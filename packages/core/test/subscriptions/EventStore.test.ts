import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/subscriptions/EventStore.js";

describe("EventStore", () => {
	let store: EventStore;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "eventstore-test-"));
		store = new EventStore(tempDir);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("storeEvent", () => {
		it("should store an event and return a SubscriptionEvent", async () => {
			const event = await store.storeEvent(
				"issue_updated",
				"linear",
				{ issueId: "abc", title: "Test" },
				{ issueId: "abc" },
			);

			expect(event.id).toBeDefined();
			expect(event.eventType).toBe("issue_updated");
			expect(event.source).toBe("linear");
			expect(event.payload).toEqual({ issueId: "abc", title: "Test" });
			expect(event.filterableProperties).toEqual({ issueId: "abc" });
		});
	});

	describe("lookupEvent", () => {
		it("should retrieve a stored event by ID", async () => {
			const event = await store.storeEvent(
				"ci_completed",
				"github",
				{ status: "success", checkName: "CI" },
				{ status: "success" },
			);

			const stored = await store.lookupEvent(event.id);
			expect(stored).not.toBeNull();
			expect(stored!.id).toBe(event.id);
			expect(stored!.eventType).toBe("ci_completed");
			expect(stored!.source).toBe("github");
			expect(stored!.payload).toEqual({
				status: "success",
				checkName: "CI",
			});
			expect(stored!.receivedAt).toBeGreaterThan(0);
		});

		it("should return null for non-existent event", async () => {
			const stored = await store.lookupEvent("nonexistent");
			expect(stored).toBeNull();
		});
	});

	describe("cleanup", () => {
		it("should remove events older than max age", async () => {
			const event = await store.storeEvent(
				"issue_updated",
				"linear",
				{ test: true },
				{},
			);

			// Events just created should not be cleaned up with a large max age
			const removed = await store.cleanup(60 * 60 * 1000); // 1 hour
			expect(removed).toBe(0);

			// Verify event still exists
			const stored = await store.lookupEvent(event.id);
			expect(stored).not.toBeNull();
		});

		it("should clean up old events with 0ms max age", async () => {
			await store.storeEvent("issue_updated", "linear", { test: true }, {});

			// Wait a tiny bit to ensure receivedAt < cutoff
			await new Promise((r) => setTimeout(r, 10));

			const removed = await store.cleanup(0);
			expect(removed).toBe(1);
		});
	});
});
