---
name: session-model-worker
description: Refactors session, routing, persistence, prompt, and validation surfaces around explicit 0/1/N repository associations.
---

# Session Model Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for implementation features that change core session/state types, persistence, edge-worker routing/session lifecycle, prompt assembly, F1 validation assets, and the required README surfaces for the repository-association refactor.

## Work Procedure

1. Read `mission.md`, `validation-contract.md`, mission `AGENTS.md`, and the relevant `.factory/library` files before making changes.
2. Read the audit artifact before changing model or runtime code so you know every known assumption site in scope.
3. Write failing targeted tests first for the behavior you are about to change. Prefer package-local tests that directly prove the relevant validation assertions.
4. Implement the smallest coherent slice needed to make those tests pass using the normalized explicit repository-association model. Do not add scattered backwards-compatibility branches.
5. When touching runtime/session code, verify that repository identity is not inferred from repo-keyed containers, singular caches, or singular workspace fields.
6. If edge-worker tests depend on built workspace `dist/` outputs, run `pnpm build` before the affected test commands.
7. Run targeted tests for the changed files, then package typechecks for `cyrus-core`, `cyrus-edge-worker`, `apps/cli`, and `apps/f1` as relevant.
8. For user-surface or end-to-end features, run the F1 validation flow described in `.factory/library/user-testing.md` and capture at least one concrete interactive check in the handoff.
9. Update only the mission-required docs/examples (`README.md`, `packages/edge-worker/README.md`, relevant F1 materials) when the feature scope requires it.
10. In the handoff, map changed tests and validations back to the validation assertion IDs completed by the feature.

## Example Handoff

```json
{
  "salientSummary": "Refactored core session persistence to store explicit repository associations, migrated legacy repo-keyed state into the normalized format, and updated targeted tests plus typechecks.",
  "whatWasImplemented": "Updated CyrusAgentSession and PersistenceManager so zero, one, and many repository associations are represented explicitly and migrated from legacy repo-keyed persisted state. Added/updated targeted tests covering zero-association round trip, single-association restore, multi-association preservation, and one-shot migration behavior.",
  "whatWasLeftUndone": "EdgeWorker runtime still needs follow-up changes to consume the normalized association model end to end.",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm --filter cyrus-core test:run -- PersistenceManager",
        "exitCode": 0,
        "observation": "Migration and repository-association persistence tests passed."
      },
      {
        "command": "pnpm --filter cyrus-core typecheck",
        "exitCode": 0,
        "observation": "Core type surfaces compile after the refactor."
      },
      {
        "command": "pnpm --filter cyrus-edge-worker typecheck",
        "exitCode": 0,
        "observation": "Downstream runtime package still typechecks against the updated core types."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Reviewed the serialized state fixture produced by the targeted tests and confirmed zero, one, and many repository-association records remain explicit after restore.",
        "observed": "No repo-keyed wrapper or primary-repository field was needed to recover association state."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "packages/core/test/PersistenceManager.migration.test.ts",
        "cases": [
          {
            "name": "serializes and restores a zero-repository session explicitly",
            "verifies": "VAL-CORE-001"
          },
          {
            "name": "migrates legacy repo-keyed persisted state into normalized repository associations",
            "verifies": "VAL-CORE-004"
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "RepositoryRouter still falls back to the first workspace repository when user selection is invalid.",
      "suggestedFix": "Address in the routing-and-selection runtime feature before runtime milestone validation."
    }
  ]
}
```

## When to Return to Orchestrator

- The feature requires a change to mission scope, validation assertions, or milestone order.
- A pre-existing baseline failure blocks verification of the behavior you changed and cannot be isolated.
- You find another repository-association assumption outside the feature scope that must be tracked before continuing.
- The refactor would require a broader architectural reset than the current feature can safely handle in one worker session.
