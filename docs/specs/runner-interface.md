Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] RunnerConfig/RunnerEvent interfaces
- [x] Adapters: Claude, Codex, OpenCode
- [x] Factory + package layout
- [ ] Ready for Implementation

# Runner Interface & Adapters

Purpose: Provide a uniform API for different CLIs (Claude, Codex, OpenCode) that matches the architecture described in [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md).

Package Layout
- Create a new package: `packages/agent-runner`
  - Exports the interfaces, factory, and concrete adapters.
  - Keeps `edge-worker` focused on orchestration only and shares utilities with [`docs/specs/edge-worker-integration.md`](edge-worker-integration.md).

TypeScript Interfaces (reference)

```ts
export type RunnerType = "claude" | "codex" | "opencode";

export interface RunnerConfigBase {
  type: RunnerType;
  cwd: string; // workspace path (git worktree)
  prompt: string; // initial prompt (built by EdgeWorker)
}

export interface CodexOptions {
  model?: string; // eg. "o3", "o4-mini"
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
}

export interface OpenCodeOptions {
  provider?: string; // eg. "openai"
  model?: string;    // eg. "o4-mini"
  serverUrl?: string; // eg. http://localhost:17899
}

export type RunnerConfig =
  | (RunnerConfigBase & { type: "claude"; model?: string; fallbackModel?: string })
  | (RunnerConfigBase & { type: "codex" } & CodexOptions)
  | (RunnerConfigBase & { type: "opencode" } & OpenCodeOptions);

export type RunnerEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input?: unknown }
  | { kind: "result"; summary?: string }
  | { kind: "error"; error: Error };

export interface Runner {
  start(onEvent: (e: RunnerEvent) => void): Promise<{ sessionId?: string }>;
  stop(): Promise<void>;
}

export interface RunnerFactory {
  create(config: RunnerConfig): Runner;
}
```

Adapters

1) ClaudeRunnerAdapter
- Wraps `cyrus-claude-runner` (existing). No behavior change.
- Emits `text` for assistant tokens, `tool` for tool-use, `result` at end.

2) CodexRunnerAdapter
- Spawns `codex exec` with flags (non-interactive):
  - `--cd <cwd>`
  - `-m <model>` if set
  - `--approval-policy <...>` if set
  - `--sandbox <...>` if set
  - prompt as the final argument (quoted)
- Environment:
  - Pass through `OPENAI_API_KEY` if present
- Streaming:
  - Pipe `stdout` line-by-line to `onEvent({ kind: "text", text: line })`
  - On exit code 0 emit `result`; on non-zero emit `error`

3) OpenCodeRunnerAdapter
- HTTP client to OpenCode server:
  - `POST /session?directory=<cwd>` → returns `{ id }`
  - `POST /session/:id/command?directory=<cwd>` with body matching `SessionPrompt.CommandInput`:
    ```json
    {
      "parts": [{ "type": "text", "text": "<prompt>" }],
      "model": { "providerID": "openai", "modelID": "o4-mini" }
    }
    ```
  - `GET /event` (SSE) and filter events for that session id
- Streaming:
  - Map `MessageV2` text parts to `RunnerEvent.text`
  - Emit `result` when OpenCode signals completion (or after a quiet timeout)

Resume Support (initial posture)
- Codex: Defer until stable `codex exec resume` and session id capture are available. Implementation should surface a TODO tied to the Phase 3 rollout in [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md).
- OpenCode: Support resume by caching `session.id` keyed by the Linear agent session id and sending additional `/session/:id/command` calls (bridge hooks defined in [`docs/specs/edge-worker-integration.md`](edge-worker-integration.md)).

Error handling (all adapters)
- If start() throws: emit a single `error` event then reject/return.
- If stop(): terminate processes / unsubscribe SSE listeners.

Dependencies to add (Phase 2)
- `eventsource` (or native `fetch` + `ReadableStream` in Node 20+) for SSE consumption.
- Lightweight HTTP utilities (prefer native `fetch`; fall back to `node-fetch`) shared between runner adapters and EdgeWorker helpers.

## Definition of Done

- `packages/agent-runner` exposes `Runner`, `RunnerConfig`, `RunnerEvent`, and a factory aligned with [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md).
- Claude, Codex, and OpenCode adapter responsibilities include spawn/auth/stream semantics and error posture described above.
- Resume guidance calls out Codex deferment and OpenCode session reuse, matching [`docs/specs/edge-worker-integration.md`](edge-worker-integration.md).
- Dependency notes keep adapters lightweight and compatible with the EdgeWorker runtime.
