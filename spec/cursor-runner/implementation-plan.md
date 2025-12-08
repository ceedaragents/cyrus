# CursorRunner Implementation Plan

## Overview

This document outlines the implementation plan for adding a `CursorRunner` to the Cyrus monorepo, following the patterns established by `ClaudeRunner` and `GeminiRunner`.

## Package Structure

```
packages/cursor-runner/
├── src/
│   ├── CursorRunner.ts        # Main runner implementation
│   ├── SimpleCursorRunner.ts  # Simple enumerated response wrapper
│   ├── adapters.ts            # Cursor → SDK message format converters
│   ├── formatter.ts           # Tool message formatting for Linear
│   ├── types.ts               # TypeScript type definitions
│   └── index.ts               # Package exports
├── test/
│   ├── CursorRunner.test.ts
│   ├── adapters.test.ts
│   └── formatter.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Implementation Components

### 1. CursorRunner Class

The main runner class implementing `IAgentRunner` interface:

```typescript
import { CursorAgent, AgentResponseStream, InteractionUpdate } from "@cursor-ai/january";
import { EventEmitter } from "events";
import { IAgentRunner } from "cyrus-core";

export class CursorRunner extends EventEmitter implements IAgentRunner {
  private agent: CursorAgent;
  private activeStream: AgentResponseStream | null = null;

  constructor(config: CursorRunnerConfig) {
    super();
    this.agent = new CursorAgent({
      apiKey: config.apiKey || process.env.CURSOR_API_KEY,
      model: config.model,
      workingLocation: {
        type: "local",
        localDirectory: config.workingDirectory,
      },
    });
  }

  async start(prompt: string): Promise<CursorSessionInfo> {
    // Implementation
  }

  // Note: Cursor SDK doesn't support streaming input
  // supportsStreamingInput = false
}
```

### 2. Configuration Interface

```typescript
interface CursorRunnerConfig {
  // Required
  apiKey?: string;              // Falls back to CURSOR_API_KEY env var
  workingDirectory: string;
  cyrusHome: string;
  workspaceName: string;

  // Optional
  model?: string;               // e.g., "claude-4-sonnet", "gpt-4o"

  // Callbacks
  onMessage?: (message: SDKMessage) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;

  // Note: These are NOT supported by Cursor SDK
  // - maxTurns (not exposed)
  // - systemPrompt (not exposed)
  // - disallowedTools (not exposed)
  // - mcpConfig (built into SDK)
}
```

### 3. Message Adapter

Convert Cursor's `InteractionUpdate` to Cyrus SDK messages:

```typescript
// adapters.ts
export function cursorUpdateToSDKMessage(
  update: InteractionUpdate,
  sessionId: string
): SDKMessage | null {
  switch (update.type) {
    case "text-delta":
      return createAssistantTextDelta(update, sessionId);
    case "tool-call-started":
      return createToolUseStart(update, sessionId);
    case "tool-call-completed":
      return createToolResult(update, sessionId);
    case "thinking-delta":
      return createThinkingDelta(update, sessionId);
    // ... etc
  }
}

export function cursorConversationToResult(
  turns: ConversationTurn[],
  sessionId: string
): SDKResultMessage {
  // Extract final response from conversation turns
  const lastTurn = turns[turns.length - 1];
  // Build result message
}
```

### 4. Message Formatter

Format tool calls for Linear display:

```typescript
// formatter.ts
export class CursorMessageFormatter implements IMessageFormatter {
  formatToolParameter(toolName: string, toolInput: unknown): string {
    switch (toolName) {
      case "shell":
        return (toolInput as ShellArgs).command;
      case "read":
        return (toolInput as ReadArgs).path;
      case "write":
        return (toolInput as WriteArgs).path;
      case "edit":
        return (toolInput as EditArgs).path;
      case "mcp":
        return `${(toolInput as McpArgs).providerIdentifier}/${(toolInput as McpArgs).toolName}`;
      // ... etc
    }
  }

  formatToolResult(toolName: string, input: unknown, result: unknown, isError: boolean): string {
    // Format results for Linear comments
  }
}
```

### 5. SimpleCursorRunner

For enumerated response scenarios (like ProcedureAnalyzer):

```typescript
// SimpleCursorRunner.ts
export class SimpleCursorRunner<T extends string> extends SimpleAgentRunner<T> {
  protected async executeAgent(
    prompt: string,
    options?: SimpleAgentQueryOptions
  ): Promise<SDKMessage[]> {
    const runner = new CursorRunner({
      apiKey: process.env.CURSOR_API_KEY,
      workingDirectory: this.config.workingDirectory,
      cyrusHome: this.config.cyrusHome,
      workspaceName: "simple-query",
      model: this.config.model,
    });

    const messages: SDKMessage[] = [];
    runner.on("message", (msg) => messages.push(msg));

    await runner.start(this.buildSystemPrompt() + "\n\n" + prompt);
    return messages;
  }

  protected extractResponse(messages: SDKMessage[]): string {
    // Find last assistant message with text content
    // Clean and validate against validResponses
  }
}
```

## Key Implementation Considerations

### 1. No maxTurns Support

The Cursor SDK doesn't expose `maxTurns`. Sessions run until:
- The agent completes its task
- An error occurs
- The session is aborted via `abort()`

**Mitigation**:
- Implement timeout-based termination at the CursorRunner level
- Document this limitation clearly

### 2. No System Prompt Configuration

The Cursor SDK doesn't allow custom system prompts.

**Mitigation**:
- Prepend instructions to the user prompt
- Document that Cursor uses its own internal system prompt
- This limits use cases where specific agent behavior is required

### 3. No Streaming Input

Unlike Claude and Gemini CLIs which support stdin piping for follow-up messages, Cursor SDK uses `submit()` for each message.

**Mitigation**:
- Set `supportsStreamingInput = false`
- Each interaction requires a new `submit()` call
- Session continuity is maintained internally by the SDK

### 4. MCP Server Configuration

Cursor SDK has built-in MCP support but doesn't expose configuration.

**Mitigation**:
- Document that MCP servers are configured within Cursor's ecosystem
- May not support custom MCP server injection like Claude/Gemini

### 5. Process Model Difference

Cursor SDK uses HTTP/gRPC API calls, not CLI subprocess spawning.

**Benefits**:
- No process management overhead
- Cleaner error handling
- No stdout/stderr parsing

**Considerations**:
- Network dependency
- Different authentication model (API key vs. CLI auth)

## Integration Points

### EdgeWorker Integration

```typescript
// In EdgeWorker, add CursorRunner support
private async createRunner(config: RunnerConfig): Promise<IAgentRunner> {
  switch (config.provider) {
    case "claude":
      return new ClaudeRunner(config);
    case "gemini":
      return new GeminiRunner(config);
    case "cursor":
      return new CursorRunner(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

### ProcedureAnalyzer Integration

```typescript
// Add SimpleCursorRunner as an option
const runnerConfig = {
  validResponses: [...] as const,
  cyrusHome: config.cyrusHome,
  model: config.model || "claude-4-sonnet",
  // ...
};

this.analysisRunner = runnerType === "claude"
  ? new SimpleClaudeRunner(runnerConfig)
  : runnerType === "gemini"
  ? new SimpleGeminiRunner(runnerConfig)
  : new SimpleCursorRunner(runnerConfig);
```

## Testing Strategy

### Unit Tests

1. **CursorRunner.test.ts**
   - Mock `@cursor-ai/january` CursorAgent
   - Test event emission for different InteractionUpdate types
   - Test error handling scenarios
   - Test abort functionality

2. **adapters.test.ts**
   - Test all InteractionUpdate → SDKMessage conversions
   - Test conversation → result message conversion
   - Test edge cases (empty content, missing fields)

3. **formatter.test.ts**
   - Test tool parameter formatting for all tool types
   - Test tool result formatting
   - Test MCP tool formatting

### Integration Tests

1. **Live API tests** (requires CURSOR_API_KEY)
   - Simple prompt completion
   - Tool use scenarios
   - Error handling

## Dependencies

```json
{
  "dependencies": {
    "@cursor-ai/january": "^0.2.1",
    "cyrus-core": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^1.6.1",
    "typescript": "^5.5.0"
  }
}
```

## Limitations Summary

| Feature | Status | Notes |
|---------|--------|-------|
| maxTurns | Not Supported | SDK doesn't expose |
| System Prompt | Not Supported | SDK uses internal prompt |
| Streaming Input | Not Supported | Use multiple submit() calls |
| Custom MCP Config | Limited | Built into SDK |
| Tool Allowlisting | Not Supported | SDK decides tool availability |
| Resume Session | Internal Only | SDK manages internally |

## Estimated Effort

| Component | Complexity | Estimate |
|-----------|------------|----------|
| CursorRunner core | Medium | 2-3 days |
| Message adapters | Medium | 1-2 days |
| Formatter | Low | 0.5-1 day |
| SimpleCursorRunner | Low | 0.5 day |
| Tests | Medium | 2-3 days |
| Integration | Medium | 1-2 days |
| Documentation | Low | 0.5 day |
| **Total** | | **8-12 days** |
