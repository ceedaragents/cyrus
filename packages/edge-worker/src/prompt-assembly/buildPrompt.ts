/**
 * Unified prompt assembly system
 *
 * This module provides a single, clear entry point for assembling prompts
 * with well-defined inputs and outputs. All prompt assembly logic flows
 * through buildPrompt() for consistency and testability.
 */

import type { Issue as LinearIssue } from "@linear/sdk";
import type {
	CyrusAgentSession,
	LinearWebhookAgentSession,
	LinearWebhookGuidanceRule,
	RepositoryConfig,
} from "cyrus-core";
import type { SubroutineDefinition } from "../procedures/types.js";
import type {
	IssueContextResult,
	PromptAssembly,
	PromptAssemblyInput,
	PromptComponent,
	PromptType,
} from "./types.js";

/**
 * Build a complete prompt assembly for a Claude session
 *
 * This is the single entry point for all prompt assembly. It handles:
 * - New sessions: issue context + subroutine prompt + user comment
 * - Existing sessions: user comment + attachments
 * - Streaming sessions: pass through user comment as-is
 *
 * @param input - All information needed to assemble the prompt
 * @param helpers - Injected helper functions (for testability)
 * @returns Complete prompt assembly with metadata
 */
export async function buildPrompt(
	input: PromptAssemblyInput,
	helpers: PromptAssemblyHelpers,
): Promise<PromptAssembly> {
	// If actively streaming, just pass through the comment
	if (input.isStreaming) {
		return buildStreamingPrompt(input);
	}

	// If new session, build full prompt with all components
	if (input.isNewSession) {
		return buildNewSessionPrompt(input, helpers);
	}

	// Existing session continuation - just user comment + attachments
	return buildContinuationPrompt(input);
}

/**
 * Build prompt for actively streaming session
 * Just passes through the user comment as-is
 */
function buildStreamingPrompt(input: PromptAssemblyInput): PromptAssembly {
	const components: PromptComponent[] = ["user-comment"];
	if (input.attachmentManifest) {
		components.push("attachment-manifest");
	}

	const parts: string[] = [input.userComment];
	if (input.attachmentManifest) {
		parts.push(input.attachmentManifest);
	}

	return {
		systemPrompt: undefined,
		userPrompt: parts.join("\n\n"),
		metadata: {
			components,
			promptType: "continuation",
			isNewSession: false,
			isStreaming: true,
		},
	};
}

/**
 * Build prompt for new session
 * Includes: issue context + subroutine prompt + user comment
 */
async function buildNewSessionPrompt(
	input: PromptAssemblyInput,
	helpers: PromptAssemblyHelpers,
): Promise<PromptAssembly> {
	const components: PromptComponent[] = [];
	const parts: string[] = [];

	// 1. Determine system prompt from labels
	const systemPrompt = await helpers.determineSystemPrompt(
		input.labels || [],
		input.repository,
	);

	// 2. Build issue context using appropriate builder
	const promptType = determinePromptType(input, !!systemPrompt);
	const issueContext = await helpers.buildIssueContext(
		input.fullIssue,
		input.repository,
		promptType,
		input.attachmentManifest,
		input.guidance,
		input.agentSession,
	);

	parts.push(issueContext.prompt);
	components.push("issue-context");

	// 3. Load and append initial subroutine prompt
	const currentSubroutine = helpers.getCurrentSubroutine(input.session);
	if (currentSubroutine) {
		const subroutinePrompt =
			await helpers.loadSubroutinePrompt(currentSubroutine);
		if (subroutinePrompt) {
			parts.push(subroutinePrompt);
			components.push("subroutine-prompt");
		}
	}

	// 4. Add user comment (if present)
	if (input.userComment.trim()) {
		parts.push(`User comment: ${input.userComment}`);
		components.push("user-comment");
	}

	// 5. Add guidance rules (if present)
	if (input.guidance && input.guidance.length > 0) {
		components.push("guidance-rules");
	}

	return {
		systemPrompt,
		userPrompt: parts.join("\n\n"),
		metadata: {
			components,
			subroutineName: currentSubroutine?.name,
			promptType,
			isNewSession: true,
			isStreaming: false,
		},
	};
}

/**
 * Build prompt for existing session continuation
 * Includes: user comment + attachments
 */
function buildContinuationPrompt(input: PromptAssemblyInput): PromptAssembly {
	const components: PromptComponent[] = ["user-comment"];
	const parts: string[] = [input.userComment];

	if (input.attachmentManifest) {
		parts.push(input.attachmentManifest);
		components.push("attachment-manifest");
	}

	return {
		systemPrompt: undefined,
		userPrompt: parts.join("\n\n"),
		metadata: {
			components,
			promptType: "continuation",
			isNewSession: false,
			isStreaming: false,
		},
	};
}

/**
 * Determine which prompt type to use based on input flags
 */
function determinePromptType(
	input: PromptAssemblyInput,
	hasSystemPrompt: boolean,
): PromptType {
	if (input.isMentionTriggered && input.isLabelBasedPromptRequested) {
		return "label-based-prompt-command";
	}
	if (input.isMentionTriggered) {
		return "mention";
	}
	if (hasSystemPrompt) {
		return "label-based";
	}
	return "fallback";
}

/**
 * Helper functions that must be injected for buildPrompt to work
 * This allows for easy mocking in tests
 */
export interface PromptAssemblyHelpers {
	/**
	 * Determine system prompt from issue labels
	 */
	determineSystemPrompt(
		labels: string[],
		repository: RepositoryConfig,
	): Promise<string | undefined>;

	/**
	 * Build issue context using the appropriate prompt builder
	 */
	buildIssueContext(
		issue: LinearIssue,
		repository: RepositoryConfig,
		promptType: PromptType,
		attachmentManifest?: string,
		guidance?: LinearWebhookGuidanceRule[],
		agentSession?: LinearWebhookAgentSession,
	): Promise<IssueContextResult>;

	/**
	 * Get the current subroutine for a session
	 */
	getCurrentSubroutine(session: CyrusAgentSession): SubroutineDefinition | null;

	/**
	 * Load a subroutine prompt file
	 */
	loadSubroutinePrompt(
		subroutine: SubroutineDefinition,
	): Promise<string | null>;
}
