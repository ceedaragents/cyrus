# Phase 2: OpenCode Adapter

Objective: Use an OpenCode server to process issues; post streaming output to Linear.

Prereqs
- User has OpenCode installed and running locally (see https://opencode.ai/docs). We’ll assume a server URL (default suggestion: http://localhost:17899) or ask the user to provide `cliDefaults.opencode.serverUrl`.
- OPENAI_API_KEY available; we’ll set OpenCode auth via `PUT /auth/openai`.

Acceptance Criteria
- A label can route an issue to OpenCode.
- We create a session in OpenCode for the repo worktree using `?directory=<cwd>`.
- We send a command with the built prompt and selected model/provider.
- We subscribe to SSE `/event` and stream text updates to Linear.
- On completion, final summary thought is posted.
- Subsequent prompts in the same Linear agent session reuse the same OpenCode session (resume) via `/session/:id/command`.

HTTP Integration

Base URL: from repo.runnerModels.opencode?.serverUrl or config.cliDefaults.opencode?.serverUrl

Endpoints (see `packages/opencode/src/server/server.ts`):
- `PUT /auth/:id` with body `{ type: "api", key: "<OPENAI_API_KEY>" }` where `:id` is `openai`
- `POST /session?directory=<cwd>` → returns session info `{ id, ... }`
- `POST /session/:id/command?directory=<cwd>` with JSON body following `SessionPrompt.CommandInput` (simplified):
  ```json
  {
    "parts": [{ "type": "text", "text": "<prompt>" }],
    "model": { "providerID": "openai", "modelID": "o4-mini" }
  }
  ```
- `GET /event` (SSE) → emits events across the system; filter by `sessionID`

Adapter Outline

```ts
export class OpenCodeRunnerAdapter implements Runner {
  constructor(private cfg: Extract<RunnerConfig, { type: 'opencode' }>) {}
  private es?: EventSource;

  async start(onEvent: (e: RunnerEvent) => void) {
    const base = this.cfg.serverUrl!;

    // 1) Ensure auth
    if (process.env.OPENAI_API_KEY) {
      await fetch(`${base}/auth/openai`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: process.env.OPENAI_API_KEY }),
      }).catch(() => {}); // ignore errors; might already be set
    }

    // 2) Create session
    const sres = await fetch(`${base}/session?directory=${encodeURIComponent(this.cfg.cwd)}`, { method: 'POST' });
    const session = await sres.json() as { id: string };
    // TODO: cache `session.id` keyed by Linear agent session id for resume

    // 3) Send command
    await fetch(`${base}/session/${session.id}/command?directory=${encodeURIComponent(this.cfg.cwd)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [{ type: 'text', text: this.cfg.prompt }],
        model: { providerID: this.cfg.provider ?? 'openai', modelID: this.cfg.model },
      }),
    });

    // 4) Stream events
    this.es = new EventSource(`${base}/event`);
    this.es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data?.properties?.sessionID === session.id && data?.type?.includes('message')) {
          const text = extractText(data); // implement extractor from MessageV2
          if (text) onEvent({ kind: 'text', text });
        }
      } catch {}
    };
    this.es.onerror = () => onEvent({ kind: 'error', error: new Error('SSE connection error') });

    return { sessionId: session.id };
  }

  async stop() { this.es?.close?.(); }
}
```

Extractor notes
- The `/event` payloads are Bus events from OpenCode’s server; identify message events and pull text from `MessageV2` parts.
- If messages are sparse, optionally post a concluding `result` after X seconds of inactivity.

EdgeWorker Wiring
- Same as Codex: use resolveRunnerSelection() and startNonClaudeRunner().
- Provide `serverUrl`, `provider`, `model` via selection + cliDefaults.opencode.
- Maintain a map from Linear agent session id → OpenCode session id; for follow‑up prompts (agent activity), post to `/session/:id/command` instead of creating a new session.

Error Handling
- If server is unreachable: post thought instructing how to start OpenCode and set `cliDefaults.opencode.serverUrl`.
- If auth fails: post thought to set `OPENAI_API_KEY` or run `cyrus connect-openai`.

Manual Test Plan
- Configure `cliDefaults.opencode.serverUrl`.
- Add label routing to runner=opencode with provider/model.
- Create a Linear issue; verify streaming thoughts.
