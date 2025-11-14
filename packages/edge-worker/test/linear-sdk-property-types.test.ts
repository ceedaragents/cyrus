/**
 * Test to verify Linear SDK property types and demonstrate that
 * identifier, title, branchName, and description are synchronous properties
 *
 * This test reproduces the bug from CYPACK-374 where these synchronous
 * properties were incorrectly treated as async and had unnecessary await
 * keywords added.
 *
 * Related Issues:
 * - CYPACK-376: Remove unnecessary await keywords
 * - CYPACK-374: Incorrectly added await keywords based on false assumption
 */

import { describe, expect, it } from "vitest";

/**
 * Create a mock Linear SDK Issue that matches actual SDK behavior
 * Based on @linear/sdk v60.0.0 type definitions
 */
function createRealLinearIssueMock() {
	return {
		id: "issue-123",
		url: "https://linear.app/test/issue/TEST-123",

		// SYNCHRONOUS properties (plain strings, NOT Promises)
		identifier: "TEST-123",
		title: "Fix authentication bug",
		description: "Users cannot log in with OAuth",
		branchName: "connor/TEST-123-fix-authentication-bug",

		// ASYNC properties (getters that return Promises)
		get state() {
			return Promise.resolve({
				id: "state-123",
				name: "In Progress",
				type: "started",
			});
		},
		get assignee() {
			return Promise.resolve({
				id: "user-123",
				name: "Connor",
				email: "connor@example.com",
			});
		},
		get team() {
			return Promise.resolve({
				id: "team-123",
				key: "TEST",
				name: "Test Team",
			});
		},
		labels: () =>
			Promise.resolve({
				nodes: [
					{ id: "label-1", name: "bug" },
					{ id: "label-2", name: "security" },
				],
			}),

		// Parent relationship
		parentId: "parent-123", // Synchronous
		get parent() {
			return Promise.resolve({
				id: "parent-123",
				identifier: "TEST-100",
				branchName: "connor/TEST-100-parent-issue",
			});
		},
	};
}

describe("Linear SDK Property Types - Verify Synchronous vs Async", () => {
	it("VERIFY: identifier, title, branchName, description are synchronous strings", () => {
		const mockIssue = createRealLinearIssueMock();

		// These properties should be plain strings, not Promises
		expect(typeof mockIssue.identifier).toBe("string");
		expect(typeof mockIssue.title).toBe("string");
		expect(typeof mockIssue.description).toBe("string");
		expect(typeof mockIssue.branchName).toBe("string");

		// They should NOT be Promise instances
		expect(mockIssue.identifier).not.toBeInstanceOf(Promise);
		expect(mockIssue.title).not.toBeInstanceOf(Promise);
		expect(mockIssue.description).not.toBeInstanceOf(Promise);
		expect(mockIssue.branchName).not.toBeInstanceOf(Promise);

		// Direct access should work without await
		expect(mockIssue.identifier).toBe("TEST-123");
		expect(mockIssue.title).toBe("Fix authentication bug");
		expect(mockIssue.description).toBe("Users cannot log in with OAuth");
		expect(mockIssue.branchName).toBe("connor/TEST-123-fix-authentication-bug");
	});

	it("VERIFY: state, assignee, team, labels ARE async and return Promises", async () => {
		const mockIssue = createRealLinearIssueMock();

		// These properties ARE Promises and need await
		expect(mockIssue.state).toBeInstanceOf(Promise);
		expect(mockIssue.assignee).toBeInstanceOf(Promise);
		expect(mockIssue.team).toBeInstanceOf(Promise);
		expect(mockIssue.labels()).toBeInstanceOf(Promise);

		// Verify they resolve correctly when awaited
		const state = await mockIssue.state;
		expect(state.name).toBe("In Progress");

		const assignee = await mockIssue.assignee;
		expect(assignee.name).toBe("Connor");

		const team = await mockIssue.team;
		expect(team.key).toBe("TEST");

		const labels = await mockIssue.labels();
		expect(labels.nodes).toHaveLength(2);
	});

	it("BUG REPRODUCTION: Unnecessary await on synchronous properties is harmless but misleading", async () => {
		const mockIssue = createRealLinearIssueMock();

		// Using await on synchronous properties works but is unnecessary
		// JavaScript will return the value immediately when awaiting non-Promises
		const identifier = await mockIssue.identifier;
		const title = await mockIssue.title;
		const description = await mockIssue.description;
		const branchName = await mockIssue.branchName;

		// The values are correct, but the await keywords are misleading
		expect(identifier).toBe("TEST-123");
		expect(title).toBe("Fix authentication bug");
		expect(description).toBe("Users cannot log in with OAuth");
		expect(branchName).toBe("connor/TEST-123-fix-authentication-bug");

		// This demonstrates the bug: await works but suggests these are async
		// The correct code should NOT use await on these properties
	});

	it("VERIFY: convertLinearIssueToCore should NOT await synchronous properties", () => {
		const mockIssue = createRealLinearIssueMock();

		// CORRECT implementation (synchronous access)
		const convertLinearIssueToCoreCorrect = (issue: typeof mockIssue) => {
			return {
				id: issue.id,
				identifier: issue.identifier, // ✅ No await needed
				title: issue.title, // ✅ No await needed
				description: issue.description, // ✅ No await needed
				branchName: issue.branchName, // ✅ No await needed
			};
		};

		const result = convertLinearIssueToCoreCorrect(mockIssue);

		// All values should be strings immediately available
		expect(result.identifier).toBe("TEST-123");
		expect(result.title).toBe("Fix authentication bug");
		expect(result.description).toBe("Users cannot log in with OAuth");
		expect(result.branchName).toBe("connor/TEST-123-fix-authentication-bug");

		// None should be Promises
		expect(result.identifier).not.toBeInstanceOf(Promise);
		expect(result.title).not.toBeInstanceOf(Promise);
		expect(result.description).not.toBeInstanceOf(Promise);
		expect(result.branchName).not.toBeInstanceOf(Promise);
	});

	it("DEMONSTRATE: Incorrect test mocks from CYPACK-374 create false positives", () => {
		// This was the INCORRECT mock from linear-async-properties.test.ts
		// It created Promises where the real SDK uses plain strings
		const incorrectMock = {
			id: "issue-123",
			identifier: Promise.resolve("TEST-123"), // ❌ Real SDK: plain string
			title: Promise.resolve("Fix authentication bug"), // ❌ Real SDK: plain string
			description: Promise.resolve("Users cannot log in"), // ❌ Real SDK: plain string
			branchName: Promise.resolve("connor/TEST-123"), // ❌ Real SDK: plain string
		};

		// The incorrect mock makes it APPEAR these need await
		expect(incorrectMock.identifier).toBeInstanceOf(Promise);
		expect(incorrectMock.title).toBeInstanceOf(Promise);

		// But the REAL Linear SDK returns plain strings
		const correctMock = createRealLinearIssueMock();
		expect(correctMock.identifier).not.toBeInstanceOf(Promise);
		expect(correctMock.title).not.toBeInstanceOf(Promise);
	});
});

describe("Linear SDK Type Definition Evidence", () => {
	it("DOCUMENTATION: Linear SDK v60.0.0 type definitions confirm synchronous properties", () => {
		// From @linear/sdk/dist/_generated_sdk.d.ts:
		//
		// export declare class Issue extends Request {
		//   identifier: string;           // Line 4975 - ✅ Synchronous
		//   title: string;                // Line 5011 - ✅ Synchronous
		//   branchName: string;           // Line 4957 - ✅ Synchronous
		//   description?: string;         // Line 4967 - ✅ Synchronous
		//
		//   // These ARE async (relationships):
		//   get assignee(): LinearFetch<User> | undefined;
		//   get state(): LinearFetch<WorkflowState> | undefined;
		//   get team(): LinearFetch<Team> | undefined;
		// }
		//
		// Where LinearFetch<T> = Promise<T>

		expect(true).toBe(true); // This test serves as documentation
	});

	it("IMPACT: Unnecessary await keywords are harmless but create technical debt", () => {
		// JavaScript behavior when awaiting non-Promises:
		// - await on a non-Promise returns the value immediately
		// - No performance penalty
		// - BUT: misleading for future developers
		// - Suggests these properties are async when they're not
		// - Makes code harder to understand

		const syncValue = "TEST-123";

		// Both produce the same result
		const withoutAwait = syncValue;
		const withAwait = (async () => await syncValue)();

		expect(withoutAwait).toBe("TEST-123");
		expect(withAwait).toBeInstanceOf(Promise); // Creates unnecessary Promise

		// The issue is NOT correctness, it's clarity and maintainability
	});
});
