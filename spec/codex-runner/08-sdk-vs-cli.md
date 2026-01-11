# SDK vs CLI Approach Research

## Decision: CLI Direct vs TypeScript SDK

### Option A: TypeScript SDK (@openai/codex)

The official Codex TypeScript SDK provides a clean wrapper around the CLI.

#### SDK Architecture
```typescript
import { Codex } from "@openai/codex";

const codex = new Codex({
  codexPathOverride: "/path/to/codex",  // Optional
  baseUrl: "https://api.openai.com",     // Optional
  apiKey: process.env.OPENAI_API_KEY,    // Optional
  env: { ... },                           // Custom env vars
});

const thread = codex.startThread({
  model: "gpt-5.1-codex-max",
  sandboxMode: "workspace-write",
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,
  networkAccessEnabled: true,
});

// Streaming mode
for await (const event of thread.runStreamed("Your prompt")) {
  console.log(event);
}

// Or buffered mode
const turn = await thread.run("Your prompt");
console.log(turn.response);
```

#### SDK Pros
- Clean TypeScript API with full type definitions
- Thread/session management built-in
- Handles binary spawning internally
- Multi-turn via `thread.run()` is seamless
- Event types already defined

#### SDK Cons
- **Bundles its own CLI binary**: Larger package, version coupling
- Less control over process lifecycle
- Can't access all CLI flags directly
- SDK may lag behind CLI features
- No `--json` flag exposed - SDK parses events internally

### Option B: CLI Direct (Recommended)

Spawn `codex exec --json` directly, similar to GeminiRunner approach.

#### CLI Architecture
```typescript
import { spawn } from "child_process";

class CodexRunner {
  private process: ChildProcess | null = null;

  async start(prompt: string): Promise<AgentSessionInfo> {
    const args = ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox"];

    if (this.config.workingDirectory) {
      args.push("--cd", this.config.workingDirectory);
    }

    args.push(prompt);

    this.process = spawn("codex", args, {
      env: {
        ...process.env,
        OPENAI_API_KEY: this.config.apiKey,
      },
    });

    // Parse JSONL from stdout
    const rl = readline.createInterface({ input: this.process.stdout });
    for await (const line of rl) {
      const event = JSON.parse(line);
      this.processEvent(event);
    }
  }
}
```

#### CLI Pros
- Full control over process lifecycle
- Consistent with GeminiRunner pattern
- Uses system-installed codex (smaller footprint)
- Direct access to all CLI flags
- Can use latest CLI features immediately
- JSONL output is well-documented

#### CLI Cons
- Need to implement event parsing ourselves
- Session resume requires spawning new process
- Need to handle process lifecycle manually

### Recommendation: **CLI Direct (Option B)**

Reasons:
1. **Consistency**: Matches GeminiRunner's implementation pattern
2. **Control**: Full access to process lifecycle and CLI flags
3. **Footprint**: Uses system codex, no bundled binary
4. **Flexibility**: Can adapt to CLI changes without SDK updates
5. **Simplicity**: Single-turn model aligns with `codex exec` design

### Implementation Comparison

| Aspect | SDK Approach | CLI Direct |
|--------|--------------|------------|
| Package Deps | `@openai/codex` (~10MB+) | None (system codex) |
| Process Control | SDK handles | Manual (spawn/kill) |
| Event Types | Pre-defined | Implement from docs |
| Multi-turn | `thread.run()` loop | Resume via new spawn |
| CLI Flags | Limited exposure | Full access |
| Consistency | Different from Gemini | Same as Gemini |

### Code Structure Comparison

```typescript
// SDK Approach
class CodexSDKRunner implements IAgentRunner {
  private codex: Codex;
  private thread: Thread | null = null;

  async start(prompt: string): Promise<AgentSessionInfo> {
    this.thread = this.codex.startThread(this.threadOptions);
    for await (const event of this.thread.runStreamed(prompt)) {
      this.processEvent(event);
    }
  }
}

// CLI Direct Approach (Recommended)
class CodexRunner implements IAgentRunner {
  private process: ChildProcess | null = null;

  async start(prompt: string): Promise<AgentSessionInfo> {
    this.process = spawn("codex", this.buildArgs(prompt), this.spawnOptions);
    await this.processOutputStream(this.process.stdout);
  }
}
```

### Hybrid Approach (Not Recommended)

Could use SDK types but spawn CLI directly:
- Import types from SDK
- Use SDK's event/item type definitions
- But spawn CLI ourselves

This adds SDK dependency without using its main feature (process management).

### Final Decision

**CLI Direct (Option B)** is the recommended approach:
1. Spawn `codex exec --json` with appropriate flags
2. Parse JSONL output using Zod schemas (like GeminiRunner)
3. Convert Codex events to SDK message types
4. Handle multi-turn via resume command if needed
5. Manage process lifecycle directly

This provides the best balance of consistency, control, and maintainability.
