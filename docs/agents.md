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
