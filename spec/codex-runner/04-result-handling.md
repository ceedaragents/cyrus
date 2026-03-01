# Result / Final Message Handling Research

## How Codex Handles Results

### Key Difference from Gemini

Unlike Gemini (which requires result message coercion), Codex provides the final message directly via `agent_message` item.

### Event Flow

A typical Codex exec session produces this event sequence:

```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Reasoning summary**"}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution",...}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution",...}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Final response here"}}
{"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
```

### Key Observations

1. **`agent_message` contains the final output**
   - The last `item.completed` with `type: "agent_message"` is the final response
   - No coercion needed - the text is already the final answer

2. **`turn.completed` marks session end**
   - Contains usage statistics
   - Emitted after all items are complete

3. **No separate "result" event type**
   - Unlike Claude SDK which has a distinct `result` message type
   - Session completion is signaled by `turn.completed`

### Implementation for CodexRunner

```typescript
// Unlike GeminiRunner, no result coercion needed
class CodexRunner {
  private lastAgentMessage: AgentMessageItem | null = null;

  private processEvent(event: ThreadEvent): void {
    if (event.type === "item.completed") {
      const item = event.item;
      if (item.type === "agent_message") {
        this.lastAgentMessage = item;
      }
      // Convert to SDK message and emit
      const message = this.convertToSDKMessage(event);
      if (message) this.emit("message", message);
    }

    if (event.type === "turn.completed") {
      // Create result message from turn.completed
      const resultMessage: SDKResultMessage = {
        type: "result",
        subtype: "success",
        cost_usd: null,
        duration_ms: this.getDuration(),
        duration_api_ms: null,
        is_error: false,
        num_turns: this.turnCount,
        result: this.lastAgentMessage?.text || "",
        session_id: this.threadId || "",
        total_cost_usd: null,
      };

      // Defer result emission (same pattern as Claude/Gemini runners)
      this.pendingResultMessage = resultMessage;
    }
  }

  private async processStreamComplete(): Promise<void> {
    this.sessionInfo.isRunning = false;

    // Emit deferred result message
    if (this.pendingResultMessage) {
      this.emit("message", this.pendingResultMessage);
    }

    this.emit("complete", this.messages);
  }
}
```

### Mapping to SDK Types

| Codex Event | SDK Message Type |
|-------------|------------------|
| `thread.started` | SDKSystemMessage (session init) |
| `item.*` with `agent_message` | SDKAssistantMessage |
| `item.*` with `command_execution` | SDKAssistantMessage (tool use) |
| `item.*` with `file_change` | SDKAssistantMessage (tool use) |
| `item.*` with `mcp_tool_call` | SDKAssistantMessage (tool use) |
| `turn.completed` | SDKResultMessage |
| `turn.failed` | SDKResultMessage (is_error: true) |

### Comparison Table

| Aspect | ClaudeRunner | GeminiRunner | CodexRunner |
|--------|--------------|--------------|-------------|
| Final Message | In SDK result message | Coerced from lastAssistantMessage | In `agent_message` item |
| Result Event | SDK `result` type | Gemini `result` event | `turn.completed` |
| Coercion Needed | No | Yes (critical) | No |
| Usage Stats | In result message | In result event | In `turn.completed` event |

### Key Takeaway

Codex's event model is simpler than Gemini's:
- No delta message accumulation needed
- No result coercion needed
- Final message clearly identified by `agent_message` type
- Clean turn lifecycle with explicit `turn.completed`

This makes CodexRunner implementation more straightforward than GeminiRunner.
