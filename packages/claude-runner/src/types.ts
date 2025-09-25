import type {
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-code";

export interface ClaudeRunnerConfig {
	workingDirectory?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	allowedDirectories?: string[];
	resumeSessionId?: string; // Session ID to resume from previous Claude session
	workspaceName?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string; // Additional prompt to append to the default system prompt
	mcpConfigPath?: string | string[]; // Single path or array of paths to compose
	mcpConfig?: Record<string, McpServerConfig>; // Additional/override MCP servers
	model?: string; // Claude model to use (e.g., "opus", "sonnet", "haiku")
	fallbackModel?: string; // Fallback model if primary model is unavailable
	cyrusHome: string; // Cyrus home directory
	promptVersions?: {
		// Optional prompt template version information
		userPromptVersion?: string;
		systemPromptVersion?: string;
	};
	hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>; // Claude SDK hooks
	onMessage?: (message: SDKMessage) => void | Promise<void>;
	onError?: (error: Error) => void | Promise<void>;
	onComplete?: (messages: SDKMessage[]) => void | Promise<void>;
}

export interface ClaudeSessionInfo {
	sessionId: string | null; // Initially null until first message received
	startedAt: Date;
	isRunning: boolean;
}

export interface ClaudeRunnerEvents {
	message: (message: SDKMessage) => void;
	assistant: (content: string) => void;
	"tool-use": (toolName: string, input: any) => void;
	text: (text: string) => void;
	"end-turn": (lastText: string) => void;
	error: (error: Error) => void | Promise<void>;
	complete: (messages: SDKMessage[]) => void | Promise<void>;
}

// Re-export SDK types for convenience
export type {
	McpServerConfig,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-code";
// Re-export Anthropic API message types
export type {
	Message as APIAssistantMessage,
	MessageParam as APIUserMessage,
} from "@anthropic-ai/sdk/resources/messages.js";
// Type aliases for re-export
export type ClaudeSystemMessage = SDKSystemMessage;
export type ClaudeUserMessage = SDKUserMessage;
export type ClaudeAssistantMessage = SDKAssistantMessage;
export type ClaudeResultMessage = SDKResultMessage;
