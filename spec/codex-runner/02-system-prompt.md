# System Prompt Research

## Codex System Prompt Configuration

### Methods

#### 1. AGENTS.md / CODEX.md Files (Automatic Discovery)

Codex automatically discovers and includes project instructions from:
- `AGENTS.md` (preferred)
- `CODEX.md`
- Fallback filenames configured via `project_doc_fallback_filenames` in config.toml

The current test config shows:
```toml
project_doc_fallback_filenames = ["CODEX.md", "CLAUDE.md"]
```

These files are discovered hierarchically (workspace root, parent directories) and concatenated into the system context.

#### 2. Custom Prompts Directory

Located at `$CODEX_HOME/prompts/` (defaults to `~/.codex/prompts/`):
- Each `.md` file becomes a slash command
- Files can include YAML frontmatter with `description` and `argument-hint`
- Prompts are invoked via `/promptname` in interactive mode

**Not directly applicable for `exec` mode** - these are interactive slash commands.

#### 3. Via Stdin (Prompt as System Context)

For `exec` mode, the prompt itself serves as the instruction:
```bash
codex exec "You are a helpful assistant. Do X and Y."
```

### No Direct System Prompt Flag

Unlike Claude Code (`--system-prompt`) or some other CLIs, Codex exec does not have a `--system-prompt` flag.

### Implementation Options

#### Option A: Prepend to User Prompt
Prepend system instructions to the user prompt:
```typescript
const fullPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${userPrompt}`
  : userPrompt;
await codexExec(fullPrompt);
```

#### Option B: AGENTS.md File Generation
Write a temporary AGENTS.md or CODEX.md file in the working directory:
```typescript
async setupSystemPrompt(systemPrompt: string): Promise<() => void> {
  const agentsPath = path.join(this.workingDirectory, 'AGENTS.md');
  const backup = existsSync(agentsPath) ? readFileSync(agentsPath) : null;

  writeFileSync(agentsPath, systemPrompt);

  return () => {
    if (backup) writeFileSync(agentsPath, backup);
    else unlinkSync(agentsPath);
  };
}
```

#### Option C: Hybrid Approach (Recommended)
Use `appendSystemPrompt` pattern similar to GeminiRunner:
1. Respect existing AGENTS.md/CODEX.md in the workspace
2. Create temporary file for additional system context if needed
3. Prepend critical instructions to user prompt

### Comparison Table

| Runner | System Prompt Method |
|--------|---------------------|
| ClaudeRunner | Direct SDK option (`systemPrompt` or preset) |
| GeminiRunner | File via `GEMINI_SYSTEM_MD` environment variable |
| CodexRunner | AGENTS.md file + prepend to prompt |

### Implementation Recommendation

```typescript
interface CodexRunnerConfig extends AgentRunnerConfig {
  systemPrompt?: string;           // Full system prompt
  appendSystemPrompt?: string;     // Additional context to append
  useAgentsMd?: boolean;           // Write to AGENTS.md (default: true)
}

class CodexRunner {
  private async setupSystemPrompt(): Promise<() => void> {
    const cleanupFns: Array<() => void> = [];

    // If systemPrompt provided and useAgentsMd enabled, write AGENTS.md
    if (this.config.systemPrompt && this.config.useAgentsMd !== false) {
      const agentsPath = path.join(this.workingDirectory, 'AGENTS.md');
      const backup = existsSync(agentsPath) ? readFileSync(agentsPath) : null;

      let content = this.config.systemPrompt;
      if (this.config.appendSystemPrompt) {
        content += '\n\n' + this.config.appendSystemPrompt;
      }

      writeFileSync(agentsPath, content);
      cleanupFns.push(() => {
        if (backup) writeFileSync(agentsPath, backup);
        else unlinkSync(agentsPath);
      });
    }

    return () => cleanupFns.forEach(fn => fn());
  }
}
```

### Key Considerations

1. **AGENTS.md is per-workspace** - Writing this file affects the entire workspace
2. **Git status** - Need to be careful not to commit generated AGENTS.md
3. **Existing files** - Should backup and restore existing AGENTS.md
4. **Cleanup** - Must clean up on runner stop/error
