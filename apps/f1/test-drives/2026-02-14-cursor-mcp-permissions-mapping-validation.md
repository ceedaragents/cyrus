# Test Drive: Cursor MCP Permission Mapping Validation

**Date**: 2026-02-14
**Goal**: Validate that Cursor sessions run through F1 with `agent=cursor` and confirm MCP permission mapping support is present in the runner.
**Test Repo**: `/tmp/f1-test-drive-cypack-804-mcp-20260213-185103`
**Server Port**: `3606`

## Verification Results

### Issue-Tracker
- [x] Issue created
- [x] Issue ID returned
- [x] Session started for created issue

### EdgeWorker
- [x] Session routed with `cursor` agent selection (`[agent=cursor]`)
- [x] Allowed tools include MCP entries (`mcp__linear`, `mcp__cyrus-tools`)
- [x] Cursor runner synced project permissions before session execution

### Renderer
- [x] Session activities were emitted during run

## Session Log

1. Initialize fresh F1 test repository:
   - `apps/f1/f1 init-test-repo -p /tmp/f1-test-drive-cypack-804-mcp-20260213-185103`
2. Start F1 server (Cursor mock mode):
   - `CYRUS_CURSOR_MOCK=1 CYRUS_PORT=3606 CYRUS_REPO_PATH=/tmp/f1-test-drive-cypack-804-mcp-20260213-185103 node dist/server.js`
3. Health checks:
   - `CYRUS_PORT=3606 apps/f1/f1 ping`
   - `CYRUS_PORT=3606 apps/f1/f1 status`
4. Create and run issue:
   - `CYRUS_PORT=3606 apps/f1/f1 create-issue -t "Cursor MCP permission mapping" -d "[agent=cursor] ..."`
   - `CYRUS_PORT=3606 apps/f1/f1 start-session -i issue-1`
5. Evidence captured from server output:
   - `Label-based runner selection for new session: cursor (session session-1)`
   - `Configured allowed tools ... 'mcp__linear', 'mcp__cyrus-tools'`
   - `[CursorRunner] Synced project permissions .../.cursor/cli.json (allow=3, deny=0)`

## Additional Automated Validation

- `pnpm --filter cyrus-cursor-runner test:run -- CursorRunner.permissions.test.ts`
  - Confirms Claude MCP tool patterns map to Cursor permissions:
    - `mcp__trigger__search_docs` -> `Mcp(trigger:search_docs)`
    - `mcp__linear` -> `Mcp(linear:*)`
    - `mcp__linear__create_issue` -> `Mcp(linear:create_issue)`

## Final Retrospective

F1 confirms end-to-end `cursor` session routing and pre-run permission sync behavior. Unit tests confirm MCP permission token mapping from Claude tool names into Cursor `Mcp(server:tool)` permission syntax, including server-wide and tool-specific cases.
