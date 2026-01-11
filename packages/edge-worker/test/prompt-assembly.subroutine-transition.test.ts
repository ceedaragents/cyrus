/**
 * Prompt Assembly Tests - Subroutine Transition
 *
 * CYPACK-705: Tests that subroutine transition prompts are properly distinguished
 * from regular user comments using the <subroutine_directive> XML wrapper.
 *
 * The fix ensures that when isSubroutineTransition=true, the prompt is wrapped
 * in <subroutine_directive> instead of <new_comment> to clearly signal to Claude
 * that this is a mandatory task switch, not an optional comment.
 */

import { describe, expect, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Subroutine Transition", () => {
	/**
	 * When isSubroutineTransition=true, the prompt should use <subroutine_directive>
	 * wrapper instead of <new_comment> to clearly signal a mandatory task switch.
	 */
	it("should use subroutine_directive wrapper when isSubroutineTransition is true", async () => {
		const worker = createTestWorker();

		const subroutinePrompt = `# Summary - Brief Response for Linear

Generate a concise summary of the work completed for posting to Linear.

## Constraints

- **You have exactly 1 turn** - generate the summary in a single response
- This is the final output that will be posted to Linear`;

		await scenario(worker)
			.continuationSession()
			.withUserComment(subroutinePrompt)
			.withCommentTimestamp("2026-01-10T19:10:56.203Z")
			.withSubroutineTransition(true) // Mark as subroutine transition
			.expectUserPrompt(`<subroutine_directive priority="override">
  <instruction>STOP your current work. This is a mandatory subroutine transition.</instruction>
  <timestamp>2026-01-10T19:10:56.203Z</timestamp>
  <content>
# Summary - Brief Response for Linear

Generate a concise summary of the work completed for posting to Linear.

## Constraints

- **You have exactly 1 turn** - generate the summary in a single response
- This is the final output that will be posted to Linear
  </content>
</subroutine_directive>`)
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment")
			.expectPromptType("continuation")
			.verify();
	});

	/**
	 * Regular user comments should still use <new_comment> wrapper
	 * when isSubroutineTransition is false or undefined.
	 */
	it("should use new_comment wrapper for regular user comments", async () => {
		const worker = createTestWorker();

		await scenario(worker)
			.continuationSession()
			.withUserComment("Please continue with the implementation")
			.withCommentAuthor("Alice Smith")
			.withCommentTimestamp("2026-01-10T19:10:56.203Z")
			.withSubroutineTransition(false) // Not a subroutine transition
			.expectUserPrompt(`<new_comment>
  <author>Alice Smith</author>
  <timestamp>2026-01-10T19:10:56.203Z</timestamp>
  <content>
Please continue with the implementation
  </content>
</new_comment>`)
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment")
			.expectPromptType("continuation")
			.verify();
	});

	/**
	 * When isSubroutineTransition is not set, it should default to regular
	 * user comment behavior (backwards compatibility).
	 */
	it("should default to new_comment wrapper when isSubroutineTransition is undefined", async () => {
		const worker = createTestWorker();

		await scenario(worker)
			.continuationSession()
			.withUserComment("Follow up question")
			.withCommentAuthor("Bob Jones")
			.withCommentTimestamp("2026-01-10T19:10:56.203Z")
			// Not calling withSubroutineTransition - should default to false
			.expectUserPrompt(`<new_comment>
  <author>Bob Jones</author>
  <timestamp>2026-01-10T19:10:56.203Z</timestamp>
  <content>
Follow up question
  </content>
</new_comment>`)
			.expectSystemPrompt(undefined)
			.expectComponents("user-comment")
			.expectPromptType("continuation")
			.verify();
	});

	/**
	 * The subroutine directive should include explicit STOP instruction
	 * to ensure Claude stops its current work.
	 */
	it("should include STOP instruction in subroutine directive", async () => {
		const worker = createTestWorker();

		const result = await scenario(worker)
			.continuationSession()
			.withUserComment("# Git Commit Phase\n\nCommit your changes.")
			.withCommentTimestamp("2026-01-10T19:10:56.203Z")
			.withSubroutineTransition(true)
			.build();

		// Verify the subroutine directive structure
		expect(result.userPrompt).toContain(
			'<subroutine_directive priority="override">',
		);
		expect(result.userPrompt).toContain(
			"<instruction>STOP your current work. This is a mandatory subroutine transition.</instruction>",
		);
		expect(result.userPrompt).toContain("</subroutine_directive>");

		// Verify it does NOT contain <new_comment>
		expect(result.userPrompt).not.toContain("<new_comment>");
	});

	/**
	 * Test that subroutine directive and regular comments are clearly distinguishable.
	 */
	it("should clearly distinguish subroutine prompts from user comments", async () => {
		const worker = createTestWorker();

		// Regular user comment
		const userCommentResult = await scenario(worker)
			.continuationSession()
			.withUserComment("Please continue with the implementation")
			.withCommentAuthor("Alice Smith")
			.withCommentTimestamp("2026-01-10T19:10:56.203Z")
			.withSubroutineTransition(false)
			.build();

		// Subroutine transition prompt
		const subroutineResult = await scenario(worker)
			.continuationSession()
			.withUserComment("# Summary Phase\n\nGenerate a summary...")
			.withCommentTimestamp("2026-01-10T19:10:56.203Z")
			.withSubroutineTransition(true)
			.build();

		// User comment uses <new_comment>
		expect(userCommentResult.userPrompt).toContain("<new_comment>");
		expect(userCommentResult.userPrompt).not.toContain("subroutine_directive");

		// Subroutine uses <subroutine_directive>
		expect(subroutineResult.userPrompt).toContain("subroutine_directive");
		expect(subroutineResult.userPrompt).not.toContain("<new_comment>");
	});

	/**
	 * Test that attachments are still included with subroutine directives.
	 */
	it("should include attachments with subroutine directive", async () => {
		const worker = createTestWorker();

		const attachmentManifest = `## New Attachments

1. screenshot.png - Local path: /path/to/screenshot.png
`;

		const result = await scenario(worker)
			.continuationSession()
			.withUserComment("# Verification Phase\n\nVerify the changes.")
			.withCommentTimestamp("2026-01-10T19:10:56.203Z")
			.withSubroutineTransition(true)
			.withAttachments(attachmentManifest)
			.build();

		// Verify structure
		expect(result.userPrompt).toContain("subroutine_directive");
		expect(result.userPrompt).toContain("## New Attachments");
		expect(result.userPrompt).toContain("screenshot.png");
		expect(result.systemPrompt).toBeUndefined();
		expect(result.metadata.components).toEqual([
			"user-comment",
			"attachment-manifest",
		]);
		expect(result.metadata.promptType).toBe("continuation");
	});
});
