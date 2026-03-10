---
name: analysis-worker
description: Creates exhaustive audit and design artifacts for repository-association refactors.
---

# Analysis Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for artifact-first features: repository-wide audits, checklist-backed maps, architecture/design writeups, migration-boundary documentation, and other non-trivial analysis deliverables that must guide later implementation workers.

## Work Procedure

1. Read `mission.md`, `validation-contract.md`, mission `AGENTS.md`, and the relevant `.factory/library` files before changing anything.
2. If the feature is an audit, enumerate the full file scope first. Use targeted searches plus directory listings so every in-scope file is accounted for. Record explicit checklist sections in the artifact.
3. Distinguish clearly between:
   - direct assumption sites
   - indirect coupling sites
   - unaffected files
   - follow-up notes or validation-only mentions
4. If the feature defines a target model, state the steady-state source of truth explicitly and name which legacy shapes are migration-only inputs.
5. Keep the artifact precise and operational. The next worker should be able to implement from it without guessing.
6. Verify the artifact with targeted `rg` searches and at least one relevant typecheck command if typed/shared artifacts were touched.
7. In the handoff, list the files reviewed, the artifact path updated, and any uncovered assumption sites or blockers for the orchestrator.

## Example Handoff

```json
{
  "salientSummary": "Expanded the repository-association audit into a repo-wide checklist-backed map and documented the normalized source of truth plus migration-only legacy inputs.",
  "whatWasImplemented": "Updated .factory/library/repository-association-audit.md with high-level assumption categories, detailed file findings across apps/packages/tests/docs, per-directory completion checklists, and a target-model section naming explicit repository-association records as the steady-state source of truth.",
  "whatWasLeftUndone": "Did not change runtime code; implementation work remains for core persistence, edge-worker routing/session lifecycle, and user-facing materials.",
  "verification": {
    "commandsRun": [
      {
        "command": "rg -n \"checklist|source of truth|migration-only\" .factory/library/repository-association-audit.md",
        "exitCode": 0,
        "observation": "Confirmed the audit file contains checklist sections and target-model language."
      },
      {
        "command": "pnpm --filter cyrus-core typecheck",
        "exitCode": 0,
        "observation": "Core package still typechecks after the artifact update."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "EdgeWorker runtime still persists agent sessions under repo-keyed containers and retains singular issue-to-repository cache behavior.",
      "suggestedFix": "Address in the runtime adoption features before milestone validation."
    }
  ]
}
```

## When to Return to Orchestrator

- The requested artifact requires a mission-scope decision about the steady-state source of truth that is not yet settled.
- The repository contains a contradictory pattern that changes milestone decomposition.
- The audit reveals a blocking pre-existing issue that would invalidate later implementation or validation work.
