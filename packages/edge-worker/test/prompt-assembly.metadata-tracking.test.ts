/**
 * Prompt Assembly Tests - Metadata Tracking
 *
 * Tests that prompt assembly correctly tracks metadata about the prompt.
 */

import { describe, expect, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Metadata Tracking", () => {
	it("should track correct metadata for streaming session", async () => {
		const worker = createTestWorker();

		const result = await scenario(worker)
			.streamingSession()
			.withUserComment("Test")
			.expectUserPrompt("Test")
			.expectSystemPrompt(undefined)
			.expectPromptType("continuation")
			.verify();

		// Verify metadata
		expect(result.metadata).toMatchObject({
			components: ["user-comment"],
			promptType: "continuation",
			isNewSession: false,
			isStreaming: true,
		});
	});

	it("should track correct metadata for continuation session", async () => {
		const worker = createTestWorker();

		const result = await scenario(worker)
			.continuationSession()
			.withUserComment("Test")
			.withAttachments(`
## New Attachments from Comment

Downloaded 1 new attachment.

### New Attachments
1. file.txt - Original URL: https://linear.app/attachments/file.txt
   Local path: /path/to/attachments/file.txt

You can use the Read tool to view these files.
`)
			.expectUserPrompt(`Test


## New Attachments from Comment

Downloaded 1 new attachment.

### New Attachments
1. file.txt - Original URL: https://linear.app/attachments/file.txt
   Local path: /path/to/attachments/file.txt

You can use the Read tool to view these files.
`)
			.expectSystemPrompt(undefined)
			.expectPromptType("continuation")
			.verify();

		// Verify metadata
		expect(result.metadata).toMatchObject({
			components: ["user-comment", "attachment-manifest"],
			promptType: "continuation",
			isNewSession: false,
			isStreaming: false,
		});
	});
});
