# Test Drive: Cursor ACP Label Validation

**Date**: 2026-03-19
**Goal**: Verify that Cursor sessions run through ACP transport in F1, with Cursor selected via labels.
**Test Repo**: `/tmp/f1-cypack-999-acp-live`
**Server Port**: `3639`

## Verification Results

### Issue-Tracker
- [x] F1 server started successfully
- [x] Issue created with label-based runner selection inputs
- [x] Session created and viewable through F1 CLI

### EdgeWorker
- [x] Repository routed via labels (`primary`)
- [x] Cursor runner selected via label (`cursor`)
- [x] Procedure forced via label (`Orchestrator`) to avoid AI-routing variance during the drive
- [x] Cursor runner launched ACP transport (`acp`)
- [x] Session completed and posted a final `response` activity

### Renderer
- [x] Timeline shows Cursor assistant text from ACP updates
- [x] Timeline shows tool-call activity from ACP `tool_call` / `tool_call_update`
- [x] Session can be paged/viewed via `view-session`
- [x] Session can be stopped cleanly via `stop-session`

## Session Log

### Setup

```bash
apps/f1/f1 init-test-repo --path /tmp/f1-cypack-999-acp-live
mkdir -p /tmp/f1-claude-config-cypack-999
CYRUS_PORT=3639 \
CYRUS_REPO_PATH=/tmp/f1-cypack-999-acp-live \
CURSOR_AGENT_PATH=/tmp/cursor-acp-stub-cypack-999 \
CURSOR_MCP_COMMAND=/tmp/cursor-acp-stub-cypack-999 \
CLAUDE_CONFIG_DIR=/tmp/f1-claude-config-cypack-999 \
bun run apps/f1/server.ts
```

### Drive Commands

```bash
CYRUS_PORT=3639 apps/f1/f1 ping
CYRUS_PORT=3639 apps/f1/f1 create-issue \
  --title "CYPACK-999 cursor ACP label drive final" \
  --description $'Respond with a short sentence proving the Cursor ACP runner executed.\n\n[model=gpt-5.4]' \
  --labels cursor,primary,Orchestrator
CYRUS_PORT=3639 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3639 apps/f1/f1 view-session --session-id session-1 --limit 200
CYRUS_PORT=3639 apps/f1/f1 stop-session --session-id session-1
CYRUS_PORT=3639 apps/f1/f1 view-session --session-id session-1 --limit 20 --offset 0
```

## Key Evidence

- Label-based routing selected the repository:
  - `[RepositoryRouter] Repositories selected: [F1 Test Repository] (label-based routing)`
- Label-based procedure override skipped AI routing:
  - `[EdgeWorker] {session=session-, issue=DEF-1} Using orchestrator-full procedure due to orchestrator label (skipping AI routing)`
- Cursor runner launched the ACP subcommand:
  - `[CursorRunner] Spawn: /tmp/cursor-acp-stub-cypack-999 acp --model auto --sandbox enabled --approve-mcps --trust`
- Cursor ACP text reached the activity timeline:
  - `thought   stub cursor acp response`
- Cursor ACP tool-call lifecycle reached the activity timeline:
  - `action    {"type":"action","action":"Bash (echo stub-acp-tool)",...}`
- Final response activity was posted:
  - `response  stub cursor acp response`

## Result

**PASS**

- F1 live validation now reaches the Cursor runner through ACP transport.
- The `cursor` label selects the Cursor runner as required.
- ACP assistant text and tool-call updates render correctly into session activities.
- The session remains controllable through standard F1 commands.

## Notes

- Two F1-specific regressions surfaced during this drive and were fixed as part of the validation:
  - `apps/f1/server.ts` needed a seeded `linearWorkspaces` entry for CLI mode.
  - `McpConfigService` needed to skip `cyrus-tools` injection when the issue tracker does not expose a Linear client (CLI/F1 mode).
- The live drive also caught two ACP runner regressions that were fixed before the passing run:
  - the runner argv was missing the `acp` subcommand
  - the child process was spawned with `stdin` ignored instead of piped
