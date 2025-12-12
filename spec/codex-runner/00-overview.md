# Codex Runner Implementation Spec

## Overview

This specification documents the research and implementation plan for adding a **CodexRunner** to the Cyrus codebase, following the same patterns established by ClaudeRunner and GeminiRunner.

## Codex CLI Summary

- **Version**: codex-cli 0.63.0
- **Source**: OpenAI Codex project (Rust-based CLI with TypeScript SDK)
- **Repository**: https://github.com/openai/codex

## Key Differences from Gemini Runner

| Aspect | GeminiRunner | CodexRunner (Proposed) |
|--------|--------------|------------------------|
| CLI Binary | `gemini` | `codex` |
| Output Format | `--output-format stream-json` | `--json` (JSONL) |
| Execution Mode | Interactive with `--yolo` | Non-interactive `exec` subcommand |
| Settings File | `~/.gemini/settings.json` | `~/.codex/config.toml` |
| SDK Available | No (CLI-only) | Yes (`@openai/codex` TypeScript SDK) |

## Implementation Options

### Option A: TypeScript SDK Integration
Use the official `@openai/codex` TypeScript SDK which wraps the CLI binary internally.

**Pros:**
- Clean TypeScript API
- Handles binary spawning internally
- Type definitions for events/items
- Thread management built-in

**Cons:**
- Less control over process lifecycle
- SDK bundles its own CLI binary (larger package size)
- May be harder to customize for our needs

### Option B: Direct CLI Integration (Recommended)
Spawn `codex exec --json` directly, similar to GeminiRunner.

**Pros:**
- Full control over process lifecycle
- Consistent with GeminiRunner pattern
- Smaller footprint (uses system-installed codex)
- Direct access to all CLI flags

**Cons:**
- Need to implement event parsing ourselves
- Handle JSONL stream manually

**Recommendation**: Option B (Direct CLI) for consistency with GeminiRunner and full control.

## Research Areas

Each area has been researched and documented in separate files:

1. [maxTurns/maxSessionTurns](./01-max-turns.md)
2. [System Prompt](./02-system-prompt.md)
3. [Stream-JSON Schema](./03-stream-json-schema.md)
4. [Result/Final Message](./04-result-handling.md)
5. [Tools Configuration](./05-tools.md)
6. [Streaming Stdin](./06-streaming-stdin.md)
7. [MCP Servers](./07-mcp-servers.md)
8. [SDK vs CLI Approach](./08-sdk-vs-cli.md)

## File Structure (Proposed)

```
packages/codex-runner/
├── src/
│   ├── CodexRunner.ts          # Main runner class (~600-800 lines)
│   ├── adapters.ts             # Codex event → SDK message conversion
│   ├── formatter.ts            # CodexMessageFormatter
│   ├── schemas.ts              # Zod validation for Codex events
│   ├── configGenerator.ts      # ~/.codex/config.toml management
│   ├── types.ts                # TypeScript interfaces
│   └── index.ts                # Public exports
├── test/
│   ├── CodexRunner.test.ts
│   └── adapters.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```
