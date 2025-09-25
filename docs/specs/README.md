Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] Global doc index refreshed
- [x] Progress tracker maintained
- [x] Phase checklist captured
- [ ] Final approval

# Multi-CLI Implementation Guides

Use these junior‑friendly, step‑by‑step guides to implement the spec. Follow the phase order and update the tracker below as work progresses.

## Progress Tracker

- [docs/multi-cli-runner-spec.md](../multi-cli-runner-spec.md) — In Progress (awaiting final approval after sub-guide alignment)
- [docs/specs/phase-0-scaffold.md](phase-0-scaffold.md) — In Progress (fields defined, implementation pending PR)
- [docs/specs/runner-interface.md](runner-interface.md) — In Progress (adapter details drafted, ready for review feedback)
- [docs/specs/edge-worker-integration.md](edge-worker-integration.md) — In Progress (bridge patterns outlined, needs testing plan sign-off)
- [docs/specs/phase-1-codex.md](phase-1-codex.md) — In Progress (error handling captured, resume deferred)
- [docs/specs/phase-2-opencode.md](phase-2-opencode.md) — In Progress (session reuse defined, awaiting endpoint validation)
- [docs/specs/cli-commands.md](cli-commands.md) — In Progress (UX flows drafted, CLI wiring pending)
- [docs/specs/testing-and-validation.md](testing-and-validation.md) — In Progress (diagnostics expanded, automation TBD)
- [docs/specs/upgrade-and-migration.md](upgrade-and-migration.md) — In Progress (algorithms ready, ops rehearsal outstanding)

## Phase Checklist

- [ ] Phase 0 scaffold finalized
- [ ] Runner interface finalized
- [ ] EdgeWorker integration plan finalized
- [ ] Codex adapter spec finalized
- [ ] OpenCode adapter spec finalized
- [ ] CLI commands spec finalized
- [ ] Testing/Validation plan finalized
- [ ] Upgrade/Migration plan finalized

## Guide Index

- [docs/specs/phase-0-scaffold.md](phase-0-scaffold.md) — Types, config, and no-op defaults
- [docs/specs/runner-interface.md](runner-interface.md) — Runner abstraction + adapters overview
- [docs/specs/edge-worker-integration.md](edge-worker-integration.md) — Hook selection + runners into EdgeWorker
- [docs/specs/phase-1-codex.md](phase-1-codex.md) — Codex adapter implementation
- [docs/specs/phase-2-opencode.md](phase-2-opencode.md) — OpenCode adapter implementation
- [docs/specs/cli-commands.md](cli-commands.md) — New CLI commands (connect-openai, defaults)
- [docs/specs/testing-and-validation.md](testing-and-validation.md) — Manual test plans and acceptance criteria
- [docs/specs/upgrade-and-migration.md](upgrade-and-migration.md) — Safe upgrades for existing VPS/Cloudflare setups

Start with Phase 0 → EdgeWorker integration → Phase 1, then Phase 2.

## Definition of Done

- Status block kept current with owner, date, and checklist.
- Progress tracker reflects every sub-guide with accurate links and 1-line status.
- Phase checklist mirrors the primary spec milestones.
- Guide index stays in sync with actual doc filenames and descriptions.
