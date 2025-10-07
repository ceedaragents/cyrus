# Runner JSON Refactor Plan

Status: Draft
Owner: Edge worker team
Last Updated: 2025-09-30

## Background

Codex CLI exposes a stable `--json` flag that streams structured events (reasoning, user-facing messages, tool invocations, token counts, final output). Our current plaintext parser misses final messages when the CLI continues emitting telemetry (e.g., `tokens used`), leaving Linear sessions open until manual stop.

Additionally, the edge worker hard-codes `--sandbox read-only`, preventing Codex from editing files when the user desires more autonomy.

## Goals

- Switch Codex integration to `codex exec --json` and feed normalized events to the edge worker.
- Remove legacy plaintext parsing path and rely solely on adapter-level normalization.
- Allow Codex sandbox/approval policy to come from config rather than forcing read-only.
- Confirm Claude and OpenCode adapters emit normalized events and drop fallback logic.

## Non-goals

- Reworking prompt construction or tool selection.
- Implementing Codex session resume (future enhancement).

## Tasks

1. **Documentation updates**
   - Update `docs/specs/runner-interface.md` and `docs/specs/runner-event-normalization.md` with the JSON message schema, event mapping, and capability flag.
   - Note the sandbox configuration change in `docs/multi-cli-runner-spec.md` (Codex defaults now derived from config only).

2. **Adapter changes**
- Modify `CodexRunnerAdapter` to spawn `codex exec --json`, parse JSON lines, and emit normalized events.
   - Remove the existing plaintext buffer parsing logic.
   - Ensure errors include raw payload context for debugging.

3. **Edge worker adjustments**
   - Pass sandbox/approval flags from config (or defaults) without forcing `--sandbox read-only`.
   - Accept capability flag from start result (log when JSON streaming is active).
   - Clean up legacy event cases (`text`, `tool`, `result`) once all adapters use normalized events.

4. **Other adapters**
   - Verify Claude/OpenCode adapters emit normalized events only, updating code/comments as needed.
   - Remove fallback code from the edge worker once verification passes.

5. **Testing**
   - Unit test Codex adapter: feed sample JSON lines (reasoning, message, final) and assert normalized events.
   - Integration/regression: run codex session end-to-end; ensure final message closes Linear session automatically.
   - Regression for Claude/OpenCode flows to guard against regressions.

6. **Cleanup**
   - Delete now-unused helper functions from `EdgeWorker.startNonClaudeRunner`.
   - Capture telemetry ideas (token usage) for follow-up.

## Risks

- JSON format changes in future Codex releases; mitigate by validating `type` fields and logging unknown values.
- Edge environments without `codex` binary; ensure adapter errors bubble up clearly.

## Success Criteria

- Codex sessions emit a final response and auto-complete without manual stop.
- Edge worker respects user-configured sandbox/approval settings.
- Normalized event pipeline handles Claude, Codex, OpenCode consistently.
