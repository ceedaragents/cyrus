# User Testing

Testing surface, startup steps, and known quirks for this mission.

**What belongs here:** user-facing entry points, validation commands, setup steps, known manual-testing limitations.
**What does NOT belong here:** low-level service definitions (use `.factory/services.yaml`).

---

## Available Surfaces

- F1 CLI help is runnable via `node apps/f1/dist/src/cli.js --help`.
- Primary interactive validation surface for this mission: F1 server in multi-repo mode on port `3600`.
- Audit milestone artifact-validation surface: direct repository file inspection from the checked-out worktree (Markdown artifact plus git-visible path/status checks). This surface is read-only and does not require an app server.

## Startup Notes

1. Run `.factory/init.sh` if dependencies or build outputs are missing.
2. Start the `f1-multi-repo` service from `.factory/services.yaml`.
3. Use the F1 flows to validate:
   - ambiguous routing with no immediate repository match
   - repository selection response handling
   - multi-repository routing-context visibility
   - zero-association behavior staying explicit until selection
4. For the `audit-and-target-model` milestone, no service startup is required when validating the committed audit artifact assertions; use repository file inspection and git-visible path checks instead.

## Known Quirks

- `packages/edge-worker` full-suite Vitest runs currently have unrelated baseline failures in feedback-delivery, screenshot-upload-hooks, and parts of runner-selection.
- Some edge-worker tests may also hit `/tmp/test-cyrus-home` permission errors during temp log creation.
- Prefer targeted tests for changed areas during iteration, then use F1/manual validation plus typechecks/build for mission-level confidence.

## Flow Validator Guidance: Repository audit artifact

- Surface: read-only repository inspection of `.factory/library/repository-association-audit.md` and related git-visible paths.
- Do not start app services or mutate product code for this surface.
- Allowed evidence sources: `Read`, `Grep`, `LS`, and read-only git/jq commands.
- Off-limits: editing the audit artifact, using generated outputs as primary evidence, or inferring checklist coverage from partial excerpts when the file can be read directly.
- Isolation rule: each validator must use only its assigned report path and keep any temporary notes scoped to its own namespace; there is no shared account or seeded data for this surface.
