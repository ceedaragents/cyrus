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
			.withAttachments("Attachment: screenshot.png")
			.expectUserPrompt(`Review the attached file

Attachment: screenshot.png`)
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment", "attachment-manifest")
			.expectPromptType("continuation")
			.verify();
	});
});
