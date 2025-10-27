/**
 * Prompt Assembly Tests - Continuation Sessions
 *
 * Tests prompt assembly for continuation (non-streaming, non-new) sessions.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Continuation Sessions", () => {
	it("should only include user comment", async () => {
		const worker = createTestWorker();

		await scenario(worker)
			.continuationSession()
			.withUserComment("Please fix the bug")
			.expectUserPrompt("Please fix the bug")
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment")
			.expectPromptType("continuation")
			.verify();
	});

	it("should include attachments if present", async () => {
		const worker = createTestWorker();

		await scenario(worker)
			.continuationSession()
			.withUserComment("Here's more context")
			.withAttachments(`
## New Attachments from Comment

Downloaded 1 new attachment.

### New Attachments
1. attachment_0001.txt - Original URL: https://linear.app/attachments/error-log.txt
   Local path: /path/to/attachments/attachment_0001.txt

You can use the Read tool to view these files.
`)
			.expectUserPrompt(`Here's more context


## New Attachments from Comment

Downloaded 1 new attachment.

### New Attachments
1. attachment_0001.txt - Original URL: https://linear.app/attachments/error-log.txt
   Local path: /path/to/attachments/attachment_0001.txt

You can use the Read tool to view these files.
`)
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment", "attachment-manifest")
			.expectPromptType("continuation")
			.verify();
	});
});
