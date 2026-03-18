import type {
	CanUseTool,
	OutputFormat,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
	AskUserQuestionInput,
	AskUserQuestionResult,
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
} from "cyrus-core";

export interface ClaudeContainerBridgeProcessConfig {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export interface SerializableClaudeSystemPromptPreset {
	type: "preset";
	preset: "claude_code";
	append?: string;
}

export type SerializableClaudeSystemPrompt =
	| string
	| SerializableClaudeSystemPromptPreset;

export interface SerializableClaudeBridgeConfig {
	workingDirectory?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	allowedDirectories?: string[];
	resumeSessionId?: string;
	model?: string;
	fallbackModel?: string;
	tools?: string[];
	maxTurns?: number;
	systemPrompt?: SerializableClaudeSystemPrompt;
	mcpConfig?: Record<string, McpServerConfig>;
	outputFormat?: OutputFormat;
	extraArgs?: Record<string, string | null>;
	enableDefaultPostToolUseHooks?: boolean;
	env?: Record<string, string>;
}

export type ClaudeBridgeHostMessage =
	| {
			type: "start";
			prompt: string;
			config: SerializableClaudeBridgeConfig;
	  }
	| {
			type: "startStreaming";
			initialPrompt?: string;
			config: SerializableClaudeBridgeConfig;
	  }
	| {
			type: "stream-message";
			content: string;
	  }
	| {
			type: "complete-stream";
	  }
	| {
			type: "ask-user-question-result";
			requestId: string;
			result: AskUserQuestionResult;
	  }
	| {
			type: "stop";
	  };

export type ClaudeBridgeChildMessage =
	| {
			type: "sdk-message";
			message: SDKMessage;
	  }
	| {
			type: "ask-user-question";
			requestId: string;
			input: AskUserQuestionInput;
			sessionId: string | null;
	  }
	| {
			type: "complete";
	  }
	| {
			type: "error";
			message: string;
	  };

export type SerializableHooks = Partial<
	Record<HookEvent, HookCallbackMatcher[]>
>;

export interface ClaudeBridgeContext {
	config: SerializableClaudeBridgeConfig;
	prompt: string | AsyncIterable<SDKUserMessage>;
	canUseTool?: CanUseTool;
	hooks?: SerializableHooks;
}
