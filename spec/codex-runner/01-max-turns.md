# maxTurns / maxSessionTurns Research

## Codex Turn Limit Configuration

### Current Status: **Not Directly Supported**

Unlike Gemini (which has `maxSessionTurns` in settings.json), Codex CLI does not have a direct equivalent for limiting the number of turns.

### Observation from CLI Help

```
codex exec --help
```

Key flags related to execution:
- `--dangerously-bypass-approvals-and-sandbox` - Auto-execute without prompts
- `--full-auto` - Auto-approve with workspace-write sandbox
- `-a, --ask-for-approval` - Approval policy (untrusted, on-failure, on-request, never)

**No `--max-turns` or similar flag exists.**

### Workarounds

#### 1. Application-Level Control (Recommended)
Since Codex `exec` runs a single turn and exits, the CodexRunner can control turns at the application level:

```typescript
class CodexRunner {
  private turnCount = 0;
  private maxTurns: number;

  async processPrompt(prompt: string): Promise<void> {
    if (this.turnCount >= this.maxTurns) {
      throw new Error(`Max turns (${this.maxTurns}) exceeded`);
    }
    this.turnCount++;
    await this.executeCodexExec(prompt);
  }
}
```

#### 2. Session Resume with Turn Counting
Since each `codex exec` run is a single turn, multi-turn conversations require session resumption:

```bash
# First turn
codex exec --json "First prompt"
# Returns thread_id in thread.started event

# Second turn (resume)
codex exec resume --last "Follow-up prompt"
```

#### 3. TypeScript SDK Approach
The SDK abstracts this via Thread.run():
```typescript
const thread = codex.startThread({ workingDirectory: "/path" });
await thread.run("First prompt");  // Turn 1
await thread.run("Follow-up");     // Turn 2
// Application controls how many times run() is called
```

### Implementation Recommendation

For CodexRunner:

```typescript
interface CodexRunnerConfig extends AgentRunnerConfig {
  maxTurns?: number;  // Optional, defaults to unlimited
}

class CodexRunner {
  private config: CodexRunnerConfig;
  private turnCount = 0;

  private canExecuteTurn(): boolean {
    if (this.config.maxTurns === undefined) return true;
    return this.turnCount < this.config.maxTurns;
  }

  async handleTurnComplete(event: TurnCompletedEvent): Promise<void> {
    this.turnCount++;
    if (!this.canExecuteTurn()) {
      this.emit("complete", this.messages);
    }
  }
}
```

### Comparison Table

| Runner | maxTurns Mechanism |
|--------|-------------------|
| ClaudeRunner | Passed directly to Claude SDK as `maxTurns` option |
| GeminiRunner | Written to `~/.gemini/settings.json` as `maxSessionTurns` |
| CodexRunner | Application-level control (count turns, stop after max) |

### Key Insight

Codex `exec` operates in a **single-turn** model by default:
- Each `codex exec` invocation = 1 turn
- Multi-turn requires explicit session resumption
- The `turn.completed` event marks the end of a turn

This is actually simpler than Gemini's approach - we don't need to configure the CLI, just count turns at the runner level.
