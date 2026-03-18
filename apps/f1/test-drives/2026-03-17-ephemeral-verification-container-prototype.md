# Test Drive: Ephemeral Verification Container Prototype

**Date**: 2026-03-17
**Goal**: Validate that the new external verification-container prototype does not break the F1 CLI flow and document the current end-to-end boundary.
**Test Repo**: `/tmp/f1-test-drive-ephemeral-verification-20260317`

## Verification Results

### Issue-Tracker
- [x] Issue created
- [x] Issue ID returned
- [x] Issue metadata accessible

### EdgeWorker
- [x] Session started
- [x] Worktree created
- [x] Activities tracked
- [ ] Agent fully processed issue

### Renderer
- [x] Activity format correct
- [x] Pagination works (`--limit 20 --offset 0`)
- [ ] Session stops cleanly

## Session Log

### Phase 1: Setup

Initialized a fresh repo:

```bash
./apps/f1/f1 init-test-repo --path /tmp/f1-test-drive-ephemeral-verification-20260317
```

Started the F1 server:

```bash
CYRUS_PORT=3613 CYRUS_REPO_PATH=/tmp/f1-test-drive-ephemeral-verification-20260317 bun run apps/f1/server.ts
```

Initial startup failed because CLI/F1 uses `CLIIssueTrackerService`, while Slack transport startup assumed a Linear-backed tracker with `getClient()`. The prototype added a graceful fallback so Slack registration continues without Linear MCP tools.

### Phase 2: Health Check

```bash
CYRUS_PORT=3613 ./apps/f1/f1 ping
CYRUS_PORT=3613 ./apps/f1/f1 status
```

Observed:

- `ping` returned healthy
- `status` returned `ready`

### Phase 3: Issue Creation

```bash
CYRUS_PORT=3613 ./apps/f1/f1 create-issue \
  --title "Ephemeral verification prototype smoke" \
  --description "[agent=codex]
Verify the prototype wiring and report what is configured for external verification containers."
```

Observed:

- Issue created as `issue-1`
- Linear-style identifier returned as `DEF-1`

### Phase 4: Session Start And Activity Rendering

```bash
CYRUS_PORT=3613 ./apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3613 ./apps/f1/f1 view-session --session-id session-1 --limit 20 --offset 0
```

Observed:

- Session `session-1` started successfully
- Renderer returned one well-formed `elicitation` activity
- Activity content: `Which repository should I work in for this issue?`

This confirmed that the new prototype did not regress:

- CLI issue creation
- session creation
- activity storage
- activity rendering

### Phase 5: Follow-Up Prompt

Sent a follow-up reply:

```bash
CYRUS_PORT=3613 ./apps/f1/f1 prompt-session --session-id session-1 --message "Use repository f1-test-repo."
```

Server log showed the session advancing into worktree creation:

- repository fallback resolved to `F1 Test Repository`
- worktree created at the F1 temp worktree path

At that point Bun crashed with a segmentation fault before the session could be viewed again or stopped cleanly. This appeared as a Bun runtime failure rather than a Cyrus exception:

```text
panic(main thread): Segmentation fault at address 0x0
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

## Prototype Scope Verified

The code-level prototype that was validated by unit tests in this branch is:

- repository config now supports `hostPaths`
- repository config now supports `verification.mode = "ephemeral_container"`
- workspaces now track both Cyrus-visible paths and host-visible paths
- `verifications` can execute an external `docker run --rm ...` step before the normal verification prompt
- the external command result is injected back into the standard verification subroutine instead of replacing the validation loop

## Final Retrospective

### What Worked

- The external verification-container prototype integrated cleanly into config, workspace creation, and the verification subroutine boundary.
- F1 startup now tolerates CLI issue trackers that do not expose a Linear SDK client.
- F1 health checks, issue creation, session creation, and first activity rendering all succeeded after the compatibility fix.

### What Failed

- The F1 drive did not complete to a clean stop because Bun crashed after the follow-up prompt.
- This test drive did not reach the new `ephemeral_container` execution path end-to-end inside F1.

### Recommendations

- Treat the Bun crash as separate follow-up work in the F1 harness/runtime path.
- For future F1 runs of this prototype, start the server with:

```bash
CYRUS_VERIFICATION_IMAGE=ghcr.io/your-org/project-debug:latest \
CYRUS_VERIFICATION_COMMAND="pnpm test" \
CYRUS_PORT=3613 \
CYRUS_REPO_PATH=/tmp/f1-test-drive-ephemeral-verification-20260317 \
bun run apps/f1/server.ts
```

- Run the true external container path on a runner with Docker available, since this prototype depends on host-level Docker access for `ephemeral_container` mode.
