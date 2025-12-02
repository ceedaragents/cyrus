# Codex Runner Implementation Specification

## Executive Summary

This document provides the complete specification for implementing a **CodexRunner** package in the Cyrus codebase. The CodexRunner will integrate OpenAI's Codex CLI with the existing EdgeWorker infrastructure, following the patterns established by ClaudeRunner and GeminiRunner.

---

## 1. Architecture Decision

### Approach: Direct CLI Integration

After evaluating both the TypeScript SDK and direct CLI approaches, **Direct CLI Integration** is recommended:

| Criteria | SDK | CLI Direct |
|----------|-----|------------|
| Package Size | ~10MB+ (bundled binary) | 0 (system codex) |
| Process Control | Limited | Full |
| Consistency | Different from Gemini | Same as Gemini |
| Flexibility | SDK abstractions | Full CLI access |

**Decision**: Spawn `codex exec --json` directly, parsing JSONL output.

---

## 2. Package Structure

```
packages/codex-runner/
├── src/
│   ├── CodexRunner.ts          # Main runner class
│   ├── adapters.ts             # Codex event → SDK message conversion
│   ├── formatter.ts            # CodexMessageFormatter
│   ├── schemas.ts              # Zod validation schemas
│   ├── configGenerator.ts      # Config.toml management
│   ├── types.ts                # TypeScript interfaces
│   └── index.ts                # Public exports
├── test/
│   ├── CodexRunner.test.ts
│   ├── adapters.test.ts
│   └── schemas.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 3. Interface Compliance

### IAgentRunner Implementation

```typescript
class CodexRunner extends EventEmitter implements IAgentRunner {
  readonly supportsStreamingInput = false;  // Single-turn model

  async start(prompt: string): Promise<AgentSessionInfo>;
  stop(): void;
  isRunning(): boolean;
  getMessages(): AgentMessage[];
  getFormatter(): IMessageFormatter;

  // Optional methods (not implemented for Codex single-turn model)
  // startStreaming?(): Promise<AgentSessionInfo>;
  // addStreamMessage?(content: string): void;
  // completeStream?(): void;
}
```

### Configuration Interface

```typescript
interface CodexRunnerConfig extends AgentRunnerConfig {
  // Codex-specific options
  codexPath?: string;                    // Path to codex binary (default: "codex")
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
  autoApprove?: boolean;                 // Use --dangerously-bypass-approvals-and-sandbox
  fullAuto?: boolean;                    // Use --full-auto
  webSearchEnabled?: boolean;            // Enable --search
  additionalDirectories?: string[];      // Additional writable directories
  skipGitRepoCheck?: boolean;            // Skip git repo validation
}
```

---

## 4. JSONL Event Schema

### Event Types

```typescript
// Thread lifecycle
type ThreadStartedEvent = { type: "thread.started"; thread_id: string };
type TurnStartedEvent = { type: "turn.started" };
type TurnCompletedEvent = { type: "turn.completed"; usage: Usage };
type TurnFailedEvent = { type: "turn.failed"; error: { message: string } };
type ThreadErrorEvent = { type: "error"; message: string };

// Item events
type ItemStartedEvent = { type: "item.started"; item: ThreadItem };
type ItemUpdatedEvent = { type: "item.updated"; item: ThreadItem };
type ItemCompletedEvent = { type: "item.completed"; item: ThreadItem };
```

### Item Types

```typescript
type ThreadItem =
  | CommandExecutionItem
  | FileChangeItem
  | AgentMessageItem
  | ReasoningItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem;

interface CommandExecutionItem {
  id: string;
  type: "command_execution";
  command: string;
  aggregated_output: string;
  exit_code: number | null;
  status: "in_progress" | "completed" | "failed";
}

interface FileChangeItem {
  id: string;
  type: "file_change";
  changes: Array<{ path: string; kind: "add" | "delete" | "update" }>;
  status: "completed" | "failed";
}

interface AgentMessageItem {
  id: string;
  type: "agent_message";
  text: string;
}

interface ReasoningItem {
  id: string;
  type: "reasoning";
  text: string;
}

interface McpToolCallItem {
  id: string;
  type: "mcp_tool_call";
  server_name: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: "in_progress" | "completed" | "failed";
}
```

---

## 5. Event to SDK Message Mapping

| Codex Event | SDK Message Type | Notes |
|-------------|------------------|-------|
| `thread.started` | SDKSystemMessage | Contains thread_id for resume |
| `item.*` with `agent_message` | SDKAssistantMessage | Text content |
| `item.*` with `command_execution` | SDKAssistantMessage | Tool use block |
| `item.*` with `file_change` | SDKAssistantMessage | Tool use block |
| `item.*` with `mcp_tool_call` | SDKAssistantMessage | Tool use block |
| `item.*` with `reasoning` | SDKAssistantMessage | Text content |
| `turn.completed` | SDKResultMessage | Contains usage stats |
| `turn.failed` | SDKResultMessage | is_error: true |

### Adapter Implementation

```typescript
function codexEventToSDKMessage(
  event: ThreadEvent,
  sessionId: string | null,
  lastAgentMessage?: AgentMessageItem | null
): SDKMessage | null {
  switch (event.type) {
    case "thread.started":
      return createSystemMessage(event.thread_id);

    case "item.completed":
      return convertItemToMessage(event.item, sessionId);

    case "turn.completed":
      return createResultMessage(event.usage, lastAgentMessage);

    case "turn.failed":
      return createErrorResultMessage(event.error);

    default:
      return null;
  }
}
```

---

## 6. Message Formatter

### CodexMessageFormatter Implementation

```typescript
class CodexMessageFormatter implements IMessageFormatter {
  formatToolParameter(toolName: string, toolInput: any): string {
    switch (toolName) {
      case "command_execution":
        return toolInput.command;
      case "file_change":
        return toolInput.changes.map((c: any) => c.path).join(", ");
      case "mcp_tool_call":
        return `${toolInput.server_name}:${toolInput.tool_name}`;
      default:
        return JSON.stringify(toolInput);
    }
  }

  formatToolResult(toolName: string, toolInput: any, result: string, isError: boolean): string {
    if (isError) return `\`\`\`\n${result}\n\`\`\``;

    switch (toolName) {
      case "command_execution":
        return `\`\`\`bash\n${toolInput.command}\n\`\`\`\n\n\`\`\`\n${result}\n\`\`\``;
      case "file_change":
        return `*Files modified: ${toolInput.changes.length}*`;
      default:
        return result.includes("\n") ? `\`\`\`\n${result}\n\`\`\`` : result;
    }
  }
}
```

---

## 7. Configuration Management

### Config.toml Generation

Codex uses TOML configuration at `~/.codex/config.toml`. The runner must:

1. **Backup existing config** before modifications
2. **Merge MCP servers** from `.mcp.json` and inline config
3. **Convert format** from SDK McpServerConfig to Codex TOML format
4. **Restore on cleanup** when runner stops

```typescript
interface CodexMcpServerConfig {
  transport: "stdio" | "streamable_http";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  bearer_env_var?: string;
  headers?: Record<string, string>;
  startup_timeout?: { secs: number };
  tool_timeout?: { secs: number };
  enabled_tools?: string[];
  disabled_tools?: string[];
  enabled?: boolean;
}

async function setupCodexConfig(mcpServers: Record<string, McpServerConfig>): Promise<() => void> {
  const configPath = path.join(process.env.HOME, '.codex', 'config.toml');
  const backup = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : null;

  const config = TOML.parse(backup || '');
  config.mcp_servers = convertMcpServers(mcpServers);

  writeFileSync(configPath, TOML.stringify(config));

  return () => {
    if (backup) writeFileSync(configPath, backup);
    else unlinkSync(configPath);
  };
}
```

---

## 8. System Prompt Handling

Codex uses AGENTS.md for system prompts. Options:

1. **Prepend to user prompt** (simple, recommended)
2. **Generate temporary AGENTS.md** (more complex)

```typescript
private buildPrompt(userPrompt: string): string {
  if (this.config.appendSystemPrompt) {
    return `${this.config.appendSystemPrompt}\n\n---\n\n${userPrompt}`;
  }
  return userPrompt;
}
```

---

## 9. Process Lifecycle

### Start Flow

```typescript
async start(prompt: string): Promise<AgentSessionInfo> {
  const cleanup = await this.setupCodexConfig();
  this.cleanupFn = cleanup;

  const args = this.buildArgs(prompt);
  this.process = spawn("codex", args, this.spawnOptions);

  const rl = readline.createInterface({ input: this.process.stdout });

  for await (const line of rl) {
    const event = this.parseEvent(line);
    if (event) {
      const message = this.convertToSDKMessage(event);
      if (message) {
        this.messages.push(message);
        this.emit("message", message);
      }
    }
  }

  return this.sessionInfo;
}
```

### CLI Arguments

```typescript
private buildArgs(prompt: string): string[] {
  const args = ["exec", "--json"];

  if (this.config.autoApprove) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (this.config.fullAuto) {
    args.push("--full-auto");
  } else {
    if (this.config.sandboxMode) {
      args.push("--sandbox", this.config.sandboxMode);
    }
  }

  if (this.config.workingDirectory) {
    args.push("--cd", this.config.workingDirectory);
  }

  if (this.config.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  if (this.config.webSearchEnabled) {
    args.push("--search");
  }

  for (const dir of this.config.additionalDirectories || []) {
    args.push("--add-dir", dir);
  }

  if (this.config.model) {
    args.push("--model", this.config.model);
  }

  args.push(prompt);
  return args;
}
```

---

## 10. Session Resume (Multi-Turn)

Codex supports multi-turn via session resume:

```bash
# First turn
codex exec --json "First prompt"
# → Emits thread.started with thread_id

# Subsequent turns
codex exec resume <thread_id> "Follow-up prompt"
```

For CodexRunner:
- Track `thread_id` from `thread.started` event
- Store in session info for potential resume
- EdgeWorker handles multi-turn at higher level

---

## 11. Key Differences from GeminiRunner

| Aspect | GeminiRunner | CodexRunner |
|--------|--------------|-------------|
| Delta Messages | Requires accumulation | No accumulation needed |
| Result Coercion | Required | Not needed |
| Config Format | JSON (settings.json) | TOML (config.toml) |
| Streaming Input | Supported | Not supported (single-turn) |
| Session Resume | Manual stdin | Via resume command |
| Tool Execution | Named tools | Shell commands |

---

## 12. Dependencies

```json
{
  "dependencies": {
    "cyrus-core": "workspace:*",
    "@iarna/toml": "^3.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 13. Implementation Phases

### Phase 1: Core Runner (MVP)
- [ ] Package scaffolding
- [ ] Zod schemas for all event types
- [ ] Basic CodexRunner with start/stop
- [ ] Event to SDK message adapter
- [ ] CodexMessageFormatter

### Phase 2: Configuration
- [ ] Config.toml management
- [ ] MCP server conversion
- [ ] System prompt handling
- [ ] Logging setup

### Phase 3: EdgeWorker Integration
- [ ] Register runner type in EdgeWorker
- [ ] Configuration passing
- [ ] Integration tests

### Phase 4: Polish
- [ ] Session resume support
- [ ] Error handling improvements
- [ ] Documentation
- [ ] Performance optimization

---

## 14. Testing Strategy

### Unit Tests
- Event parsing (Zod schemas)
- Adapter conversion logic
- Formatter output
- Config generation

### Integration Tests
- Full exec cycle with mock CLI
- MCP server configuration
- Error handling

### E2E Tests (Manual)
- Real Codex CLI with test repository
- Multi-turn via resume
- MCP tool calls

---

## 15. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Codex CLI API changes | Pin to specific version, test on upgrade |
| TOML parsing complexity | Use battle-tested `@iarna/toml` package |
| Single-turn limitation | Document clearly, EdgeWorker handles |
| Config.toml conflicts | Backup/restore with cleanup function |

---

## Appendix: Example JSONL Output

```json
{"type":"thread.started","thread_id":"019ae047-d040-7891-8d68-5dd42b18474e"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Listing files in directory**"}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"README.md\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"README.md\n\ndone"}}
{"type":"turn.completed","usage":{"input_tokens":6651,"cached_input_tokens":6144,"output_tokens":39}}
```
