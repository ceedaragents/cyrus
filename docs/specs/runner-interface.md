Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] RunnerConfig/RunnerEvent interfaces
- [x] Adapters: Claude, Codex, OpenCode
- [x] Factory + package layout
- [x] Ready for Implementation

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

// Normalized events emitted by adapters. See runner-event-normalization.md for details.
export type RunnerEvent =
  | { kind: "thought"; text: string }
  | { kind: "action"; name: string; detail?: string; itemType?: string; icon?: string }
  | { kind: "response"; text: string }
  | { kind: "final"; text: string }
  | { kind: "log"; text: string }
  | { kind: "error"; error: Error };

export interface Runner {
  start(onEvent: (e: RunnerEvent) => void): Promise<{
    sessionId?: string;
    capabilities?: {
      jsonStream?: boolean;
    };
  }>;
  stop(): Promise<void>;
}

export interface RunnerFactory {
  create(config: RunnerConfig): Runner;
}
```

Adapters

1) ClaudeRunnerAdapter
- Wraps `cyrus-claude-runner` (existing). Emits `thought` for assistant deltas, `action` for tool-use metadata, and `final` when Claude completes streaming.

2) CodexRunnerAdapter
- Spawns `codex exec --json` with flags (non-interactive):
  - `--cd <cwd>`
  - `-m <model>` if set
  - `--approval-policy <...>` if set
  - `--sandbox <...>` if set (derived from config; no hard-coded defaults)
  - prompt as the final argument (quoted)
- Environment:
  - Pass through `OPENAI_API_KEY` if present
- Streaming:
  - Parses each JSON line and maps message types to normalized events (see `runner-event-normalization.md`).
  - Emits `capabilities.jsonStream = true` in `RunnerStartResult`.

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
  - Map `MessageV2` payloads to `thought` / `action` events.
  - Emit `final` when OpenCode signals completion (or after a quiet timeout) so the edge worker can publish the summary.

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
