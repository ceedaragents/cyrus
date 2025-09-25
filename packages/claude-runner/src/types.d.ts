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
	resumeSessionId?: string;
	workspaceName?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string;
	mcpConfigPath?: string | string[];
	mcpConfig?: Record<string, McpServerConfig>;
	model?: string;
	fallbackModel?: string;
	cyrusHome: string;
	promptVersions?: {
		userPromptVersion?: string;
		systemPromptVersion?: string;
	};
	hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
	onMessage?: (message: SDKMessage) => void | Promise<void>;
	onError?: (error: Error) => void | Promise<void>;
	onComplete?: (messages: SDKMessage[]) => void | Promise<void>;
}
export interface ClaudeSessionInfo {
	sessionId: string | null;
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
export type {
	McpServerConfig,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-code";
export type {
	Message as APIAssistantMessage,
	MessageParam as APIUserMessage,
} from "@anthropic-ai/sdk/resources/messages.js";
export type ClaudeSystemMessage = SDKSystemMessage;
export type ClaudeUserMessage = SDKUserMessage;
export type ClaudeAssistantMessage = SDKAssistantMessage;
export type ClaudeResultMessage = SDKResultMessage;
//# sourceMappingURL=types.d.ts.map
