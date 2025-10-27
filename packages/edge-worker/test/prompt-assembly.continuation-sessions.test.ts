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
			.withAttachments("Attachment: error-log.txt")
			.expectUserPrompt(`Here's more context

Attachment: error-log.txt`)
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment", "attachment-manifest")
			.expectPromptType("continuation")
			.verify();
	});
});
