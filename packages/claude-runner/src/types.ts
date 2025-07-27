import type { SDKMessage, SDKSystemMessage, SDKUserMessage, SDKAssistantMessage, SDKResultMessage, McpServerConfig } from '@anthropic-ai/claude-code'

export interface ClaudeRunnerConfig {
  workingDirectory?: string
  allowedTools?: string[]
  allowedDirectories?: string[]
  resumeSessionId?: string  // Session ID to resume from previous Claude session
  workspaceName?: string
  systemPrompt?: string
  appendSystemPrompt?: string  // Additional prompt to append to the default system prompt
  mcpConfigPath?: string | string[]  // Single path or array of paths to compose
  mcpConfig?: Record<string, McpServerConfig>  // Additional/override MCP servers
  onMessage?: (message: SDKMessage) => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
  onComplete?: (messages: SDKMessage[]) => void | Promise<void>
}

export interface ClaudeSessionInfo {
  sessionId: string | null  // Initially null until first message received
  startedAt: Date
  isRunning: boolean
}

export interface ClaudeRunnerEvents {
  'message': (message: SDKMessage) => void
  'assistant': (content: string) => void
  'tool-use': (toolName: string, input: any) => void
  'text': (text: string) => void
  'end-turn': (lastText: string) => void
  'error': (error: Error) => void | Promise<void>
  'complete': (messages: SDKMessage[]) => void | Promise<void>
}

// Re-export SDK types for convenience
export type { SDKMessage, SDKSystemMessage, SDKUserMessage, SDKAssistantMessage, SDKResultMessage, McpServerConfig } from '@anthropic-ai/claude-code'
// Re-export Anthropic API message types
export type { Message as APIAssistantMessage, MessageParam as APIUserMessage } from '@anthropic-ai/sdk/resources/messages.js'
// Type aliases for re-export
export type ClaudeSystemMessage = SDKSystemMessage
export type ClaudeUserMessage = SDKUserMessage
export type ClaudeAssistantMessage = SDKAssistantMessage
export type ClaudeResultMessage = SDKResultMessage
