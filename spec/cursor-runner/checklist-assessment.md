# Cursor Runner Checklist Assessment

This document assesses each checklist item from the issue for the @cursor-ai/january SDK.

---

## 1. maxTurns / maxSessionTurns

**Status**: NOT SUPPORTED

**Assessment**:
The `@cursor-ai/january` SDK does not expose a `maxTurns` or `maxSessionTurns` configuration option. The `CursorAgentOptions` interface only includes:
- `apiKey: string` (required)
- `model?: string` (optional)
- `workingLocation?: WorkingLocation` (optional)

**How Claude/Gemini handle this**:
- ClaudeRunner: Passes `maxTurns` directly to Claude SDK's `query()` function
- GeminiRunner: Writes `maxSessionTurns` to `~/.gemini/settings.json` under `model` section

**Impact**:
- Sessions run until the agent completes or errors
- Workaround: Implement timeout-based termination at CursorRunner level
- Workaround: Call `abort()` method to terminate long-running sessions

**Recommendation**:
Add optional `timeoutMs` config to CursorRunner that calls `abort()` after timeout.

---

## 2. System Prompt

**Status**: NOT SUPPORTED

**Assessment**:
The `@cursor-ai/january` SDK does not expose system prompt configuration. Neither `CursorAgentOptions` nor `SubmitOptions` include a system prompt parameter.

**How Claude/Gemini handle this**:
- ClaudeRunner: Uses `systemPrompt` config (string or preset), can append via `appendSystemPrompt`
- GeminiRunner: Writes system prompt to file, sets `GEMINI_SYSTEM_MD` env var

**Impact**:
- Cannot customize agent behavior at system level
- Cannot add workspace-specific instructions like subroutine prompts
- Limited to prepending instructions to user prompts

**Recommendation**:
- Document limitation clearly
- Prepend required instructions to user message: `buildPrompt(systemInstructions, userPrompt)`
- May limit Cyrus use cases requiring specific agent personas

---

## 3. Stream-JSON Schema

**Status**: FULLY DOCUMENTED

**Assessment**:
The SDK uses `InteractionUpdate` discriminated union for streaming. Types are well-defined with Zod schemas.

**Stream Event Types**:
```typescript
type InteractionUpdate =
  | { type: "text-delta"; text: string }
  | { type: "tool-call-started"; callId: string; toolCall: ToolCall }
  | { type: "tool-call-completed"; callId: string; toolCall: ToolCall }
  | { type: "thinking-delta"; text: string }
  | { type: "thinking-completed"; thinkingDurationMs: number }
  | { type: "user-message-appended"; userMessage: { text: string } }
  | { type: "partial-tool-call"; callId: string; toolCall: ToolCall }
  | { type: "token-delta"; tokens: number }
  | { type: "summary"; summary: string }
  | { type: "summary-started" }
  | { type: "summary-completed" }
  | { type: "shell-output-delta"; event: unknown }
  | { type: "turn-ended" };
```

**Mapping to Cyrus SDK Messages**:
| Cursor Event | Cyrus SDK Message |
|--------------|-------------------|
| text-delta | SDKAssistantMessage (accumulate) |
| tool-call-started | SDKAssistantMessage (tool_use start) |
| tool-call-completed | SDKUserMessage (tool_result) |
| thinking-delta | SDKThinkingMessage (if supported) |
| turn-ended / stream.done | SDKResultMessage |

---

## 4. Result Handling (Final Message)

**Status**: DIFFERENT FROM CLAUDE

**Assessment**:
Cursor SDK provides final response via `conversation` Promise, NOT in a result message like Claude.

**How it works**:
```typescript
const { stream, conversation } = agent.submit({ message: "..." });

// Option 1: Stream deltas, then get conversation
for await (const delta of stream) { /* handle deltas */ }
const turns = await conversation;

// Option 2: Just wait for conversation
const turns = await agent.submit({ message: "..." }).conversation;
```

**ConversationTurn structure**:
```typescript
type ConversationTurn = {
  type: "agent";
  steps: ConversationStep[];
} | {
  type: "shell";
  command: ShellCommand;
  output: ShellOutput;
};
```

**How Claude/Gemini handle this**:
- ClaudeRunner: Gets `SDKResultMessage` with result content directly in stream
- GeminiRunner: Coerces result from last assistant message (similar approach needed)

**Recommendation**:
Adapter should extract final text from last `ConversationTurn` to build `SDKResultMessage`:
```typescript
function cursorConversationToResult(turns: ConversationTurn[]): SDKResultMessage {
  const lastAgentTurn = turns.filter(t => t.type === "agent").pop();
  const lastStep = lastAgentTurn?.steps.filter(s => s.type === "assistantMessage").pop();
  const resultContent = lastStep?.message.text || "Session completed";
  return {
    type: "result",
    subtype: "success",
    result: resultContent,
    // ...
  };
}
```

---

## 5. Allowed Tools / Tools Configuration

**Status**: NOT CONFIGURABLE

**Assessment**:
The SDK does not expose tool allowlisting/blocklisting. All tools are available by default.

**Available Tools** (from SDK types):
- `shell` - Execute shell commands
- `write` - Write file contents
- `read` - Read file contents
- `edit` - Edit/replace file content
- `delete` - Delete files
- `glob` - Find files by pattern
- `grep` - Search file contents
- `ls` - List directory contents
- `readLints` - Read lint results
- `mcp` - MCP tool invocation
- `semSearch` - Semantic search
- `createPlan` - Create execution plan
- `updateTodos` - Update todo list

**How Claude/Gemini handle this**:
- ClaudeRunner: `allowedTools`, `disallowedTools`, `allowedDirectories` config options
- GeminiRunner: Doesn't expose tool configuration either

**Impact**:
- Cannot restrict agent to read-only operations
- Cannot prevent file modifications for certain subroutines
- Security implications for sandboxing

**Recommendation**:
- Document limitation
- For read-only scenarios, consider using a different provider or relying on Cursor's internal safety measures

---

## 6. Streaming stdin of Prompts

**Status**: NOT SUPPORTED

**Assessment**:
The SDK uses a message-per-call model, not stdin streaming.

**How it works**:
```typescript
// Each message is a separate submit() call
const result1 = agent.submit({ message: "First message" });
await result1.conversation;

const result2 = agent.submit({ message: "Follow-up" });
await result2.conversation;
```

**How Claude/Gemini handle this**:
- ClaudeRunner: `startStreaming()` opens stdin, `addStreamMessage()` pipes additional content
- GeminiRunner: Writes to stdin pipe, critical 500ms timeout handling

**Impact**:
- Cannot inject mid-session prompts while agent is processing
- Each interaction is discrete
- Session state maintained internally by SDK

**Recommendation**:
- Set `supportsStreamingInput = false` on CursorRunner
- Document that follow-up messages require new `submit()` calls
- May affect "mid-implementation prompting" feature

---

## 7. MCP Server Configuration / Custom Tools

**Status**: BUILT-IN BUT NOT CONFIGURABLE

**Assessment**:
The SDK has native MCP support but doesn't expose configuration options.

**MCP Tool Naming Convention**:
```
mcp__<provider>__<tool>
```

Examples from SDK docs:
- `mcp__filesystem__read_file`
- `mcp__github__create_issue`
- `mcp__database__query_table`

**MCP Args Schema**:
```typescript
interface McpArgs {
  args?: Record<string, unknown>;
  providerIdentifier?: string;
  toolName?: string;
}
```

**MCP Result Schema**:
```typescript
interface McpSuccess {
  content: Array<{
    text?: { text: string };
    image?: { data: string; mimeType?: string };
  }>;
  isError: boolean;
}
```

**How Claude/Gemini handle this**:
- ClaudeRunner: Auto-detects `.mcp.json`, accepts `mcpConfigPath`, `mcpConfig` inline
- GeminiRunner: Writes MCP servers to `~/.gemini/settings.json`

**Impact**:
- Cannot inject custom MCP servers like Linear MCP
- Cannot configure Cyrus-specific MCP tools (cyrus-tools)
- MCP servers must be configured in Cursor's own ecosystem

**Recommendation**:
- Document that custom MCP injection is not supported
- Cursor may have its own MCP server configuration (in Cursor app settings?)
- This is a significant limitation for Cyrus integration

---

## Summary Table

| Checklist Item | Status | Impact | Workaround |
|----------------|--------|--------|------------|
| maxTurns | Not Supported | Sessions run indefinitely | Timeout + abort() |
| System Prompt | Not Supported | Cannot customize behavior | Prepend to user prompt |
| Stream Schema | Documented | Need adapters | Map InteractionUpdate → SDKMessage |
| Result Content | Different | Not in stream | Extract from conversation |
| Allowed Tools | Not Configurable | Cannot restrict | None |
| Streaming Input | Not Supported | No mid-session injection | Multiple submit() calls |
| MCP Config | Built-in, Not Configurable | Cannot inject custom MCPs | Use Cursor's config |

---

## Overall Assessment

**Feasibility**: MEDIUM-HIGH

The Cursor SDK can be integrated into Cyrus, but with notable limitations:

### What Works Well:
1. Clean streaming API with typed events
2. Built-in MCP support
3. Good error handling with specific error classes
4. Conversation history management
5. Tool use with detailed result schemas

### Significant Limitations:
1. **No system prompt** - Major limitation for subroutine prompts
2. **No tool restrictions** - Security concern
3. **No MCP injection** - Cannot use Cyrus MCP tools (Linear integration)
4. **No streaming input** - Affects mid-implementation prompting

### Recommendation:
Proceed with implementation, clearly documenting limitations. CursorRunner will be useful for:
- Simple development tasks
- Scenarios where Cursor's default behavior is acceptable
- Users who prefer Cursor's model selection

Not recommended for:
- Complex subroutine orchestration
- Scenarios requiring custom MCP servers
- Read-only or restricted tool scenarios
