# Tools Configuration Research

## Codex Built-in Tools

Codex has a different tool model compared to Claude Code. It uses a shell-centric approach.

### Core Execution Model

Codex primarily uses shell commands via `/bin/zsh -lc` (or equivalent shell):

```json
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls",...}}
```

### Tool Types in Codex

Based on research and the TypeScript SDK:

#### 1. Shell Commands (`command_execution`)
- Primary execution mechanism
- Commands run through the system shell
- Output captured in `aggregated_output`
- Exit codes tracked

#### 2. File Operations (`file_change`)
- Handled via patch application
- Tracks add/delete/update operations
- Status can be completed or failed

#### 3. MCP Tool Calls (`mcp_tool_call`)
- Integration with Model Context Protocol servers
- Server name and tool name tracked
- Arguments and results captured

#### 4. Web Search (`web_search`)
- Enabled via `--search` flag
- Uses OpenAI's native web search tool

### Sandbox Modes

Unlike Claude's `allowedTools`/`disallowedTools` approach, Codex uses sandbox modes:

```bash
# Read-only mode (default for exec)
codex exec "prompt"

# Workspace write access
codex exec --sandbox workspace-write "prompt"
# Or using --full-auto (workspace-write + auto-approve)
codex exec --full-auto "prompt"

# Full access (DANGEROUS)
codex exec --sandbox danger-full-access "prompt"
```

### Approval Policies

```bash
-a, --ask-for-approval <APPROVAL_POLICY>
    - untrusted:  Only "trusted" commands run without approval
    - on-failure: Ask only if command fails
    - on-request: Model decides when to ask
    - never:      Never ask for approval
```

### No Direct Tool Filtering

Codex doesn't have Claude-style tool filtering (`allowedTools`, `disallowedTools`).
Instead, it relies on:
1. Sandbox mode for permission control
2. Approval policy for execution gating
3. MCP server tool filtering (see MCP research)

### Implementation for CodexRunner

```typescript
interface CodexRunnerConfig extends AgentRunnerConfig {
  // Sandbox mode
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";

  // Approval policy (for non-exec mode or manual mode)
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";

  // Auto-approve everything (uses --dangerously-bypass-approvals-and-sandbox)
  autoApprove?: boolean;

  // Full-auto mode (workspace-write + on-request)
  fullAuto?: boolean;

  // Enable web search
  webSearchEnabled?: boolean;

  // Additional writable directories
  additionalDirectories?: string[];
}

class CodexRunner {
  private buildArgs(): string[] {
    const args = ["exec", "--json"];

    if (this.config.autoApprove) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      if (this.config.fullAuto) {
        args.push("--full-auto");
      } else {
        if (this.config.sandboxMode) {
          args.push("--sandbox", this.config.sandboxMode);
        }
        if (this.config.approvalPolicy) {
          args.push("--ask-for-approval", this.config.approvalPolicy);
        }
      }
    }

    if (this.config.webSearchEnabled) {
      args.push("--search");
    }

    if (this.config.workingDirectory) {
      args.push("--cd", this.config.workingDirectory);
    }

    for (const dir of this.config.additionalDirectories || []) {
      args.push("--add-dir", dir);
    }

    return args;
  }
}
```

### Comparison Table

| Aspect | ClaudeRunner | GeminiRunner | CodexRunner |
|--------|--------------|--------------|-------------|
| Tool Model | Named tools (Read, Edit, Bash) | Named tools (read_file, write_file) | Shell commands + file ops |
| Filtering | allowedTools/disallowedTools | No direct filtering | Sandbox mode |
| Permissions | Per-tool basis | Auto-approve via --yolo | Sandbox mode + approval policy |
| File Ops | Edit, Write, Read tools | write_file, read_file | Patch application |
| Network | WebFetch tool | Limited | Web search via --search |

### Key Differences

1. **Shell-centric**: Codex runs commands through shell, not discrete tools
2. **Sandbox over Filtering**: Uses execution sandboxing instead of tool whitelists
3. **Simpler Model**: Fewer tool types, more reliance on shell capabilities
4. **MCP for Extensions**: Additional tools come via MCP servers
