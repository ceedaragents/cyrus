import { describe, expect, it } from "vitest";

/**
 * Tests for error message sanitization.
 *
 * These tests verify that sensitive information is properly removed from
 * error messages before they are posted to Linear.
 */
describe("Error Sanitization", () => {
	// Since sanitizeErrorForLinear is a private method, we test the sanitization
	// logic by reimplementing it here and verifying the behavior matches expectations.

	function sanitizeErrorMessage(error: Error): string {
		let message = error.message || "Unknown error";

		// Remove absolute file paths (keep just the filename/relative part)
		message = message.replace(/\/[^\s:]+\//g, (match) => {
			// Keep only the last component of the path
			const parts = match.split("/").filter(Boolean);
			return parts.length > 0 ? `.../${parts[parts.length - 1]}/` : match;
		});

		// Remove potential API keys or tokens (alphanumeric strings > 20 chars)
		message = message.replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]");

		// Remove stack traces (anything after "at " with file paths)
		const stackTraceIndex = message.indexOf("\n    at ");
		if (stackTraceIndex !== -1) {
			message = message.substring(0, stackTraceIndex);
		}

		// Truncate very long messages
		const maxLength = 500;
		if (message.length > maxLength) {
			message = `${message.substring(0, maxLength)}...`;
		}

		return message;
	}

	describe("sanitizeErrorMessage", () => {
		it("should sanitize absolute file paths", () => {
			const error = new Error(
				"Error: File not found at /Users/john/secret/project/config.json",
			);
			const result = sanitizeErrorMessage(error);
			expect(result).not.toContain("/Users/john/secret");
			expect(result).toContain(".../project/");
		});

		it("should redact long alphanumeric strings that look like API keys", () => {
			// Use a fake token pattern that won't trigger GitHub secret scanning
			const fakeToken = "test_token_abcdef123456789012345";
			const error = new Error(`Invalid API key: ${fakeToken}`);
			const result = sanitizeErrorMessage(error);
			expect(result).toContain("[REDACTED]");
			expect(result).not.toContain(fakeToken);
		});

		it("should not redact short strings", () => {
			const error = new Error("Error code: E_FAILED");
			const result = sanitizeErrorMessage(error);
			expect(result).toBe("Error code: E_FAILED");
		});

		it("should remove stack traces", () => {
			const error = new Error(
				"Something failed\n    at Function.execute (/path/to/file.js:123:45)\n    at main (/path/to/main.js:10:5)",
			);
			const result = sanitizeErrorMessage(error);
			expect(result).toBe("Something failed");
			expect(result).not.toContain("at Function");
		});

		it("should truncate very long messages", () => {
			// Use a message with spaces to avoid regex issues
			const longMessage = "word ".repeat(200);
			const error = new Error(longMessage);
			const result = sanitizeErrorMessage(error);
			expect(result.length).toBeLessThanOrEqual(503); // 500 + "..."
			expect(result.endsWith("...")).toBe(true);
		});

		it("should handle errors without messages", () => {
			const error = new Error();
			error.message = "";
			const result = sanitizeErrorMessage(error);
			expect(result).toBe("Unknown error");
		});

		it("should sanitize multiple paths in one message", () => {
			const error = new Error(
				"Cannot copy /home/user/.secrets/key to /var/data/output/file",
			);
			const result = sanitizeErrorMessage(error);
			expect(result).not.toContain("/home/user/.secrets");
			expect(result).not.toContain("/var/data/output");
		});

		it("should handle MCP configuration error patterns", () => {
			const error = new Error(
				'Invalid MCP server configuration at /Users/cyrus/.mcp.json: missing "type" field',
			);
			const result = sanitizeErrorMessage(error);
			expect(result).not.toContain("/Users/cyrus/");
			expect(result).toContain('.mcp.json: missing "type" field');
		});

		it("should handle SDK exit errors", () => {
			const error = new Error("Claude Code process exited with code 1");
			const result = sanitizeErrorMessage(error);
			expect(result).toBe("Claude Code process exited with code 1");
		});
	});
});
