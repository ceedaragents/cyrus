# Stream-JSON Schema Research

## Codex JSONL Output Format

Codex uses `--json` flag with the `exec` subcommand to produce JSONL (JSON Lines) output.

```bash
codex exec --json "your prompt here"
```

## Event Types

Based on the TypeScript SDK (`sdk/typescript/src/events.ts`) and Rust source (`codex-rs/exec/src/exec_events.rs`):

### ThreadEvent Union

```typescript
type ThreadEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | ItemStartedEvent
  | ItemUpdatedEvent
  | ItemCompletedEvent
  | ThreadErrorEvent;
```

### Event Definitions

#### Thread Lifecycle

```typescript
// First event emitted
type ThreadStartedEvent = {
  type: "thread.started";
  thread_id: string;  // UUID for resumption
};

// Fatal error
type ThreadErrorEvent = {
  type: "error";
  message: string;
};
```

#### Turn Lifecycle

```typescript
type TurnStartedEvent = {
  type: "turn.started";
};

type TurnCompletedEvent = {
  type: "turn.completed";
  usage: Usage;
};

type TurnFailedEvent = {
  type: "turn.failed";
  error: { message: string };
};

type Usage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
};
```

#### Item Events

```typescript
type ItemStartedEvent = {
  type: "item.started";
  item: ThreadItem;
};

type ItemUpdatedEvent = {
  type: "item.updated";
  item: ThreadItem;
};

type ItemCompletedEvent = {
  type: "item.completed";
  item: ThreadItem;
};
```

## ThreadItem Types

### Command Execution
```typescript
type CommandExecutionItem = {
  id: string;
  type: "command_execution";
  command: string;           // e.g., "/bin/zsh -lc ls"
  aggregated_output: string; // stdout/stderr combined
  exit_code: number | null;  // null when in_progress
  status: "in_progress" | "completed" | "failed";
};
```

### File Changes
```typescript
type FileChangeItem = {
  id: string;
  type: "file_change";
  changes: Array<{
    path: string;
    kind: "add" | "delete" | "update";
  }>;
  status: "completed" | "failed";
};
```

### Agent Message
```typescript
type AgentMessageItem = {
  id: string;
  type: "agent_message";
  text: string;  // Natural language or JSON structured output
};
```

### Reasoning
```typescript
type ReasoningItem = {
  id: string;
  type: "reasoning";
  text: string;  // Brief reasoning summary (e.g., "**Listing files in directory**")
};
```

### MCP Tool Call
```typescript
type McpToolCallItem = {
  id: string;
  type: "mcp_tool_call";
  server_name: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: "in_progress" | "completed" | "failed";
};
```

### Web Search
```typescript
type WebSearchItem = {
  id: string;
  type: "web_search";
  query: string;
};
```

### Todo List
```typescript
type TodoListItem = {
  id: string;
  type: "todo_list";
  items: Array<{
    text: string;
    completed: boolean;
  }>;
};
```

## Real Example Output

From actual test run:
```json
{"type":"thread.started","thread_id":"019ae047-d040-7891-8d68-5dd42b18474e"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Listing files in directory**"}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"README.md\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"README.md\n\ndone"}}
{"type":"turn.completed","usage":{"input_tokens":6651,"cached_input_tokens":6144,"output_tokens":39}}
```

## Comparison with Gemini

| Aspect | Gemini | Codex |
|--------|--------|-------|
| Format Flag | `--output-format stream-json` | `--json` |
| Thread ID | Not present | `thread_id` in `thread.started` |
| Turn Events | No explicit turn events | `turn.started`, `turn.completed`, `turn.failed` |
| Delta Messages | Yes, needs accumulation | No, items are complete |
| Usage Stats | In result event | In `turn.completed` event |
| Item IDs | Varies | Sequential `item_0`, `item_1`, etc. |

## Key Differences for Implementation

1. **No Delta Accumulation Needed**: Unlike Gemini, Codex items are complete when emitted
2. **Thread ID Available**: Can use for session resumption
3. **Turn Events**: Clear lifecycle for tracking agent activity
4. **Simpler Item Flow**: `item.started` → `item.updated` (optional) → `item.completed`

## Zod Schema (Proposed)

```typescript
import { z } from "zod";

const UsageSchema = z.object({
  input_tokens: z.number(),
  cached_input_tokens: z.number(),
  output_tokens: z.number(),
});

const ThreadStartedEventSchema = z.object({
  type: z.literal("thread.started"),
  thread_id: z.string(),
});

const TurnStartedEventSchema = z.object({
  type: z.literal("turn.started"),
});

const TurnCompletedEventSchema = z.object({
  type: z.literal("turn.completed"),
  usage: UsageSchema,
});

// ... additional schemas for all event types

const ThreadEventSchema = z.discriminatedUnion("type", [
  ThreadStartedEventSchema,
  TurnStartedEventSchema,
  TurnCompletedEventSchema,
  TurnFailedEventSchema,
  ItemStartedEventSchema,
  ItemUpdatedEventSchema,
  ItemCompletedEventSchema,
  ThreadErrorEventSchema,
]);
```
