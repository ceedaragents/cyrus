/**
 * Prompt Assembly Tests - Streaming Sessions
 *
 * Tests prompt assembly for streaming (continuation) sessions.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Streaming Sessions", () => {
	it("should pass through user comment unchanged", async () => {
		const worker = createTestWorker();

		await scenario(worker)
			.streamingSession()
			.withUserComment("Continue with the current task")
			.expectUserPrompt("Continue with the current task")
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment")
			.expectPromptType("continuation")
			.verify();
	});

	it("should include attachment manifest", async () => {
		const worker = createTestWorker();

		await scenario(worker)
			.streamingSession()
			.withUserComment("Review the attached file")
			.withAttachments(`
## New Attachments from Comment

Downloaded 1 new attachment.

### New Images
1. image_0001.png - Original URL: https://linear.app/attachments/abc123.png
   Local path: /path/to/attachments/image_0001.png

You can use the Read tool to view these images.
`)
			.expectUserPrompt(`Review the attached file


## New Attachments from Comment

Downloaded 1 new attachment.

### New Images
1. image_0001.png - Original URL: https://linear.app/attachments/abc123.png
   Local path: /path/to/attachments/image_0001.png

You can use the Read tool to view these images.
`)
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment", "attachment-manifest")
			.expectPromptType("continuation")
			.verify();
	});
});
