# Streaming Stdin Research

## Codex Stdin Prompt Handling

### exec Mode Prompt Input

```bash
# Via argument
codex exec "your prompt here"

# Via stdin (use "-" as prompt argument)
echo "your prompt here" | codex exec -

# Implicit stdin (no prompt argument)
codex exec < prompt.txt
```

### Key Insight: Single-Turn Model

Unlike Claude Code (which supports streaming multi-message input), Codex `exec`:
- Accepts a single prompt
- Runs to completion
- Exits

For multi-turn conversations, you must **resume** the session:
```bash
# First turn
codex exec --json "First prompt"
# Get thread_id from thread.started event

# Second turn - resume last session
codex exec resume --last "Follow-up prompt"

# Or resume specific session
codex exec resume <thread_id> "Follow-up prompt"
```

### Streaming Within a Turn

Within a single turn, Codex handles everything internally:
- It streams events to stdout (with `--json`)
- Tool results are handled internally
- No need to send additional input during a turn

### Implementation for CodexRunner

Since Codex doesn't support streaming input within a turn (like Claude's `addStreamMessage`), we have two options:

#### Option A: Single-Prompt Model (Simpler)
```typescript
class CodexRunner {
  readonly supportsStreamingInput = false;  // Different from Claude/Gemini

  async start(prompt: string): Promise<AgentSessionInfo> {
    return this.executeCodexExec(prompt);
  }

  // No startStreaming, addStreamMessage, or completeStream methods
}
```

#### Option B: Multi-Turn via Resume (Full Compatibility)
```typescript
class CodexRunner {
  readonly supportsStreamingInput = true;  // Emulated via resume

  private promptQueue: string[] = [];
  private threadId: string | null = null;

  async startStreaming(initialPrompt?: string): Promise<AgentSessionInfo> {
    if (initialPrompt) {
      this.promptQueue.push(initialPrompt);
    }
    this.processNextPrompt();
    return this.sessionInfo;
  }

  addStreamMessage(content: string): void {
    this.promptQueue.push(content);
    // Process if not currently running
    if (!this.isExecuting) {
      this.processNextPrompt();
    }
  }

  completeStream(): void {
    this.streamComplete = true;
  }

  private async processNextPrompt(): Promise<void> {
    if (this.promptQueue.length === 0) return;

    this.isExecuting = true;
    const prompt = this.promptQueue.shift()!;

    if (this.threadId) {
      // Resume existing session
      await this.executeResume(this.threadId, prompt);
    } else {
      // Start new session
      await this.executeCodexExec(prompt);
      // threadId is set from thread.started event
    }

    this.isExecuting = false;

    // Process next prompt if available
    if (this.promptQueue.length > 0) {
      await this.processNextPrompt();
    } else if (this.streamComplete) {
      this.finishSession();
    }
  }
}
```

### Recommendation

**Option A (Single-Prompt Model)** is recommended because:
1. Aligns with Codex's design philosophy
2. Simpler implementation
3. Each EdgeWorker interaction is typically a single turn anyway
4. Avoids complexity of managing multi-turn state

The EdgeWorker can handle multi-turn at a higher level if needed.

### Comparison Table

| Aspect | ClaudeRunner | GeminiRunner | CodexRunner |
|--------|--------------|--------------|-------------|
| Streaming Input | Yes (StreamingPrompt) | Yes (stdin writes) | No (single prompt) |
| Multi-Turn | Via SDK session | Manual stdin | Via resume command |
| Initial Prompt | Queued in StreamingPrompt | Written to stdin immediately | CLI argument |
| Additional Input | addStreamMessage() | addStreamMessage() to stdin | New resume invocation |
| Stream End | completeStream() | stdin.end() | N/A (turn completes naturally) |

### TypeScript SDK Approach

The official SDK handles multi-turn via Thread.run():
```typescript
const thread = codex.startThread();
await thread.run("First prompt");   // Waits for completion
await thread.run("Second prompt");  // Resumes internally
```

This is essentially what Option B implements manually, but using the SDK would be cleaner if we choose that route.
