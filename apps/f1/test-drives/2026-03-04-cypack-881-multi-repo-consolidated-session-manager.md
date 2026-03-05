# Test Drive #007: CYPACK-881 Multi-Repository + Consolidated Session Manager

**Date**: 2026-03-04
**Goal**: Validate 0-repo, 1-repo, and N-repo session behavior after consolidating to shared AgentSessionManager/IssueTrackerService.
**Test Repo**: `/tmp/f1-cypack881-one-1772661153`, `/tmp/f1-cypack881-two-1772661350`

## Verification Results

### Issue-Tracker
- [x] Issue created
- [x] Issue ID returned
- [x] Issue metadata accessible

### EdgeWorker
- [x] Session started
- [x] Worktree/workspace created (0/1/N shape verified)
- [x] Activities tracked
- [x] Prompted continuation processed for 0-repo session

### Renderer
- [x] Activity format correct (`thought`, `prompt` entries present)
- [x] Pagination works (`--limit` + `--offset`)
- [x] Search works (`--search validation`)

## Session Log

### Scenario A: 1 Repository
- Server start:
  - `CLAUDE_CODE_OAUTH_TOKEN='' ANTHROPIC_API_KEY='' GEMINI_API_KEY='' CURSOR_API_KEY='' OPENAI_API_KEY='f1-test-key' CYRUS_PORT=3605 CYRUS_REPO_PATH=/tmp/f1-cypack881-one-1772661153 bun run apps/f1/server.ts`
- Health checks:
  - `CYRUS_PORT=3605 ./apps/f1/f1 ping` -> healthy
  - `CYRUS_PORT=3605 ./apps/f1/f1 status` -> ready
- Issue/session:
  - `create-issue` -> `issue-1` / `DEF-1`
  - `start-session --issue-id issue-1` -> `session-1`
  - `view-session --session-id session-1` -> 3 activities rendered
- Workspace structure evidence:
  - `find .../cyrus-f1-1772661315019/worktrees -maxdepth 2 -type d`
  - Observed:
    - `.../worktrees/DEF-1`
    - No repo subdirectory layer

### Scenario B: N Repositories (2 repos)
- Server start:
  - `CLAUDE_CODE_OAUTH_TOKEN='' ANTHROPIC_API_KEY='' GEMINI_API_KEY='' CURSOR_API_KEY='' OPENAI_API_KEY='f1-test-key' CYRUS_PORT=3606 CYRUS_REPO_PATH=/tmp/f1-cypack881-one-1772661153 CYRUS_REPO_PATH_2=/tmp/f1-cypack881-two-1772661350 bun run apps/f1/server.ts`
- Health checks:
  - `CYRUS_PORT=3606 ./apps/f1/f1 ping` -> healthy
  - `CYRUS_PORT=3606 ./apps/f1/f1 status` -> ready
- Issue/session:
  - `create-issue` -> `issue-1` / `DEF-1`
  - `start-session --issue-id issue-1` -> `session-1`
  - `view-session --session-id session-1` -> 3 activities rendered
- Workspace structure evidence:
  - `find .../cyrus-f1-1772661366274/worktrees -maxdepth 3 -type d`
  - Observed:
    - `.../worktrees/DEF-1/f1-test-repository`
    - `.../worktrees/DEF-1/f1-secondary-repository`
  - Confirms N-repo parent folder + per-repo worktree subdirectories

### Scenario C: 0 Repositories
- Server start (custom F1 CLI-mode server with `repositories: []`):
  - `node --input-type=module -e '... new EdgeWorker({ platform:"cli", repositories: [], ... }) ...'`
  - Port: `3607`
  - Cyrus home: `/var/folders/xv/c55x22nd6lv8kq9fccch04d40000gp/T/cyrus-f1-zero-1772661445750`
- Health checks:
  - `CYRUS_PORT=3607 ./apps/f1/f1 ping` -> healthy
  - `CYRUS_PORT=3607 ./apps/f1/f1 status` -> ready
- Issue/session:
  - `create-issue` -> `issue-1` / `DEF-1`
  - `start-session --issue-id issue-1` -> `session-1`
  - `view-session --session-id session-1` -> activities rendered (no repository-selection activity)
- Prompted continuation on 0-repo session:
  - `prompt-session --session-id session-1 --message "quick follow-up for zero repo validation"` -> success
  - Follow-up `view-session` showed new prompt/thought activities (no "session configuration was lost" response)
- Workspace structure evidence:
  - `find .../cyrus-f1-zero-1772661445750/worktrees -maxdepth 3 -type d`
  - Observed:
    - `.../worktrees/DEF-1`
    - No repo subdirectory layer
  - Confirms 0-repo plain issue folder behavior
- Renderer checks:
  - Pagination: `view-session --limit 3 --offset 2` -> "Showing 3 of 8 activities"
  - Search: `view-session --search validation` -> filtered activity subset rendered

## Final Retrospective
- The new workspace layout behavior is correct across all three modes:
  - 0 repos: plain issue folder
  - 1 repo: direct issue worktree
  - N repos: issue parent + per-repo subdirs
- Prompted continuation now works in 0-repo sessions (session-carried repo context + fallback handling).
- Multi-repo fallback routing selected all workspace repos when no specific routing rule matched.
- A runtime hardening issue was identified and fixed during this drive: auto-detected `.mcp.json` paths are now only included when the file exists (prevents runner startup failure on missing files).
