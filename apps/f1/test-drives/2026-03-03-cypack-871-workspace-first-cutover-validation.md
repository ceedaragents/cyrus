# Test Drive: CYPACK-871 Workspace-First Runtime Cutover Validation

**Date**: 2026-03-03
**Goal**: Validate workspace-first (non-repo-keyed) runtime behavior with both multi-repo and single-repo issue routing.
**Test Repos**:
- `/tmp/f1-cypack871-cutover-primary-20260303-195400`
- `/tmp/f1-cypack871-cutover-secondary-20260303-195400`

## Verification Results

### Issue-Tracker
- [x] Multi-repo issue created (`issue-1` / `DEF-1`)
- [x] Single-repo issue created (`issue-2` / `DEF-2`)
- [x] Both sessions started and were stop-able (`session-1`, `session-2`)

### EdgeWorker
- [x] Multi-repo explicit selection path hit: `Multiple repositories explicitly matched (2) - using multi-repo workspace`
- [x] Multi-repo issue created a non-git parent workspace folder (`worktrees/DEF-1`) with nested repo worktrees
- [x] Single-repo issue created a direct git worktree (`worktrees/DEF-2`)
- [x] Multi-repo nested worktrees shared the same issue branch name

### Renderer
- [x] `view-session` rendered activities with timestamp/type/message
- [x] Pagination worked (`--limit 2 --offset 1` => `Showing 2 of 3 activities`)
- [x] Search path worked cleanly (no-match output returns `No activities found`)

## Session Log

### Setup
```bash
TS=20260303-195400
PORT=3614
apps/f1/f1 init-test-repo --path /tmp/f1-cypack871-cutover-primary-20260303-195400
apps/f1/f1 init-test-repo --path /tmp/f1-cypack871-cutover-secondary-20260303-195400
```

### Server Startup (Multi-Repo)
```bash
HOME=/tmp/cyrus-f1-home-cutover-20260303-195400 \
CYRUS_PORT=3614 \
CYRUS_REPO_PATH=/tmp/f1-cypack871-cutover-primary-20260303-195400 \
CYRUS_REPO_PATH_2=/tmp/f1-cypack871-cutover-secondary-20260303-195400 \
bun run apps/f1/server.ts
```

Server reported:
- RPC: `http://localhost:3614/cli/rpc`
- Cyrus Home: `/var/folders/xv/c55x22nd6lv8kq9fccch04d40000gp/T/cyrus-f1-1772596139795`
- Multi-Repo: enabled

### Health Check
```bash
CYRUS_PORT=3614 apps/f1/f1 ping
CYRUS_PORT=3614 apps/f1/f1 status
```

Observed:
- ping healthy
- status ready (`CLIRPCServer`)

### Multi-Repo Scenario (DEF-1)
```bash
CYRUS_PORT=3614 apps/f1/f1 create-issue \
  --title "CYPACK-871 workspace-cutover multi" \
  --description "Validate workspace-first multi repo routing. [repo=f1-test-repo] [repo=f1-test-repo-secondary]"

CYRUS_PORT=3614 apps/f1/f1 start-session --issue-id issue-1
```

EdgeWorker log proof:
- `Multiple repositories explicitly matched (2) - using multi-repo workspace`
- `Multi-repo workspace selected for issue issue-1: F1 Test Repository, F1 Secondary Repository`

Filesystem proof:
```bash
find /var/folders/xv/c55x22nd6lv8kq9fccch04d40000gp/T/cyrus-f1-1772596139795/worktrees -maxdepth 3 -type d | sort
```

Contains:
- `.../worktrees/DEF-1`
- `.../worktrees/DEF-1/f1-cypack871-cutover-primary-20260303-195400`
- `.../worktrees/DEF-1/f1-cypack871-cutover-secondary-20260303-195400`

Git marker proof:
- `worktrees/DEF-1/.git` does not exist
- Both nested repo folders inside `DEF-1` contain `.git` worktree markers

Branch proof:
```bash
git -C .../worktrees/DEF-1/f1-cypack871-cutover-primary-20260303-195400 branch --show-current
# def-1-cypack-871-workspace-cutover-m

git -C .../worktrees/DEF-1/f1-cypack871-cutover-secondary-20260303-195400 branch --show-current
# def-1-cypack-871-workspace-cutover-m
```

### Single-Repo Scenario (DEF-2)
```bash
CYRUS_PORT=3614 apps/f1/f1 create-issue \
  --title "CYPACK-871 workspace-cutover single" \
  --description "Validate single-repo compatibility. [repo=f1-test-repo]"

CYRUS_PORT=3614 apps/f1/f1 start-session --issue-id issue-2
```

Filesystem proof:
- `.../worktrees/DEF-2` exists as direct worktree root
- `.../worktrees/DEF-2/.git` exists

Branch proof:
```bash
git -C .../worktrees/DEF-2 branch --show-current
# def-2-cypack-871-workspace-cutover-s
```

### Renderer Validation
```bash
CYRUS_PORT=3614 apps/f1/f1 view-session --session-id session-1
CYRUS_PORT=3614 apps/f1/f1 view-session --session-id session-1 --limit 2 --offset 1
CYRUS_PORT=3614 apps/f1/f1 view-session --session-id session-1 --search "workspace"
```

Observed:
- Activity table renders timestamp/type/message fields
- Pagination output showed `Showing 2 of 3 activities`
- Search no-match path cleanly reports `No activities found`

### Cleanup
```bash
CYRUS_PORT=3614 apps/f1/f1 stop-session --session-id session-1
CYRUS_PORT=3614 apps/f1/f1 stop-session --session-id session-2
# stop server
```

## Final Retrospective

This test drive passed both acceptance-critical paths after workspace-first runtime cutover:
- Multi-repo issues now consistently use a normal issue workspace folder with nested repo worktrees.
- Single-repo issues remain backward-compatible as a direct git worktree.

No regressions were observed in session creation, activity rendering, pagination/search output, or stop behavior.
