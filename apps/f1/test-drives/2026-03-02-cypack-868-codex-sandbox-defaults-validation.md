# Test Drive: CYPACK-868 Codex Sandbox Defaults Validation

**Date**: 2026-03-02
**Goal**: Validate Cyrus F1 end-to-end flow during Codex runner sandbox-default changes.
**Test Repo**: /tmp/f1-test-drive-cypack-868-20260302-172142

## Verification Results

### Issue-Tracker
- [x] Issue created
- [x] Issue ID returned
- [x] Issue metadata accessible

### EdgeWorker
- [x] Session started
- [x] Worktree created
- [x] Activities tracked
- [x] Agent processed issue (analysis phase started)

### Renderer
- [x] Activity format correct
- [x] Pagination works
- [x] Search works

## Session Log

1. `./f1 init-test-repo -p /tmp/f1-test-drive-cypack-868-20260302-172142`
- Result: pass; repo scaffolded and initial git commit created.

2. `HOME=/tmp CYRUS_PORT=3600 CYRUS_REPO_PATH=/tmp/f1-test-drive-cypack-868-20260302-172142 pnpm --filter cyrus-f1 run server`
- Result: pass; server started and RPC endpoint available at `http://localhost:3600/cli/rpc`.

3. `CYRUS_PORT=3600 ./f1 ping` and `CYRUS_PORT=3600 ./f1 status`
- Result: pass; server health and status returned.

4. `CYRUS_PORT=3600 ./f1 create-issue -t "CYPACK-868 validation clean run" -d "Validate F1 protocol execution."`
- Result: pass; created `issue-1` / `DEF-1`.

5. `CYRUS_PORT=3600 ./f1 start-session -i issue-1`
- Result: pass; started `session-1`.

6. `CYRUS_PORT=3600 ./f1 view-session -s session-1`
- Result: pass; activities visible with timestamp/type/message columns.

7. `CYRUS_PORT=3600 ./f1 view-session -s session-1 --limit 10 --offset 0`
- Result: pass; pagination output returned successfully.

8. `CYRUS_PORT=3600 ./f1 view-session -s session-1 --search "Analyzing"`
- Result: pass; filtered activity search returned matching entry.

9. `CYRUS_PORT=3600 ./f1 stop-session -s session-1`
- Result: pass; session stop acknowledged.

10. Server shutdown (`Ctrl+C`)
- Result: pass; graceful shutdown completed.

## Final Retrospective

- Core F1 flow (repo init, server startup, issue creation, session creation, activity rendering, pagination, search, stop, shutdown) worked as expected.
- This drive provides end-to-end validation evidence for the testing protocol requirement.
- Initial run without `HOME=/tmp` reproduced known environment-specific `EPERM` writes under `~/.claude/debug`; rerun with `HOME=/tmp` completed cleanly.
