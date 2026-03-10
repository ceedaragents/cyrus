# Test Drive: Zero / One / Many Repository Association Validation

**Date**: 2026-03-08
**Goal**: Validate explicit zero-association routing, exact-name repository selection, natural-language repository selection, downstream prompt/context continuity, and quiet F1 setup when optional local prompt files are absent.
**Server Port**: 3600

---

## Scenarios Covered

1. **Zero associations remain explicit** until the user selects a repository.
2. **Single-association transition via exact repository name** continues into runner initialization without losing the issue/session.
3. **Selection via natural-language wrapper phrase** matches the intended repository and reaches orchestrator prompt assembly.
4. **Multi-repository prompt context** enumerates both repositories after selection.
5. **Optional local prompt/setup file noise is suppressed** during F1 worktree setup when `CLAUDE.local.md` is absent.

---

## Setup

### Start F1 multi-repo service

```bash
CYRUS_PORT=3600 \
CYRUS_REPO_PATH=/Users/connor/code/cyrus/worktrees/multirepo \
CYRUS_REPO_PATH_2=/Users/connor/code/cyrus/worktrees/multirepo \
bun apps/f1/server.ts
```

**Observed**:

- Server started on `http://localhost:3600`
- Multi-repo mode was enabled
- Later worktree setup completed without the previous `cp ... CLAUDE.local.md: No such file or directory` noise

---

## Flow 1: Zero associations stay explicit, then exact-name selection resolves to one repository

### Commands

```bash
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js create-issue \
  --team-id team-default \
  --title "Exact selection flow" \
  --description "Validate ambiguous routing stays unresolved until an explicit repository name is chosen."

CYRUS_PORT=3600 node apps/f1/dist/src/cli.js assign-issue --issue-id issue-1 --assignee-id user-default
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js start-session --issue-id issue-1
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js view-session --session-id session-1 --limit 10
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js prompt-session --session-id session-1 --message "F1 Frontend Repository"
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js view-session --session-id session-1 --limit 12
```

### Observed

- `view-session` before selection showed a single `elicitation` activity: `Which repository should I work in for this issue?`
- No repository was silently chosen before the reply.
- After replying with the exact repository name, the timeline showed:
  - prompt: `F1 Frontend Repository`
  - thought: `Repository "F1 Frontend Repository" has been selected by user...`
  - thought: immediate acknowledgment / analysis continuation
- The F1 server logs continued into runner setup and issue prompt building instead of failing with `Agent session session-1 not found` or `Issue issue-1 not found`.

---

## Flow 2: Natural-language repository selection resolves and preserves multi-repo prompt context

### Commands

```bash
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js create-issue \
  --team-id team-default \
  --title "Natural language backend selection" \
  --description "Validate that repository selection accepts a natural-language wrapper phrase and continues into orchestrator routing context." \
  --labels orchestrator

CYRUS_PORT=3600 node apps/f1/dist/src/cli.js assign-issue --issue-id issue-2 --assignee-id user-default
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js start-session --issue-id issue-2
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js prompt-session \
  --session-id session-2 \
  --message "Please use F1 Backend Repository for this issue."
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js view-session --session-id session-2 --limit 12
```

### Observed

- The natural-language response matched `F1 Backend Repository` successfully.
- `view-session` showed:
  - prompt: `Please use F1 Backend Repository for this issue.`
  - thought: `Repository "F1 Backend Repository" has been selected by user...`
  - thought: `Selected procedure: **orchestrator-full** ...`
  - thought: `Entering 'orchestrator' mode because of the 'orchestrator' label...`
- The F1 server log showed:
  - `User selected repository: F1 Backend Repository`
  - successful worktree setup for `worktrees/backend/DEF-2`
  - `Using orchestrator-full procedure due to orchestrator label`
  - a prompt containing `<repository_routing_context>` with both backend and frontend repositories
- No `Agent session ... not found` or `Issue ... not found` errors occurred after selection.

---

## Summary

The F1 validation confirmed the end-to-end `0/1/N` behavior:

- ambiguous sessions stayed explicitly unresolved,
- exact-name and natural-language repository selections both resolved cleanly,
- selected sessions preserved the referenced issue/session state into runner initialization,
- multi-repo orchestration context remained visible after selection,
- and missing optional local prompt/setup files no longer emitted avoidable setup noise.
