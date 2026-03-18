# Test Drive: Codex AgentExecution Container E2E

**Date**: 2026-03-18
**Goal**: Validate `agentExecution.mode = persistent_issue_container` end-to-end in F1 using a Codex-enabled image, and verify CLI/F1 session completion state stays consistent.
**Test Repo**: `/tmp/f1-agent-execution-codex-20260318-103756`
**Image**: `cyrus-f1-codex-test:local`
**Server Port**: `39019`

## Verification Results

### Issue-Tracker
- [x] Issue created
- [x] Issue ID returned
- [x] Issue metadata accessible
- [x] `Question:` title now produces a git-safe branch name

### EdgeWorker
- [x] Session started
- [x] Worktree created
- [x] Persistent issue container started for the issue
- [x] Codex executed inside the issue container
- [x] Activities streamed back to F1 during both `question-investigation` and `question-answer`
- [x] Final `response` activity posted
- [x] Session status advanced to `complete`
- [x] Issue container was destroyed on completion

### Renderer
- [x] Activity format correct
- [x] Session view showed thought/action/response activities
- [x] Final response visible in F1 timeline

## Session Log

### Setup

```bash
./apps/f1/f1 init-test-repo --path /tmp/f1-agent-execution-codex-20260318-103756
CYRUS_PORT=39019 \
CYRUS_REPO_PATH=/tmp/f1-agent-execution-codex-20260318-103756 \
CYRUS_AGENT_EXECUTION_IMAGE=cyrus-f1-codex-test:local \
CYRUS_AGENT_EXECUTION_RUNNERS=codex \
node apps/f1/dist/server.js
CYRUS_PORT=39019 ./apps/f1/f1 ping
CYRUS_PORT=39019 ./apps/f1/f1 status
```

Server started successfully and `/status` returned `ready`.

### Issue Creation

```bash
CYRUS_PORT=39019 ./apps/f1/f1 create-issue \
  --title 'Question: summarize the rate limiter repo' \
  --description $'[agent=codex]\nQuestion only. Do not edit files. Which functionality is already implemented, which TODOs remain, and what are the top two next tasks?'
```

Returned:

- `issue-1`
- `DEF-1`

### Session Start And Repository Selection

```bash
CYRUS_PORT=39019 ./apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=39019 ./apps/f1/f1 prompt-session --session-id session-1 --message 'f1-test-repo'
```

F1 first showed the expected repository-selection elicitation, then accepted the repository prompt and continued.

### Worktree / Branch Evidence

Server log showed successful worktree creation from local `main`:

- `Creating git worktree at .../worktrees/DEF-1 from local main`

Git confirmed the branch name was sanitized and valid:

```bash
git -C /tmp/f1-agent-execution-codex-20260318-103756 worktree list
git -C /var/folders/h0/49n4b8zj21l47577rh3wgxpw0000gn/T/cyrus-f1-1773801480040/worktrees/DEF-1 branch --show-current
```

Observed branch:

- `def-1-question-summarize-the-rate-li`

### Container Execution Evidence

Server log:

- `Starting issue container cyrus-issue-f1-test-repo-def-1 for DEF-1 with image cyrus-f1-codex-test:local`

Container process inspection during the run:

```bash
docker top cyrus-issue-f1-test-repo-def-1
```

Observed process:

- `node ... codex exec ... resume 019cfecf-659c-7101-9153-b1905afd7cf3`

This confirms the resumed Codex session executed inside the persistent issue container, not in the Cyrus host process.

### Activity Flow

`view-session` showed:

- repository selection elicitation
- routing thought
- `Selected procedure: simple-question`
- `Using model: gpt-5.3-codex`
- streamed investigation thoughts/actions
- final `response`

Relevant commands:

```bash
CYRUS_PORT=39019 ./apps/f1/f1 view-session --session-id session-1 --limit 500 --offset 0
docker ps --filter label=cyrus.issue=DEF-1 --format '{{.Names}} {{.Status}}'
```

### Completion Evidence

Codex local transcript:

- `~/.codex/sessions/2026/03/18/rollout-2026-03-18T02-38-50-019cfecf-659c-7101-9153-b1905afd7cf3.jsonl`

That transcript contains:

- `task_complete` for the investigation turn
- `task_complete` for the final answer turn

Server log then showed:

- `All subroutines completed, posting final result to Linear`
- `Result message emitted to Linear`
- `Stopped issue container cyrus-issue-f1-test-repo-def-1 for DEF-1`

Final F1 session state:

- `Status: complete`
- `Updated: 3/18/2026, 10:41:07 AM`

Container check after completion returned no running containers for `DEF-1`.

## Findings

### Fixed During This Session

1. CLI/F1 session completion status was not being synchronized back to the in-memory issue tracker. Result: finished sessions still appeared as `active` in `view-session`.
2. CLI issue branch-name generation was not git-safe for titles containing `:`. Result: titles like `Question: ...` could break `git worktree add -b ...`.

### Current Status

- Codex issue-container execution is validated end-to-end in F1.
- F1 now reflects completed sessions as `complete`.
- `Question:` titles no longer block worktree creation in CLI/F1.

### Remaining Gap

- Claude container execution was implemented at the runner layer, but this drive did not run a full Claude end-to-end session because no equivalent Claude-authenticated test image/session was available in F1.

## Final Retrospective

The containerized `agentExecution` path is working as intended for Codex:

- Cyrus stayed as control plane
- the issue work happened in a persistent per-issue container
- subroutine resume reused the same container
- F1 activity rendering stayed intact
- completion cleanup removed the container

The first pass exposed two real integration bugs in CLI/F1, and the rerun after fixes passed cleanly.
