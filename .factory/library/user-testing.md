# User Testing

Testing surface, startup steps, and known quirks for this mission.

**What belongs here:** user-facing entry points, validation commands, setup steps, known manual-testing limitations.
**What does NOT belong here:** low-level service definitions (use `.factory/services.yaml`).

---

## Available Surfaces

- F1 CLI help is runnable via `node apps/f1/dist/src/cli.js --help`.
- Primary interactive validation surface for this mission: F1 server in multi-repo mode on port `3600`.
- Audit milestone artifact-validation surface: direct repository file inspection from the checked-out worktree (Markdown artifact plus git-visible path/status checks). This surface is read-only and does not require an app server.
- Core session-state refactor validation surface: the built `cyrus-core` public API via `node --input-type=module` importing `packages/core/dist/index.js`, using isolated persistence directories under `.factory/validation/core-session-state-refactor/user-testing/namespaces/`.

## Startup Notes

1. Run `.factory/init.sh` if dependencies or build outputs are missing.
2. Start the `f1-multi-repo` service from `.factory/services.yaml`.
3. Use the F1 flows to validate:
   - ambiguous routing with no immediate repository match
   - repository selection response handling
   - multi-repository routing-context visibility
   - zero-association behavior staying explicit until selection
4. For the `audit-and-target-model` milestone, no service startup is required when validating the committed audit artifact assertions; use repository file inspection and git-visible path checks instead.
5. For the `core-session-state-refactor` milestone, no app service startup is required; run `.factory/init.sh`, then exercise `PersistenceManager` and the exported session types through the built `cyrus-core` package using namespace-specific persistence paths.

## Known Quirks

- `packages/edge-worker` full-suite Vitest runs currently have unrelated baseline failures in feedback-delivery, screenshot-upload-hooks, and parts of runner-selection.
- Some edge-worker tests may also hit `/tmp/test-cyrus-home` permission errors during temp log creation.
- Prefer targeted tests for changed areas during iteration, then use F1/manual validation plus typechecks/build for mission-level confidence.
- For inline package-API validation scripts, use `node --input-type=module` so ESM imports from `packages/core/dist/index.js` work reliably.
- `apps/f1/server.ts` generates a fresh temp `CYRUS_HOME` on each start, so post-restart restore coverage is better validated with targeted `packages/edge-worker` restore tests than by restarting the same F1 instance.
- Avoid `::` in F1 validation issue titles/descriptions; the sanitized branch-name path can still produce invalid branch names. Use hyphenated namespace prefixes instead.

## Flow Validator Guidance: Repository audit artifact

- Surface: read-only repository inspection of `.factory/library/repository-association-audit.md` and related git-visible paths.
- Do not start app services or mutate product code for this surface.
- Allowed evidence sources: `Read`, `Grep`, `LS`, and read-only git/jq commands.
- Off-limits: editing the audit artifact, using generated outputs as primary evidence, or inferring checklist coverage from partial excerpts when the file can be read directly.
- Isolation rule: each validator must use only its assigned report path and keep any temporary notes scoped to its own namespace; there is no shared account or seeded data for this surface.

## Flow Validator Guidance: cyrus-core persistence api

- Surface: public `cyrus-core` API exercised through `node --input-type=module` scripts that import `packages/core/dist/index.js`.
- No app server or browser is required for this surface; use isolated persistence/state directories created under `.factory/validation/core-session-state-refactor/user-testing/namespaces/<namespace>/`.
- Allowed evidence sources: `Execute` for Node scripts and targeted package tests, plus `Read`/`Grep` for exported type inspection when needed to confirm public API shape.
- Off-limits: editing product code, using repo-keyed legacy containers as the primary success criterion, or sharing persistence directories between validator runs.
- Isolation rule: each validator must stay inside its assigned namespace directory and only write its assigned flow report file.

## Flow Validator Guidance: f1 multi-repo cli

- Surface: the running `f1-multi-repo` service on port `3600`, exercised through `node apps/f1/dist/src/cli.js`.
- Parent validator owns service startup/teardown; flow validators should assume the service is already healthy before they begin.
- Required runtime evidence for this milestone comes from real CLI flows: `status`, `create-issue`, `assign-issue`, `start-session`, `view-session`, and `prompt-session`.
- The key behaviors to confirm are: zero-association sessions stay unresolved until selection, exact-name and natural-language repository selections resolve cleanly, selected sessions continue into runner initialization without losing issue/session state, and orchestrator routing context enumerates both repositories.
- Also inspect the shared F1 server log provided by the parent validator for absence of avoidable optional-local-prompt noise and for repository-selection / routing-context continuation evidence.
- Off-limits: editing product code, reconfiguring the service port, or reusing another validator's issue/session identifiers.
- Isolation rule: each validator must use only issue titles/descriptions prefixed with its assigned namespace, keep to its assigned session IDs, and write only its assigned flow report.

## Flow Validator Guidance: repository-association docs surface

- Surface: committed repository files that users and validators read directly, especially `README.md`, `packages/edge-worker/README.md`, and `apps/f1/test-drives/2026-01-13-multi-repo-orchestration.md` / `apps/f1/test-drives/2026-03-08-zero-one-many-association-validation.md`.
- No app server is required for this surface; use repository inspection only.
- Allowed evidence sources: `Read`, `Grep`, `Glob`, `LS`, and read-only git commands.
- The key behaviors to confirm are that public/internal examples describe explicit repository associations and selection behavior, avoid teaching a session-wide primary/current repository model, and that the F1 validation assets describe ambiguous-routing plus multi-repository routing-context flows.
- Off-limits: editing documentation, inferring coverage from one file when the assertion names require checking multiple surfaces, or using generated artifacts as a substitute for the committed sources.
- Isolation rule: each validator must keep notes within its own report and avoid creating any shared scratch files.

## Flow Validator Guidance: edge-worker restore test surface

- Surface: targeted `packages/edge-worker` runtime restore tests that exercise persisted session/repository-association restoration without relying on a long-lived F1 temp home.
- Preferred command: `pnpm --filter cyrus-edge-worker exec vitest run test/EdgeWorker.missing-session-recovery.test.ts test/GlobalSessionRegistry.test.ts test/AgentSessionManager.repository-associations.test.ts`.
- Use direct file inspection of those tests when you need to tie a passing command back to explicit repository-association restore behavior.
- Off-limits: running the full edge-worker suite as primary evidence, editing product code, or inferring restore behavior from unrelated runner-selection/feedback failures.
- Isolation rule: each validator writes only its assigned report file and treats unrelated baseline failures outside the targeted restore command as noise, not assertion evidence.
