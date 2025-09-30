# Runner Event Normalization

Status: Draft
Owner: Edge worker team
Last Updated: 2025-09-26

## Why

Multi-runner support currently streams raw stdout/stderr lines back to Linear. The edge worker has to implement CLI-specific parsing (Codex timestamps, OpenCode SSE payloads, Claude streaming), which leads to brittle heuristics inside `EdgeWorker.startNonClaudeRunner`. Codex support just required inlining a large parser to strip timestamps, merge multi-line blocks, and detect `___LAST_MESSAGE_MARKER___`, which should live with the adapter that knows the CLI dialect.

## Goals

- Push CLI-specific parsing down into the corresponding runner adapter.
- Provide a normalized event contract so the edge worker can route thoughts/responses without caring about source CLI.
- Ensure final responses (marked by `___LAST_MESSAGE_MARKER___` or CLI-native equivalents) are emitted as dedicated events so sessions close automatically.
- Maintain backward compatibility for Claude streaming.

## Non-goals

- Changing how prompts are assembled or how tools are gated.
- Restructuring persistence or webhook handling.
- Implementing resume semantics for Codex (still pending CLI support).

## Proposed Event Model

Extend `RunnerEvent` with richer semantics:

```ts
export type RunnerEvent =
  | { kind: "thought"; text: string }
  | { kind: "action"; name: string; detail?: string }
  | { kind: "response"; text: string }
  | { kind: "final"; text: string }
  | { kind: "log"; text: string } // optional for debug
  | { kind: "error"; error: Error };
```

Adapters are responsible for mapping CLI output to these events:

- **Claude**: emits structured streaming messages; map assistant deltas to `thought`, tool notifications to `action`, completion to `final`.
- **Codex**: run with `codex exec --json` and parse each JSON object:
  - `msg.type === "agent_reasoning"` → `thought`
  - `msg.type === "agent_message"` or explicit `"final"` payload → `final`
  - Tool invocations (`tool_call`, `tool_result`, etc.) → `action`
  - `token_count`, `status`, `task_started` → `log`
  - `error` payloads → `error`
- **OpenCode**: SSE packets become `thought` or `action` depending on event type; completion yields `final`.

`RunnerStartResult` gains optional `capabilities` to advertise support for follow-up prompts, tool streams, etc.

## Edge Worker Changes

- Replace direct `postThought` calls in `startNonClaudeRunner` with a switch on normalized events.
- Only keep CLI-agnostic plumbing: posting thoughts/actions, posting final response once, stopping runners on follow-ups/stops.
- Error events still surface as thoughts unless preceded by `final`.

## Migration Plan

1. Update `packages/agent-runner/src/types.ts` with the new event union and `RunnerStartResult` shape.
2. Refactor adapters to emit normalized events:
   - Move current Codex parsing from `EdgeWorker` into `CodexRunnerAdapter`.
   - Claude/OpenCode adapters can stub new event kinds (mapping old `text` to `thought`). Follow-up work can expand them.
3. Adjust `EdgeWorker.startNonClaudeRunner` to handle normalized events and remove Codex-specific parsing.
4. Add integration coverage that feeds captured Codex logs and asserts `final` emission closes the session.

## Open Questions

- Should adapters expose a teardown hook to flush buffered events before the process exits?
- Do we need an explicit `progress` event to represent repeated `tokens used` messages for analytics?
- How do we surface tool invocations consistently between Claude (streaming) and Codex (stdout logs)?

## Risks

- Adapters must replicate any error normalization previously done at the edge worker level.
- We need to ensure the optional `log` events do not spam Linear; they should be opt-in for debugging.

## Next Steps

- Implement the interface changes in code.
- Update docs/specs for runner interface to reference this model.
- Capture regression tests for Codex final marker handling.
