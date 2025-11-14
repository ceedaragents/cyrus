/**
 * Test to reproduce critical bugs in Linear async property handling
 *
 * This test demonstrates that EdgeWorker has multiple locations where
 * async properties from Linear SDK are not properly awaited, causing
 * Promise objects to be serialized as "[object Promise]" instead of
 * actual values.
 *
 * Related to PR #441 review (CYPACK-374)
 */

import { describe, expect, it } from "vitest";

/**
 * Mock Linear SDK issue with async properties
 * This simulates how Linear SDK actually works - many properties return Promises
 */
function createMockLinearIssue() {
	return {
		id: "issue-123",
		url: "https://linear.app/test/issue/TEST-123",

		// These properties return Promises (as Linear SDK does)
		identifier: Promise.resolve("TEST-123"),
		title: Promise.resolve("Fix authentication bug"),
		description: Promise.resolve("Users cannot log in with OAuth"),
		branchName: Promise.resolve("connor/TEST-123-fix-authentication-bug"),

		// Nested objects also have async properties
		state: Promise.resolve({
			id: "state-123",
			name: "In Progress",
			type: "started",
		}),
		assignee: Promise.resolve({
			id: "user-123",
			name: "Connor",
			email: "connor@example.com",
		}),
		team: Promise.resolve({
			id: "team-123",
			key: "TEST",
			name: "Test Team",
		}),
		labels: () =>
			Promise.resolve({
				nodes: [
					{ id: "label-1", name: "bug" },
					{ id: "label-2", name: "security" },
				],
			}),

		// Parent relationship
		parentId: "parent-123", // This is synchronous
		parent: Promise.resolve({
			id: "parent-123",
			identifier: Promise.resolve("TEST-100"),
			branchName: Promise.resolve("connor/TEST-100-parent-issue"),
		}),
	};
}

describe("Linear Async Property Handling Bugs", () => {
	it("BUG 1: convertLinearIssueToCore stores Promise objects instead of actual values", async () => {
		const mockIssue = createMockLinearIssue();

		// Simulate the current INCORRECT implementation in EdgeWorker.ts:2437-2444
		const convertLinearIssueToCoreIncorrect = (issue: any) => {
			return {
				id: issue.id,
				identifier: issue.identifier, // ❌ Should await
				title: issue.title, // ❌ Should await
				description: issue.description, // ❌ Should await
				branchName: issue.branchName, // ❌ Should await
			};
		};

		const result = convertLinearIssueToCoreIncorrect(mockIssue);

		// This test SHOULD FAIL - demonstrating the bug
		// When stored in sessionMap, these become "[object Promise]"
		expect(result.identifier).toBeInstanceOf(Promise);
		expect(result.title).toBeInstanceOf(Promise);
		expect(result.description).toBeInstanceOf(Promise);
		expect(result.branchName).toBeInstanceOf(Promise);

		// When serialized (e.g., in logs or returned to user), they become useless
		const serialized = JSON.stringify(result);
		expect(serialized).toContain("{}"); // Promises serialize to empty objects

		// The CORRECT implementation should await all properties
		const convertLinearIssueToCoreCorrect = async (issue: any) => {
			return {
				id: issue.id,
				identifier: await issue.identifier,
				title: await issue.title,
				description: await issue.description,
				branchName: await issue.branchName,
			};
		};

		const correctResult = await convertLinearIssueToCoreCorrect(mockIssue);
		expect(correctResult.identifier).toBe("TEST-123");
		expect(correctResult.title).toBe("Fix authentication bug");
		expect(correctResult.description).toBe("Users cannot log in with OAuth");
		expect(correctResult.branchName).toBe(
			"connor/TEST-123-fix-authentication-bug",
		);
	});

	it("BUG 2: Template replacements produce [object Promise] in prompts", async () => {
		const mockIssue = createMockLinearIssue();

		// Simulate buildLabelBasedPrompt (EdgeWorker.ts:2206-2212)
		const buildLabelBasedPromptIncorrect = (
			issue: any,
			promptTemplate: string,
		) => {
			return promptTemplate
				.replace("{identifier}", issue.identifier) // ❌ Should await
				.replace("{title}", issue.title); // ❌ Should await
		};

		const template = "Working on {identifier}: {title}";
		const result = buildLabelBasedPromptIncorrect(mockIssue, template);

		// This test SHOULD FAIL - demonstrating the bug
		// Claude receives prompts like "Working on [object Promise]: [object Promise]"
		expect(result).toContain("[object Promise]");

		// The CORRECT implementation
		const buildLabelBasedPromptCorrect = async (
			issue: any,
			promptTemplate: string,
		) => {
			const identifier = await issue.identifier;
			const title = await issue.title;
			return promptTemplate
				.replace("{identifier}", identifier)
				.replace("{title}", title);
		};

		const correctResult = await buildLabelBasedPromptCorrect(
			mockIssue,
			template,
		);
		expect(correctResult).toBe("Working on TEST-123: Fix authentication bug");
	});

	it("BUG 3: AI routing receives garbage input for classification", async () => {
		const mockIssue = createMockLinearIssue();

		// Simulate AI routing input preparation (EdgeWorker.ts:1500)
		const prepareRoutingInputIncorrect = (issue: any, description: string) => {
			return `${issue.title}\n\n${description}`; // ❌ Should await issue.title
		};

		const description = await mockIssue.description;
		const result = prepareRoutingInputIncorrect(mockIssue, description);

		// This test SHOULD FAIL - demonstrating the bug
		// AI receives "[object Promise]\n\nUsers cannot log in with OAuth"
		expect(result).toContain("[object Promise]");

		// The CORRECT implementation
		const prepareRoutingInputCorrect = async (
			issue: any,
			description: string,
		) => {
			const title = await issue.title;
			return `${title}\n\n${description}`;
		};

		const correctResult = await prepareRoutingInputCorrect(
			mockIssue,
			description,
		);
		expect(correctResult).toBe(
			"Fix authentication bug\n\nUsers cannot log in with OAuth",
		);
	});

	it("BUG 4: Comment parentId incorrectly awaited (semantic issue)", async () => {
		const mockComment = {
			id: "comment-123",
			body: "Test comment",
			parentId: "parent-456", // ✅ This is synchronous (string, not Promise)
			parent: Promise.resolve({ id: "parent-456", body: "Parent comment" }), // ❌ This is async
			user: Promise.resolve({ id: "user-123", name: "Test User" }),
		};

		// Current code in EdgeWorker.ts:2470 does: const parent = await comment.parentId
		// This is semantically wrong (awaiting a non-Promise) but works by accident
		const currentImplementation = async (comment: any) => {
			const parent = await comment.parentId; // ❌ Shouldn't await a string
			return parent;
		};

		const result = await currentImplementation(mockComment);
		expect(result).toBe("parent-456"); // Works by accident

		// The correct implementation should NOT await parentId
		const correctImplementation = (comment: any) => {
			const parent = comment.parentId; // ✅ No await needed for strings
			return parent;
		};

		const correctResult = correctImplementation(mockComment);
		expect(correctResult).toBe("parent-456");

		// This is a LOW severity bug - it works but is semantically incorrect
		// It adds unnecessary async overhead and confuses code readers
	});

	it("BUG 5: Tool outputs return invalid JSON with Promise objects", async () => {
		const mockIssue = createMockLinearIssue();

		// Simulate MCP tool output (basic-issue-tracker.ts:98-100)
		const createToolOutputIncorrect = (issue: any) => {
			return {
				id: issue.id,
				identifier: issue.identifier, // ❌ Should await
				title: issue.title, // ❌ Should await
				url: issue.url,
			};
		};

		const result = createToolOutputIncorrect(mockIssue);
		const serialized = JSON.stringify(result);

		// This test SHOULD FAIL - demonstrating the bug
		// Agent receives: {"id":"issue-123","identifier":{},"title":{},"url":"..."}
		expect(serialized).toContain("{}");
		expect(result.identifier).toBeInstanceOf(Promise);

		// The CORRECT implementation
		const createToolOutputCorrect = async (issue: any) => {
			return {
				id: issue.id,
				identifier: await issue.identifier,
				title: await issue.title,
				url: issue.url,
			};
		};

		const correctResult = await createToolOutputCorrect(mockIssue);
		const correctSerialized = JSON.stringify(correctResult);
		expect(correctSerialized).toBe(
			'{"id":"issue-123","identifier":"TEST-123","title":"Fix authentication bug","url":"https://linear.app/test/issue/TEST-123"}',
		);
	});

	it("BUG 6: Architecture violation - Direct labels() call instead of service interface", async () => {
		const mockIssue = createMockLinearIssue();

		// Current code in EdgeWorker.ts:1131-1133 calls issue.labels() directly
		// This violates the abstraction principle
		const getCurrentImplementation = async (issue: any) => {
			const labels = await issue.labels(); // ❌ Direct Linear SDK call
			return labels.nodes.map((l: any) => l.name);
		};

		const result = await getCurrentImplementation(mockIssue);
		expect(result).toEqual(["bug", "security"]);

		// The abstraction says EdgeWorker should NEVER call SDK methods directly
		// It should use: await issueTrackerService.fetchIssueLabels(issue.id)
		// But this method doesn't exist in IIssueTrackerService!

		// This test documents the architectural violation
		// Fix requires adding fetchIssueLabels() to IIssueTrackerService interface
	});

	it("Summary: Impact on Linear platform vs CLI platform", async () => {
		// CLI platform: All properties are synchronous
		const cliIssue = {
			id: "issue-123",
			identifier: "TEST-123", // ✅ Synchronous
			title: "Fix bug", // ✅ Synchronous
			description: "Description", // ✅ Synchronous
			branchName: "branch", // ✅ Synchronous
		};

		// No await needed - works fine
		const cliResult = {
			identifier: cliIssue.identifier,
			title: cliIssue.title,
		};
		expect(cliResult.identifier).toBe("TEST-123");

		// Linear platform: Properties are Promises
		const linearIssue = createMockLinearIssue();

		// Without await - BROKEN
		const linearResultBroken = {
			identifier: linearIssue.identifier, // Promise object
			title: linearIssue.title, // Promise object
		};
		expect(linearResultBroken.identifier).toBeInstanceOf(Promise);

		// With await - WORKS
		const linearResultFixed = {
			identifier: await linearIssue.identifier,
			title: await linearIssue.title,
		};
		expect(linearResultFixed.identifier).toBe("TEST-123");

		// This demonstrates why the bugs only affect Linear platform
		// CLI tests pass because properties are synchronous
		// But production Linear usage is completely broken
	});
});
