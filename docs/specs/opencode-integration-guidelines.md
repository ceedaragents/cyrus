# OpenCode Integration Guidelines (Deferred)

Status: Reference only – implementation postponed while the Codex adapter ships.

These notes capture the research and design decisions from the earlier
OpenCode spike so we can re-add the adapter in a future cycle without starting
from scratch.

## Goals

- Reuse the generic `Runner` interface from `packages/agent-runner`
- Drive OpenCode through its local HTTP API (no CLI dependency)
- Stream assistant updates back to Linear using the existing non-Claude event
  path in the edge worker
- Preserve session IDs so follow-up prompts can resume the same OpenCode state

## HTTP Surface

| Endpoint | Purpose |
| --- | --- |
| `POST /session` | Create a session. Response includes `session.id` used for all follow-up calls |
| `POST /session/:id/command` | Send prompt/command payload (`SessionPrompt.CommandInput`) |
| `GET /event` | SSE stream of `MessageV2` events (filter by `sessionID`) |
| `POST /session/:id/permissions/:permissionID` | Respond to tool permission requests |
| `PUT /auth/:provider` | Seed credentials (`{"type":"api","key":"sk-…"}` for OpenAI) |

Key types live in `packages/opencode/src/session/prompt.ts` and
`packages/opencode/src/session/message-v2.ts`.

## Runner Adapter Sketch

```ts
const response = await fetch(`${serverUrl}/session`, { method: "POST", body })
const { id: sessionId } = await response.json()

const eventSource = new EventSource(`${serverUrl}/event`)
eventSource.onmessage = (evt) => {
  const payload = JSON.parse(evt.data)
  if (payload.properties?.sessionID !== sessionId) return

  // Map MessageV2 parts to RunnerEvent
}

await fetch(`${serverUrl}/session/${sessionId}/command`, { method: "POST", body })
```

Translate streamed `MessageV2` data into `RunnerEvent`s:

- `text` parts → `kind: "thought"`
- `tool` parts → `kind: "action"`
- `error` field → `kind: "error"`
- Completion message → `kind: "final"`

Persist `sessionId` via `PersistenceManager` so follow-up prompts can reuse the
OpenCode conversation.

## Configuration Shape

Add to `EdgeWorkerConfig.cliDefaults` when re-enabling:

```ts
cliDefaults?: {
  opencode?: {
    serverUrl?: string;      // default http://localhost:17899
    provider?: string;       // default "openai"
    model?: string;          // e.g. "o4-mini"
  }
}
```

Per repository overrides mirror Codex:

```ts
runnerModels?: {
  opencode?: {
    provider?: string
    model?: string
  }
}
```

Label routing rules can select `runner: "opencode"` and optionally override
`provider`/`model`.

## Edge Worker Hooks

When the adapter is restored:

1. `resolveRunnerSelection` should include an `opencode` branch
2. `startNonClaudeRunner` stores session IDs in a dedicated cache
3. The SSE handler needs reconnection logic (backoff + one retry)
4. Permission events should call `POST /session/:id/permissions/:permissionID`

## Validation & Troubleshooting

- `cyrus validate` can hit `GET ${serverUrl}/health` (or `/`) and report status
- During `cyrus connect-openai`, call `PUT /auth/openai` automatically if
  `cliDefaults.opencode.serverUrl` is present
- Log helpful guidance when the server is unreachable (e.g. "Run
  `opencode serve --port 17899`")

Keep this document in sync with upstream OpenCode changes before resuming the
adapter work.
