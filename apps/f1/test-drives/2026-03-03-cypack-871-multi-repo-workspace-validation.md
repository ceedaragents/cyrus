# Test Drive: CYPACK-871 Multi-Repo Workspace + Single-Repo Regression

**Date**: 2026-03-03  
**Goal**: Validate that explicit multi-repository issue routing creates a plain issue folder containing per-repo git worktrees, while single-repository routing preserves existing direct-worktree behavior.  
**Primary Test Repo**: `/tmp/f1-cypack-871-primary`  
**Secondary Test Repo**: `/tmp/f1-cypack-871-secondary`

## Verification Results

### Issue-Tracker
- [x] Issue created
- [x] Issue ID returned
- [x] Issue metadata accessible

### EdgeWorker
- [x] Session started
- [x] Worktree/workspace created
- [x] Activities tracked
- [x] Agent processed issue

### Renderer
- [x] Activity format correct (`thought` rows with timestamp/content)
- [x] Pagination works (`view-session --limit 20` and `--limit 10`)
- [ ] Search not executed in this drive

## Session Log

### Scenario A: Multi-Repo explicit routing (description + label)

1. Start F1 server in multi-repo mode.

```bash
CYRUS_PORT=3600 \
CYRUS_REPO_PATH=/tmp/f1-cypack-871-primary \
CYRUS_REPO_PATH_2=/tmp/f1-cypack-871-secondary \
bun run apps/f1/server.ts
```

2. Create issue with mixed explicit signals that target two repositories.

```bash
CYRUS_PORT=3600 apps/f1/f1 create-issue \
  -t "CYPACK-871 multi repo F1" \
  -d "Validate multi repo workspace creation [repo=f1-test/primary-repo]" \
  -l "backend"
```

3. Start session, view activity, validate workspace filesystem.

```bash
CYRUS_PORT=3600 apps/f1/f1 start-session -i issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session -s session-1 --limit 20 --offset 0
CYRUS_PORT=3600 apps/f1/f1 view-session -s session-1 --limit 10 --offset 0
```

Observed server evidence:
- `[RepositoryRouter] Multiple repositories explicitly matched (2) - using multi-repo workspace`
- `[EdgeWorker] Multi-repo workspace selected for issue issue-1: F1 Test Repository, F1 Secondary Repository`
- `Creating git worktree at .../worktrees/DEF-1/f1-cypack-871-primary`
- `Creating git worktree at .../worktrees/DEF-1/f1-cypack-871-secondary`

Observed filesystem evidence:

```text
/worktrees/DEF-1/
  f1-cypack-871-primary/
  f1-cypack-871-secondary/
```

### Scenario B: Single-repo regression check

1. Start F1 server in single-repo mode.

```bash
CYRUS_PORT=3601 \
CYRUS_REPO_PATH=/tmp/f1-cypack-871-primary \
bun run apps/f1/server.ts
```

2. Create issue with single-repo explicit metadata.

```bash
CYRUS_PORT=3601 apps/f1/f1 create-issue \
  -t "CYPACK-871 single repo F1" \
  -d "Validate single repo workspace [repo=f1-test/primary-repo]" \
  -l "main-repo"
```

3. Start session, view activity, validate workspace filesystem.

```bash
CYRUS_PORT=3601 apps/f1/f1 start-session -i issue-1
CYRUS_PORT=3601 apps/f1/f1 view-session -s session-1 --limit 20 --offset 0
CYRUS_PORT=3601 apps/f1/f1 view-session -s session-1 --limit 10 --offset 0
```

Observed server evidence:
- `[RepositoryRouter] Repository selected: F1 Test Repository (description-tag routing)`
- `Creating git worktree at .../worktrees/DEF-1 from local main`

Observed filesystem evidence:

```text
/worktrees/DEF-1/
  .git
  package.json
  src/
  ...
UNEXPECTED_NESTED_REPO_DIRS=false
```

## Evidence Artifacts

- Multi-repo transcript: `/tmp/f1-cypack-871-multi-transcript.log`
- Multi-repo server log: `/tmp/f1-cypack-871-multi-server.log`
- Single-repo transcript: `/tmp/f1-cypack-871-single-transcript.log`
- Single-repo server log: `/tmp/f1-cypack-871-single-server.log`

## Final Retrospective

- Multi-repo explicit routing now creates a non-worktree issue root with nested repo-named git worktrees.
- Single-repo behavior remains unchanged: the issue path itself is the git worktree.
- Activity rendering remained coherent in both scenarios, and pagination behaved correctly.
