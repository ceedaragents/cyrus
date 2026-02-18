import { describe, expect, it } from "vitest";
import { extractTitle } from "../src/utils/titleExtractor.js";

describe("extractTitle", () => {
	it("returns the full message when short enough", () => {
		expect(extractTitle("Add a retry mechanism")).toBe("Add a retry mechanism");
	});

	it("returns first sentence when message has multiple sentences", () => {
		expect(
			extractTitle(
				"Add retry logic to webhooks. It should use exponential backoff with 3 retries.",
			),
		).toBe("Add retry logic to webhooks.");
	});

	it("returns first line for multi-line messages", () => {
		expect(extractTitle("Fix the login bug\nThe user can't sign in")).toBe(
			"Fix the login bug",
		);
	});

	it("truncates long single-line messages at word boundary", () => {
		const longMessage =
			"Implement a comprehensive retry mechanism with exponential backoff and jitter for all webhook handlers in the proxy application";
		const title = extractTitle(longMessage);
		expect(title.length).toBeLessThanOrEqual(80);
		expect(title.endsWith("...")).toBe(true);
	});

	it("handles empty message", () => {
		expect(extractTitle("")).toBe("Untitled");
		expect(extractTitle("   ")).toBe("Untitled");
	});

	it("handles message with only whitespace and newlines", () => {
		expect(extractTitle("  \n  \n  ")).toBe("Untitled");
	});

	it("preserves short first sentence ending with exclamation", () => {
		expect(extractTitle("Fix this bug! The login page is broken.")).toBe(
			"Fix this bug!",
		);
	});

	it("preserves short first sentence ending with question mark", () => {
		expect(
			extractTitle("Can you add dark mode? I'd like a toggle in settings."),
		).toBe("Can you add dark mode?");
	});
});
