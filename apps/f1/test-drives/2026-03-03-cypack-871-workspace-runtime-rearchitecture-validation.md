# Test Drive: CYPACK-871 Workspace Runtime Re-architecture Validation

**Date**: 2026-03-03
**Goal**: Validate multi-repo and single-repo workspace behavior after migrating runtime/session/issue-tracker ownership from repository-keyed to workspace-keyed internals.
**Test Repos**:
- `/tmp/f1-cypack871-primary-20260303-172622`
- `/tmp/f1-cypack871-secondary-20260303-172622`

## Verification Results

### Issue-Tracker
- [x] Issue created (multi-repo scenario)
- [x] Issue created (single-repo scenario)
- [x] Issue IDs and identifiers returned

### EdgeWorker
- [x] Session started for multi-repo issue (`session-1`)
- [x] Session started for single-repo issue (`session-2`)
- [x] Multi-repo issue created a normal folder at `worktrees/DEF-1` with nested repo worktrees
- [x] Single-repo issue created a direct git worktree at `worktrees/DEF-2`
- [x] Both multi-repo nested worktrees used the same issue-derived branch name

### Renderer
- [x] Activities rendered with timestamp/type/message columns
- [x] Pagination works (`--limit 2 --offset 1`)
- [x] Search path works (returns filtered/no rows cleanly)

## Session Log

### Setup
```bash
cd apps/f1
./f1 init-test-repo --path /tmp/f1-cypack871-primary-20260303-172622
./f1 init-test-repo --path /tmp/f1-cypack871-secondary-20260303-172622
```

### Server startup (multi-repo mode)
```bash
HOME=/tmp/cyrus-f1-home \
CYRUS_PORT=3600 \
CYRUS_REPO_PATH=/tmp/f1-cypack871-primary-20260303-172622 \
CYRUS_REPO_PATH_2=/tmp/f1-cypack871-secondary-20260303-172622 \
bun run apps/f1/server.ts
```

Server reported:
- RPC: `http://localhost:3600/cli/rpc`
- Multi-Repo: enabled
- Cyrus Home: `/var/folders/xv/c55x22nd6lv8kq9fccch04d40000gp/T/cyrus-f1-1772587671893`

### Health check
```bash
CYRUS_PORT=3600 ./f1 ping
CYRUS_PORT=3600 ./f1 status
```

### Multi-repo scenario
```bash
CYRUS_PORT=3600 ./f1 create-issue \
  --title "CYPACK-871 F1 multi-repo rerun" \
  --description "Validate multi-repo behavior. [repo=f1-test-repo] [repo=f1-test-repo-secondary]"
# -> issue-1 / DEF-1

CYRUS_PORT=3600 ./f1 start-session --issue-id issue-1
# -> session-1
```

Filesystem proof:
```bash
find /var/folders/xv/c55x22nd6lv8kq9fccch04d40000gp/T/cyrus-f1-1772587671893/worktrees -maxdepth 3 -type d | sort
```
Contains:
- `.../worktrees/DEF-1`
- `.../worktrees/DEF-1/f1-cypack871-primary-20260303-172622`
- `.../worktrees/DEF-1/f1-cypack871-secondary-20260303-172622`

Git marker proof:
- `worktrees/DEF-1` has no `.git`
- nested repos each contain `.git` worktree file

Branch proof:
```bash
git -C .../worktrees/DEF-1/f1-cypack871-primary-20260303-172622 branch --show-current
# def-1-cypack-871-f1-multi-repo-rerun

git -C .../worktrees/DEF-1/f1-cypack871-secondary-20260303-172622 branch --show-current
# def-1-cypack-871-f1-multi-repo-rerun
```

### Single-repo scenario
```bash
CYRUS_PORT=3600 ./f1 create-issue \
  --title "CYPACK-871 F1 single-repo" \
  --description "Validate single-repo behavior. [repo=f1-test-repo]"
# -> issue-2 / DEF-2

CYRUS_PORT=3600 ./f1 start-session --issue-id issue-2
# -> session-2
```

Filesystem proof:
- `.../worktrees/DEF-2` exists directly as worktree root
- `.../worktrees/DEF-2/.git` exists

Branch proof:
```bash
git -C .../worktrees/DEF-2 branch --show-current
# def-2-cypack-871-f1-single-repo
```

### Activity rendering and pagination
```bash
CYRUS_PORT=3600 ./f1 view-session --session-id session-1
CYRUS_PORT=3600 ./f1 view-session --session-id session-1 --limit 2 --offset 1
CYRUS_PORT=3600 ./f1 view-session --session-id session-1 --search "multi-repo"
```
Observed:
- table output includes timestamp/type/message
- paginated view reports `Showing 2 of 3 activities`
- search with no matches returns `No activities found`

### Cleanup
```bash
CYRUS_PORT=3600 ./f1 stop-session --session-id session-1
CYRUS_PORT=3600 ./f1 stop-session --session-id session-2
# then SIGINT to server process
```

## Final Retrospective

Validation passed for both acceptance-critical behavior paths:
- Multi-repo issues now create a parent workspace folder with nested git worktrees per repository.
- Single-repo issues remain backward-compatible, creating a direct git worktree at the issue folder.

No regressions were observed in session creation, activity rendering, pagination, or stop flows during this drive.
