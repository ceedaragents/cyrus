import { beforeEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../src/services/ConversationStore.js";
import type { Conversation } from "../src/types.js";

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
	return {
		chatId: 100,
		anchorMessageId: 1,
		linearIssueId: "issue-1",
		linearIssueIdentifier: "TEAM-1",
		linearIssueUrl: "https://linear.app/team/issue/TEAM-1",
		createdAt: Date.now(),
		lastPolledAt: Date.now(),
		isActive: true,
		...overrides,
	};
}

describe("ConversationStore", () => {
	let store: ConversationStore;

	beforeEach(() => {
		store = new ConversationStore();
	});

	it("adds and retrieves conversation by chat ID", () => {
		const conv = makeConversation();
		store.add(conv);
		expect(store.getActiveForChat(100)).toHaveLength(1);
		expect(store.getActiveForChat(100)[0]).toBe(conv);
	});

	it("retrieves conversation by issue ID", () => {
		const conv = makeConversation();
		store.add(conv);
		expect(store.getByIssueId("issue-1")).toBe(conv);
	});

	it("finds conversation by anchor message ID", () => {
		const conv = makeConversation({ anchorMessageId: 42 });
		store.add(conv);
		expect(store.findByAnchor(100, 42)).toBe(conv);
		expect(store.findByAnchor(100, 99)).toBeUndefined();
	});

	it("returns empty array for unknown chat ID", () => {
		expect(store.getActiveForChat(999)).toHaveLength(0);
	});

	it("filters inactive conversations from getActiveForChat", () => {
		store.add(makeConversation({ linearIssueId: "issue-1" }));
		store.add(
			makeConversation({
				linearIssueId: "issue-2",
				anchorMessageId: 2,
				isActive: false,
			}),
		);
		expect(store.getActiveForChat(100)).toHaveLength(1);
	});

	it("marks conversation as inactive", () => {
		store.add(makeConversation());
		store.markInactive("issue-1");
		expect(store.getActiveForChat(100)).toHaveLength(0);
		expect(store.getByIssueId("issue-1")?.isActive).toBe(false);
	});

	it("getAllActive returns only active conversations", () => {
		store.add(makeConversation({ linearIssueId: "issue-1" }));
		store.add(
			makeConversation({
				chatId: 200,
				linearIssueId: "issue-2",
				anchorMessageId: 2,
			}),
		);
		store.add(
			makeConversation({
				chatId: 300,
				linearIssueId: "issue-3",
				anchorMessageId: 3,
				isActive: false,
			}),
		);
		expect(store.getAllActive()).toHaveLength(2);
	});

	it("updates lastPolledAt", () => {
		const conv = makeConversation({ lastPolledAt: 1000 });
		store.add(conv);
		store.updateLastPolled("issue-1", 2000);
		expect(store.getByIssueId("issue-1")?.lastPolledAt).toBe(2000);
	});

	it("supports multiple conversations in the same chat", () => {
		store.add(
			makeConversation({
				linearIssueId: "issue-1",
				anchorMessageId: 1,
			}),
		);
		store.add(
			makeConversation({
				linearIssueId: "issue-2",
				anchorMessageId: 2,
			}),
		);
		expect(store.getActiveForChat(100)).toHaveLength(2);
	});
});
