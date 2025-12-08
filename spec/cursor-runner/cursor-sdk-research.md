# Cursor Agent SDK Research (@cursor-ai/january)

## Package Overview

- **Package Name**: `@cursor-ai/january` (codename for preview SDK)
- **Version**: 0.2.1
- **Type**: ESM module with CJS fallback
- **Dependencies**: `@bufbuild/protobuf`, `@connectrpc/connect`, `@connectrpc/connect-node`, `zod`

## Core API

### CursorAgent Class

```typescript
import { CursorAgent, type WorkingLocation } from "@cursor-ai/january";

const agent = new CursorAgent({
  apiKey: string,           // Required: CURSOR_API_KEY
  model?: string,           // Optional: e.g., "claude-4-sonnet", "gpt-4o"
  workingLocation?: WorkingLocation,  // Local directory or GitHub repo
});

// Submit a message and get streaming response
const { stream, conversation, abort } = agent.submit({
  message: string,
  images?: Array<{ type: "base64"; data: string }>,
  model?: string,           // Override model for this request
  onStep?: (args: { step: ConversationStep }) => void | Promise<void>,
  onDelta?: (args: { update: InteractionUpdate }) => void | Promise<void>,
});
```

### WorkingLocation Types

```typescript
type WorkingLocation =
  | { type: "local"; localDirectory?: string }
  | { type: "github"; repository: string; ref?: string };
```

## Streaming Architecture

### AgentResponseStream

The `AgentResponseStream` implements `AsyncIterable<InteractionUpdate>`:

```typescript
for await (const update of stream) {
  switch (update.type) {
    case "user-message-appended": // User message added
    case "thinking-delta":        // Thinking text chunk
    case "thinking-completed":    // Thinking finished
    case "text-delta":            // Assistant text chunk
    case "tool-call-started":     // Tool invocation began
    case "partial-tool-call":     // Tool call in progress
    case "tool-call-completed":   // Tool finished with result
    case "summary":               // Summary text
    case "summary-started":       // Summary began
    case "summary-completed":     // Summary finished
    case "token-delta":           // Token count update
    case "shell-output-delta":    // Shell command output
    case "turn-ended":            // Turn completed
  }
}

// Wait for completion
await stream.done;

// Or get full conversation
const turns = await conversation;
```

### InteractionUpdate Types

```typescript
type InteractionUpdate =
  | TextDeltaUpdate
  | ToolCallStartedUpdate
  | ToolCallCompletedUpdate
  | ThinkingDeltaUpdate
  | ThinkingCompletedUpdate
  | UserMessageAppendedUpdate
  | PartialToolCallUpdate
  | TokenDeltaUpdate
  | SummaryUpdate
  | SummaryStartedUpdate
  | SummaryCompletedUpdate
  | ShellOutputDeltaUpdate
  | TurnEndedUpdate;
```

## Available Tools

The SDK exposes these built-in tools:

| Tool | Description |
|------|-------------|
| `shell` | Execute shell commands |
| `write` | Write file contents |
| `delete` | Delete files |
| `glob` | Find files by pattern |
| `grep` | Search file contents |
| `read` | Read file contents |
| `edit` | Edit/replace file content |
| `ls` | List directory contents |
| `readLints` | Read lint results |
| `mcp` | MCP tool invocation |
| `semSearch` | Semantic search |
| `createPlan` | Create execution plan |
| `updateTodos` | Update todo list |

### Tool Call Structure

```typescript
interface ToolCall {
  type: ToolType;  // "shell" | "write" | "delete" | etc.
  args: Record<string, unknown>;  // Tool-specific arguments
  result?: {
    status: "success" | "error";
    value?: unknown;
    error?: unknown;
  };
}
```

## MCP Integration

### MCP Tool Naming Convention

MCP tools follow the pattern: `mcp__provider__tool`

Examples:
- `mcp__github__create_issue`
- `mcp__filesystem__read_file`
- `mcp__database__query_table`

### MCP Tool Args

```typescript
interface McpArgs {
  args?: Record<string, unknown>;
  providerIdentifier?: string;
  toolName?: string;
}
```

### MCP Tool Result

```typescript
interface McpSuccess {
  content: Array<{
    text?: { text: string };
    image?: { data: string; mimeType?: string };
  }>;
  isError: boolean;
}
```

## Conversation Types

### ConversationTurn

```typescript
type ConversationTurn = AgentConversationTurn | ShellConversationTurn;

interface AgentConversationTurn {
  type: "agent";
  steps: ConversationStep[];
}

interface ShellConversationTurn {
  type: "shell";
  command: ShellCommand;
  output: ShellOutput;
}
```

### ConversationStep

```typescript
type ConversationStep =
  | { type: "assistantMessage"; message: { text: string } }
  | { type: "toolCall"; message: ToolCall }
  | { type: "thinkingMessage"; message: { text: string; thinkingDurationMs?: number } }
  | { type: "userMessage"; message: { text: string } };
```

## Error Handling

### Error Classes

```typescript
class CursorAgentError extends Error {
  readonly isRetryable: boolean;
  readonly code?: Code;          // gRPC error code
  readonly cause?: ConnectError;
  readonly protoErrorCode?: ErrorDetails_Error;
}

class AuthenticationError extends CursorAgentError {}  // 401
class RateLimitError extends CursorAgentError {}       // 429
class ConfigurationError extends CursorAgentError {}   // 400, 404
class NetworkError extends CursorAgentError {}         // 503, 504
class UnknownAgentError extends CursorAgentError {}
```

## Key Differences from Claude/Gemini

| Feature | Claude SDK | Gemini CLI | Cursor SDK |
|---------|-----------|------------|------------|
| **maxTurns** | Via SDK config | Via settings.json | Not exposed |
| **System Prompt** | Via `--system` flag or config | Via file (GEMINI_SYSTEM_MD) | Not exposed |
| **Streaming Input** | Yes (stdin piping) | Yes (stdin piping) | No (single message) |
| **Session Resume** | `--continue` flag | Not supported | Internal sessionId |
| **MCP Config** | .mcp.json + inline | settings.json mcpServers | Built-in support |
| **Output Format** | NDJSON | stream-json | AsyncIterable deltas |
| **Result Content** | In result message | Coerced from last assistant | In conversation Promise |
| **Process Model** | CLI subprocess | CLI subprocess | HTTP/gRPC API calls |

## Authentication

The SDK uses API key authentication:

```typescript
const apiKey = process.env.CURSOR_API_KEY;
const agent = new CursorAgent({ apiKey });
```

Backend defaults to `https://app.cursor.sh` but can be overridden via `CURSOR_BACKEND_URL`.
