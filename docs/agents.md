# Cyrus Agents Overview

Cyrus can route work to several local runners (Claude Code, Codex, OpenCode).
Each runner lives in its own workspace package, and the CLI bundles the compiled
artefacts under `apps/cli/dist` so operators can launch a single binary.

When you change any of the agent packages, make sure to rebuild the CLI bundle
before testing. The CLI otherwise keeps serving stale JavaScript from an earlier
run, which can hide new logs or fixes. See
[`docs/specs/build-refresh.md`](./specs/build-refresh.md) for the exact clean-and-build
sequence we now follow to refresh the compiled output.

Additional architecture notes for multi-runner support live in
`docs/specs/runner-interface.md` and `docs/specs/runner-event-normalization.md`.

## Process Cleanup Helper

Run `./scripts/edge-process-helper.sh` to list any running
`dist/apps/cli/app.js` edge-worker instances and active `ngrok` tunnels. The
script prints matching PIDs so you can send a graceful `SIGTERM` with
`./scripts/edge-process-helper.sh --kill <PID>` after confirming the process is
stale. The helper relies on `pgrep` being available in `PATH`; install
`procps`/`procps-ng` (Linux) or ensure `pgrep` exists on macOS to use it.
