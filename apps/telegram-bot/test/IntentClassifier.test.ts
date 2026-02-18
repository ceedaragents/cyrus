import { beforeEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../src/services/ConversationStore.js";
import { IntentClassifier } from "../src/services/IntentClassifier.js";
import type { Conversation } from "../src/types.js";

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
	return {
		chatId: 100,
		anchorMessageId: 42,
		linearIssueId: "issue-1",
		linearIssueIdentifier: "TEAM-1",
		linearIssueUrl: "https://linear.app/team/issue/TEAM-1",
		createdAt: Date.now(),
		lastPolledAt: Date.now(),
		isActive: true,
		...overrides,
	};
}

describe("IntentClassifier", () => {
	let store: ConversationStore;
	let classifier: IntentClassifier;

	beforeEach(() => {
		store = new ConversationStore();
		classifier = new IntentClassifier(store);
	});

	it("classifies message without reply as new-task", () => {
		const result = classifier.classify(100, "Add retry logic");
		expect(result.type).toBe("new-task");
		expect(result.text).toBe("Add retry logic");
		expect(result.conversation).toBeUndefined();
	});

	it("classifies reply to known anchor as follow-up", () => {
		store.add(makeConversation());
		const result = classifier.classify(100, "Also handle timeouts", 42);
		expect(result.type).toBe("follow-up");
		expect(result.conversation?.linearIssueId).toBe("issue-1");
	});

	it("classifies reply to unknown message as new-task", () => {
		const result = classifier.classify(100, "Something new", 999);
		expect(result.type).toBe("new-task");
	});

	it("classifies reply to inactive conversation anchor as new-task", () => {
		store.add(makeConversation({ isActive: false }));
		const result = classifier.classify(100, "More changes", 42);
		expect(result.type).toBe("new-task");
	});

	it("classifies reply to anchor in different chat as new-task", () => {
		store.add(makeConversation({ chatId: 200 }));
		const result = classifier.classify(100, "Follow up", 42);
		expect(result.type).toBe("new-task");
	});
});
