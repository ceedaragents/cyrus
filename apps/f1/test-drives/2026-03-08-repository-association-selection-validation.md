# Test Drive: Repository Association Selection Validation

**Date**: 2026-03-08
**Goal**: Validate zero-association behavior, exact-name repository selection, and natural-language repository selection in the F1 multi-repo flow.
**Server Port**: 3600

---

## Setup

Confirmed the F1 service was available on the mission port:

```bash
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js status
```

Observed:

- Status: `ready`
- Server: `CLIRPCServer`

---

## Flow 1: Exact-name selection

### Create issue and start session

```bash
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js create-issue \
  -t "Association exact-name selection validation" \
  -d "Validate that ambiguous routing stays explicit until a repository is selected." \
  -T team-default \
  -l "orchestrator"

CYRUS_PORT=3600 node apps/f1/dist/src/cli.js start-session -i issue-3
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js view-session -s session-3 -l 10
```

Observed before selection:

- `session-3` showed exactly one activity: `Which repository should I work in for this issue?`
- No repository was silently assigned before the user replied.

### Select repository by exact name

```bash
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js prompt-session -s session-3 -m "F1 Frontend Repository"
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js view-session -s session-3 -l 20
```

Observed after selection:

- Prompt activity recorded: `F1 Frontend Repository`
- Selection thought recorded: `Repository "F1 Frontend Repository" has been selected by user...`
- Follow-up thoughts confirmed continuation: `I've received your request and I'm starting to work on it...`
- Procedure initialization continued into orchestrator mode instead of failing with missing session/issue state.

---

## Flow 2: Natural-language selection

### Create issue and start session

```bash
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js create-issue \
  -t "Association natural-language selection validation" \
  -d "Validate that repository selection accepts natural-language wrapper phrases." \
  -T team-default \
  -l "orchestrator"

CYRUS_PORT=3600 node apps/f1/dist/src/cli.js start-session -i issue-4
```

### Select repository with wrapper phrase

```bash
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js prompt-session -s session-4 -m "Please use repository: F1 Backend Repository"
CYRUS_PORT=3600 node apps/f1/dist/src/cli.js view-session -s session-4 -l 20
```

Observed after selection:

- Prompt activity recorded: `Please use repository: F1 Backend Repository`
- Selection thought recorded: `Repository "F1 Backend Repository" has been selected by user...`
- Follow-up thoughts confirmed runner initialization continued normally.
- The flow did not regress into `Agent session ... not found` or `Issue ... not found` errors.

---

## Outcome

Validated successfully:

- Zero-association sessions stayed explicit until a repository was chosen.
- Exact-name repository replies continued into runner initialization.
- Natural-language wrapper replies around a valid repository name were accepted.
- User-visible F1 activity output showed clean continuation without visible fallback behavior or avoidable prompt-file setup noise.
