# Test Drive: Codex App-Server Validation

**Date**: 2026-03-19
**Goal**: Verify the Codex runner uses `codex app-server` end-to-end through the F1 harness.
**Test Repo**: `/tmp/f1-codex-app-server-1773988022`
**Server Env**: `CYRUS_PORT=3631 CYRUS_DEFAULT_RUNNER=codex CYRUS_CODEX_DEFAULT_MODEL=gpt-5.4`

## Verification Results

### Issue-Tracker
- [x] Issue created
- [x] Issue ID returned
- [x] Session created on issue
- [x] Session prompt/elicitation loop worked

### EdgeWorker
- [x] F1 server started in CLI mode
- [x] `SimpleRunner` resolved from config to `codex`
- [x] Codex runner selected `gpt-5.4`
- [x] Codex app-server session produced thought/action activity
- [x] Session posted a final `response` activity

### Renderer / Activities
- [x] Activity timeline recorded elicitation, prompt, thought, action, error, and response entries
- [x] Todo-style plan activity rendered in the timeline
- [x] Action activity rendered from Codex tool usage

## Commands

```bash
cd apps/f1
./f1 init-test-repo --path /tmp/f1-codex-app-server-1773988022

CYRUS_PORT=3631 \
CYRUS_REPO_PATH=/tmp/f1-codex-app-server-1773988022 \
CYRUS_DEFAULT_RUNNER=codex \
CYRUS_CODEX_DEFAULT_MODEL=gpt-5.4 \
bun run apps/f1/server.ts

CYRUS_PORT=3631 ./f1 ping
CYRUS_PORT=3631 ./f1 create-issue \
  --title "Codex app-server validation" \
  --description "Validate Codex end-to-end through F1." \
  --labels codex
CYRUS_PORT=3631 ./f1 start-session --issue-id issue-1
CYRUS_PORT=3631 ./f1 prompt-session --session-id session-1 --message "Use the F1 Test Repository."
CYRUS_PORT=3631 ./f1 view-session --session-id session-1
CYRUS_PORT=3631 ./f1 stop-session --session-id session-1
```

## Key Evidence

- Server startup confirmed the codex path:
  - `[EdgeWorker] 🏃 SimpleRunner type resolved from config.defaultRunner: codex`
- Codex runner initialization appeared in server logs:
  - `[CodexRunner] hasCodexSubscription: true`
  - `[CodexRunner] Configured 4 MCP server(s) for codex config`
  - `[EdgeWorker] cyrus-tools MCP session connected: ...`
- `session-1` timeline showed Codex-selected execution:
  - `Selected procedure: **user-testing**`
  - `Using model: gpt-5.4`
  - action entries from Codex tool usage
  - final `response` activity present

## Observations

- The app-server migration is working: the Codex harness starts, emits tool/thought activity, and reaches a final response path in F1.
- Two pre-existing or adjacent issues were observed during the drive:
  - `SimpleCodexRunner` classification sometimes raises `NoResponseError`, but the worker still falls back to a usable procedure.
  - follow-up summary/plan subroutines can emit `no rollout found for thread id ...` errors in F1.
- The F1 server itself needed CLI-harness wiring fixes for `linearWorkspaces`, a dummy `getClient()`, and env-selectable default runner/model so the codex path could be exercised reliably.

## Conclusion

Pass with caveats. The F1 harness now proves Cyrus can start Codex sessions through the app-server path, surface Codex activities in the timeline, and emit a final response activity. Residual F1 issues remain around classification/summary subroutines, but they did not block validation of the app-server migration itself.
